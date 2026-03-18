// brosearch Chrome Extension - Background Service Worker (v2)
// Fixes: scroll/type/keyboard, dialog auto-dismiss, reliable page-load wait,
// body budget (64KB req / 256KB resp / 8MB total), console+error monitoring,
// AX tree depth limit for large pages, concurrency-safe capture, onInstalled/onStartup.

'use strict'

// ─── Configuration ────────────────────────────────────────────────────────────

let DAEMON_URL = 'http://localhost:19824'
let connected = false
let abortController = null
let reconnectAttempts = 0

// ─── Per-tab State ────────────────────────────────────────────────────────────

const attachedTabs    = new Set()
const captureSession  = new Map()  // tabId → { pending, captured, active }
const pendingDialogs  = new Map()  // tabId → { message, type, defaultPrompt }
const pageLoadWaiters = new Map()  // tabId → resolve callback
const consoleMessages = new Map()  // tabId → ConsoleMessage[]
const jsErrors        = new Map()  // tabId → JSError[]

// Memory budget (matching bb-browser)
const MAX_REQUESTS            = 500
const MAX_REQUEST_BODY_BYTES  = 64  * 1024        //  64 KB per request body
const MAX_RESPONSE_BODY_BYTES = 256 * 1024        // 256 KB per response body
const MAX_TAB_BODY_BYTES      = 8   * 1024 * 1024 //   8 MB total per tab
const MAX_CONSOLE_MESSAGES    = 500
const MAX_ERRORS              = 100
const AX_DEFAULT_DEPTH        = 12  // levels; pass depth=-1 for full tree

// Only capture these resource types (adapter generation relevant)
const API_TYPES  = new Set(['XHR', 'Fetch'])
const SKIP_EXTS  = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)(\?|$)/i

// Key code map for pressKey
const KEY_CODES = {
  Enter: 13, Tab: 9, Backspace: 8, Escape: 27, Space: 32,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34, F5: 116
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

async function init() {
  const cfg = await chrome.storage.sync.get({ daemonUrl: 'http://localhost:19824' })
  DAEMON_URL = cfg.daemonUrl.replace(/\/$/, '')
  connect()
}

// Keepalive alarm — MV3 Service Worker dies after 30s of inactivity
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'keepalive' && !connected) connect()
})

// Reconnect on daemon URL change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.daemonUrl) {
    DAEMON_URL = changes.daemonUrl.newValue.replace(/\/$/, '')
    disconnect(); connect()
  }
})

// Handle extension install/update and browser start
chrome.runtime.onInstalled.addListener(() => init())
chrome.runtime.onStartup.addListener(() => init())

// Tab cleanup
chrome.tabs.onRemoved.addListener(cleanupTab)
chrome.debugger.onDetach.addListener(source => { if (source.tabId) cleanupTab(source.tabId) })

function cleanupTab(tabId) {
  attachedTabs.delete(tabId)
  captureSession.delete(tabId)
  pendingDialogs.delete(tabId)
  pageLoadWaiters.delete(tabId)
  consoleMessages.delete(tabId)
  jsErrors.delete(tabId)
}

// ─── SSE via fetch + ReadableStream (EventSource not reliable in MV3) ─────────

async function connect() {
  disconnect()
  abortController = new AbortController()
  try {
    const resp = await fetch(`${DAEMON_URL}/extension/connect`, {
      signal: abortController.signal,
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      keepalive: true
    })
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)
    connected = true
    reconnectAttempts = 0
    updateBadge(true)
    await readSSEStream(resp.body)
  } catch (err) {
    if (err.name === 'AbortError') return
    connected = false
    updateBadge(false)
    reconnectAttempts++
    const delay = Math.min(3000 * Math.pow(2, reconnectAttempts - 1), 60000)
    setTimeout(connect, delay)
  }
}

function disconnect() {
  if (abortController) { abortController.abort(); abortController = null }
  connected = false
}

function updateBadge(ok) {
  chrome.action.setBadgeText({ text: ok ? '✓' : '✗' })
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#22c55e' : '#ef4444' })
}

async function readSSEStream(body) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = '', eventType = '', eventData = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { connected = false; scheduleReconnect(); break }
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (t.startsWith('event:'))      { eventType = t.slice(6).trim() }
        else if (t.startsWith('data:'))  { eventData = t.slice(5).trim() }
        else if (t === '' && eventData) {
          if (!eventType || eventType === 'command') {
            handleCommand(eventData).catch(e => console.error('[brosearch] cmd error:', e))
          }
          eventType = ''; eventData = ''
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') { connected = false; scheduleReconnect() }
  } finally {
    reader.releaseLock()
  }
}

function scheduleReconnect() {
  reconnectAttempts++
  const delay = Math.min(3000 * Math.pow(2, reconnectAttempts - 1), 60000)
  setTimeout(() => { disconnect(); connect() }, delay)
}

// ─── Global CDP Event Dispatcher ─────────────────────────────────────────────
// Single listener routes ALL debugger events — avoids concurrency issues
// from per-capture add/removeListener.

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId
  if (!tabId) return

  // Page load — resolves waitForPageLoad() promise
  if (method === 'Page.loadEventFired') {
    const cb = pageLoadWaiters.get(tabId)
    if (cb) { pageLoadWaiters.delete(tabId); cb() }
  }

  // Dialog — auto-dismiss so pages never hang waiting for user input
  if (method === 'Page.javascriptDialogOpening') {
    pendingDialogs.set(tabId, {
      message: params.message, type: params.type, defaultPrompt: params.defaultPrompt
    })
    // Auto-accept alerts, auto-cancel confirm/prompt
    cdp(tabId, 'Page.handleJavaScriptDialog', {
      accept: params.type === 'alert',
      promptText: params.defaultPrompt || ''
    }).catch(() => {})
  }
  if (method === 'Page.javascriptDialogClosed') pendingDialogs.delete(tabId)

  // Network — route to active capture session for this tab
  if (method.startsWith('Network.')) {
    const session = captureSession.get(tabId)
    if (session?.active) routeCaptureEvent(tabId, session, method, params)
  }

  // Console API calls (console.log, console.error, etc.)
  if (method === 'Runtime.consoleAPICalled') handleConsoleAPI(tabId, params)
  if (method === 'Log.entryAdded')           handleLogEntry(tabId, params)
  if (method === 'Runtime.exceptionThrown')  handleException(tabId, params)
})

// ─── Network Capture Event Handlers ──────────────────────────────────────────

function routeCaptureEvent(tabId, session, method, params) {
  if (method === 'Network.requestWillBeSent') {
    const { requestId, request, type } = params
    if (!API_TYPES.has(type) || SKIP_EXTS.test(request.url)) return
    if (session.pending.size >= MAX_REQUESTS) return

    const reqBody = request.postData
      ? truncateStr(request.postData, MAX_REQUEST_BODY_BYTES) : null

    session.pending.set(requestId, {
      url: request.url, method: request.method,
      headers: request.headers, postData: reqBody, type
    })
  }

  if (method === 'Network.responseReceived') {
    const { requestId, response } = params
    if (!session.pending.has(requestId)) return
    session.captured.set(requestId, {
      request:         session.pending.get(requestId),
      status:          response.status,
      responseHeaders: response.headers,
      mimeType:        response.mimeType
    })
  }

  if (method === 'Network.loadingFinished') {
    const { requestId } = params
    const entry = session.captured.get(requestId)
    if (!entry) return
    // Skip if already over budget
    if (estimateSessionBytes(session) >= MAX_TAB_BODY_BYTES) return

    cdp(tabId, 'Network.getResponseBody', { requestId }).then(res => {
      if (!res) return
      let raw = res.base64Encoded ? atob(res.body) : res.body
      const { text, truncated } = truncateStrObj(raw, MAX_RESPONSE_BODY_BYTES)
      entry.responseBody = text
      if (truncated) entry.bodyTruncated = true
    }).catch(() => {})
  }

  if (method === 'Network.loadingFailed') {
    const entry = session.captured.get(params.requestId)
    if (entry) { entry.failed = true; entry.failureReason = params.errorText }
  }
}

function estimateSessionBytes(session) {
  let total = 0
  for (const e of session.captured.values())
    if (e.responseBody) total += e.responseBody.length * 2
  return total
}

function truncateStr(str, maxBytes) {
  const maxChars = Math.floor(maxBytes / 2)
  return str.length > maxChars ? str.slice(0, maxChars) + '…[truncated]' : str
}

function truncateStrObj(str, maxBytes) {
  const maxChars = Math.floor(maxBytes / 2)
  if (str.length <= maxChars) return { text: str, truncated: false }
  return { text: str.slice(0, maxChars) + '…[truncated]', truncated: true }
}

// ─── Console & Error Handlers ─────────────────────────────────────────────────

function handleConsoleAPI(tabId, params) {
  const msgs = consoleMessages.get(tabId) || []
  if (msgs.length >= MAX_CONSOLE_MESSAGES) msgs.shift()
  const text = (params.args || [])
    .map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ')
  const typeMap = { log:'log', info:'info', warning:'warn', error:'error', debug:'debug' }
  msgs.push({
    type: typeMap[params.type] || 'log', text, timestamp: params.timestamp,
    url: params.stackTrace?.callFrames?.[0]?.url
  })
  consoleMessages.set(tabId, msgs)
}

function handleLogEntry(tabId, params) {
  const msgs = consoleMessages.get(tabId) || []
  if (msgs.length >= MAX_CONSOLE_MESSAGES) msgs.shift()
  const e = params.entry
  const typeMap = { verbose:'debug', info:'info', warning:'warn', error:'error' }
  msgs.push({ type: typeMap[e.level] || 'log', text: e.text, timestamp: e.timestamp, url: e.url })
  consoleMessages.set(tabId, msgs)
}

function handleException(tabId, params) {
  const errs = jsErrors.get(tabId) || []
  if (errs.length >= MAX_ERRORS) errs.shift()
  const d = params.exceptionDetails
  const stack = d.stackTrace?.callFrames
    ?.map(f => `  at ${f.url}:${f.lineNumber}:${f.columnNumber}`).join('\n')
  errs.push({
    message: d.exception?.description || d.text,
    url: d.url, lineNumber: d.lineNumber, columnNumber: d.columnNumber,
    stackTrace: stack, timestamp: params.timestamp
  })
  jsErrors.set(tabId, errs)
}

// ─── Command Dispatch ─────────────────────────────────────────────────────────

async function handleCommand(raw) {
  let cmd
  try { cmd = JSON.parse(raw) } catch { return }
  if (!cmd.id) return

  try {
    let result
    switch (cmd.type) {
      case 'evaluate':         result = await cmdEvaluate(cmd);        break
      case 'capture':          result = await cmdCapture(cmd);         break
      case 'navigate':         result = await cmdNavigate(cmd);        break
      case 'snapshot':         result = await cmdSnapshot(cmd);        break
      case 'snapshot-partial': result = await cmdSnapshotPartial(cmd); break
      case 'click':            result = await cmdClick(cmd);           break
      case 'type':             result = await cmdType(cmd);            break
      case 'key-press':        result = await cmdKeyPress(cmd);        break
      case 'scroll':           result = await cmdScroll(cmd);          break
      case 'screenshot':       result = await cmdScreenshot(cmd);      break
      case 'get-console':      result = await cmdGetConsole(cmd);      break
      case 'get-errors':       result = await cmdGetErrors(cmd);       break
      default: throw new Error(`Unknown command: ${cmd.type}`)
    }
    await reportResult(cmd.id, result, null)
  } catch (err) {
    await reportResult(cmd.id, null, err.message)
  }
}

// ─── Tab & Debugger Management ────────────────────────────────────────────────

async function resolveTab(tabQuery) {
  const q = (tabQuery && Object.keys(tabQuery).length)
    ? tabQuery : { active: true, currentWindow: true }
  const tabs = await chrome.tabs.query(q)
  if (!tabs.length) throw new Error(`No tab matches: ${JSON.stringify(tabQuery)}`)
  return tabs[0]
}

async function ensureAttached(tabId) {
  if (attachedTabs.has(tabId)) return
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
  } catch (e) {
    const msg = e.message || ''
    if (!msg.includes('already attached') && !msg.includes('Another debugger')) throw e
  }
  attachedTabs.add(tabId)
  await cdp(tabId, 'Page.enable')
  await cdp(tabId, 'DOM.enable')
  await cdp(tabId, 'Runtime.enable')
  await cdp(tabId, 'Log.enable').catch(() => {})  // for console monitoring
  if (!consoleMessages.has(tabId)) consoleMessages.set(tabId, [])
  if (!jsErrors.has(tabId))        jsErrors.set(tabId, [])
}

function cdp(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, result => {
      if (chrome.runtime.lastError)
        reject(new Error(chrome.runtime.lastError.message))
      else resolve(result)
    })
  })
}

// ─── CMD: evaluate ───────────────────────────────────────────────────────────

async function cmdEvaluate({ tabQuery, js }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const result = await cdp(tab.id, 'Runtime.evaluate', {
    expression: `(async () => { ${js} })()`,
    awaitPromise: true, returnByValue: true
  })
  if (result?.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || 'JS error')
  return result?.result?.value
}

// ─── CMD: navigate ────────────────────────────────────────────────────────────

async function cmdNavigate({ url, tabQuery }) {
  if (!tabQuery || !Object.keys(tabQuery).length) {
    // New tab — use chrome.tabs API (debugger not yet attached)
    const tab = await chrome.tabs.create({ url, active: true })
    await new Promise(res => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          res()
        }
      }
      chrome.tabs.onUpdated.addListener(listener)
      setTimeout(res, 15000) // 15s max
    })
    return { tabId: tab.id, url }
  }

  // Existing tab — use CDP Page.loadEventFired for reliable wait
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)

  // Register waiter BEFORE navigating to avoid race condition
  const loadPromise = waitForPageLoad(tab.id, 15000)
  await cdp(tab.id, 'Page.navigate', { url })
  await loadPromise
  return { tabId: tab.id, url }
}

function waitForPageLoad(tabId, timeoutMs) {
  return new Promise(resolve => {
    const done = () => {
      pageLoadWaiters.delete(tabId)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    pageLoadWaiters.set(tabId, () => { clearTimeout(timer); done() })
  })
}

// ─── AX Tree Shared Utilities ─────────────────────────────────────────────────

// Returns { tree: string, nodeCount: number, refToNode: Map<ref, AXNode> }
function buildAXTree(nodes) {
  const nodeMap = new Map()
  for (const n of nodes) nodeMap.set(n.nodeId, n)

  let ref = 0
  const refToNode = new Map()
  const lines = []
  const visited = new Set()

  function fmt(node, depth) {
    if (!node || visited.has(node.nodeId)) return
    visited.add(node.nodeId)

    const role = node.role?.value || ''
    const skip = node.ignored || !role || role === 'none' || role === 'generic'
    if (skip) {
      for (const cid of (node.childIds || [])) fmt(nodeMap.get(cid), depth)
      return
    }

    ref++
    refToNode.set(ref, node)

    const name   = node.name?.value || ''
    const indent = '  '.repeat(Math.min(depth, 15))
    const extras = buildNodeExtras(node)
    lines.push(`${indent}@${ref} ${role}${name ? ` "${name.slice(0, 80)}"` : ''}${extras}`)

    for (const cid of (node.childIds || [])) fmt(nodeMap.get(cid), depth + 1)
  }

  if (nodes[0]) fmt(nodes[0], 0)
  return { tree: lines.join('\n'), nodeCount: ref, refToNode }
}

// Append [disabled], [checked], etc. for interactive elements
function buildNodeExtras(node) {
  if (!node.properties) return ''
  const flags = ['disabled','checked','selected','expanded','required']
  const active = node.properties
    .filter(p => flags.includes(p.name) && p.value?.value === true)
    .map(p => p.name)
  return active.length ? ` [${active.join(',')}]` : ''
}

// Fetch AX tree with optional depth limit (large page optimization)
async function fetchAXTree(tabId, depth) {
  await cdp(tabId, 'Accessibility.enable')
  const params = {}
  if (typeof depth === 'number' && depth >= 0) params.depth = depth
  // depth=-1 or undefined → full tree (omit param)
  const { nodes } = await cdp(tabId, 'Accessibility.getFullAXTree', params)
  return nodes
}

// ─── CMD: snapshot ───────────────────────────────────────────────────────────

async function cmdSnapshot({ tabQuery, depth, full = false }) {
  const tab  = await resolveTab(tabQuery)
  await ensureAttached(tab.id)

  // Performance: default depth=AX_DEFAULT_DEPTH. Pass full=true or depth=-1 for complete tree.
  const useDepth = full ? undefined : (depth ?? AX_DEFAULT_DEPTH)
  const nodes    = await fetchAXTree(tab.id, useDepth)
  const { tree, nodeCount } = buildAXTree(nodes)

  return {
    url: tab.url, title: tab.title, tree, nodeCount,
    depthLimited: !full && useDepth !== undefined,
    hint: nodeCount > 500
      ? 'Large page. Pass full=true to get complete tree, or use snapshot-partial.'
      : undefined
  }
}

// ─── CMD: snapshot-partial ───────────────────────────────────────────────────
// Get AX subtree starting from a specific DOM node (by backendNodeId or @ref).
// Use this to zoom into a section of a large page.

async function cmdSnapshotPartial({ tabQuery, backendNodeId, depth = 10 }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  await cdp(tab.id, 'Accessibility.enable')

  const { nodes } = await cdp(tab.id, 'Accessibility.getPartialAXTree', {
    backendNodeId, fetchRelatives: true, depth
  })
  const { tree, nodeCount } = buildAXTree(nodes)
  return { url: tab.url, title: tab.title, tree, nodeCount }
}

// ─── CMD: click ──────────────────────────────────────────────────────────────

async function cmdClick({ tabQuery, ref: targetRef }) {
  const tab  = await resolveTab(tabQuery)
  await ensureAttached(tab.id)

  const nodes = await fetchAXTree(tab.id)
  const { refToNode } = buildAXTree(nodes)
  const targetNode = refToNode.get(targetRef)

  if (!targetNode)          throw new Error(`Element @${targetRef} not found`)
  const backendId = targetNode.backendDOMNodeId
  if (!backendId)           throw new Error(`Element @${targetRef} has no DOM node`)

  await cdp(tab.id, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: backendId }).catch(() => {})

  const { model } = await cdp(tab.id, 'DOM.getBoxModel', { backendNodeId: backendId })
  const c = model.content
  const x = (c[0] + c[2] + c[4] + c[6]) / 4
  const y = (c[1] + c[3] + c[5] + c[7]) / 4

  await cdp(tab.id, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })

  return {
    ref: targetRef, x: Math.round(x), y: Math.round(y),
    role: targetNode.role?.value, name: targetNode.name?.value
  }
}

// ─── CMD: type ───────────────────────────────────────────────────────────────

async function cmdType({ tabQuery, ref, text }) {
  // Focus element first if ref provided
  if (ref !== undefined) await cmdClick({ tabQuery, ref })
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  await cdp(tab.id, 'Input.insertText', { text })
  return { typed: text }
}

// ─── CMD: key-press ──────────────────────────────────────────────────────────

async function cmdKeyPress({ tabQuery, key }) {
  const tab     = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const keyCode = KEY_CODES[key] ?? key.charCodeAt(0)
  await cdp(tab.id, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key, code: key,
    windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode
  })
  if (key.length === 1) {
    await cdp(tab.id, 'Input.dispatchKeyEvent', { type: 'char', text: key, key })
  }
  await cdp(tab.id, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key, code: key,
    windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode
  })
  return { pressed: key }
}

// ─── CMD: scroll ─────────────────────────────────────────────────────────────

async function cmdScroll({ tabQuery, x = 760, y = 400, deltaX = 0, deltaY = 600 }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  await cdp(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y, deltaX, deltaY, modifiers: 0
  })
  return { scrolled: true, x, y, deltaX, deltaY }
}

// ─── CMD: screenshot ─────────────────────────────────────────────────────────

async function cmdScreenshot({ tabQuery, format = 'png', quality, clip, captureBeyondViewport = false }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const { data } = await cdp(tab.id, 'Page.captureScreenshot', {
    format,
    quality: quality ?? (format === 'jpeg' ? 80 : undefined),
    clip,
    fromSurface: true,
    captureBeyondViewport
  })
  return { base64: data, format }
}

// ─── CMD: capture (network) ──────────────────────────────────────────────────

async function cmdCapture({ tabQuery, duration = 5000 }) {
  const tab   = await resolveTab(tabQuery)
  const tabId = tab.id
  await ensureAttached(tabId)

  // Deactivate any existing capture on this tab (concurrent safety)
  const prev = captureSession.get(tabId)
  if (prev?.active) prev.active = false

  const session = { pending: new Map(), captured: new Map(), active: true }
  captureSession.set(tabId, session)

  await cdp(tabId, 'Network.enable')
  await new Promise(res => setTimeout(res, duration))
  session.active = false

  // Brief wait for in-flight body fetches (loadingFinished handlers)
  await new Promise(res => setTimeout(res, 600))

  await cdp(tabId, 'Network.disable').catch(() => {})
  captureSession.delete(tabId)

  return [...session.captured.values()]
}

// ─── CMD: get-console ────────────────────────────────────────────────────────

async function cmdGetConsole({ tabQuery, clear = false }) {
  const tab  = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const msgs = consoleMessages.get(tab.id) || []
  if (clear) consoleMessages.set(tab.id, [])
  return { tabId: tab.id, messages: msgs, count: msgs.length }
}

// ─── CMD: get-errors ─────────────────────────────────────────────────────────

async function cmdGetErrors({ tabQuery, clear = false }) {
  const tab  = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const errs = jsErrors.get(tab.id) || []
  if (clear) jsErrors.set(tab.id, [])
  return { tabId: tab.id, errors: errs, count: errs.length }
}

// ─── Report Result ────────────────────────────────────────────────────────────

async function reportResult(id, data, error) {
  try {
    await fetch(`${DAEMON_URL}/extension/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, data, error })
    })
  } catch (e) {
    console.error('[brosearch] report failed:', e)
  }
}

init()

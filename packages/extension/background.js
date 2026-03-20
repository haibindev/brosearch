// brosearch Chrome Extension - Background Service Worker (v3)
// Full parity with bb-browser: fill/hover/select/reload/tab-mgmt/wait,
// React-compatible input, AX value display, snapshot cache, scroll-to-ref.

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
const axTreeCache     = new Map()  // tabId → { ts, nodes } — 5s snapshot cache

// Memory budget
const MAX_REQUESTS            = 500
const MAX_REQUEST_BODY_BYTES  = 64  * 1024
const MAX_RESPONSE_BODY_BYTES = 256 * 1024
const MAX_TAB_BODY_BYTES      = 8   * 1024 * 1024
const MAX_CONSOLE_MESSAGES    = 500
const MAX_ERRORS              = 100
const AX_DEFAULT_DEPTH        = 12
const AX_CACHE_TTL            = 5000  // ms

const API_TYPES = new Set(['XHR', 'Fetch'])
const SKIP_EXTS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)(\?|$)/i

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

chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'keepalive' && !connected) connect()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.daemonUrl) {
    DAEMON_URL = changes.daemonUrl.newValue.replace(/\/$/, '')
    disconnect(); connect()
  }
})

chrome.runtime.onInstalled.addListener(() => init())
chrome.runtime.onStartup.addListener(() => init())

chrome.tabs.onRemoved.addListener(cleanupTab)
chrome.debugger.onDetach.addListener(src => { if (src.tabId) cleanupTab(src.tabId) })

function cleanupTab(tabId) {
  attachedTabs.delete(tabId)
  captureSession.delete(tabId)
  pendingDialogs.delete(tabId)
  pageLoadWaiters.delete(tabId)
  consoleMessages.delete(tabId)
  jsErrors.delete(tabId)
  axTreeCache.delete(tabId)
}

// ─── SSE ─────────────────────────────────────────────────────────────────────

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
    connected = true; reconnectAttempts = 0; updateBadge(true)
    await readSSEStream(resp.body)
  } catch (err) {
    if (err.name === 'AbortError') return
    connected = false; updateBadge(false)
    reconnectAttempts++
    setTimeout(connect, Math.min(3000 * Math.pow(2, reconnectAttempts - 1), 60000))
  }
}

function disconnect() {
  if (abortController) { abortController.abort(); abortController = null }
  connected = false
}

function updateBadge(ok) {
  if (ok) {
    chrome.action.setBadgeText({ text: '' })
  } else {
    chrome.action.setBadgeText({ text: '✗' })
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })
  }
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
      const lines = buf.split('\n'); buf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (t.startsWith('event:'))     { eventType = t.slice(6).trim() }
        else if (t.startsWith('data:')) { eventData = t.slice(5).trim() }
        else if (t === '' && eventData) {
          if (!eventType || eventType === 'command')
            handleCommand(eventData).catch(e => console.error('[brosearch] cmd error:', e))
          eventType = ''; eventData = ''
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') { connected = false; scheduleReconnect() }
  } finally { reader.releaseLock() }
}

function scheduleReconnect() {
  reconnectAttempts++
  setTimeout(() => { disconnect(); connect() }, Math.min(3000 * Math.pow(2, reconnectAttempts - 1), 60000))
}

// ─── Global CDP Event Dispatcher ─────────────────────────────────────────────

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId
  if (!tabId) return

  if (method === 'Page.loadEventFired') {
    const cb = pageLoadWaiters.get(tabId)
    if (cb) { pageLoadWaiters.delete(tabId); cb() }
  }

  // Invalidate AX tree cache on top-level navigation
  if (method === 'Page.frameNavigated' && !params.frame?.parentId) {
    axTreeCache.delete(tabId)
  }

  if (method === 'Page.javascriptDialogOpening') {
    pendingDialogs.set(tabId, { message: params.message, type: params.type, defaultPrompt: params.defaultPrompt })
    cdp(tabId, 'Page.handleJavaScriptDialog', {
      accept: params.type === 'alert', promptText: params.defaultPrompt || ''
    }).catch(() => {})
  }
  if (method === 'Page.javascriptDialogClosed') pendingDialogs.delete(tabId)

  if (method.startsWith('Network.')) {
    const session = captureSession.get(tabId)
    if (session?.active) routeCaptureEvent(tabId, session, method, params)
  }

  if (method === 'Runtime.consoleAPICalled') handleConsoleAPI(tabId, params)
  if (method === 'Log.entryAdded')           handleLogEntry(tabId, params)
  if (method === 'Runtime.exceptionThrown')  handleException(tabId, params)
})

// ─── Network Capture ─────────────────────────────────────────────────────────

function routeCaptureEvent(tabId, session, method, params) {
  if (method === 'Network.requestWillBeSent') {
    const { requestId, request, type } = params
    if (!API_TYPES.has(type) || SKIP_EXTS.test(request.url)) return
    if (session.pending.size >= MAX_REQUESTS) return
    session.pending.set(requestId, {
      url: request.url, method: request.method,
      headers: request.headers,
      postData: request.postData ? truncateStr(request.postData, MAX_REQUEST_BODY_BYTES) : null,
      type
    })
  }
  if (method === 'Network.responseReceived') {
    const { requestId, response } = params
    if (!session.pending.has(requestId)) return
    session.captured.set(requestId, {
      request: session.pending.get(requestId),
      status: response.status, responseHeaders: response.headers, mimeType: response.mimeType
    })
  }
  if (method === 'Network.loadingFinished') {
    const entry = session.captured.get(params.requestId)
    if (!entry || estimateSessionBytes(session) >= MAX_TAB_BODY_BYTES) return
    cdp(tabId, 'Network.getResponseBody', { requestId: params.requestId }).then(res => {
      if (!res) return
      const raw = res.base64Encoded ? atob(res.body) : res.body
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
  const max = Math.floor(maxBytes / 2)
  return str.length > max ? str.slice(0, max) + '…[truncated]' : str
}

function truncateStrObj(str, maxBytes) {
  const max = Math.floor(maxBytes / 2)
  if (str.length <= max) return { text: str, truncated: false }
  return { text: str.slice(0, max) + '…[truncated]', truncated: true }
}

// ─── Console & Error Handlers ─────────────────────────────────────────────────

function handleConsoleAPI(tabId, params) {
  const msgs = consoleMessages.get(tabId) || []
  if (msgs.length >= MAX_CONSOLE_MESSAGES) msgs.shift()
  const text = (params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ')
  const typeMap = { log:'log', info:'info', warning:'warn', error:'error', debug:'debug' }
  msgs.push({ type: typeMap[params.type] || 'log', text, timestamp: params.timestamp,
    url: params.stackTrace?.callFrames?.[0]?.url })
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
  errs.push({
    message: d.exception?.description || d.text, url: d.url,
    lineNumber: d.lineNumber, columnNumber: d.columnNumber,
    stackTrace: d.stackTrace?.callFrames?.map(f => `  at ${f.url}:${f.lineNumber}:${f.columnNumber}`).join('\n'),
    timestamp: params.timestamp
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
      case 'reload':           result = await cmdReload(cmd);          break
      case 'snapshot':         result = await cmdSnapshot(cmd);        break
      case 'snapshot-partial': result = await cmdSnapshotPartial(cmd); break
      case 'click':            result = await cmdClick(cmd);           break
      case 'hover':            result = await cmdHover(cmd);           break
      case 'type':             result = await cmdType(cmd);            break
      case 'fill':             result = await cmdFill(cmd);            break
      case 'select':           result = await cmdSelect(cmd);          break
      case 'key-press':        result = await cmdKeyPress(cmd);        break
      case 'scroll':           result = await cmdScroll(cmd);          break
      case 'screenshot':       result = await cmdScreenshot(cmd);      break
      case 'tab-list':         result = await cmdTabList();            break
      case 'tab-switch':       result = await cmdTabSwitch(cmd);       break
      case 'tab-close':        result = await cmdTabClose(cmd);        break
      case 'wait':             result = await cmdWait(cmd);            break
      case 'get-console':      result = await cmdGetConsole(cmd);      break
      case 'get-errors':       result = await cmdGetErrors(cmd);       break
      case 'detach':           result = await cmdDetach(cmd);          break
      case 'detach-all':       result = await cmdDetachAll();          break
      default: throw new Error(`Unknown command: ${cmd.type}`)
    }
    await reportResult(cmd.id, result, null)
  } catch (err) {
    await reportResult(cmd.id, null, err.message)
  }
}

// ─── Tab & Debugger ───────────────────────────────────────────────────────────

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
  await cdp(tabId, 'Log.enable').catch(() => {})
  if (!consoleMessages.has(tabId)) consoleMessages.set(tabId, [])
  if (!jsErrors.has(tabId))        jsErrors.set(tabId, [])
}

function cdp(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
      else resolve(result)
    })
  })
}

// ─── AX Tree ─────────────────────────────────────────────────────────────────

async function fetchAXTree(tabId, depth) {
  // Use cache for full-tree fetches (enables snapshot → click without double-fetch)
  if (depth === undefined) {
    const cached = axTreeCache.get(tabId)
    if (cached && Date.now() - cached.ts < AX_CACHE_TTL) return cached.nodes
  }
  await cdp(tabId, 'Accessibility.enable')
  const params = {}
  if (typeof depth === 'number' && depth >= 0) params.depth = depth
  const { nodes } = await cdp(tabId, 'Accessibility.getFullAXTree', params)
  if (depth === undefined) axTreeCache.set(tabId, { ts: Date.now(), nodes })
  return nodes
}

function invalidateAXCache(tabId) {
  axTreeCache.delete(tabId)
}

// Returns { tree, nodeCount, refToNode }
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
    if (node.ignored || !role || role === 'none' || role === 'generic') {
      for (const cid of (node.childIds || [])) fmt(nodeMap.get(cid), depth)
      return
    }
    ref++
    refToNode.set(ref, node)
    const name    = node.name?.value || ''
    const val     = node.value?.value
    const indent  = '  '.repeat(Math.min(depth, 15))
    const nameStr = name ? ` "${name.slice(0, 80)}"` : ''
    // Show current value for inputs/textareas (agents need to know pre-filled state)
    const valStr  = (val !== undefined && val !== null && String(val).trim() && String(val) !== name)
      ? ` [val="${String(val).slice(0, 60)}"]` : ''
    const extras  = buildNodeExtras(node)
    lines.push(`${indent}@${ref} ${role}${nameStr}${valStr}${extras}`)
    for (const cid of (node.childIds || [])) fmt(nodeMap.get(cid), depth + 1)
  }

  if (nodes[0]) fmt(nodes[0], 0)
  return { tree: lines.join('\n'), nodeCount: ref, refToNode }
}

function buildNodeExtras(node) {
  if (!node.properties) return ''
  const flags = ['disabled', 'checked', 'selected', 'expanded', 'required', 'readonly']
  const active = node.properties
    .filter(p => flags.includes(p.name) && p.value?.value === true)
    .map(p => p.name)
  return active.length ? ` [${active.join(',')}]` : ''
}

// Get backendDOMNodeId from @ref (shared by multiple commands)
async function resolveRef(tabId, ref) {
  const nodes = await fetchAXTree(tabId)
  const { refToNode } = buildAXTree(nodes)
  const node = refToNode.get(ref)
  if (!node) throw new Error(`Element @${ref} not found in AX tree`)
  if (!node.backendDOMNodeId) throw new Error(`Element @${ref} has no DOM node`)
  return { node, backendNodeId: node.backendDOMNodeId }
}

// ─── CMD: evaluate ───────────────────────────────────────────────────────────

async function cmdEvaluate({ tabQuery, js }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const result = await cdp(tab.id, 'Runtime.evaluate', {
    expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true
  })
  if (result?.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || 'JS error')
  return result?.result?.value
}

// ─── CMD: navigate ────────────────────────────────────────────────────────────

async function cmdNavigate({ url, tabQuery }) {
  if (!tabQuery || !Object.keys(tabQuery).length) {
    const tab = await chrome.tabs.create({ url, active: true })
    await new Promise(res => {
      const l = (id, info) => { if (id === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(l); res() } }
      chrome.tabs.onUpdated.addListener(l)
      setTimeout(res, 15000)
    })
    return { tabId: tab.id, url }
  }
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  invalidateAXCache(tab.id)
  const loadPromise = waitForPageLoad(tab.id, 15000)
  await cdp(tab.id, 'Page.navigate', { url })
  await loadPromise
  return { tabId: tab.id, url }
}

// ─── CMD: reload ─────────────────────────────────────────────────────────────

async function cmdReload({ tabQuery, ignoreCache = false }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  invalidateAXCache(tab.id)
  const loadPromise = waitForPageLoad(tab.id, 15000)
  await cdp(tab.id, 'Page.reload', { ignoreCache })
  await loadPromise
  return { reloaded: true, url: tab.url, ignoreCache }
}

function waitForPageLoad(tabId, ms) {
  return new Promise(resolve => {
    const done = () => { pageLoadWaiters.delete(tabId); resolve() }
    const timer = setTimeout(done, ms)
    pageLoadWaiters.set(tabId, () => { clearTimeout(timer); done() })
  })
}

// ─── CMD: snapshot ───────────────────────────────────────────────────────────

async function cmdSnapshot({ tabQuery, depth, full = false }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const useDepth = full ? undefined : (depth ?? AX_DEFAULT_DEPTH)
  const nodes = await fetchAXTree(tab.id, useDepth)
  const { tree, nodeCount } = buildAXTree(nodes)
  return {
    url: tab.url, title: tab.title, tree, nodeCount,
    depthLimited: !full && useDepth !== undefined,
    hint: nodeCount > 500 ? 'Large page. Pass full=true or use snapshot-partial.' : undefined
  }
}

// ─── CMD: snapshot-partial ───────────────────────────────────────────────────

async function cmdSnapshotPartial({ tabQuery, backendNodeId, depth = 10 }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  await cdp(tab.id, 'Accessibility.enable')
  const { nodes } = await cdp(tab.id, 'Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: true, depth })
  const { tree, nodeCount } = buildAXTree(nodes)
  return { url: tab.url, title: tab.title, tree, nodeCount }
}

// ─── CMD: click ──────────────────────────────────────────────────────────────

async function cmdClick({ tabQuery, ref: targetRef }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const { node, backendNodeId } = await resolveRef(tab.id, targetRef)
  invalidateAXCache(tab.id)  // page may change after click

  await cdp(tab.id, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {})
  const { model } = await cdp(tab.id, 'DOM.getBoxModel', { backendNodeId })
  const c = model.content
  const x = (c[0] + c[2] + c[4] + c[6]) / 4
  const y = (c[1] + c[3] + c[5] + c[7]) / 4

  await cdp(tab.id, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  return { ref: targetRef, x: Math.round(x), y: Math.round(y), role: node.role?.value, name: node.name?.value }
}

// ─── CMD: hover ──────────────────────────────────────────────────────────────

async function cmdHover({ tabQuery, ref: targetRef }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const { node, backendNodeId } = await resolveRef(tab.id, targetRef)

  await cdp(tab.id, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {})
  const { model } = await cdp(tab.id, 'DOM.getBoxModel', { backendNodeId })
  const c = model.content
  const x = (c[0] + c[2] + c[4] + c[6]) / 4
  const y = (c[1] + c[3] + c[5] + c[7]) / 4

  await cdp(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  return { ref: targetRef, x: Math.round(x), y: Math.round(y), role: node.role?.value, name: node.name?.value }
}

// ─── CMD: type (append, React-compatible via char key events) ─────────────────

async function cmdType({ tabQuery, ref, text }) {
  if (ref !== undefined) await cmdClick({ tabQuery, ref })
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)

  // Char-by-char key events — triggers React's synthetic onChange correctly
  for (const char of text) {
    const code = char.charCodeAt(0)
    await cdp(tab.id, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: char, text: char, windowsVirtualKeyCode: code })
    await cdp(tab.id, 'Input.dispatchKeyEvent', { type: 'char',       key: char, text: char, windowsVirtualKeyCode: code })
    await cdp(tab.id, 'Input.dispatchKeyEvent', { type: 'keyUp',      key: char, text: char, windowsVirtualKeyCode: code })
  }
  return { typed: text }
}

// ─── CMD: fill (clear + set, React-compatible via native setter) ──────────────

async function cmdFill({ tabQuery, ref, text }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)

  // Focus via DOM.focus (not click, to avoid unintended click handlers)
  if (ref !== undefined) {
    const { backendNodeId } = await resolveRef(tab.id, ref)
    await cdp(tab.id, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {})
    await cdp(tab.id, 'DOM.focus', { backendNodeId }).catch(() => {})
  }

  // Use native prototype setter to bypass React's value override, then fire input event
  await cdp(tab.id, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.activeElement
      if (!el) return
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(el, ${JSON.stringify(text)})
      else el.value = ${JSON.stringify(text)}
      el.dispatchEvent(new InputEvent('input',  { bubbles: true, data: ${JSON.stringify(text)} }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })()`,
    awaitPromise: false
  })

  invalidateAXCache(tab.id)
  return { filled: text, ref }
}

// ─── CMD: select (dropdown) ──────────────────────────────────────────────────

async function cmdSelect({ tabQuery, ref: targetRef, value }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const { node, backendNodeId } = await resolveRef(tab.id, targetRef)

  // Resolve to Runtime object and call value setter
  const { object } = await cdp(tab.id, 'DOM.resolveNode', { backendNodeId })
  if (!object?.objectId) throw new Error(`@${targetRef} could not be resolved to DOM object`)

  await cdp(tab.id, 'Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: `function(val) {
      this.value = val
      this.dispatchEvent(new Event('change', { bubbles: true }))
      this.dispatchEvent(new Event('input',  { bubbles: true }))
    }`,
    arguments: [{ value }],
    awaitPromise: false
  })
  // Release object
  await cdp(tab.id, 'Runtime.releaseObject', { objectId: object.objectId }).catch(() => {})

  invalidateAXCache(tab.id)
  return { selected: value, ref: targetRef, role: node.role?.value, name: node.name?.value }
}

// ─── CMD: key-press ──────────────────────────────────────────────────────────

async function cmdKeyPress({ tabQuery, key }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const keyCode = KEY_CODES[key] ?? key.charCodeAt(0)
  await cdp(tab.id, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
  if (key.length === 1) await cdp(tab.id, 'Input.dispatchKeyEvent', { type: 'char', text: key, key })
  await cdp(tab.id, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
  return { pressed: key }
}

// ─── CMD: scroll ─────────────────────────────────────────────────────────────

async function cmdScroll({ tabQuery, ref, x = 760, y = 400, deltaX = 0, deltaY = 600 }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)

  // If @ref given: scroll to bring element into view, dispatch wheel near element
  if (ref !== undefined) {
    try {
      const { backendNodeId } = await resolveRef(tab.id, ref)
      await cdp(tab.id, 'DOM.scrollIntoViewIfNeeded', { backendNodeId })
      const { model } = await cdp(tab.id, 'DOM.getBoxModel', { backendNodeId })
      const c = model.content
      x = (c[0] + c[2] + c[4] + c[6]) / 4
      y = (c[1] + c[3] + c[5] + c[7]) / 4
    } catch {}
  }

  await cdp(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers: 0 })
  return { scrolled: true, x: Math.round(x), y: Math.round(y), deltaX, deltaY }
}

// ─── CMD: screenshot ─────────────────────────────────────────────────────────

async function cmdScreenshot({ tabQuery, format = 'png', quality, clip, captureBeyondViewport = false }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const { data } = await cdp(tab.id, 'Page.captureScreenshot', {
    format, quality: quality ?? (format === 'jpeg' ? 80 : undefined),
    clip, fromSurface: true, captureBeyondViewport
  })
  return { base64: data, format }
}

// ─── CMD: capture ────────────────────────────────────────────────────────────

async function cmdCapture({ tabQuery, duration = 5000 }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const prev = captureSession.get(tab.id)
  if (prev?.active) prev.active = false
  const session = { pending: new Map(), captured: new Map(), active: true }
  captureSession.set(tab.id, session)
  await cdp(tab.id, 'Network.enable')
  await new Promise(res => setTimeout(res, duration))
  session.active = false
  await new Promise(res => setTimeout(res, 600))  // wait for in-flight body fetches
  await cdp(tab.id, 'Network.disable').catch(() => {})
  captureSession.delete(tab.id)
  return [...session.captured.values()]
}

// ─── CMD: tab management ─────────────────────────────────────────────────────

async function cmdTabList() {
  const tabs = await chrome.tabs.query({})
  return tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId }))
}

async function cmdTabSwitch({ tabId }) {
  const tab = await chrome.tabs.get(tabId)
  await chrome.tabs.update(tabId, { active: true })
  await chrome.windows.update(tab.windowId, { focused: true })
  return { switched: true, tabId, url: tab.url }
}

async function cmdTabClose({ tabId }) {
  await chrome.tabs.remove(tabId)
  cleanupTab(tabId)
  return { closed: true, tabId }
}

// ─── CMD: wait ───────────────────────────────────────────────────────────────

async function cmdWait({ ms = 1000 }) {
  const safe = Math.min(Math.max(Number(ms), 0), 30000)
  await new Promise(res => setTimeout(res, safe))
  return { waited_ms: safe }
}

// ─── CMD: get-console / get-errors ───────────────────────────────────────────

async function cmdGetConsole({ tabQuery, clear = false }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const msgs = consoleMessages.get(tab.id) || []
  if (clear) consoleMessages.set(tab.id, [])
  return { tabId: tab.id, messages: msgs, count: msgs.length }
}

async function cmdGetErrors({ tabQuery, clear = false }) {
  const tab = await resolveTab(tabQuery)
  await ensureAttached(tab.id)
  const errs = jsErrors.get(tab.id) || []
  if (clear) jsErrors.set(tab.id, [])
  return { tabId: tab.id, errors: errs, count: errs.length }
}

// ─── CMD: detach ────────────────────────────────────────────────────────────

async function cmdDetach({ tabQuery }) {
  const tab = await resolveTab(tabQuery)
  if (attachedTabs.has(tab.id)) {
    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {})
    cleanupTab(tab.id)
  }
  return { detached: true, tabId: tab.id }
}

async function cmdDetachAll() {
  const tabIds = [...attachedTabs]
  for (const tabId of tabIds) {
    await chrome.debugger.detach({ tabId }).catch(() => {})
    cleanupTab(tabId)
  }
  return { detached: tabIds.length, tabIds }
}

// ─── Report ───────────────────────────────────────────────────────────────────

async function reportResult(id, data, error) {
  try {
    await fetch(`${DAEMON_URL}/extension/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, data, error })
    })
  } catch (e) { console.error('[brosearch] report failed:', e) }
}

init()

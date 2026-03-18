import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { ExtensionBridge } from './extension-bridge'
import { AdapterRouter } from './router'

const PORT = parseInt(process.env.BROSEARCH_PORT || '19824')
const HOST = process.env.BROSEARCH_HOST || '0.0.0.0'

const bridge = new ExtensionBridge()
const router = new AdapterRouter(bridge)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(body)
}

function requireExtension(res: ServerResponse): boolean {
  if (!bridge.isConnected()) {
    json(res, 503, { ok: false, error: 'Chrome extension not connected' })
    return false
  }
  return true
}

async function parseBody(req: IncomingMessage) {
  const raw = await readBody(req)
  return raw ? JSON.parse(raw) : {}
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function route(req: IncomingMessage, res: ServerResponse) {
  const url    = req.url ?? '/'
  const method = req.method ?? 'GET'

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    })
    res.end()
    return
  }

  // ── Extension SSE stream
  if (method === 'GET' && url === '/extension/connect') {
    bridge.handleExtensionConnect(req, res); return
  }

  // ── Extension posts result back
  if (method === 'POST' && url === '/extension/result') {
    const { id, data, error } = await parseBody(req)
    bridge.receiveResult(id, data, error)
    json(res, 200, { ok: true }); return
  }

  // ── POST /api/fetch  { platform, command, args }
  if (method === 'POST' && url === '/api/fetch') {
    const { platform, command, args = {} } = await parseBody(req)
    if (!platform || !command) { json(res, 400, { error: 'platform and command required' }); return }
    try { json(res, 200, { ok: true, data: await router.execute(platform, command, args) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── GET /api/fetch/:platform/:command?key=val
  const fetchMatch = url.match(/^\/api\/fetch\/([^/]+)\/([^/?]+)(\?.*)?$/)
  if (method === 'GET' && fetchMatch) {
    const [, platform, command, qs] = fetchMatch
    const args = Object.fromEntries(new URLSearchParams(qs?.slice(1) ?? ''))
    try { json(res, 200, { ok: true, data: await router.execute(platform, command, args) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/capture  { tabQuery, duration }
  if (method === 'POST' && url === '/api/capture') {
    if (!requireExtension(res)) return
    const { tabQuery = {}, duration = 5000 } = await parseBody(req)
    try { json(res, 200, { ok: true, data: await bridge.capture(tabQuery, duration) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/navigate  { url, tabQuery? }
  if (method === 'POST' && url === '/api/navigate') {
    if (!requireExtension(res)) return
    const { url: targetUrl, tabQuery } = await parseBody(req)
    if (!targetUrl) { json(res, 400, { error: 'url required' }); return }
    try { json(res, 200, { ok: true, data: await bridge.navigate(targetUrl, tabQuery) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/snapshot  { tabQuery?, depth?, full? }
  if (method === 'POST' && url === '/api/snapshot') {
    if (!requireExtension(res)) return
    const { tabQuery, depth, full } = await parseBody(req)
    try { json(res, 200, { ok: true, data: await bridge.snapshot(tabQuery, { depth, full }) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/snapshot-partial  { backendNodeId, tabQuery?, depth? }
  if (method === 'POST' && url === '/api/snapshot-partial') {
    if (!requireExtension(res)) return
    const { backendNodeId, tabQuery, depth = 10 } = await parseBody(req)
    if (backendNodeId == null) { json(res, 400, { error: 'backendNodeId required' }); return }
    try { json(res, 200, { ok: true, data: await bridge.snapshotPartial(backendNodeId, tabQuery, depth) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/click  { ref, tabQuery? }
  if (method === 'POST' && url === '/api/click') {
    if (!requireExtension(res)) return
    const { ref, tabQuery } = await parseBody(req)
    if (ref == null) { json(res, 400, { error: 'ref required' }); return }
    try { json(res, 200, { ok: true, data: await bridge.click(ref, tabQuery) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/type  { text, ref?, tabQuery? }
  if (method === 'POST' && url === '/api/type') {
    if (!requireExtension(res)) return
    const { text, ref, tabQuery } = await parseBody(req)
    if (!text) { json(res, 400, { error: 'text required' }); return }
    try { json(res, 200, { ok: true, data: await bridge.type(text, ref, tabQuery) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/key-press  { key, tabQuery? }
  if (method === 'POST' && url === '/api/key-press') {
    if (!requireExtension(res)) return
    const { key, tabQuery } = await parseBody(req)
    if (!key) { json(res, 400, { error: 'key required' }); return }
    try { json(res, 200, { ok: true, data: await bridge.keyPress(key, tabQuery) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/scroll  { deltaY?, deltaX?, x?, y?, ref?, tabQuery? }
  if (method === 'POST' && url === '/api/scroll') {
    if (!requireExtension(res)) return
    const { deltaX, deltaY, x, y, ref, tabQuery } = await parseBody(req)
    try { json(res, 200, { ok: true, data: await bridge.scroll({ deltaX, deltaY, x, y, ref }, tabQuery) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/fill  { text, ref, tabQuery? }
  if (method === 'POST' && url === '/api/fill') {
    if (!requireExtension(res)) return
    const { text, ref, tabQuery } = await parseBody(req)
    if (!text || ref == null) { json(res, 400, { error: 'text and ref required' }); return }
    try { json(res, 200, { ok: true, data: await bridge.fill(text, ref, tabQuery) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/hover  { ref, tabQuery? }
  if (method === 'POST' && url === '/api/hover') {
    if (!requireExtension(res)) return
    const { ref, tabQuery } = await parseBody(req)
    if (ref == null) { json(res, 400, { error: 'ref required' }); return }
    try { json(res, 200, { ok: true, data: await bridge.hover(ref, tabQuery) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/select  { ref, value, tabQuery? }
  if (method === 'POST' && url === '/api/select') {
    if (!requireExtension(res)) return
    const { ref, value, tabQuery } = await parseBody(req)
    if (ref == null || value == null) { json(res, 400, { error: 'ref and value required' }); return }
    try { json(res, 200, { ok: true, data: await bridge.select(ref, value, tabQuery) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/reload  { tabQuery? }
  if (method === 'POST' && url === '/api/reload') {
    if (!requireExtension(res)) return
    const { tabQuery } = await parseBody(req)
    try { json(res, 200, { ok: true, data: await bridge.reload(tabQuery) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/tabs
  if (method === 'POST' && url === '/api/tabs') {
    if (!requireExtension(res)) return
    try { json(res, 200, { ok: true, data: await bridge.tabList() }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/tab/switch  { tabId }
  if (method === 'POST' && url === '/api/tab/switch') {
    if (!requireExtension(res)) return
    const { tabId } = await parseBody(req)
    if (tabId == null) { json(res, 400, { error: 'tabId required' }); return }
    try { json(res, 200, { ok: true, data: await bridge.tabSwitch(tabId) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/tab/close  { tabId }
  if (method === 'POST' && url === '/api/tab/close') {
    if (!requireExtension(res)) return
    const { tabId } = await parseBody(req)
    if (tabId == null) { json(res, 400, { error: 'tabId required' }); return }
    try { json(res, 200, { ok: true, data: await bridge.tabClose(tabId) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/wait  { ms }
  if (method === 'POST' && url === '/api/wait') {
    if (!requireExtension(res)) return
    const { ms = 1000 } = await parseBody(req)
    try { json(res, 200, { ok: true, data: await bridge.wait(Number(ms)) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/screenshot  { tabQuery?, format?, quality?, clip?, captureBeyondViewport? }
  if (method === 'POST' && url === '/api/screenshot') {
    if (!requireExtension(res)) return
    const { tabQuery, format, quality, clip, captureBeyondViewport } = await parseBody(req)
    try { json(res, 200, { ok: true, data: await bridge.screenshot(tabQuery, { format, quality, clip, captureBeyondViewport }) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/console  { tabQuery?, clear? }
  if (method === 'POST' && url === '/api/console') {
    if (!requireExtension(res)) return
    const { tabQuery, clear = false } = await parseBody(req)
    try { json(res, 200, { ok: true, data: await bridge.getConsole(tabQuery, clear) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── POST /api/errors  { tabQuery?, clear? }
  if (method === 'POST' && url === '/api/errors') {
    if (!requireExtension(res)) return
    const { tabQuery, clear = false } = await parseBody(req)
    try { json(res, 200, { ok: true, data: await bridge.getErrors(tabQuery, clear) }) }
    catch (e: any) { json(res, 500, { ok: false, error: e.message }) }
    return
  }

  // ── GET /api/adapters
  if (method === 'GET' && url === '/api/adapters') {
    json(res, 200, router.listAdapters()); return
  }

  // ── GET /health
  if (method === 'GET' && url === '/health') {
    json(res, 200, { ok: true, extension_connected: bridge.isConnected(), version: '0.2.0' }); return
  }

  json(res, 404, { error: 'Not found' })
}

// ─── Start ────────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try { await route(req, res) }
  catch (e: any) { json(res, 500, { error: e.message }) }
})

server.listen(PORT, HOST, () => {
  console.log(`brosearch daemon  http://${HOST}:${PORT}`)
})

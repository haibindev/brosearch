import type { IncomingMessage, ServerResponse } from 'node:http'

interface Pending {
  resolve: (data: any) => void
  reject:  (err: Error) => void
  timeout: NodeJS.Timeout
}

export class ExtensionBridge {
  private res:     ServerResponse | null = null
  private pending  = new Map<string, Pending>()
  private seq      = 0

  // Extension connects here via SSE
  handleExtensionConnect(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type':                'text/event-stream',
      'Cache-Control':               'no-cache',
      'Connection':                  'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })
    res.flushHeaders()
    this.res = res
    console.log('[bridge] Extension connected')

    const keepalive = setInterval(() => res.write('event: heartbeat\ndata: {}\n\n'), 15000)
    req.on('close', () => {
      clearInterval(keepalive)
      this.res = null
      console.log('[bridge] Extension disconnected')
    })
  }

  isConnected() { return this.res !== null }

  // Called when extension posts result back
  receiveResult(id: string, data: any, error?: string) {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timeout)
    error ? p.reject(new Error(error)) : p.resolve(data)
  }

  // ─── Command Methods ───────────────────────────────────────────────────────

  evaluate(tabQuery: object, js: string, timeoutMs = 15000): Promise<any> {
    return this._send({ type: 'evaluate', tabQuery, js }, timeoutMs)
  }

  capture(tabQuery: object, duration: number, timeoutMs?: number): Promise<any> {
    return this._send({ type: 'capture', tabQuery, duration }, timeoutMs ?? duration + 10000)
  }

  navigate(url: string, tabQuery?: object, timeoutMs = 20000): Promise<any> {
    return this._send({ type: 'navigate', url, tabQuery }, timeoutMs)
  }

  snapshot(tabQuery?: object, opts: { depth?: number; full?: boolean } = {}, timeoutMs = 15000): Promise<any> {
    return this._send({ type: 'snapshot', tabQuery, ...opts }, timeoutMs)
  }

  snapshotPartial(backendNodeId: number, tabQuery?: object, depth = 10, timeoutMs = 15000): Promise<any> {
    return this._send({ type: 'snapshot-partial', tabQuery, backendNodeId, depth }, timeoutMs)
  }

  click(ref: number, tabQuery?: object, timeoutMs = 10000): Promise<any> {
    return this._send({ type: 'click', ref, tabQuery }, timeoutMs)
  }

  type(text: string, ref?: number, tabQuery?: object, timeoutMs = 10000): Promise<any> {
    return this._send({ type: 'type', text, ref, tabQuery }, timeoutMs)
  }

  keyPress(key: string, tabQuery?: object, timeoutMs = 5000): Promise<any> {
    return this._send({ type: 'key-press', key, tabQuery }, timeoutMs)
  }

  scroll(opts: { x?: number; y?: number; deltaX?: number; deltaY?: number; ref?: number }, tabQuery?: object, timeoutMs = 5000): Promise<any> {
    return this._send({ type: 'scroll', ...opts, tabQuery }, timeoutMs)
  }

  fill(text: string, ref: number, tabQuery?: object, timeoutMs = 10000): Promise<any> {
    return this._send({ type: 'fill', text, ref, tabQuery }, timeoutMs)
  }

  hover(ref: number, tabQuery?: object, timeoutMs = 10000): Promise<any> {
    return this._send({ type: 'hover', ref, tabQuery }, timeoutMs)
  }

  select(ref: number, value: string, tabQuery?: object, timeoutMs = 10000): Promise<any> {
    return this._send({ type: 'select', ref, value, tabQuery }, timeoutMs)
  }

  reload(tabQuery?: object, timeoutMs = 20000): Promise<any> {
    return this._send({ type: 'reload', tabQuery }, timeoutMs)
  }

  tabList(timeoutMs = 5000): Promise<any> {
    return this._send({ type: 'tab-list' }, timeoutMs)
  }

  tabSwitch(tabId: number, timeoutMs = 5000): Promise<any> {
    return this._send({ type: 'tab-switch', tabId }, timeoutMs)
  }

  tabClose(tabId: number, timeoutMs = 5000): Promise<any> {
    return this._send({ type: 'tab-close', tabId }, timeoutMs)
  }

  wait(ms: number, timeoutMs?: number): Promise<any> {
    return this._send({ type: 'wait', ms }, timeoutMs ?? ms + 5000)
  }

  screenshot(tabQuery?: object, opts: { format?: string; quality?: number; clip?: object; captureBeyondViewport?: boolean } = {}, timeoutMs = 10000): Promise<any> {
    return this._send({ type: 'screenshot', tabQuery, ...opts }, timeoutMs)
  }

  getConsole(tabQuery?: object, clear = false, timeoutMs = 5000): Promise<any> {
    return this._send({ type: 'get-console', tabQuery, clear }, timeoutMs)
  }

  getErrors(tabQuery?: object, clear = false, timeoutMs = 5000): Promise<any> {
    return this._send({ type: 'get-errors', tabQuery, clear }, timeoutMs)
  }

  private _send(payload: object, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.res) return reject(new Error('Chrome extension not connected'))
      const id      = `req_${++this.seq}`
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timeout (${timeoutMs}ms)`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      this.res.write(`event: command\ndata: ${JSON.stringify({ id, ...payload })}\n\n`)
    })
  }
}

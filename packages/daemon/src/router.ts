import fs from 'fs'
import path from 'path'
import { ExtensionBridge } from './extension-bridge'

// Adapters live in /adapters/<platform>/<command>.js
// Each adapter exports: { tabQuery, buildJs(args) }
// tabQuery: Chrome tab matching (e.g. { url: '*://twitter.com/*' })
// buildJs(args): returns JS string to evaluate in page context

const ADAPTERS_DIR = path.resolve(__dirname, '../../../adapters')

interface Adapter {
  tabQuery: object
  buildJs: (args: Record<string, any>) => string
  description?: string
}

export class AdapterRouter {
  private adapters = new Map<string, Adapter>()

  constructor(private bridge: ExtensionBridge) {
    this.loadAdapters()
  }

  private loadAdapters() {
    if (!fs.existsSync(ADAPTERS_DIR)) return

    for (const platform of fs.readdirSync(ADAPTERS_DIR)) {
      const platformDir = path.join(ADAPTERS_DIR, platform)
      if (!fs.statSync(platformDir).isDirectory()) continue

      for (const file of fs.readdirSync(platformDir)) {
        if (!file.endsWith('.js')) continue
        const command = file.replace('.js', '')
        const key = `${platform}/${command}`
        try {
          const adapter = require(path.join(platformDir, file))
          this.adapters.set(key, adapter)
        } catch (e) {
          console.warn(`[router] Failed to load adapter ${key}:`, e)
        }
      }
    }

    console.log(`[router] Loaded ${this.adapters.size} adapters:`, [...this.adapters.keys()].join(', '))
  }

  async execute(platform: string, command: string, args: Record<string, any>): Promise<any> {
    const key = `${platform}/${command}`
    const adapter = this.adapters.get(key)

    if (!adapter) {
      throw new Error(`No adapter for ${key}. Available: ${[...this.adapters.keys()].join(', ')}`)
    }

    const js = adapter.buildJs(args)

    // Public API adapters (empty tabQuery): execute directly in Node.js — no browser needed
    if (!adapter.tabQuery || Object.keys(adapter.tabQuery).length === 0) {
      const fn = new Function(`return (async () => { ${js} })()`)
      return await fn()
    }

    // Site-specific adapters: execute in browser tab via extension
    return this.bridge.evaluate(adapter.tabQuery, js)
  }

  listAdapters(): Record<string, any> {
    const result: Record<string, any> = {}
    for (const [key, adapter] of this.adapters) {
      result[key] = { description: adapter.description || '' }
    }
    return result
  }
}

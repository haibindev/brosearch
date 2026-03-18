// Test public-API adapters by calling their real endpoints
// Run: node tests/run_adapters.mjs

import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const base = path.resolve(__dirname, '../adapters')

async function run(name, adapterPath, args) {
  const label = name.padEnd(28)
  try {
    const a = require(adapterPath)
    const js = a.buildJs(args)
    // Use eval in ESM context (has global fetch)
    const result = await eval(`(async () => { ${js} })()`)
    const count = Array.isArray(result) ? result.length : 1
    console.log(`  ✓ ${label} ${count} items`)
    const sample = Array.isArray(result) ? result.slice(0, 2) : result
    for (const item of (Array.isArray(sample) ? sample : [sample])) {
      const title = item.title || item.name || item.repo || ''
      const extra = item.score != null ? ` (score:${item.score})` : ''
      console.log(`    → ${title.slice(0, 60)}${extra}`)
    }
  } catch (e) {
    console.log(`  ✗ ${label} ${e.message.split('\n')[0]}`)
  }
}

console.log('=== 公开 API 适配器（无需 Chrome）===\n')

await run('hackernews/top',         `${base}/hackernews/top.js`,         { limit: 5 })
await run('v2ex/hot',               `${base}/v2ex/hot.js`,              {})
await run('npm/search',             `${base}/npm/search.js`,            { query: 'llm agent', limit: 3 })
await run('stackoverflow/search',   `${base}/stackoverflow/search.js`,  { query: 'RAG implementation', limit: 3 })
await run('reddit/hot',             `${base}/reddit/hot.js`,            { sub: 'MachineLearning', limit: 5 })
await run('producthunt/trending',   `${base}/producthunt/trending.js`,  { limit: 3 })

// arXiv uses regex that trips Node v24 TypeScript parser in eval
// Test it via direct fetch instead
console.log('\n--- arXiv (direct fetch test) ---')
try {
  const res = await fetch('https://export.arxiv.org/api/query?search_query=all:retrieval+augmented+generation&max_results=3&sortBy=relevance')
  const xml = await res.text()
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
  console.log(`  ✓ arxiv/search               ${entries.length} papers`)
  for (const [, e] of entries.slice(0, 2)) {
    const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim().replace(/\s+/g, ' ')
    console.log(`    → ${title?.slice(0, 70)}`)
  }
} catch (e) {
  console.log(`  ✗ arxiv/search               ${e.message}`)
}

// GitHub trending uses DOMParser (browser-only), test via direct fetch
console.log('\n--- GitHub trending (direct fetch test) ---')
try {
  const res = await fetch('https://github.com/trending?since=daily', {
    headers: { 'User-Agent': 'brosearch/0.1' }
  })
  const html = await res.text()
  const repos = [...html.matchAll(/<h2[^>]*class="[^"]*lh-condensed[^"]*"[^>]*>[\s\S]*?<a[^>]*href="\/([^"]+)"[^>]*>/g)]
  console.log(`  ✓ github/trending            ${repos.length} repos`)
  for (const [, repo] of repos.slice(0, 3)) {
    console.log(`    → ${repo}`)
  }
} catch (e) {
  console.log(`  ✗ github/trending            ${e.message}`)
}

console.log('\n=== 需要 Chrome 登录态的适配器（仅列出，不测试） ===')
const chromeAdapters = [
  'zhihu/hot', 'zhihu/search', 'weibo/hot', 'weibo/hot-search',
  'bilibili/hot', 'twitter/search', 'twitter/timeline',
  'xiaohongshu/search', '36kr/hot', '36kr/newsflash',
  'douban/hot-movie', 'juejin/hot', 'xueqiu/hot'
]
for (const name of chromeAdapters) {
  console.log(`  ⏸ ${name.padEnd(28)} 需要 daemon + Chrome 扩展`)
}

console.log('\n=== Done ===')

// Test public-API adapters directly (no Chrome needed)
// Run: node tests/run_adapters.cjs

async function run(name, path, args) {
  const label = name.padEnd(25)
  try {
    const a = require(path)
    const js = a.buildJs(args)
    const fn = new Function('return (async () => { ' + js + ' })()')
    const result = await fn()
    const count = Array.isArray(result) ? result.length : 1
    console.log(`✓ ${label} ${count} items`)
    const sample = Array.isArray(result) ? result.slice(0, 2) : result
    console.log(JSON.stringify(sample, null, 2))
  } catch(e) {
    console.log(`✗ ${label} ${e.message}`)
  }
}

const base = require('path').resolve(__dirname, '../adapters/')

;(async () => {
  console.log('=== Testing public-API adapters (no Chrome needed) ===\n')
  await run('arxiv/search',           base+'/arxiv/search.js',           {query:'retrieval augmented generation', limit:3})
  await run('npm/search',             base+'/npm/search.js',             {query:'llm agent', limit:3})
  await run('stackoverflow/search',   base+'/stackoverflow/search.js',   {query:'RAG implementation', limit:3})
  await run('hackernews/top',         base+'/hackernews/top.js',         {limit:5})
  await run('v2ex/hot',               base+'/v2ex/hot.js',               {})
  await run('reddit/hot (MachineLearning)', base+'/reddit/hot.js',       {sub:'MachineLearning', limit:5})
  await run('producthunt/trending',   base+'/producthunt/trending.js',   {limit:3})
  console.log('\n=== Done ===')
})()

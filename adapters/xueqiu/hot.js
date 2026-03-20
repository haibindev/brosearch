// Xueqiu hot stocks - Tier 1: Cookie fetch
module.exports = {
  description: '雪球热门股票',
  tabQuery: { url: '*://xueqiu.com/*' },
  buildJs: (args) => `
    const size = ${Number(args.limit) || 20}
    const type = ${JSON.stringify(args.type || '10')}

    // Strategy 1: hot_stock API (bb-sites approach)
    async function viaHotStock() {
      const res = await fetch(
        'https://stock.xueqiu.com/v5/stock/hot_stock/list.json?size=' + size + '&type=' + type,
        { credentials: 'include', headers: { Accept: 'application/json' } }
      )
      if (!res.ok) throw new Error('hot_stock API ' + res.status)
      const json = await res.json()
      const items = json?.data?.items || []
      if (!items.length) throw new Error('hot_stock returned empty')
      return items.map(s => ({
        symbol:      s.symbol,
        name:        s.name,
        price:       s.current,
        change:      s.percent != null ? (s.percent > 0 ? '+' : '') + s.percent + '%' : null,
        value:       s.value,
        rank_change: s.rank_change,
        url:         'https://xueqiu.com/S/' + s.symbol
      }))
    }

    // Strategy 2: screener API (fallback)
    async function viaScreener() {
      const res = await fetch(
        'https://xueqiu.com/service/v5/stock/screener/quote/list?size=' + size + '&order=desc&orderby=percent&type=sh_sz',
        { credentials: 'include', headers: { Accept: 'application/json' } }
      )
      if (!res.ok) throw new Error('screener API ' + res.status)
      const json = await res.json()
      const items = json?.data?.list || []
      if (!items.length) throw new Error('screener returned empty')
      return items.map(s => ({
        symbol:      s.symbol,
        name:        s.name,
        price:       s.current,
        change:      s.percent != null ? (s.percent > 0 ? '+' : '') + s.percent + '%' : null,
        value:       s.volume,
        rank_change: null,
        url:         'https://xueqiu.com/S/' + s.symbol
      }))
    }

    try { return await viaHotStock() }
    catch(e1) {
      try { return await viaScreener() }
      catch(e2) { throw new Error('All strategies failed: ' + e1.message + '; ' + e2.message) }
    }
  `
}

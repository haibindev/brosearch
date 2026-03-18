module.exports = {
  description: '雪球热门股票（涨幅榜）',
  tabQuery: { url: '*://xueqiu.com/*' },
  buildJs: (args) => `
    const size = ${Number(args.limit) || 20}
    const market = ${JSON.stringify(args.market || 'CN')}
    const res  = await fetch(
      \`https://xueqiu.com/service/v5/stock/screener/quote/list?size=\${size}&order=desc&orderby=percent&type=\${market}\`,
      { credentials: 'include', headers: { Accept: 'application/json' } }
    )
    const data = await res.json()
    return (data?.data?.list || []).map(s => ({
      symbol: s.symbol,
      name:   s.name,
      price:  s.current,
      change: (s.percent > 0 ? '+' : '') + s.percent + '%',
      volume: s.volume,
      cap:    s.market_capital
    }))
  `
}

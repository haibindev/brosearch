module.exports = {
  description: '36kr 最新快讯',
  tabQuery: { url: '*://36kr.com/*' },
  buildJs: (args) => `
    const limit = ${Number(args.limit) || 20}
    const res   = await fetch(
      \`https://36kr.com/api/newsflash/home-flow?column=flow&limit=\${limit}\`,
      { credentials: 'include', headers: { 'Content-Type': 'application/json' } }
    )
    const data = await res.json()
    return (data?.data?.items || []).map(item => ({
      id:    item.id,
      title: item.itemData?.newsFlashContent || item.itemData?.title,
      time:  item.itemData?.publishTime,
      url:   'https://36kr.com/newsflashes/' + item.id
    }))
  `
}

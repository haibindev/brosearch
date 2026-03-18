module.exports = {
  description: '36kr 热门文章',
  tabQuery: { url: '*://36kr.com/*' },
  buildJs: (args) => `
    const limit = ${Number(args.limit) || 20}
    const res   = await fetch(
      'https://36kr.com/api/information-flow/list/flow/hot',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column: 'hot', limit, pageSize: limit })
      }
    )
    const data = await res.json()
    return (data?.data?.items || []).map(item => ({
      id:      item.id,
      title:   item.itemData?.widgetTitle || item.itemData?.title,
      summary: item.itemData?.summary,
      author:  item.itemData?.authorName,
      time:    item.itemData?.publishTime,
      url:     'https://36kr.com/p/' + item.id
    }))
  `
}

module.exports = {
  description: '豆瓣热门电影',
  tabQuery: { url: '*://douban.com/*' },
  buildJs: (args) => `
    const limit = ${Number(args.limit) || 20}
    const type  = ${JSON.stringify(args.type || 'movie')}
    const res   = await fetch(
      \`https://movie.douban.com/j/search_subjects?type=\${type}&tag=热门&sort=recommend&page_limit=\${limit}&page_start=0\`,
      { credentials: 'include' }
    )
    const data = await res.json()
    return (data?.subjects || []).map(m => ({
      id:     m.id,
      title:  m.title,
      rate:   m.rate,
      url:    m.url,
      cover:  m.cover
    }))
  `
}

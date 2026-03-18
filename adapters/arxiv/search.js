module.exports = {
  description: 'Search arXiv papers by keyword',
  tabQuery: {},
  buildJs: (args) => `
    const query = encodeURIComponent(${JSON.stringify(args.query || '')})
    const limit = ${Number(args.limit) || 10}
    const res  = await fetch(
      \`https://export.arxiv.org/api/query?search_query=all:\${query}&max_results=\${limit}&sortBy=relevance\`
    )
    const xml = await res.text()
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    return entries.map(([, e]) => ({
      id:        (e.match(/<id>(.*?)<\/id>/)     || [])[1]?.split('/').pop(),
      title:     (e.match(/<title>([\s\S]*?)<\/title>/)   || [])[1]?.trim().replace(/\s+/g, ' '),
      authors:   [...e.matchAll(/<name>(.*?)<\/name>/g)].map(m => m[1]).join(', '),
      summary:   (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.trim().replace(/\s+/g, ' ').slice(0, 400),
      published: (e.match(/<published>(.*?)<\/published>/) || [])[1]?.slice(0, 10),
      link:      (e.match(/<id>(.*?)<\/id>/) || [])[1]
    }))
  `
}

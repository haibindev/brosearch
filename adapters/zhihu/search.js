// Zhihu search - Tier 1: Cookie fetch
module.exports = {
  description: 'Search Zhihu',
  tabQuery: { url: '*://www.zhihu.com/*' },
  buildJs: ({ query, limit = 10 }) => `
    const params = new URLSearchParams({
      t: 'general',
      q: ${JSON.stringify(query)},
      correction: '1',
      offset: '0',
      limit: String(${limit}),
      filter_fields: '',
      lc_idx: '0',
      show_all_topics: '0'
    })
    const res = await fetch('https://www.zhihu.com/api/v4/search_v3?' + params, {
      credentials: 'include',
      headers: { 'x-requested-with': 'fetch' }
    })
    const json = await res.json()
    return (json.data || []).map(item => ({
      type: item.type,
      title: item.object?.title || item.object?.question?.title,
      excerpt: item.object?.excerpt,
      author: item.object?.author?.name,
      url: item.object?.url
    })).filter(x => x.title)
  `
}

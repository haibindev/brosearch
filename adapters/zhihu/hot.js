// Zhihu hot list - Tier 1: Cookie fetch
module.exports = {
  description: 'Get Zhihu hot list',
  tabQuery: { url: '*://www.zhihu.com/*' },
  buildJs: ({ limit = 20 }) => `
    const res = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=${limit}', {
      credentials: 'include',
      headers: { 'x-requested-with': 'fetch' }
    })
    const json = await res.json()
    return (json.data || []).map(item => ({
      title: item.target?.title || item.target?.question?.title,
      excerpt: item.target?.excerpt,
      heat: item.detail_text,
      url: 'https://www.zhihu.com/question/' + (item.target?.id || '')
    }))
  `
}

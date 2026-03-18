// Bilibili hot videos - Tier 1: Cookie fetch
module.exports = {
  description: 'Get Bilibili hot videos',
  tabQuery: { url: '*://www.bilibili.com/*' },
  buildJs: ({ limit = 20 }) => `
    const res = await fetch(
      'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all',
      { credentials: 'include' }
    )
    const json = await res.json()
    return (json.data?.list || []).slice(0, ${limit}).map(v => ({
      bvid: v.bvid,
      title: v.title,
      author: v.owner?.name,
      view: v.stat?.view,
      like: v.stat?.like,
      coin: v.stat?.coin,
      desc: v.desc,
      url: 'https://www.bilibili.com/video/' + v.bvid
    }))
  `
}

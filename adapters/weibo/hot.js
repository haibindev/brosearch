// Weibo hot search - Tier 1: Cookie fetch
module.exports = {
  description: 'Get Weibo hot search list',
  tabQuery: { url: '*://weibo.com/*' },
  buildJs: ({ limit = 20 }) => `
    const res = await fetch(
      'https://weibo.com/ajax/side/hotSearch',
      { credentials: 'include' }
    )
    const json = await res.json()
    return (json.data?.realtime || []).slice(0, ${limit}).map((item, i) => ({
      rank: i + 1,
      word: item.word,
      raw_hot: item.raw_hot,
      label_name: item.label_name,
      url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent(item.word)
    }))
  `
}

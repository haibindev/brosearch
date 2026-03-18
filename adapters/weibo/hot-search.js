module.exports = {
  description: '微博实时热搜榜',
  tabQuery: { url: '*://weibo.com/*' },
  buildJs: (args) => `
    const res  = await fetch('https://weibo.com/ajax/side/hotSearch', {
      credentials: 'include'
    })
    const data = await res.json()
    return (data?.data?.realtime || []).slice(0, 30).map((item, i) => ({
      rank:  i + 1,
      word:  item.word,
      heat:  item.num,
      label: item.flag_desc,
      url:   'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + item.word + '#')
    }))
  `
}

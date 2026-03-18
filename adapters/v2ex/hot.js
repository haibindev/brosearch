// V2EX hot topics - public API
module.exports = {
  description: 'Get V2EX hot topics',
  tabQuery: { url: '*://www.v2ex.com/*' },
  buildJs: () => `
    const res = await fetch('https://www.v2ex.com/api/topics/hot.json', {
      credentials: 'include'
    })
    const topics = await res.json()
    return topics.map(t => ({
      id: t.id,
      title: t.title,
      url: t.url,
      replies: t.replies,
      node: t.node?.title,
      member: t.member?.username,
      last_replied: t.last_reply_by
    }))
  `
}

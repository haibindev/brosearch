module.exports = {
  description: 'Reddit hot posts (r/all or specific subreddit)',
  tabQuery: { url: '*://reddit.com/*' },
  buildJs: (args) => `
    const sub   = ${JSON.stringify(args.sub || 'all')}
    const limit = ${Number(args.limit) || 25}
    const res  = await fetch(\`https://www.reddit.com/r/\${sub}.json?limit=\${limit}\`, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    })
    const data = await res.json()
    return data.data.children.map(c => ({
      id:        c.data.id,
      title:     c.data.title,
      url:       c.data.url,
      score:     c.data.score,
      comments:  c.data.num_comments,
      subreddit: c.data.subreddit,
      author:    c.data.author,
      nsfw:      c.data.over_18
    }))
  `
}

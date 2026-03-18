// HackerNews top stories - public API, no auth needed
module.exports = {
  description: 'Get HackerNews top stories',
  tabQuery: { url: '*://*.ycombinator.com/*' },
  buildJs: ({ limit = 20 }) => `
    const ids = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
      .then(r => r.json())
    const top = ids.slice(0, ${limit})
    const stories = await Promise.all(
      top.map(id =>
        fetch('https://hacker-news.firebaseio.com/v0/item/' + id + '.json').then(r => r.json())
      )
    )
    return stories.map(s => ({
      id: s.id,
      title: s.title,
      url: s.url,
      score: s.score,
      comments: s.descendants,
      by: s.by
    }))
  `
}

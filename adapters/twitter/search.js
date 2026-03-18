// Twitter search adapter - Tier 2: Bearer + CSRF token
module.exports = {
  description: 'Search tweets',
  tabQuery: { url: '*://twitter.com/*' },
  buildJs: ({ query, count = 20 }) => `
    const getCookie = (name) => document.cookie.split('; ')
      .find(r => r.startsWith(name + '='))?.split('=')[1]

    const bearer = [...document.scripts]
      .map(s => s.src).filter(Boolean)
      .reduce((found, src) => found, null) ||
      'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

    const ct0 = getCookie('ct0')
    if (!ct0) throw new Error('Not logged in to Twitter')

    const params = new URLSearchParams({
      q: ${JSON.stringify(query)},
      count: String(${count}),
      tweet_mode: 'extended'
    })

    const res = await fetch(
      'https://api.twitter.com/1.1/search/tweets.json?' + params,
      {
        headers: {
          'Authorization': 'Bearer ' + bearer,
          'x-csrf-token': ct0
        },
        credentials: 'include'
      }
    )
    const json = await res.json()
    return (json.statuses || []).map(t => ({
      id: t.id_str,
      text: t.full_text || t.text,
      user: t.user.screen_name,
      likes: t.favorite_count,
      retweets: t.retweet_count,
      created_at: t.created_at
    }))
  `
}

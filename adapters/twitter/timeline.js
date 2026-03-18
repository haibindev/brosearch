// Twitter home timeline - Tier 2: Bearer + CSRF token
module.exports = {
  description: 'Get home timeline',
  tabQuery: { url: '*://twitter.com/*' },
  buildJs: ({ count = 20 }) => `
    const getCookie = (name) => document.cookie.split('; ')
      .find(r => r.startsWith(name + '='))?.split('=')[1]

    const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
    const ct0 = getCookie('ct0')
    if (!ct0) throw new Error('Not logged in to Twitter')

    const res = await fetch(
      'https://api.twitter.com/1.1/statuses/home_timeline.json?count=${count}&tweet_mode=extended',
      {
        headers: {
          'Authorization': 'Bearer ' + bearer,
          'x-csrf-token': ct0
        },
        credentials: 'include'
      }
    )
    const tweets = await res.json()
    return tweets.map(t => ({
      id: t.id_str,
      text: t.full_text || t.text,
      user: t.user.screen_name,
      likes: t.favorite_count,
      retweets: t.retweet_count,
      created_at: t.created_at
    }))
  `
}

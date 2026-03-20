// Twitter search - DOM scraping (SearchTimeline API requires x-client-transaction-id which is hard to obtain)
// Works best when user is on x.com/search page with the desired query
module.exports = {
  description: 'Search tweets (scrapes from x.com search page)',
  tabQuery: { url: ['*://*.twitter.com/*', '*://*.x.com/*'] },
  buildJs: ({ query, count = 20 }) => `
    const searchQuery = ${JSON.stringify(query || '')}
    if (!searchQuery) throw new Error('query parameter is required')
    const resultCount = ${Number(count)}

    // Scrape tweets from DOM
    const tweetEls = document.querySelectorAll('[data-testid="tweet"]')
    const tweets = []

    for (const el of tweetEls) {
      try {
        // Extract user info
        const userNameEl = el.querySelector('[data-testid="User-Name"]')
        const links = userNameEl ? userNameEl.querySelectorAll('a') : []
        let screenName = ''
        let displayName = ''
        for (const a of links) {
          if (a.href && a.href.match(/x\\.com\\/[^/]+$/)) {
            screenName = screenName || a.href.split('/').pop()
          }
          if (!displayName && a.textContent && !a.textContent.startsWith('@')) {
            displayName = a.textContent.trim()
          }
        }

        // Extract tweet text
        const textEl = el.querySelector('[data-testid="tweetText"]')
        const text = textEl?.textContent?.trim() || ''

        // Extract tweet ID from status link
        const statusLink = el.querySelector('a[href*="/status/"]')
        const statusMatch = statusLink?.href?.match(/status\\/(\\d+)/)
        const tweetId = statusMatch?.[1] || ''

        // Extract metrics from aria-label
        const getMetric = (testId) => {
          const metricEl = el.querySelector('[data-testid="' + testId + '"]')
          const label = metricEl?.getAttribute('aria-label') || metricEl?.textContent || '0'
          const num = label.match(/([\\d,]+)/)
          return num ? parseInt(num[1].replace(/,/g, '')) : 0
        }

        // Extract time
        const timeEl = el.querySelector('time')
        const createdAt = timeEl?.getAttribute('datetime') || timeEl?.textContent || ''

        if (text || tweetId) {
          tweets.push({
            id:         tweetId,
            text:       text.substring(0, 500),
            user:       screenName,
            name:       displayName,
            likes:      getMetric('like'),
            retweets:   getMetric('retweet'),
            replies:    getMetric('reply'),
            created_at: createdAt,
            url:        statusLink?.href || ''
          })
        }
      } catch(e) { /* skip malformed tweet */ }
    }

    if (!tweets.length) {
      throw new Error('No tweets found. Navigate to x.com/search?q=' + encodeURIComponent(searchQuery) + ' first, then retry.')
    }
    return tweets.slice(0, resultCount)
  `
}

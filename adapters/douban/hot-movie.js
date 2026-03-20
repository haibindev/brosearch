// Douban hot movies - requires a movie.douban.com tab
// Note: Douban has strict anti-scraping, only works from browser context on correct domain
module.exports = {
  description: '豆瓣热门电影 (需要打开 movie.douban.com)',
  tabQuery: { url: ['*://movie.douban.com/*', '*://www.douban.com/*'] },
  buildJs: (args) => `
    const limit = ${Number(args.limit) || 20}
    const type  = ${JSON.stringify(args.type || 'movie')}

    // If we're on movie.douban.com, use same-origin API
    if (location.hostname === 'movie.douban.com') {
      const res = await fetch(
        '/j/search_subjects?type=' + type + '&tag=' + encodeURIComponent('热门') + '&sort=recommend&page_limit=' + limit + '&page_start=0',
        { credentials: 'include' }
      )
      if (res.ok) {
        const data = await res.json()
        const subjects = data?.subjects || []
        if (subjects.length) return subjects.map(m => ({
          id: m.id, title: m.title, rate: m.rate, url: m.url, cover: m.cover
        }))
      }
    }

    // If we're on www.douban.com, try to scrape visible movie data from DOM
    const items = []
    const seen = new Set()

    // Try various DOM selectors for movie listings
    const selectors = [
      '.list-wp .item',
      '.ui-slide-item',
      '.slide-item',
      '.subject-item',
      '.item-root',
      '[data-type="movie"]',
      '.cover-col-item'
    ]

    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        const a = el.querySelector('a[href*="subject"]') || el.querySelector('a')
        if (!a) return
        const idMatch = (a.href || '').match(/subject\\/(\\d+)/)
        if (!idMatch || seen.has(idMatch[1])) return
        seen.add(idMatch[1])
        const img = el.querySelector('img')
        items.push({
          id:    idMatch[1],
          title: a.title || img?.alt || el.querySelector('.title')?.textContent?.trim() || a.textContent?.trim() || '',
          rate:  el.querySelector('.rating_nums')?.textContent?.trim() || el.getAttribute('data-rate') || '',
          url:   a.href,
          cover: img?.src || img?.getAttribute('data-src') || ''
        })
      })
      if (items.length >= limit) break
    }

    // Fallback: find any movie links
    if (!items.length) {
      document.querySelectorAll('a[href*="movie.douban.com/subject/"]').forEach(a => {
        const idMatch = a.href.match(/subject\\/(\\d+)/)
        if (!idMatch || seen.has(idMatch[1])) return
        seen.add(idMatch[1])
        const title = a.textContent?.trim() || a.title || ''
        if (!title || title.length > 100) return
        items.push({ id: idMatch[1], title, rate: '', url: a.href, cover: '' })
      })
    }

    if (!items.length) throw new Error('No movie data found. Please open movie.douban.com and try again.')
    return items.slice(0, limit)
  `
}

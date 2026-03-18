// GitHub trending - Tier 1: public page, cookie optional
module.exports = {
  description: 'Get GitHub trending repos',
  tabQuery: { url: '*://github.com/*' },
  buildJs: ({ lang = '', since = 'daily' }) => `
    const url = 'https://github.com/trending' +
      (${JSON.stringify(lang)} ? '/' + ${JSON.stringify(lang)} : '') +
      '?since=${since}'
    const res = await fetch(url, { credentials: 'include' })
    const html = await res.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    return [...doc.querySelectorAll('article.Box-row')].map(el => ({
      repo: el.querySelector('h2 a')?.getAttribute('href')?.slice(1),
      description: el.querySelector('p')?.textContent?.trim(),
      language: el.querySelector('[itemprop=programmingLanguage]')?.textContent?.trim(),
      stars: el.querySelector('a[href*=stargazers]')?.textContent?.trim(),
      stars_today: el.querySelector('.float-sm-right')?.textContent?.trim()
    })).filter(x => x.repo)
  `
}

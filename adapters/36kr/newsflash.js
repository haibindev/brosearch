// 36kr newsflash - gateway API
module.exports = {
  description: '36kr 最新快讯',
  tabQuery: { url: '*://*.36kr.com/*' },
  buildJs: (args) => `
    const count = ${Number(args.limit) || 20}

    // Strategy 1: Gateway API (primary)
    async function viaGateway() {
      const res = await fetch('https://gateway.36kr.com/api/mis/nav/newsflash/flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: 'web',
          param: { siteId: 1, platformId: 2, pageSize: count, pageEvent: 0 },
          timestamp: Date.now()
        })
      })
      const json = await res.json()
      if (json.code !== 0) throw new Error('Gateway code: ' + json.code)
      const items = json?.data?.itemList || json?.data?.data?.itemList || []
      if (!items.length) throw new Error('Gateway returned empty')
      return items.map(item => {
        const m = item.templateMaterial || {}
        return {
          id:      item.itemId || item.id,
          title:   m.widgetTitle || '',
          content: (m.widgetContent || '').replace(/<[^>]*>/g, '').slice(0, 200),
          time:    m.publishTime,
          url:     'https://36kr.com/newsflashes/' + (item.itemId || item.id)
        }
      })
    }

    // Strategy 2: SSR fallback from window.initialState
    function viaSSR() {
      const state = window.initialState || window.__INITIAL_STATE__
      if (!state) throw new Error('No SSR state')
      const feeds = state.newsflashFeed?.feedList ||
                    state.newsflashCatalogData?.data?.newsflashList || []
      if (!feeds.length) throw new Error('SSR state empty')
      return feeds.slice(0, count).map(item => ({
        id:      item.id,
        title:   item.title || item.newsflashContent || '',
        content: (item.newsflashContent || item.description || '').slice(0, 200),
        time:    item.publishTime || item.published_at,
        url:     'https://36kr.com/newsflashes/' + item.id
      }))
    }

    try { return await viaGateway() }
    catch(e1) {
      try { return viaSSR() }
      catch(e2) { throw new Error('All strategies failed: ' + e1.message + '; ' + e2.message) }
    }
  `
}

// 36kr hot articles - gateway API + SSR fallback
module.exports = {
  description: '36kr 热门文章',
  tabQuery: { url: '*://*.36kr.com/*' },
  buildJs: (args) => `
    const count = ${Number(args.limit) || 20}

    // Strategy 1: Hot rank API (confirmed working via probe, 50 items)
    async function viaHotRank() {
      const res = await fetch('https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: 'web',
          param: { siteId: 1, platformId: 2 },
          timestamp: Date.now()
        })
      })
      const json = await res.json()
      if (json.code !== 0) throw new Error('Gateway code: ' + json.code)
      const items = json?.data?.hotRankList || []
      if (!items.length) throw new Error('Hot rank returned empty')
      return items.slice(0, count).map((item, i) => {
        const m = item.templateMaterial || {}
        return {
          rank:    i + 1,
          id:      item.itemId || item.id,
          title:   m.widgetTitle || m.title || '',
          summary: (m.summary || m.widgetContent || '').replace(/<[^>]*>/g, '').slice(0, 200),
          author:  m.authorName || '',
          time:    m.publishTime || '',
          cover:   (m.widgetImage || '').split('?')[0],
          url:     'https://36kr.com/p/' + (item.itemId || item.id)
        }
      })
    }

    // Strategy 2: SSR fallback from window.initialState
    function viaSSR() {
      const state = window.initialState || window.__INITIAL_STATE__
      if (!state) throw new Error('No SSR state')
      const feeds = state.informationFlow?.informationFlowList ||
                    state.hotArticleList?.data || []
      if (!feeds.length) throw new Error('SSR state empty')
      return feeds.slice(0, count).map(item => {
        const d = item.itemData || item.templateMaterial || item
        return {
          id:      item.id || item.itemId,
          title:   d.widgetTitle || d.title || '',
          summary: (d.summary || '').slice(0, 200),
          author:  d.authorName || '',
          time:    d.publishTime || '',
          url:     'https://36kr.com/p/' + (item.id || item.itemId)
        }
      })
    }

    try { return await viaHotRank() }
    catch(e1) {
      try { return viaSSR() }
      catch(e2) { throw new Error('All strategies failed: ' + e1.message + '; ' + e2.message) }
    }
  `
}

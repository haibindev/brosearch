// Xiaohongshu search - Pinia store + XHR interception
module.exports = {
  description: 'Search Xiaohongshu notes',
  tabQuery: { url: '*://www.xiaohongshu.com/*' },
  buildJs: ({ query, limit = 20 }) => `
    const searchQuery = ${JSON.stringify(query)}
    const maxResults = ${Number(limit)}

    /* ---- Strategy 1: Pinia store (Vue 3 app) ---- */
    async function viaPinia() {
      const app = document.querySelector('#app')?.__vue_app__
      if (!app) throw new Error('No Vue app found')
      const pinia = app.config?.globalProperties?.$pinia
      if (!pinia) throw new Error('No Pinia store')
      const searchStore = pinia._s?.get('search')
      if (!searchStore) throw new Error('No search store')

      // Intercept XHR to capture the raw response
      let capturedData = null
      const origOpen = XMLHttpRequest.prototype.open
      const origSend = XMLHttpRequest.prototype.send
      XMLHttpRequest.prototype.open = function(method, url) {
        this._bsUrl = url
        return origOpen.apply(this, arguments)
      }
      XMLHttpRequest.prototype.send = function() {
        if (this._bsUrl && this._bsUrl.includes('/search/')) {
          this.addEventListener('load', function() {
            try {
              const resp = JSON.parse(this.responseText)
              if (resp.data?.items) capturedData = resp.data.items
            } catch(e) {}
          })
        }
        return origSend.apply(this, arguments)
      }

      try {
        // Trigger search via store
        if (typeof searchStore.mutateSearchValue === 'function') {
          searchStore.mutateSearchValue(searchQuery)
        }
        if (typeof searchStore.loadMore === 'function') {
          await searchStore.loadMore()
        }

        // Wait briefly for XHR to complete
        await new Promise(r => setTimeout(r, 2000))

        // Try getting results from store state first
        const storeItems = searchStore.noteList || searchStore.notes || searchStore.items || []
        const items = capturedData || storeItems

        if (!items.length) throw new Error('Pinia search returned empty')
        return items.slice(0, maxResults).map(item => {
          const card = item.note_card || item
          return {
            id:     item.id || card.note_id,
            title:  card.display_title || card.title || '',
            desc:   card.desc || '',
            author: card.user?.nickname || card.user?.name || '',
            likes:  card.interact_info?.liked_count || card.liked_count || 0,
            type:   item.model_type || card.type
          }
        })
      } finally {
        // Restore originals
        XMLHttpRequest.prototype.open = origOpen
        XMLHttpRequest.prototype.send = origSend
      }
    }

    /* ---- Strategy 2: Direct API with page cookies/headers ---- */
    async function viaAPI() {
      const res = await fetch('https://edith.xiaohongshu.com/api/sns/web/v1/search/notes', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          keyword: searchQuery,
          page: 1,
          page_size: maxResults,
          search_id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          sort: 'general',
          note_type: 0
        })
      })
      if (!res.ok) throw new Error('API ' + res.status)
      const json = await res.json()
      if (json.code !== 0 && json.success !== true) throw new Error('API error: ' + (json.msg || json.code))
      const items = json.data?.items || []
      if (!items.length) throw new Error('API returned empty')
      return items.slice(0, maxResults).map(item => {
        const card = item.note_card || item
        return {
          id:     item.id || card.note_id,
          title:  card.display_title || card.title || '',
          desc:   card.desc || '',
          author: card.user?.nickname || card.user?.name || '',
          likes:  card.interact_info?.liked_count || card.liked_count || 0,
          type:   item.model_type || card.type
        }
      })
    }

    /* ---- Strategy 3: DOM scraping as last resort ---- */
    function viaDom() {
      // If we're on a search page, parse visible results
      const cards = document.querySelectorAll('[class*="note-item"], .search-result-card, section.note-item')
      if (!cards.length) throw new Error('No DOM cards found')
      const items = []
      for (const card of cards) {
        const titleEl = card.querySelector('[class*="title"], h3, a.title')
        const authorEl = card.querySelector('[class*="author"], .author-name, [class*="nickname"]')
        const likeEl = card.querySelector('[class*="like"], [class*="count"]')
        items.push({
          id:     card.dataset?.noteId || card.querySelector('a')?.href?.match(/\\/explore\\/([^?]+)/)?.[1] || '',
          title:  titleEl?.textContent?.trim() || '',
          desc:   '',
          author: authorEl?.textContent?.trim() || '',
          likes:  likeEl?.textContent?.trim() || '0',
          type:   'dom'
        })
      }
      if (!items.length) throw new Error('DOM parsing empty')
      return items.slice(0, maxResults)
    }

    /* ---- try strategies in order ---- */
    const errors = []
    for (const fn of [viaPinia, viaAPI, viaDom]) {
      try { return await fn() }
      catch(e) { errors.push(fn.name + ': ' + e.message) }
    }
    throw new Error('All strategies failed:\\n' + errors.join('\\n'))
  `
}

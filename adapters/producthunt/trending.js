// Product Hunt trending - multi-strategy fallback
module.exports = {
  description: 'Product Hunt trending products today',
  tabQuery: { url: '*://*.producthunt.com/*' },
  buildJs: (args) => `
    const limit = ${Number(args.limit) || 20}

    function normalize(items) {
      return items.slice(0, limit).map(p => ({
        id:       p.id,
        name:     p.name,
        tagline:  p.tagline,
        votes:    p.votesCount || p.votes_count || p.votesCount || 0,
        comments: p.commentsCount || p.comments_count || 0,
        url:      p.url || p.slug ? ('https://www.producthunt.com/posts/' + (p.slug || '')) : '',
        topics:   Array.isArray(p.topics)
          ? p.topics.map(t => typeof t === 'string' ? t : t.name || t.node?.name || '')
          : (p.topics?.edges || []).map(e => e.node?.name || '')
      }))
    }

    /* ---- Strategy 1: GraphQL with CSRF ---- */
    async function viaGraphQL() {
      const csrfMeta = document.querySelector('meta[name="csrf-token"]')
      const csrf = csrfMeta?.content
      const query = \`query {
        posts(order: VOTES, first: \${limit}) {
          edges { node {
            id name tagline slug
            votesCount commentsCount
            url
            topics { edges { node { name } } }
          }}
        }
      }\`
      const headers = { 'Content-Type': 'application/json' }
      if (csrf) headers['X-CSRF-Token'] = csrf
      const res = await fetch('https://www.producthunt.com/frontend/graphql', {
        method: 'POST', credentials: 'include', headers,
        body: JSON.stringify({ query })
      })
      if (!res.ok) throw new Error('GraphQL ' + res.status)
      const data = await res.json()
      const edges = data?.data?.posts?.edges || []
      if (!edges.length) throw new Error('GraphQL returned empty')
      return normalize(edges.map(e => e.node))
    }

    /* ---- Strategy 2: __NEXT_DATA__ SSR ---- */
    function viaNextData() {
      const el = document.getElementById('__NEXT_DATA__')
      if (!el) throw new Error('No __NEXT_DATA__')
      const nd = JSON.parse(el.textContent)
      // traverse props looking for posts array
      const props = nd?.props?.pageProps
      const posts = props?.posts || props?.initialData?.posts || props?.data?.posts
      if (!posts || !posts.length) {
        // try deeper: apolloState
        throw new Error('No posts in __NEXT_DATA__')
      }
      return normalize(posts)
    }

    /* ---- Strategy 3: Apollo cache ---- */
    function viaApolloCache() {
      const cache = window.__APOLLO_STATE__ || window.__NEXT_DATA__?.props?.apolloState
      if (!cache) throw new Error('No Apollo cache')
      const posts = Object.values(cache)
        .filter(v => v && v.__typename === 'Post' && v.name && v.votesCount != null)
        .sort((a, b) => (b.votesCount || 0) - (a.votesCount || 0))
      if (!posts.length) throw new Error('Apollo cache empty')
      return normalize(posts)
    }

    /* ---- Strategy 4: DOM parsing ---- */
    function viaDom() {
      const items = []
      // PH uses data-test attributes and section structure
      const cards = document.querySelectorAll('[data-test="post-item"], .post-item, [class*="styles_item"]')
      if (!cards.length) {
        // try broader selector
        const links = document.querySelectorAll('a[href^="/posts/"]')
        const seen = new Set()
        for (const a of links) {
          const href = a.getAttribute('href')
          if (seen.has(href)) continue
          seen.add(href)
          const container = a.closest('div[class]') || a.parentElement
          const name = a.textContent?.trim() || ''
          if (!name || name.length > 100) continue
          items.push({
            id: href, name,
            tagline: container?.querySelector('p, [class*="tagline"]')?.textContent?.trim() || '',
            votesCount: parseInt(container?.querySelector('button, [class*="vote"]')?.textContent) || 0,
            slug: href.replace('/posts/', '')
          })
        }
      } else {
        for (const card of cards) {
          const nameEl = card.querySelector('h3, [data-test="post-name"], a[href^="/posts/"]')
          const tagEl = card.querySelector('[data-test="post-tagline"], p')
          const voteEl = card.querySelector('[data-test="vote-button"], button')
          items.push({
            id: nameEl?.closest('a')?.href || '',
            name: nameEl?.textContent?.trim() || '',
            tagline: tagEl?.textContent?.trim() || '',
            votesCount: parseInt(voteEl?.textContent) || 0,
            slug: (nameEl?.closest('a')?.getAttribute('href') || '').replace('/posts/', '')
          })
        }
      }
      if (!items.length) throw new Error('DOM parsing found nothing')
      return normalize(items)
    }

    /* ---- Strategy 5: Atom feed ---- */
    async function viaFeed() {
      const res = await fetch('https://www.producthunt.com/feed?category=tech', {
        credentials: 'include',
        headers: { Accept: 'application/atom+xml, application/xml, text/xml' }
      })
      if (!res.ok) throw new Error('Feed ' + res.status)
      const text = await res.text()
      const parser = new DOMParser()
      const doc = parser.parseFromString(text, 'text/xml')
      const entries = doc.querySelectorAll('entry, item')
      if (!entries.length) throw new Error('Feed empty')
      const items = []
      for (const entry of entries) {
        const title = entry.querySelector('title')?.textContent || ''
        const link = entry.querySelector('link')?.getAttribute('href') ||
                     entry.querySelector('link')?.textContent || ''
        const summary = entry.querySelector('summary, description, content')?.textContent || ''
        items.push({
          id: link,
          name: title.split(' - ')[0]?.trim() || title,
          tagline: summary.replace(/<[^>]*>/g, '').slice(0, 200),
          votesCount: 0,
          slug: link.split('/posts/')[1] || ''
        })
      }
      return normalize(items)
    }

    /* ---- try all strategies in order ---- */
    const strategies = [viaGraphQL, viaNextData, viaApolloCache, viaDom, viaFeed]
    const errors = []
    for (const fn of strategies) {
      try { return await fn() }
      catch(e) { errors.push(fn.name + ': ' + e.message) }
    }
    throw new Error('All strategies failed:\\n' + errors.join('\\n'))
  `
}

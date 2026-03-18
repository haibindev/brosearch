module.exports = {
  description: 'Product Hunt trending products today',
  tabQuery: { url: '*://producthunt.com/*' },
  buildJs: (args) => `
    const limit = ${Number(args.limit) || 20}
    const query = \`{
      posts(order: VOTES, first: \${limit}) {
        edges { node {
          id name tagline
          votesCount commentsCount
          url
          topics { edges { node { name } } }
        }}
      }
    }\`
    const res  = await fetch('https://www.producthunt.com/frontend/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    })
    const data = await res.json()
    return (data?.data?.posts?.edges || []).map(({ node: p }) => ({
      id:       p.id,
      name:     p.name,
      tagline:  p.tagline,
      votes:    p.votesCount,
      comments: p.commentsCount,
      url:      p.url,
      topics:   p.topics?.edges?.map(e => e.node.name)
    }))
  `
}

module.exports = {
  description: 'Search npm packages',
  tabQuery: {},
  buildJs: (args) => `
    const q    = encodeURIComponent(${JSON.stringify(args.query || '')})
    const size = ${Number(args.limit) || 10}
    const res  = await fetch(\`https://registry.npmjs.org/-/v1/search?text=\${q}&size=\${size}\`)
    const data = await res.json()
    return (data.objects || []).map(o => ({
      name:        o.package.name,
      version:     o.package.version,
      description: o.package.description,
      keywords:    o.package.keywords,
      author:      o.package.author?.name,
      links:       o.package.links,
      score:       Math.round((o.score?.final || 0) * 100)
    }))
  `
}

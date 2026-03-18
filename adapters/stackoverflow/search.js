module.exports = {
  description: 'Search StackOverflow questions',
  tabQuery: {},
  buildJs: (args) => `
    const q    = encodeURIComponent(${JSON.stringify(args.query || '')})
    const size = ${Number(args.limit) || 10}
    const res  = await fetch(
      \`https://api.stackexchange.com/2.3/search/advanced?q=\${q}&site=stackoverflow&order=desc&sort=relevance&pagesize=\${size}\`
    )
    const data = await res.json()
    return (data.items || []).map(item => ({
      id:       item.question_id,
      title:    item.title,
      url:      item.link,
      score:    item.score,
      answers:  item.answer_count,
      views:    item.view_count,
      tags:     item.tags,
      answered: item.is_answered
    }))
  `
}

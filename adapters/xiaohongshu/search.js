// Xiaohongshu search - Tier 3: internal API via page context
module.exports = {
  description: 'Search Xiaohongshu notes',
  tabQuery: { url: '*://www.xiaohongshu.com/*' },
  buildJs: ({ query, limit = 10 }) => `
    const res = await fetch('https://edith.xiaohongshu.com/api/sns/web/v1/search/notes', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({
        keyword: ${JSON.stringify(query)},
        page: 1,
        page_size: ${limit},
        search_id: Date.now().toString(),
        sort: 'general',
        note_type: 0
      })
    })
    const json = await res.json()
    return (json.data?.items || []).map(item => ({
      id: item.id,
      title: item.note_card?.display_title,
      desc: item.note_card?.desc,
      author: item.note_card?.user?.nickname,
      likes: item.note_card?.interact_info?.liked_count,
      type: item.model_type
    }))
  `
}

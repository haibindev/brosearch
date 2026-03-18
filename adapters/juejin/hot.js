module.exports = {
  description: '掘金热门文章',
  tabQuery: { url: '*://juejin.cn/*' },
  buildJs: (args) => `
    const limit = ${Number(args.limit) || 20}
    const res   = await fetch(
      'https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_type: 2, sort_type: 200,
          cate_id: '6809637767543259144',
          cursor: '0', limit
        })
      }
    )
    const data = await res.json()
    return (data?.data || []).map(item => ({
      id:       item.article_id,
      title:    item.article_info?.title,
      brief:    item.article_info?.brief_content,
      author:   item.author_user_info?.user_name,
      tags:     item.tags?.map(t => t.tag_name),
      views:    item.article_info?.view_count,
      likes:    item.article_info?.digg_count,
      comments: item.article_info?.comment_count,
      url:      'https://juejin.cn/post/' + item.article_id
    }))
  `
}

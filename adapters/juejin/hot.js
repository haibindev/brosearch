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
    return (data?.data || []).map(item => {
      const info = item.item_info || item
      const article = info.article_info || info
      const author = info.author_user_info || item.author_user_info || {}
      const tags = info.tags || item.tags || []
      const aid = article.article_id || info.article_id || item.article_id
      return {
        id:       aid,
        title:    article.title,
        brief:    article.brief_content,
        author:   author.user_name,
        tags:     tags.map(t => t.tag_name),
        views:    article.view_count,
        likes:    article.digg_count,
        comments: article.comment_count,
        url:      'https://juejin.cn/post/' + aid
      }
    })
  `
}

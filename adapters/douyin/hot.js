// Douyin hot search - confirmed working via probe (49 items)
module.exports = {
  description: '抖音热搜榜',
  tabQuery: { url: '*://*.douyin.com/*' },
  buildJs: (args) => `
    const limit = ${Number(args.limit) || 50}

    const res = await fetch(
      'https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1',
      { credentials: 'include' }
    )
    if (!res.ok) throw new Error('Douyin hot API ' + res.status)
    const json = await res.json()
    if (json.status_code !== 0) throw new Error('Douyin status_code: ' + json.status_code)

    const list = json?.data?.word_list || []
    return list.slice(0, limit).map((item, i) => ({
      rank:      i + 1,
      title:     item.word || '',
      hotValue:  item.hot_value || 0,
      label:     item.label || 0,
      cover:     item.word_cover?.url_list?.[0] || '',
      videoCount: item.video_count || 0,
      url:       'https://www.douyin.com/search/' + encodeURIComponent(item.word || '')
    }))
  `
}

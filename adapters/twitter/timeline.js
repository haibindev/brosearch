// Twitter home timeline - GraphQL HomeTimeline with webpack module injection
module.exports = {
  description: 'Get home timeline via GraphQL',
  tabQuery: { url: ['*://*.twitter.com/*', '*://*.x.com/*'] },
  buildJs: ({ count = 20 }) => `
    const resultCount = ${Number(count)}

    /* ---- helpers ---- */
    const getCookie = (name) => document.cookie.split('; ')
      .find(r => r.startsWith(name + '='))?.split('=')[1]

    const ct0 = getCookie('ct0')
    if (!ct0) throw new Error('Not logged in to Twitter/X (no ct0 cookie)')

    const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

    /* ---- get transaction ID via webpack injection ---- */
    let genTxId = null
    try {
      const chunkKey = Object.keys(window).find(k => k.startsWith('webpackChunk'))
                    || 'webpackChunk_twitter_responsive_web'
      const chunks = window[chunkKey]
      if (chunks && chunks.push) {
        let wpRequire = null
        chunks.push([['brosearch_probe_tl'], {}, (req) => { wpRequire = req }])
        if (wpRequire) {
          try {
            const txMod = wpRequire(83914)
            genTxId = txMod && (txMod.jJ || txMod.default || txMod.a)
          } catch(e) {
            for (const modId of Object.keys(wpRequire.m || {})) {
              try {
                const m = wpRequire(modId)
                if (m && typeof m.jJ === 'function') {
                  genTxId = m.jJ
                  break
                }
              } catch(e2) {}
            }
          }
        }
      }
    } catch(e) {}

    /* ---- feature flags ---- */
    const features = {
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      rweb_video_timestamps_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_enhance_cards_enabled: false,
      tweetypie_unmention_optimization_enabled: true,
      responsive_web_text_conversations_enabled: false,
      interactive_text_enabled: true,
      responsive_web_media_download_video_enabled: false,
      premium_content_api_read_enabled: false
    }

    const variables = {
      count: resultCount,
      includePromotedContent: false,
      latestControlAvailable: true,
      requestContext: 'launch',
      withCommunity: true
    }

    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(features)
    })

    const headers = {
      'Authorization': 'Bearer ' + bearer,
      'x-csrf-token': ct0,
      'Content-Type': 'application/json',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en'
    }
    if (typeof genTxId === 'function') {
      try { headers['x-client-transaction-id'] = genTxId() } catch(e) {}
    }

    /* ---- try HomeTimeline, fallback to HomeLatestTimeline ---- */
    const endpoints = [
      'https://x.com/i/api/graphql/HJFjzBgCs16TqxewQOeLNg/HomeTimeline',
      'https://x.com/i/api/graphql/zhX91JE87mWvfprhYE97xA/HomeLatestTimeline'
    ]

    let lastErr = null
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint + '?' + params, { headers, credentials: 'include' })
        if (!res.ok) { lastErr = new Error(endpoint + ' => ' + res.status); continue }

        const json = await res.json()

        /* ---- parse nested response ---- */
        const timeline = json?.data?.home?.home_timeline_urt ||
                         json?.data?.home?.latest_timeline ||
                         json?.data?.home_timeline_urt ||
                         json?.data?.timeline_by_id
        const instructions = timeline?.instructions || []
        const tweets = []
        for (const inst of instructions) {
          const entries = inst.entries || []
          for (const entry of entries) {
            const result = entry?.content?.itemContent?.tweet_results?.result
            if (!result) continue
            const tweet = result.tweet || result
            const core = tweet.core?.user_results?.result?.legacy || {}
            const legacy = tweet.legacy || {}
            if (!legacy.full_text) continue
            tweets.push({
              id:         legacy.id_str || tweet.rest_id,
              text:       legacy.full_text,
              user:       core.screen_name || '',
              name:       core.name || '',
              likes:      legacy.favorite_count || 0,
              retweets:   legacy.retweet_count || 0,
              replies:    legacy.reply_count || 0,
              views:      tweet.views?.count,
              created_at: legacy.created_at
            })
          }
        }
        if (tweets.length) return tweets.slice(0, resultCount)
        lastErr = new Error('Parsed 0 tweets from ' + endpoint)
      } catch(e) { lastErr = e }
    }
    throw lastErr || new Error('All timeline endpoints failed')
  `
}

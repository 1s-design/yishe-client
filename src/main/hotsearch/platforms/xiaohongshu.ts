import type { PlatformModule } from '../types'
import axios from 'axios'

const xiaohongshu: PlatformModule = {
  config: {
    key: 'xiaohongshu',
    name: '小红书',
    enabled: true,
    environment: 'direct',
    maxItems: 30,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const url = 'https://www.xiaohongshu.com/explore'

    const { data: html } = await axios.get(url, {
      timeout: ctx.timeout,
      headers: {
        'User-Agent':
          ctx.userAgent ||
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    })

    const match = String(html).match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})<\/script>/)
    if (!match) {
      throw new Error('未能从小红书页面解析 __INITIAL_STATE__')
    }

    const state = JSON.parse(match[1].replace(/undefined/g, 'null'))
    const feeds = state.feed?.feeds || []

    return feeds.slice(0, this.config.maxItems).map((feed: any, index: number) => {
      const noteCard = feed.noteCard || {}
      const user = noteCard.user || {}
      const interactInfo = noteCard.interactInfo || {}
      const cover = noteCard.cover || {}
      const coverUrl =
        cover.urlDefault ||
        cover.urlPre ||
        (Array.isArray(cover.infoList) && cover.infoList[0]?.url) ||
        ''

      return {
        rank: index + 1,
        title: noteCard.displayTitle || noteCard.title || '未知标题',
        hot: interactInfo.likedCount ? `${interactInfo.likedCount} 赞` : '',
        url: feed.id
          ? `https://www.xiaohongshu.com/explore/${feed.id}?xsec_token=${encodeURIComponent(feed.xsecToken || '')}&xsec_source=pc_feed`
          : undefined,
        id: feed.id || noteCard.id,
        xsecToken: feed.xsecToken || user.xsecToken || '',
        coverUrl,
        author: user.nickname || user.nickName || '',
        type: noteCard.type || 'normal',
      }
    })
  },
}

export default xiaohongshu

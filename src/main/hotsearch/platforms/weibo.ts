import type { PlatformModule } from '../types'
import axios from 'axios'

const weibo: PlatformModule = {
  config: {
    key: 'weibo',
    name: '微博',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data } = await axios.get('https://weibo.com/ajax/side/hotSearch', {
      timeout: ctx.timeout,
      headers: {
        'User-Agent': ctx.userAgent,
        'Referer': 'https://weibo.com/',
        'Accept': 'application/json, text/plain, */*',
      },
    })

    const list = Array.isArray(data?.data?.realtime) ? data.data.realtime : []
    return list.slice(0, this.config.maxItems).map((item: any, index: number) => ({
      rank: index + 1,
      title: item.word || item.word_scheme || '未知',
      hot: item.num || '',
      url: item.word_scheme ? `https://s.weibo.com/weibo?q=%23${encodeURIComponent(item.word_scheme)}%23` : undefined,
      tag: item.icon_desc || undefined,
    }))
  },
}

export default weibo

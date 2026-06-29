import type { PlatformModule } from '../types'
import axios from 'axios'

const bilibili: PlatformModule = {
  config: {
    key: 'bilibili',
    name: '哔哩哔哩',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data } = await axios.get('https://api.bilibili.com/x/web-interface/wbi/search/square?limit=50', {
      timeout: ctx.timeout,
      headers: {
        'User-Agent': ctx.userAgent,
        'Referer': 'https://www.bilibili.com/',
        'Accept': 'application/json, text/plain, */*',
      },
    })

    const list = Array.isArray(data?.data?.trending?.list) ? data.data.trending.list : []
    return list.slice(0, this.config.maxItems).map((item: any, index: number) => ({
      rank: index + 1,
      title: item.show_name || item.keyword || '未知',
      hot: item.heat_score || '',
      url: item.word_type ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(item.show_name || item.keyword)}` : undefined,
      tag: item.icon_desc || undefined,
    }))
  },
}

export default bilibili

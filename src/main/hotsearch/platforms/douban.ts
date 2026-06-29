import type { PlatformModule } from '../types'
import axios from 'axios'

const douban: PlatformModule = {
  config: {
    key: 'douban',
    name: '豆瓣',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data } = await axios.get('https://m.douban.com/rexxar/api/v2/search/hots?ck=', {
      timeout: ctx.timeout,
      headers: {
        'User-Agent': ctx.userAgent,
        'Referer': 'https://m.douban.com/',
        'Accept': 'application/json, text/plain, */*',
      },
    })

    const list = Array.isArray(data?.gallery_topics) ? data.gallery_topics : []
    return list.slice(0, this.config.maxItems).map((item: any, index: number) => ({
      rank: index + 1,
      title: item.title || item.name || '未知',
      hot: item.read_count ? `${(item.read_count / 10000).toFixed(1)}万` : '',
      url: item.url || undefined,
    }))
  },
}

export default douban

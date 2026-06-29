import type { PlatformModule } from '../types'
import axios from 'axios'

const zhihu: PlatformModule = {
  config: {
    key: 'zhihu',
    name: '知乎',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data } = await axios.get('https://www.zhihu.com/api/v4/search/recommend_query/v2', {
      timeout: ctx.timeout,
      headers: {
        'User-Agent': ctx.userAgent,
        'Referer': 'https://www.zhihu.com/',
        'Accept': 'application/json, text/plain, */*',
      },
    })

    const list = Array.isArray(data?.recommend_queries?.queries)
      ? data.recommend_queries.queries
      : []

    return list.slice(0, this.config.maxItems).map((item: any, index: number) => ({
      rank: index + 1,
      title: item.query_display || item.query || '未知',
      hot: item.label || '',
      url: item.query ? `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(item.query)}` : undefined,
    }))
  },
}

export default zhihu

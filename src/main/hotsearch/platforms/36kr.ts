/**
 * 36氪 热点
 * 数据源：公开 API（国内直连）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const kr36: PlatformModule = {
  config: {
    key: '36kr',
    name: '36氪',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data } = await http.get('https://36kr.com/api/newsflash', {
      params: { per_page: this.config.maxItems },
    })

    const items = data?.data?.items || data?.data?.newsList || []
    return items.map((item: any, i: number) => ({
      rank: i + 1,
      title: item.title || item.entity_name || '未知',
      hot: item.popularity || '',
      url: item.news_url || (item.id ? `https://36kr.com/newsflashes/${item.id}` : ''),
    }))
  },
}

export default kr36

/**
 * npm 热门包
 * 数据源：npms.io 公开 API（无需代理）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const API_URL = 'https://api.npms.io/v2/search'

const npmTrending: PlatformModule = {
  config: {
    key: 'npm_trending',
    name: 'npm Trending',
    enabled: false,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data } = await http.get(API_URL, {
      params: {
        q: 'not:deprecated',
        from: 0,
        size: this.config.maxItems,
        sort: 'popularity',
      },
    })

    const results = data?.results || []

    return results.map((item: any, i: number) => ({
      rank: i + 1,
      title: item.package?.name || '未知',
      hot: item.score?.detail?.popularity
        ? Math.round(item.score.detail.popularity * 10000)
        : '',
      url: item.package?.links?.repository || item.package?.links?.npm || '',
      subtitle: item.package?.description || '',
    }))
  },
}

export default npmTrending

/**
 * 少数派 热门文章
 * 数据源：公开 API（国内直连）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const sspai: PlatformModule = {
  config: {
    key: 'sspai',
    name: '少数派',
    enabled: false,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data } = await http.get('https://sspai.com/api/v2/articles', {
      params: {
        limit: this.config.maxItems,
        sort: 'hot',
        is_matrix: 0,
        include_total: false,
      },
    })

    const items = data?.data || data?.list || []
    return items.map((item: any, i: number) => ({
      rank: i + 1,
      title: item.title || '未知',
      hot: item.like_count || item.views_count || '',
      url: item.id ? `https://sspai.com/post/${item.id}` : '',
    }))
  },
}

export default sspai

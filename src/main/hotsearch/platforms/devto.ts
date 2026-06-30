/**
 * Dev.to 热门文章
 * 数据源：公开 API（无需代理）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const devto: PlatformModule = {
  config: {
    key: 'devto',
    name: 'Dev.to',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data } = await http.get('https://dev.to/api/articles', {
      params: { top: 1, per_page: this.config.maxItems },
    })

    return (data || []).map((article: any, i: number) => ({
      rank: i + 1,
      title: article.title || '未知',
      hot: article.public_reactions_count || article.positive_reactions_count || 0,
      url: article.url || article.canonical_url,
      subtitle: article.tag_list?.slice(0, 3).join(', '),
    }))
  },
}

export default devto

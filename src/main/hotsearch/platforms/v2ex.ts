/**
 * V2EX 热门话题
 * 数据源：公共 API（国内可访问）
 */

import type { PlatformModule } from '../types'
import axios from 'axios'

const v2ex: PlatformModule = {
  config: {
    key: 'v2ex',
    name: 'V2EX',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data } = await axios.get('https://www.v2ex.com/api/topics/hot.json', {
      timeout: ctx.timeout,
      headers: {
        'User-Agent': ctx.userAgent,
        'Accept': 'application/json',
      },
    })

    return (Array.isArray(data) ? data : [])
      .slice(0, this.config.maxItems)
      .map((item: any, index: number) => ({
        rank: index + 1,
        title: item.title || '未知',
        hot: item.replies || 0,
        url: item.url || `https://www.v2ex.com/t/${item.id}`,
        subtitle: item.node?.title || undefined,
      }))
  },
}

export default v2ex

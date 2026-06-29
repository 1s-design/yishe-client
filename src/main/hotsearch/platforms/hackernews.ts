/**
 * Hacker News 热门
 * 数据源：Firebase API（需要境外网络）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const API_BASE = 'https://hacker-news.firebaseio.com/v0'

const hackernews: PlatformModule = {
  config: {
    key: 'hackernews',
    name: 'Hacker News',
    enabled: true,
    environment: 'proxy',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx);
    // 获取 top story IDs
    const { data: ids } = await http.get<number[]>(`${API_BASE}/topstories.json`)

    const topIds = (ids || []).slice(0, this.config.maxItems)

    // 并发获取每条 story 详情
    const items = await Promise.all(
      topIds.map(async (id, index) => {
        try {
          const { data } = await http.get(`${API_BASE}/item/${id}.json`, {
            timeout: 5000,
          })
          return {
            rank: index + 1,
            title: data.title || '未知',
            hot: data.score || '',
            url: data.url || `https://news.ycombinator.com/item?id=${id}`,
            subtitle: data.descendants ? `${data.descendants} comments` : undefined,
          }
        } catch {
          return null
        }
      }),
    )

    return items.filter(Boolean) as any[]
  },
}

export default hackernews

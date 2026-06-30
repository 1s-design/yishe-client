/**
 * 虎嗅 热门文章
 * 数据源：HTML 解析（国内直连）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const huxiu: PlatformModule = {
  config: {
    key: 'huxiu',
    name: '虎嗅',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data: html } = await http.get('https://www.huxiu.com/', {
      headers: {
        'Accept': 'text/html',
      },
    })

    const items: { rank: number; title: string; hot: string; url: string }[] = []

    // Parse article titles from HTML
    const articleRegex = /<a[^>]*href="(\/article\/[^"]*)"[^>]*>\s*<h4[^>]*>([\s\S]*?)<\/h4>/gi
    let match: RegExpExecArray | null

    while ((match = articleRegex.exec(String(html))) && items.length < this.config.maxItems) {
      const title = match[2].replace(/<[^>]+>/g, '').trim()
      if (title) {
        items.push({
          rank: items.length + 1,
          title,
          hot: '',
          url: `https://www.huxiu.com${match[1]}`,
        })
      }
    }

    // Fallback: try broader article link pattern
    if (items.length === 0) {
      const fallbackRegex = /<a[^>]*href="(\/article\/\d+\.html)"[^>]*>([\s\S]*?)<\/a>/gi
      while ((match = fallbackRegex.exec(String(html))) && items.length < this.config.maxItems) {
        const title = match[2].replace(/<[^>]+>/g, '').trim()
        if (title && title.length > 4) {
          items.push({
            rank: items.length + 1,
            title,
            hot: '',
            url: `https://www.huxiu.com${match[1]}`,
          })
        }
      }
    }

    return items.slice(0, this.config.maxItems)
  },
}

export default huxiu

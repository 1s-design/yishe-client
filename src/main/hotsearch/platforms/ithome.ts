/**
 * IT之家 热门文章
 * 数据源：HTML 解析（国内直连）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const ithome: PlatformModule = {
  config: {
    key: 'ithome',
    name: 'IT之家',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data: html } = await http.get('https://www.ithome.com/', {
      headers: {
        'Accept': 'text/html',
      },
    })

    const items: { rank: number; title: string; hot: string; url: string }[] = []

    // Parse hot article links from the homepage
    const articleRegex = /<a[^>]*href="(https?:\/\/www\.ithome\.com\/\d+\/\d+\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
    let match: RegExpExecArray | null
    const seen = new Set<string>()

    while ((match = articleRegex.exec(String(html))) && items.length < this.config.maxItems) {
      const title = match[2].replace(/<[^>]+>/g, '').trim()
      const url = match[1]
      if (title && title.length > 4 && !seen.has(url)) {
        seen.add(url)
        items.push({
          rank: items.length + 1,
          title,
          hot: '',
          url,
        })
      }
    }

    // Fallback: try the hot list page
    if (items.length === 0) {
      try {
        const { data: hotHtml } = await http.get('https://www.ithome.com/top/', {
          headers: { 'Accept': 'text/html' },
        })
        const hotRegex = /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
        while ((match = hotRegex.exec(String(hotHtml))) && items.length < this.config.maxItems) {
          const title = match[2].replace(/<[^>]+>/g, '').trim()
          if (title && title.length > 4 && match[1].includes('ithome.com')) {
            items.push({
              rank: items.length + 1,
              title,
              hot: '',
              url: match[1],
            })
          }
        }
      } catch {
        // ignore fallback failure
      }
    }

    return items.slice(0, this.config.maxItems)
  },
}

export default ithome

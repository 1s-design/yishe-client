/**
 * 京东热搜
 * 数据源：HTML 解析（国内直连）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const jdHot: PlatformModule = {
  config: {
    key: 'jd_hot',
    name: '京东热搜',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)

    try {
      // Try the main page for hot search keywords
      const { data: html } = await http.get('https://www.jd.com/', {
        headers: {
          'Accept': 'text/html',
        },
      })

      const items: { rank: number; title: string; hot: string; url: string }[] = []

      // Parse hot search keywords from the search bar area
      const hotRegex = /<a[^>]*href="[^"]*search\.jd\.com[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
      let match: RegExpExecArray | null
      const seen = new Set<string>()

      while ((match = hotRegex.exec(String(html))) && items.length < this.config.maxItems) {
        const title = match[1].replace(/<[^>]+>/g, '').trim()
        if (title && title.length > 1 && !seen.has(title)) {
          seen.add(title)
          items.push({
            rank: items.length + 1,
            title,
            hot: '',
            url: `https://search.jd.com/Search?keyword=${encodeURIComponent(title)}`,
          })
        }
      }

      // Fallback: try the hot ranking page
      if (items.length === 0) {
        try {
          const { data: hotData } = await http.get('https://top.jd.com/ranking', {
            headers: { 'Accept': 'text/html' },
          })
          const rankingRegex = /<a[^>]*href="[^"]*"[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
          while ((match = rankingRegex.exec(String(hotData))) && items.length < this.config.maxItems) {
            const title = match[1].replace(/<[^>]+>/g, '').trim()
            if (title) {
              items.push({
                rank: items.length + 1,
                title,
                hot: '',
                url: `https://search.jd.com/Search?keyword=${encodeURIComponent(title)}`,
              })
            }
          }
        } catch {
          // ignore fallback failure
        }
      }

      return items.slice(0, this.config.maxItems)
    } catch {
      return []
    }
  },
}

export default jdHot

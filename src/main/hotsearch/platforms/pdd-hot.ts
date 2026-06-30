/**
 * 拼多多热搜
 * 数据源：HTML 解析（国内直连）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const pddHot: PlatformModule = {
  config: {
    key: 'pdd_hot',
    name: '拼多多热搜',
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
      const { data: html } = await http.get('https://www.pinduoduo.com/', {
        headers: {
          'Accept': 'text/html',
        },
      })

      const items: { rank: number; title: string; hot: string; url: string }[] = []

      // Parse hot search keywords from HTML
      const hotRegex = /<a[^>]*href="[^"]*search[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
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
            url: `https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(title)}`,
          })
        }
      }

      // Fallback: try to extract from embedded JSON data
      if (items.length === 0) {
        const jsonRegex = /"hotWords"\s*:\s*(\[[\s\S]*?\])/
        const jsonMatch = jsonRegex.exec(String(html))
        if (jsonMatch) {
          try {
            const words = JSON.parse(jsonMatch[1])
            words.slice(0, this.config.maxItems).forEach((item: any, i: number) => {
              const title = typeof item === 'string' ? item : item.word || item.title || ''
              if (title) {
                items.push({
                  rank: i + 1,
                  title,
                  hot: '',
                  url: `https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(title)}`,
                })
              }
            })
          } catch {
            // JSON parse failed
          }
        }
      }

      return items.slice(0, this.config.maxItems)
    } catch {
      return []
    }
  },
}

export default pddHot

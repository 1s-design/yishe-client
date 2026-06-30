/**
 * 淘宝热搜
 * 数据源：HTML 解析（国内直连）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const taobaoHot: PlatformModule = {
  config: {
    key: 'taobao_hot',
    name: '淘宝热搜',
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
      const { data: html } = await http.get('https://www.taobao.com/', {
        headers: {
          'Accept': 'text/html',
        },
      })

      const items: { rank: number; title: string; hot: string; url: string }[] = []

      // Parse hot search keywords from HTML
      const hotRegex = /<a[^>]*href="[^"]*search[^"]*"[^>]*data-query="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
      let match: RegExpExecArray | null

      while ((match = hotRegex.exec(String(html))) && items.length < this.config.maxItems) {
        const title = (match[2] || match[1]).replace(/<[^>]+>/g, '').trim()
        if (title) {
          items.push({
            rank: items.length + 1,
            title,
            hot: '',
            url: `https://s.taobao.com/search?q=${encodeURIComponent(title)}`,
          })
        }
      }

      // Fallback: try to extract from script data
      if (items.length === 0) {
        const scriptRegex = /"hotKeyWords"\s*:\s*\[([\s\S]*?)\]/
        const scriptMatch = scriptRegex.exec(String(html))
        if (scriptMatch) {
          try {
            const keywords = JSON.parse(`[${scriptMatch[1]}]`)
            keywords.slice(0, this.config.maxItems).forEach((kw: any, i: number) => {
              const title = typeof kw === 'string' ? kw : kw.word || kw.title || ''
              if (title) {
                items.push({
                  rank: i + 1,
                  title,
                  hot: '',
                  url: `https://s.taobao.com/search?q=${encodeURIComponent(title)}`,
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
      // If main page fails, return empty
      return []
    }
  },
}

export default taobaoHot

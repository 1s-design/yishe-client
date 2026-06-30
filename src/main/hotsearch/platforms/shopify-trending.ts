/**
 * Shopify Trending 热门趋势
 * 数据源：HTML 解析（需要境外网络）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const shopifyTrending: PlatformModule = {
  config: {
    key: 'shopify_trending',
    name: 'Shopify Trending',
    enabled: true,
    environment: 'proxy',
    maxItems: 20,
    timeout: 20000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)

    try {
      // Try the Shopify trending/explore page
      const { data: html } = await http.get('https://www.shopify.com/trending', {
        headers: {
          'Accept': 'text/html',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })

      const items: { rank: number; title: string; hot: string; url: string }[] = []

      // Parse trending topics from HTML
      const topicRegex = /<a[^>]*href="([^"]*)"[^>]*>\s*<[^>]*class="[^"]*trending[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/gi
      let match: RegExpExecArray | null

      while ((match = topicRegex.exec(String(html))) && items.length < this.config.maxItems) {
        const title = match[2].replace(/<[^>]+>/g, '').trim()
        if (title) {
          items.push({
            rank: items.length + 1,
            title,
            hot: '',
            url: match[1].startsWith('http') ? match[1] : `https://www.shopify.com${match[1]}`,
          })
        }
      }

      // Fallback: try generic heading/link pattern
      if (items.length === 0) {
        const fallbackRegex = /<h[2-4][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/h[2-4]>/gi
        while ((match = fallbackRegex.exec(String(html))) && items.length < this.config.maxItems) {
          const title = match[2].replace(/<[^>]+>/g, '').trim()
          if (title && title.length > 3) {
            items.push({
              rank: items.length + 1,
              title,
              hot: '',
              url: match[1].startsWith('http') ? match[1] : `https://www.shopify.com${match[1]}`,
            })
          }
        }
      }

      return items.slice(0, this.config.maxItems)
    } catch {
      // If trending page is not available, try the blog for trending topics
      const http2 = createHttpClient(ctx)
      const { data: html } = await http2.get('https://www.shopify.com/blog', {
        headers: {
          'Accept': 'text/html',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })

      const items: { rank: number; title: string; hot: string; url: string }[] = []
      const blogRegex = /<a[^>]*href="(\/blog\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
      let match: RegExpExecArray | null

      while ((match = blogRegex.exec(String(html))) && items.length < this.config.maxItems) {
        const title = match[2].replace(/<[^>]+>/g, '').trim()
        if (title && title.length > 5) {
          items.push({
            rank: items.length + 1,
            title,
            hot: '',
            url: `https://www.shopify.com${match[1]}`,
          })
        }
      }

      return items.slice(0, this.config.maxItems)
    }
  },
}

export default shopifyTrending

/**
 * eBay Trending 热门商品
 * 数据源：HTML 解析（需要境外网络）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const ebayTrending: PlatformModule = {
  config: {
    key: 'ebay_trending',
    name: 'eBay Trending',
    enabled: true,
    environment: 'proxy',
    maxItems: 20,
    timeout: 20000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data: html } = await http.get('https://www.ebay.com/trending', {
      headers: {
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    const items: { rank: number; title: string; hot: string; url: string }[] = []

    // Parse trending items from HTML
    const itemRegex = /<a[^>]*href="(https?:\/\/www\.ebay\.com\/[^"]*)"[^>]*>\s*<[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/gi
    let match: RegExpExecArray | null

    while ((match = itemRegex.exec(String(html))) && items.length < this.config.maxItems) {
      const title = match[2].replace(/<[^>]+>/g, '').trim()
      if (title) {
        items.push({
          rank: items.length + 1,
          title,
          hot: '',
          url: match[1],
        })
      }
    }

    // Fallback: try generic item card pattern
    if (items.length === 0) {
      const fallbackRegex = /<span[^>]*class="[^"]*[^"]*item[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/span>/gi
      while ((match = fallbackRegex.exec(String(html))) && items.length < this.config.maxItems) {
        const title = match[1].replace(/<[^>]+>/g, '').trim()
        if (title) {
          items.push({
            rank: items.length + 1,
            title,
            hot: '',
            url: 'https://www.ebay.com/trending',
          })
        }
      }
    }

    return items.slice(0, this.config.maxItems)
  },
}

export default ebayTrending

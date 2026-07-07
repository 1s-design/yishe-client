/**
 * Etsy Trending 热门商品
 * 数据源：HTML 解析（需要境外网络）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const etsyTrending: PlatformModule = {
  config: {
    key: 'etsy_trending',
    name: 'Etsy Trending',
    enabled: false,
    environment: 'proxy',
    maxItems: 20,
    timeout: 20000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data: html } = await http.get('https://www.etsy.com/trending', {
      headers: {
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    const items: { rank: number; title: string; hot: string; url: string }[] = []

    // Parse trending listings from HTML
    const listingRegex = /<a[^>]*href="(https?:\/\/www\.etsy\.com\/listing\/[^"]*)"[^>]*>[\s\S]*?<[^>]*class="[^"]*v2-listing-card__info[^"]*"[^>]*>[\s\S]*?<[^>]*>([\s\S]*?)<\/[^>]*>/gi
    let match: RegExpExecArray | null

    while ((match = listingRegex.exec(String(html))) && items.length < this.config.maxItems) {
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

    // Fallback: try generic listing title pattern
    if (items.length === 0) {
      const fallbackRegex = /<a[^>]*href="[^"]*etsy\.com\/listing\/[^"]*"[^>]*aria-label="([^"]+)"/gi
      while ((match = fallbackRegex.exec(String(html))) && items.length < this.config.maxItems) {
        const title = match[1].trim()
        if (title) {
          items.push({
            rank: items.length + 1,
            title,
            hot: '',
            url: 'https://www.etsy.com/trending',
          })
        }
      }
    }

    return items.slice(0, this.config.maxItems)
  },
}

export default etsyTrending

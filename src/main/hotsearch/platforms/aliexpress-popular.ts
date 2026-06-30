/**
 * AliExpress 热门商品
 * 数据源：HTML 解析（需要境外网络）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const aliexpressPopular: PlatformModule = {
  config: {
    key: 'aliexpress_popular',
    name: 'AliExpress 热门',
    enabled: true,
    environment: 'proxy',
    maxItems: 20,
    timeout: 20000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data: html } = await http.get('https://www.aliexpress.com/popular/', {
      headers: {
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    const items: { rank: number; title: string; hot: string; url: string }[] = []

    // Try to parse product cards from HTML
    const productRegex = /<a[^>]*href="(\/\/www\.aliexpress\.com\/item\/[^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/span>/gi
    let match: RegExpExecArray | null

    while ((match = productRegex.exec(String(html))) && items.length < this.config.maxItems) {
      const title = match[2].replace(/<[^>]+>/g, '').trim()
      if (title) {
        items.push({
          rank: items.length + 1,
          title,
          hot: '',
          url: match[1].startsWith('//') ? `https:${match[1]}` : match[1],
        })
      }
    }

    // Fallback: try generic product link pattern
    if (items.length === 0) {
      const fallbackRegex = /<a[^>]*href="[^"]*aliexpress\.com\/item\/[^"]*"[^>]*title="([^"]+)"/gi
      while ((match = fallbackRegex.exec(String(html))) && items.length < this.config.maxItems) {
        const title = match[1].trim()
        if (title) {
          items.push({
            rank: items.length + 1,
            title,
            hot: '',
            url: 'https://www.aliexpress.com/popular/',
          })
        }
      }
    }

    return items.slice(0, this.config.maxItems)
  },
}

export default aliexpressPopular

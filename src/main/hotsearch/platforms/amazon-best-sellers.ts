/**
 * Amazon 畅销榜
 * 数据源：HTML 解析（需要境外网络）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const amazonBestSellers: PlatformModule = {
  config: {
    key: 'amazon_bestsellers',
    name: 'Amazon 畅销榜',
    enabled: true,
    environment: 'proxy',
    maxItems: 20,
    timeout: 20000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data: html } = await http.get('https://www.amazon.com/best-sellers/zgbs', {
      headers: {
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    const items: { rank: number; title: string; hot: string; url: string }[] = []
    const regex = /<span[^>]*class="[^"]*zg-bdg-text[^"]*"[^>]*>(\d+)<\/span>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi
    let match: RegExpExecArray | null

    while ((match = regex.exec(String(html))) && items.length < this.config.maxItems) {
      const title = match[2].replace(/<[^>]+>/g, '').trim()
      if (title) {
        items.push({
          rank: parseInt(match[1]),
          title,
          hot: '',
          url: 'https://www.amazon.com/best-sellers/zgbs',
        })
      }
    }

    return items.slice(0, this.config.maxItems)
  },
}

export default amazonBestSellers

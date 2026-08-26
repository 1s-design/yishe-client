/**
 * 当当图书畅销榜
 * 数据源：HTML 解析（国内直连）
 */

import type { PlatformModule } from '../types'

import { createHttpClient } from '../http'

const dangdangBestsellers: PlatformModule = {
  config: {
    key: 'dangdang_bestsellers',
    name: '当当畅销榜',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data: html } = await http.get('http://bang.dangdang.com/books/bestsellers/01.00.00.00.00.00-recent7-0-0-1-1', {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      // 当当使用 GBK 编码
      responseType: 'arraybuffer',
    })

    // 处理 GBK 编码
    let htmlStr: string
    try {
      const decoder = new TextDecoder('gbk')
      htmlStr = decoder.decode(new Uint8Array(html as any))
    } catch {
      htmlStr = String(html)
    }

    const items: { rank: number; title: string; author: string; price: string; url: string }[] = []

    // 解析当当图书列表
    const nameRegex = /class="name"[^>]*>[\s\S]*?title="([^"]+)"/g
    let match: RegExpExecArray | null
    const titles: string[] = []
    while ((match = nameRegex.exec(htmlStr)) !== null) {
      const title = match[1].trim()
      if (title && title.length > 2) {
        titles.push(title)
      }
    }

    // 提取作者
    const authorRegex = /class="publisher_info"[^>]*>[\s\S]*?<a[^>]*>([^<]+)</g
    const authors: string[] = []
    while ((match = authorRegex.exec(htmlStr)) !== null) {
      authors.push(match[1].trim())
    }

    // 提取价格
    const priceRegex = /class="price_n"[^>]*>\.?([\d.]+)/g
    const prices: string[] = []
    while ((match = priceRegex.exec(htmlStr)) !== null) {
      prices.push(`¥${match[1]}`)
    }

    // 组装数据
    for (let i = 0; i < titles.length && i < this.config.maxItems; i++) {
      items.push({
        rank: i + 1,
        title: titles[i],
        author: authors[i] || '',
        price: prices[i] || '',
        url: 'http://bang.dangdang.com/books/bestsellers/',
      })
    }

    return items.slice(0, this.config.maxItems)
  },
}

export default dangdangBestsellers


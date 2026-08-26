/**
 * 慢慢买优惠精选
 * 数据源：HTML 解析（国内直连）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const manmanbuyDeals: PlatformModule = {
  config: {
    key: 'manmanbuy_deals',
    name: '慢慢买优惠',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data: html } = await http.get('https://www.manmanbuy.com/', {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    })

    const items: { rank: number; title: string; price: string; mall: string; url: string }[] = []
    const seen = new Set<string>()

    // 解析商品标题
    const titleRegex = /title="([^"]+)"/g
    let match: RegExpExecArray | null

    while ((match = titleRegex.exec(html)) !== null && items.length < this.config.maxItems) {
      const title = match[1].trim()
      // 过滤无效标题
      if (
        title.length > 5 &&
        title.length < 80 &&
        !seen.has(title) &&
        !title.includes('下载') &&
        !title.includes('客户端') &&
        !title.startsWith('http') &&
        !title.includes('iPhone版') &&
        !title.includes('Android版')
      ) {
        seen.add(title)
        items.push({
          rank: items.length + 1,
          title,
          price: '',
          mall: '',
          url: 'https://www.manmanbuy.com/',
        })
      }
    }

    return items.slice(0, this.config.maxItems)
  },
}

export default manmanbuyDeals

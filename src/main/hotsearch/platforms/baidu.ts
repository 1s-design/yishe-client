/**
 * 百度热搜
 * 数据源：百度热搜页面嵌入的 JSON 数据 (<!--s-data:{...}-->)
 */

import type { PlatformModule } from '../types'
import axios from 'axios'

const baidu: PlatformModule = {
  config: {
    key: 'baidu',
    name: '百度热搜',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data: html } = await axios.get('https://top.baidu.com/board?tab=realtime', {
      timeout: ctx.timeout,
      responseType: 'text',
      headers: {
        'User-Agent': ctx.userAgent,
        'Referer': 'https://top.baidu.com/',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    // 百度热搜数据嵌入在 HTML 注释 <!--s-data:{...}--> 中
    const match = String(html).match(/<!--s-data:(\{[\s\S]*?)-->/)
    if (!match) return []

    const json = JSON.parse(match[1])
    const content = json?.data?.cards?.[0]?.content || []

    return content.slice(0, this.config.maxItems).map((item: any, index: number) => ({
      rank: index + 1,
      title: item.word || item.query || '未知',
      hot: item.hotScore || '',
      url: item.rawUrl || item.url || `https://www.baidu.com/s?wd=${encodeURIComponent(item.word || '')}`,
      desc: item.desc || undefined,
      tag: item.hotTag === '3' ? '热' : item.hotTag === '1' ? '新' : undefined,
    }))
  },
}

export default baidu

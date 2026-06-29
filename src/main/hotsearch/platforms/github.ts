/**
 * GitHub Trending 热门项目
 * 数据源：HTML 解析（国内可访问）
 */

import type { PlatformModule } from '../types'
import axios from 'axios'

const github: PlatformModule = {
  config: {
    key: 'github',
    name: 'GitHub',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data: html } = await axios.get('https://github.com/trending', {
      timeout: ctx.timeout,
      responseType: 'text',
      headers: {
        'User-Agent': ctx.userAgent,
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    const items: { rank: number; title: string; hot: string; url: string; subtitle?: string }[] = []
    const repoRegex = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi
    let match: RegExpExecArray | null
    let rank = 0

    while ((match = repoRegex.exec(String(html)))) {
      rank++
      const href = match[1].trim()
      const titleRaw = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      // titleRaw 格式: "owner / repo"
      const title = titleRaw.replace(/\s*\/\s*/, '/')

      items.push({
        rank,
        title: title || href,
        hot: '',
        url: `https://github.com${href}`,
      })
    }

    // 尝试提取描述
    const descRegex = /<p class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/gi

    let descIdx = 0
    while ((match = descRegex.exec(String(html)))) {
      if (descIdx < items.length) {
        items[descIdx].subtitle = match[1].replace(/<[^>]+>/g, '').trim().slice(0, 100)
      }
      descIdx++
    }

    return items.slice(0, this.config.maxItems)
  },
}

export default github

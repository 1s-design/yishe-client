/**
 * Lobsters 热门
 * 数据源：Lobsters 首页 HTML 解析
 */

import type { PlatformModule } from '../types'
import axios from 'axios'

const lobsters: PlatformModule = {
  config: {
    key: 'lobsters',
    name: 'Lobsters',
    enabled: true,
    environment: 'proxy',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data: html } = await axios.get('https://lobste.rs/', {
      timeout: ctx.timeout,
      responseType: 'text',
      headers: {
        'User-Agent': ctx.userAgent,
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    const items: { rank: number; title: string; hot: string; url: string; subtitle?: string; tag?: string }[] = []

    // 每条故事: <div class="story"> 内含标题链接与分数
    const storyRegex = /<div[^>]*class="[^"]*story[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi
    let storyMatch: RegExpExecArray | null
    let rank = 0

    while ((storyMatch = storyRegex.exec(String(html)))) {
      rank++
      const block = storyMatch[1]

      // 标题与链接
      const titleMatch = block.match(/<a[^>]*class="[^"]*u-url[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/i)
        || block.match(/<a[^>]*href="([^"]*)"[^>]*class="[^"]*u-url[^"]*"[^>]*>([^<]*)<\/a>/i)
        || block.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]{5,})<\/a>/i)

      // 分数 (score)
      const scoreMatch = block.match(/class="[^"]*score[^"]*"[^>]*>([0-9]+)</i)

      // 标签
      const tags: string[] = []
      const tagRegex = /<a[^>]*class="[^"]*tag[^"]*"[^>]*>([^<]*)<\/a>/gi
      let tagMatch: RegExpExecArray | null
      while ((tagMatch = tagRegex.exec(block))) {
        tags.push(tagMatch[1].trim())
      }

      if (titleMatch) {
        const url = titleMatch[1].startsWith('http') ? titleMatch[1] : `https://lobste.rs${titleMatch[1]}`
        items.push({
          rank,
          title: titleMatch[2].trim(),
          hot: scoreMatch ? scoreMatch[1] : '',
          url,
          subtitle: tags.length > 0 ? tags.slice(0, 3).join(', ') : undefined,
          tag: tags[0] || undefined,
        })
      }

      if (rank >= this.config.maxItems) break
    }

    return items
  },
}

export default lobsters

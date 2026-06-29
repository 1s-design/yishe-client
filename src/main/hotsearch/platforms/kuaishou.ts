import type { PlatformModule } from '../types'
import axios from 'axios'

const kuaishou: PlatformModule = {
  config: {
    key: 'kuaishou',
    name: '快手',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data: html } = await axios.get('https://www.kuaishou.com/?isHome=1', {
      timeout: ctx.timeout,
      responseType: 'text',
      headers: {
        'User-Agent': ctx.userAgent,
        'Referer': 'https://www.kuaishou.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    const items: { rank: number; title: string; hot: string }[] = []
    const itemRegex = /"VisionHotRankItem:([^"]+)":\s*({[^}]*"rank":[^}]*"id":[^}]*"name":[^}]*"hotValue":[^}]*})/g
    let match: RegExpExecArray | null

    while ((match = itemRegex.exec(String(html || '')))) {
      const jsonText = match[2]
      const rankMatch = jsonText.match(/"rank":\s*(\d+)/)
      const nameMatch = jsonText.match(/"name":\s*"([^"]+)"/)
      const hotMatch = jsonText.match(/"hotValue":\s*"([^"]+)"/)
      if (!rankMatch || !nameMatch) continue

      items.push({
        rank: Number(rankMatch[1]) + 1,
        title: nameMatch[1],
        hot: hotMatch ? hotMatch[1] : '',
      })
    }

    items.sort((a, b) => a.rank - b.rank)
    return items.slice(0, this.config.maxItems)
  },
}

export default kuaishou

/**
 * Google Trends 热搜
 * 数据源：RSS Feed（需要境外网络）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const FEED_URL = 'https://trends.google.com/trending/rss'
const DEFAULT_GEO = 'US'

function extractTagValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''
}

function extractTagBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const blocks: string[] = []
  let match
  while ((match = regex.exec(xml))) {
    blocks.push(match[1])
  }
  return blocks
}

const googleTrends: PlatformModule = {
  config: {
    key: 'google_trends',
    name: 'Google Trends',
    enabled: true,
    environment: 'proxy',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx);
    const { data: xml } = await http.get(`${FEED_URL}?geo=${DEFAULT_GEO}`, {
      responseType: 'text',
      headers: {
        'User-Agent': ctx.userAgent,
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://trends.google.com/',
        // 绕过 GDPR consent
        'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+100',
      },
    })

    const items = extractTagBlocks(String(xml), 'item')
      .map((block, index) => {
        const title = extractTagValue(block, 'title')
        const approxTraffic = extractTagValue(block, 'ht:approx_traffic')

        return {
          rank: index + 1,
          title,
          hot: approxTraffic || '',
          url: `https://trends.google.com/trends/explore?geo=${DEFAULT_GEO}&q=${encodeURIComponent(title)}`,
        }
      })
      .filter((item) => item.title)

    return items.slice(0, this.config.maxItems)
  },
}

export default googleTrends

/**
 * Reuters 热点
 * 数据源：RSS Feed（需要境外网络）
 */

import type { PlatformModule } from '../types'
import { createHttpClient } from '../http'

const FEED_URL = 'https://www.reutersagency.com/feed/'

function extractTagValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''
}

function extractTagBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const blocks: string[] = []
  let match
  while ((match = regex.exec(xml))) blocks.push(match[1])
  return blocks
}

const reuters: PlatformModule = {
  config: {
    key: 'reuters',
    name: 'Reuters',
    enabled: true,
    environment: 'proxy',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const http = createHttpClient(ctx)
    const { data: xml } = await http.get(FEED_URL, { responseType: 'text' })

    return extractTagBlocks(String(xml), 'item')
      .map((block, i) => ({
        rank: i + 1,
        title: extractTagValue(block, 'title'),
        hot: extractTagValue(block, 'description'),
        url: extractTagValue(block, 'link'),
      }))
      .filter(item => item.title)
      .slice(0, this.config.maxItems)
  },
}

export default reuters

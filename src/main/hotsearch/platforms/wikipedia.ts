/**
 * Wikipedia 热门页面
 * 数据源：Wikimedia REST API（国内可访问）
 */

import type { PlatformModule } from '../types'
import axios from 'axios'

const wikipedia: PlatformModule = {
  config: {
    key: 'wikipedia',
    name: '维基百科',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    // 获取昨天的热门文章（今天的可能还不完整）
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const year = yesterday.getFullYear()
    const month = String(yesterday.getMonth() + 1).padStart(2, '0')
    const day = String(yesterday.getDate()).padStart(2, '0')

    const { data } = await axios.get(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${year}/${month}/${day}`,
      {
        timeout: ctx.timeout,
        headers: {
          'User-Agent': 'YisheHotSearch/1.0 (https://1s.design; admin@1s.design)',
          'Accept': 'application/json',
        },
      },
    )

    const articles = data?.items?.[0]?.articles || []

    return articles
      .filter((item: any) => item.article && !item.article.startsWith('Main_Page'))
      .slice(0, this.config.maxItems)
      .map((item: any, index: number) => ({
        rank: index + 1,
        title: decodeURIComponent(item.article.replace(/_/g, ' ')),
        hot: item.views || '',
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.article)}`,
      }))
  },
}

export default wikipedia

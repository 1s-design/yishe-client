/**
 * Reddit 热门
 * 数据源：公共 JSON API（需要境外网络）
 */

import type { PlatformModule } from '../types'
import axios from 'axios'

const reddit: PlatformModule = {
  config: {
    key: 'reddit',
    name: 'Reddit',
    enabled: true,
    environment: 'proxy',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    // Reddit 要求 User-Agent 格式为: platform:app_id:version (by /u/username)
    // 使用 old.reddit.com 更稳定
    const { data } = await axios.get('https://old.reddit.com/r/popular.json', {
      timeout: ctx.timeout,
      params: { limit: this.config.maxItems, raw_json: 1 },
      headers: {
        'User-Agent': 'YisheHotSearch:1.0 (by /u/yishe_bot)',
        'Accept': 'application/json',
      },
      // 跟随重定向
      maxRedirects: 5,
    })

    const posts = data?.data?.children || []

    return posts
      .filter((child: any) => child?.data)
      .map((child: any, index: number) => {
        const post = child.data
        return {
          rank: index + 1,
          title: post.title || '未知',
          hot: post.score || '',
          url: post.url?.startsWith('http')
            ? post.url
            : `https://www.reddit.com${post.permalink}`,
          subtitle: post.subreddit ? `r/${post.subreddit}` : undefined,
          tag: post.link_flair_text || undefined,
        }
      })
      .slice(0, this.config.maxItems)
  },
}

export default reddit

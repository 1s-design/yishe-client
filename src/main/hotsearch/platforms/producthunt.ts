/**
 * Product Hunt 热门产品
 * 数据源：公开 API（需要境外网络）
 * 使用 GraphQL 公开端点，比 HTML 解析更稳定
 */

import type { PlatformModule } from '../types'
import axios from 'axios'

const producthunt: PlatformModule = {
  config: {
    key: 'producthunt',
    name: 'Product Hunt',
    enabled: true,
    environment: 'proxy',
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    // 使用 Product Hunt 的公开 GraphQL API
    const { data } = await axios.post(
      'https://www.producthunt.com/frontend/graphql',
      {
        operationName: 'HomePage',
        query: `query HomePage($cursor: String) {
          homefeed(first: 20, after: $cursor) {
            edges {
              node {
                ... on Post {
                  id
                  name
                  tagline
                  votesCount
                  commentsCount
                  slug
                  website
                }
              }
            }
          }
        }`,
        variables: {},
      },
      {
        timeout: ctx.timeout,
        headers: {
          'User-Agent': ctx.userAgent,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Origin': 'https://www.producthunt.com',
          'Referer': 'https://www.producthunt.com/',
        },
      },
    )

    const edges = data?.data?.homefeed?.edges || []

    return edges
      .map((edge: any, index: number) => {
        const post = edge?.node
        if (!post?.name) return null
        return {
          rank: index + 1,
          title: post.name,
          hot: post.votesCount || '',
          url: post.website || `https://www.producthunt.com/posts/${post.slug}`,
          subtitle: post.tagline || undefined,
        }
      })
      .filter(Boolean)
      .slice(0, this.config.maxItems)
  },
}

export default producthunt

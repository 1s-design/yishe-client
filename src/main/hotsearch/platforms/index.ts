/**
 * 热搜平台注册表（键表）
 *
 * 平台「实现」已收敛到服务端源定义 + 客户端采集引擎（hotSearchService.fetchPlatform 优先走引擎）。
 * 本表只保留平台键 / 名称 / 环境等元信息，供 MCP 工具名生成、路由与状态查询使用。
 * 新增平台：服务端加源定义即可，本表仅在需要暴露新键时补一行。
 */
import type { PlatformModule } from '../types'

const deprecatedFetch = async (): Promise<any[]> => {
  throw new Error('该平台实现已迁移至采集引擎（服务端源定义）')
}

export const allPlatforms: PlatformModule[] = [
  { config: { key: '36kr', name: '36氪', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'aliexpress_popular', name: 'AliExpress 热门', environment: 'proxy', enabled: true, retryCount: 2, timeout: 20000 }, fetch: deprecatedFetch },
  { config: { key: 'aljazeera', name: 'Al Jazeera', environment: 'proxy', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'amazon_bestsellers', name: 'Amazon 畅销榜', environment: 'proxy', enabled: true, retryCount: 2, timeout: 20000 }, fetch: deprecatedFetch },
  { config: { key: 'baidu', name: '百度热搜', environment: 'direct', enabled: true, retryCount: 2, timeout: 10000 }, fetch: deprecatedFetch },
  { config: { key: 'bbc_news', name: 'BBC News', environment: 'proxy', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'bilibili', name: '哔哩哔哩', environment: 'direct', enabled: true, retryCount: 2, timeout: 10000 }, fetch: deprecatedFetch },
  { config: { key: 'cnn', name: 'CNN', environment: 'proxy', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'dangdang_bestsellers', name: '当当畅销榜', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'devto', name: 'Dev.to', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'douban', name: '豆瓣', environment: 'direct', enabled: true, retryCount: 2, timeout: 10000 }, fetch: deprecatedFetch },
  { config: { key: 'douyin', name: '抖音', environment: 'direct', enabled: true, retryCount: 2, timeout: 10000 }, fetch: deprecatedFetch },
  { config: { key: 'ebay_trending', name: 'eBay Trending', environment: 'proxy', enabled: true, retryCount: 2, timeout: 20000 }, fetch: deprecatedFetch },
  { config: { key: 'etsy_trending', name: 'Etsy Trending', environment: 'proxy', enabled: false, retryCount: 2, timeout: 20000 }, fetch: deprecatedFetch },
  { config: { key: 'flipboard', name: 'Flipboard', environment: 'proxy', enabled: false, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'github', name: 'GitHub', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'google_trends', name: 'Google Trends', environment: 'proxy', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'guardian', name: 'The Guardian', environment: 'proxy', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'hackernews', name: 'Hacker News', environment: 'proxy', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'huxiu', name: '虎嗅', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'ithome', name: 'IT之家', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'jd_hot', name: '京东热搜', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'kuaishou', name: '快手', environment: 'direct', enabled: true, retryCount: 2, timeout: 10000 }, fetch: deprecatedFetch },
  { config: { key: 'lobsters', name: 'Lobsters', environment: 'proxy', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'manmanbuy_deals', name: '慢慢买优惠', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'medium', name: 'Medium', environment: 'proxy', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'npm_trending', name: 'npm Trending', environment: 'direct', enabled: false, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'nytimes', name: 'New York Times', environment: 'proxy', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'pdd_hot', name: '拼多多热搜', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'producthunt', name: 'Product Hunt', environment: 'proxy', enabled: false, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'quora', name: 'Quora', environment: 'proxy', enabled: false, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'reddit', name: 'Reddit', environment: 'proxy', enabled: false, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'reuters', name: 'Reuters', environment: 'proxy', enabled: false, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'shopify_trending', name: 'Shopify Trending', environment: 'proxy', enabled: true, retryCount: 2, timeout: 20000 }, fetch: deprecatedFetch },
  { config: { key: 'sspai', name: '少数派', environment: 'direct', enabled: false, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'taobao_hot', name: '淘宝热搜', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: '', name: '', environment: 'direct', enabled: true, retryCount: 2, timeout: 12000 }, fetch: deprecatedFetch },
  { config: { key: 'tencent_tech', name: '腾讯科技', environment: 'direct', enabled: true, retryCount: 2, timeout: 12000 }, fetch: deprecatedFetch },
  { config: { key: 'toutiao', name: '今日头条', environment: 'direct', enabled: true, retryCount: 2, timeout: 10000 }, fetch: deprecatedFetch },
  { config: { key: 'v2ex', name: 'V2EX', environment: 'direct', enabled: true, retryCount: 2, timeout: 10000 }, fetch: deprecatedFetch },
  { config: { key: 'weibo', name: '微博', environment: 'direct', enabled: true, retryCount: 2, timeout: 10000 }, fetch: deprecatedFetch },
  { config: { key: '', name: '', environment: 'direct', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'xiaohongshu', name: '小红书', environment: 'direct', enabled: true, retryCount: 2, timeout: 10000 }, fetch: deprecatedFetch },
  { config: { key: 'yahoo_news', name: 'Yahoo News', environment: 'proxy', enabled: true, retryCount: 2, timeout: 15000 }, fetch: deprecatedFetch },
  { config: { key: 'zhihu', name: '知乎', environment: 'direct', enabled: true, retryCount: 2, timeout: 10000 }, fetch: deprecatedFetch }
] as any[]

export function getPlatform(key: string): PlatformModule | undefined {
  return allPlatforms.find((p) => p.config.key === key)
}

export function getEnabledPlatforms(): PlatformModule[] {
  return allPlatforms.filter((p) => p.config.enabled)
}

export function getPlatformsByEnvironment(env: 'direct' | 'proxy' | 'browser'): PlatformModule[] {
  return allPlatforms.filter((p) => p.config.environment === env)
}

import type { PlatformModule } from '../types'

// 国内平台 (direct)
import weibo from './weibo'
import douyin from './douyin'
import bilibili from './bilibili'
import zhihu from './zhihu'
import toutiao from './toutiao'
import douban from './douban'
import kuaishou from './kuaishou'
import v2ex from './v2ex'
import kr36 from './36kr'
import ithome from './ithome'
import baidu from './baidu'
import tencentNews from './tencent_news'
import tencentTech from './tencent_tech'
import xiaohongshu from './xiaohongshu'

// 国际新闻/趋势 (proxy)
import googleTrends from './google-trends'
import hackernews from './hackernews'
import github from './github'
import wikipedia from './wikipedia'
import bbcNews from './bbc-news'
import cnn from './cnn'
import nytimes from './nytimes'
import aljazeera from './aljazeera'
import devto from './devto'
import lobsters from './lobsters'

// 电商平台 (proxy)
import ebayTrending from './ebay-trending'
import shopifyTrending from './shopify-trending'

export const allPlatforms: PlatformModule[] = [
  // 国内平台 (direct)
  weibo,
  douyin,
  bilibili,
  zhihu,
  toutiao,
  douban,
  kuaishou,
  v2ex,
  kr36,
  ithome,
  baidu,
  tencentNews,
  tencentTech,
  xiaohongshu,
  // 国际新闻/趋势 (proxy)
  googleTrends,
  hackernews,
  github,
  wikipedia,
  bbcNews,
  cnn,
  nytimes,
  aljazeera,
  devto,
  lobsters,
  // 电商平台 (proxy)
  ebayTrending,
  shopifyTrending,
]

export function getPlatform(key: string): PlatformModule | undefined {
  return allPlatforms.find((p) => p.config.key === key)
}

export function getEnabledPlatforms(): PlatformModule[] {
  return allPlatforms.filter((p) => p.config.enabled)
}

export function getPlatformsByEnvironment(env: 'direct' | 'proxy' | 'browser'): PlatformModule[] {
  return allPlatforms.filter((p) => p.config.environment === env)
}

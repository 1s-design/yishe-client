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
import huxiu from './huxiu'
import ithome from './ithome'
import taobaoHot from './taobao-hot'
import jdHot from './jd-hot'
import pddHot from './pdd-hot'

// 国际新闻/趋势 (proxy)
import googleTrends from './google-trends'
import hackernews from './hackernews'
import github from './github'
import wikipedia from './wikipedia'
import bbcNews from './bbc-news'
import cnn from './cnn'
import nytimes from './nytimes'
import guardian from './guardian'
import aljazeera from './aljazeera'
import yahooNews from './yahoo-news'
import medium from './medium'
import devto from './devto'

// 电商平台 (proxy)
import amazonBestSellers from './amazon-best-sellers'
import aliexpressPopular from './aliexpress-popular'
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
  huxiu,
  ithome,
  taobaoHot,
  jdHot,
  pddHot,
  // 国际新闻/趋势 (proxy)
  googleTrends,
  hackernews,
  github,
  wikipedia,
  bbcNews,
  cnn,
  nytimes,
  guardian,
  aljazeera,
  yahooNews,
  medium,
  devto,
  // 电商平台 (proxy)
  amazonBestSellers,
  aliexpressPopular,
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

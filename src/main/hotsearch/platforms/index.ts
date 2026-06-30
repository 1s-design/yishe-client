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
import sspai from './sspai'
import ithome from './ithome'
import taobaoHot from './taobao-hot'
import jdHot from './jd-hot'
import pddHot from './pdd-hot'

// 国际新闻/趋势 (proxy)
import googleTrends from './google-trends'
import hackernews from './hackernews'
import reddit from './reddit'
import github from './github'
import wikipedia from './wikipedia'
import producthunt from './producthunt'
import bbcNews from './bbc-news'
import cnn from './cnn'
import nytimes from './nytimes'
import guardian from './guardian'
import reuters from './reuters'
import aljazeera from './aljazeera'
import yahooNews from './yahoo-news'
import medium from './medium'
import devto from './devto'
import npmTrending from './npm-trending'
import quora from './quora'
import flipboard from './flipboard'

// 电商平台 (proxy)
import amazonBestSellers from './amazon-best-sellers'
import aliexpressPopular from './aliexpress-popular'
import ebayTrending from './ebay-trending'
import etsyTrending from './etsy-trending'
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
  sspai,
  ithome,
  taobaoHot,
  jdHot,
  pddHot,
  // 国际新闻/趋势 (proxy)
  googleTrends,
  hackernews,
  reddit,
  github,
  wikipedia,
  producthunt,
  bbcNews,
  cnn,
  nytimes,
  guardian,
  reuters,
  aljazeera,
  yahooNews,
  medium,
  devto,
  npmTrending,
  quora,
  flipboard,
  // 电商平台 (proxy)
  amazonBestSellers,
  aliexpressPopular,
  ebayTrending,
  etsyTrending,
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

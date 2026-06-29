import type { PlatformModule } from '../types'

// 国内平台
import weibo from './weibo'
import douyin from './douyin'
import bilibili from './bilibili'
import zhihu from './zhihu'
import toutiao from './toutiao'
import douban from './douban'
import kuaishou from './kuaishou'
import v2ex from './v2ex'

// 国际平台
import googleTrends from './google-trends'
import hackernews from './hackernews'
import reddit from './reddit'
import github from './github'
import wikipedia from './wikipedia'
import producthunt from './producthunt'

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
  // 国际平台
  googleTrends,
  hackernews,
  reddit,
  github,
  wikipedia,
  producthunt,
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

/**
 * 热搜功能类型定义
 */

// 平台任务运行环境
export type TaskEnvironment = 'direct'   // 直接 HTTP 请求（国内网络）
                             | 'proxy'   // 需要境外网络代理
                             | 'browser' // 需要浏览器环境（Playwright）

// 平台任务配置
export interface PlatformTaskConfig {
  key: string                    // 唯一标识，如 'weibo'
  name: string                   // 显示名，如 '微博'
  enabled: boolean               // 是否启用
  environment: TaskEnvironment   // 运行环境要求
  maxItems: number               // 最大条目数
  timeout: number                // 单次超时（ms），默认 10s
  retryCount: number             // 重试次数，默认 2
}

// 单条热搜数据
export interface HotSearchItem {
  rank: number
  title: string
  hot?: string | number
  url?: string
  tag?: string
  subtitle?: string
  [key: string]: any
}

// 平台采集结果
export interface PlatformResult {
  platform: string
  name: string
  success: boolean
  items: HotSearchItem[]
  timestamp: string
  error?: string
  duration: number
}

// 平台模块定义
export interface PlatformModule {
  config: PlatformTaskConfig
  fetch: (ctx: FetchContext) => Promise<HotSearchItem[]>
}

// 采集上下文
export interface FetchContext {
  userAgent: string
  timeout: number
  proxy?: { host: string; port: number; protocol?: string } | null
  category?: string   // 分类频道，如 'homefeed.fashion_v2'
  keyword?: string    // 搜索关键词（部分平台支持）
}

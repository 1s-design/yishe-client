/**
 * 爬虫采集相关 API
 */

const API_BASE = 'http://localhost:1519'

export type CrawlerSite = 'sora' | 'pinterest'

/**
 * 爬虫配置
 */
export interface CrawlerConfig {
  site: CrawlerSite
  maxImages: number
  interval: number
  category?: string
  isPublic?: boolean
}

/**
 * 爬虫状态
 */
export interface CrawlerStatus {
  enabled: boolean
  isRunning: boolean
  config: CrawlerConfig
}

export type CrawlerStatusMap = Record<CrawlerSite, CrawlerStatus>

export interface CrawlerProgressLog {
  time: string
  stage: 'idle' | 'crawling' | 'downloading' | 'uploading' | 'saving' | 'completed' | 'failed'
  success: boolean
  message: string
  image?: string
  index?: number
  total?: number
}

export interface CrawlerProgress {
  site: CrawlerSite
  running: boolean
  stage: 'idle' | 'crawling' | 'downloading' | 'uploading' | 'saving' | 'completed' | 'failed'
  startedAt: string | null
  finishedAt: string | null
  total: number
  current: number
  successCount: number
  failCount: number
  lastError?: string
  logs: CrawlerProgressLog[]
}

export type CrawlerProgressMap = Record<CrawlerSite, CrawlerProgress>

/**
 * 采集结果
 */
export interface CollectResult {
  success: boolean
  message: string
  collected: number
  failed: number
  results: Array<{
    success: boolean
    image: string
    materialId?: string
    cosUrl?: string
    error?: string
  }>
}

/**
 * 启动爬虫定时器
 */
export async function startCrawlerSchedule(site: CrawlerSite, config?: Partial<CrawlerConfig>) {
  const response = await fetch(`${API_BASE}/api/crawler/schedule/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ site, ...(config || {}) }),
  })

  if (!response.ok) {
    throw new Error(`启动失败: ${response.status}`)
  }

  return response.json()
}

/**
 * 停止爬虫定时器
 */
export async function stopCrawlerSchedule(site: CrawlerSite) {
  const response = await fetch(`${API_BASE}/api/crawler/schedule/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ site }),
  })

  if (!response.ok) {
    throw new Error(`停止失败: ${response.status}`)
  }

  return response.json()
}

/**
 * 获取爬虫状态
 */
export async function getCrawlerStatus(): Promise<CrawlerStatusMap> {
  const response = await fetch(`${API_BASE}/api/crawler/schedule/status`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`获取状态失败: ${response.status}`)
  }

  return response.json()
}

/**
 * 更新爬虫配置
 */
export async function updateCrawlerConfig(site: CrawlerSite, config: Partial<CrawlerConfig>) {
  const response = await fetch(`${API_BASE}/api/crawler/schedule/config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ site, ...config }),
  })

  if (!response.ok) {
    throw new Error(`更新配置失败: ${response.status}`)
  }

  return response.json()
}

/**
 * 手动触发采集
 */
export async function manualCollect(site: CrawlerSite, maxImages?: number): Promise<CollectResult> {
  const response = await fetch(`${API_BASE}/api/crawler/manual-collect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ site, maxImages }),
  })

  if (!response.ok) {
    throw new Error(`采集失败: ${response.status}`)
  }

  return response.json()
}

/**
 * 获取爬虫详细进度
 */
export async function getCrawlerProgress(): Promise<CrawlerProgressMap> {
  const response = await fetch(`${API_BASE}/api/crawler/progress`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`获取进度失败: ${response.status}`)
  }

  return response.json()
}

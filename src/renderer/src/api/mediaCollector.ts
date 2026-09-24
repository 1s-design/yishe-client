/**
 * 媒体采集 API（客户端执行）
 * 搜索/下载/上传都在 Electron 客户端完成，不占用服务端带宽
 */

const API_BASE = 'http://localhost:1519'

// ─── 类型 ──────────────────────────────────────────────

export type MediaSource = 'wikimedia' | 'internet-archive'
export type MediaType = 'image' | 'video' | 'audio'

export interface MediaAsset {
  id: string
  source: MediaSource
  title: string
  description: string
  mediaType: MediaType
  mimeType?: string
  thumbnailUrl?: string
  previewUrl?: string
  fileUrl?: string
  fileSize?: number
  width?: number
  height?: number
  duration?: number
  license?: string
  creator?: string
  tags?: string[]
}

export interface MediaSearchResult {
  total: number
  page: number
  pageSize: number
  items: MediaAsset[]
  hasMore: boolean
}

export interface MediaSourceInfo {
  key: MediaSource
  name: string
  supportedTypes: MediaType[]
}

export interface ImportProgress {
  total: number
  current: number
  successCount: number
  failCount: number
  currentFile: string
  stage: 'downloading' | 'uploading' | 'saving' | 'done' | 'error'
  errors: string[]
}

// ─── API 函数 ──────────────────────────────────────────

/** 获取支持的采集源列表 */
export async function getMediaCollectProviders(): Promise<MediaSourceInfo[]> {
  try {
    const res = await fetch(`${API_BASE}/api/media-collect/providers`)
    const json = await res.json()
    return json?.data || []
  } catch (error) {
    console.error('[MediaCollect] 获取采集源失败:', error)
    return []
  }
}

/** 搜索媒体资源 */
export async function searchMediaCollect(params: {
  source: MediaSource
  query: string
  mediaType?: MediaType
  page?: number
  pageSize?: number
}): Promise<MediaSearchResult> {
  const sp = new URLSearchParams({
    source: params.source,
    query: params.query,
  })
  if (params.mediaType) sp.set('mediaType', params.mediaType)
  if (params.page) sp.set('page', String(params.page))
  if (params.pageSize) sp.set('pageSize', String(params.pageSize))

  const res = await fetch(`${API_BASE}/api/media-collect/search?${sp.toString()}`)
  const json = await res.json()

  if (!json?.success) {
    throw new Error(json?.message || '搜索失败')
  }

  return json.data
}

/** 导入媒体资源到文件库 */
export async function importMediaCollect(items: MediaAsset[]): Promise<{
  success: number
  failed: number
  errors: string[]
}> {
  const res = await fetch(`${API_BASE}/api/media-collect/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  const json = await res.json()

  if (!json?.success) {
    throw new Error(json?.message || '导入失败')
  }

  return json.data
}

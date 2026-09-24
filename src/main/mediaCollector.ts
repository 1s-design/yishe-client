/**
 * 媒体采集调度器（客户端）
 * 统一管理多个采集源（Wikimedia、Internet Archive 等）的搜索、下载、上传流程
 * 采集逻辑在客户端执行，不占用服务端带宽
 */

import path from 'path'
import os from 'os'
import fs from 'fs'
import { searchWikimedia, downloadWikimediaImage, type WikimediaFile, type WikimediaSearchResult } from './wikimedia'
import { searchInternetArchive, downloadInternetArchiveFile, type InternetArchiveFile, type InternetArchiveSearchResult } from './internetArchive'
import { searchPexelsMedia, downloadPexelsMedia, type PexelsMediaResult } from './pexelsMedia'
import { generateCosKey, uploadFileToCos } from './cos'
import { getBackendApiBase, getCurrentAccessToken } from './cos'

// ─── 类型定义 ──────────────────────────────────────────────

export type MediaSource = 'wikimedia' | 'internet-archive' | 'pexels'
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

export interface MediaSearchParams {
  source: MediaSource
  query: string
  mediaType?: MediaType
  page?: number
  pageSize?: number
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

// ─── 源配置 ──────────────────────────────────────────────

const SOURCES: MediaSourceInfo[] = [
  { key: 'wikimedia', name: 'Wikimedia Commons', supportedTypes: ['image', 'video', 'audio'] },
  { key: 'internet-archive', name: 'Internet Archive', supportedTypes: ['image', 'video', 'audio'] },
  { key: 'pexels', name: 'Pexels', supportedTypes: ['image', 'video'] },
]

// ─── 搜索 ──────────────────────────────────────────────

export function listSources(): MediaSourceInfo[] {
  return SOURCES
}

export async function searchMedia(params: MediaSearchParams): Promise<MediaSearchResult> {
  const { source, query, mediaType, page = 1, pageSize = 20 } = params

  if (source === 'wikimedia') {
    return searchWikimediaMedia(query, mediaType, page, pageSize)
  } else if (source === 'internet-archive') {
    return searchInternetArchiveMedia(query, mediaType, page, pageSize)
  } else if (source === 'pexels') {
    return searchPexelsMediaMedia(query, mediaType, page, pageSize)
  }

  throw new Error(`Unknown source: ${source}`)
}

async function searchWikimediaMedia(
  query: string,
  mediaType: MediaType | undefined,
  page: number,
  pageSize: number
): Promise<MediaSearchResult> {
  // 分页转 offset：Wikimedia 用 offset 分页
  const offset = (page - 1) * pageSize
  const result: WikimediaSearchResult = await searchWikimedia(query, {
    limit: pageSize,
    mediaType,
    offset,
    pageSize,
  })

  if (!result.success) {
    throw new Error(result.error || '搜索失败')
  }

  const items: MediaAsset[] = result.items.map((f) => ({
    id: f.id,
    source: 'wikimedia' as MediaSource,
    title: f.title,
    description: f.description,
    mediaType: getMimeType(f.mime),
    mimeType: f.mime,
    thumbnailUrl: f.thumbnail || undefined,
    previewUrl: f.image,
    fileUrl: f.image,
    fileSize: undefined,
    width: f.width,
    height: f.height,
    duration: f.duration,
    license: f.license,
    creator: f.author,
  }))

  return {
    total: result.totalHits || result.count,
    page,
    pageSize,
    items,
    hasMore: result.nextOffset != null,
  }
}

async function searchInternetArchiveMedia(
  query: string,
  mediaType: MediaType | undefined,
  page: number,
  pageSize: number
): Promise<MediaSearchResult> {
  const result: InternetArchiveSearchResult = await searchInternetArchive(query, {
    mediaType,
    page,
    pageSize,
  })

  if (!result.success) {
    throw new Error(result.error || '搜索失败')
  }

  const items: MediaAsset[] = result.items.map((f) => ({
    id: f.id,
    source: 'internet-archive' as MediaSource,
    title: f.title,
    description: f.description,
    mediaType: getMimeType(f.mime, f.mediatype),
    mimeType: f.mime,
    thumbnailUrl: f.thumbnail || undefined,
    previewUrl: f.image,
    fileUrl: f.image,
    fileSize: undefined,
    duration: f.duration,
    license: f.license,
    creator: f.author,
    tags: [],
  }))

  return {
    total: result.total,
    page,
    pageSize,
    items,
    hasMore: result.nextPage != null,
  }
}

async function searchPexelsMediaMedia(
  query: string,
  mediaType: MediaType | undefined,
  page: number,
  pageSize: number
): Promise<MediaSearchResult> {
  const result: PexelsMediaResult = await searchPexelsMedia(query, {
    mediaType,
    page,
    pageSize,
  })

  if (!result.success) {
    throw new Error(result.error || '搜索失败')
  }

  const items: MediaAsset[] = result.items.map((f) => ({
    id: f.id,
    source: 'pexels' as MediaSource,
    title: f.title,
    description: f.description,
    mediaType: f.mediaType,
    mimeType: f.mimeType,
    thumbnailUrl: f.thumbnail || undefined,
    previewUrl: f.preview || f.fileUrl,
    fileUrl: f.fileUrl,
    fileSize: undefined,
    width: f.width,
    height: f.height,
    duration: f.duration,
    creator: f.creator,
    license: 'Pexels License',
  }))

  return {
    total: result.total || result.count,
    page,
    pageSize,
    items,
    hasMore: result.hasMore,
  }
}

function getMimeType(mime?: string, mediatype?: string): MediaType {
  if (mime?.startsWith('video/') || mediatype === 'movies') return 'video'
  if (mime?.startsWith('audio/') || mediatype === 'audio') return 'audio'
  return 'image'
}

// ─── 导入（下载 → COS → file-resource） ────────────────────

export async function importMedia(
  items: MediaAsset[],
  onProgress?: (progress: ImportProgress) => void
): Promise<{ success: number; failed: number; errors: string[] }> {
  const progress: ImportProgress = {
    total: items.length,
    current: 0,
    successCount: 0,
    failCount: 0,
    currentFile: '',
    stage: 'downloading',
    errors: [],
  }

  const destDir = path.join(os.tmpdir(), 'yishe-media-collect')
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }

  for (const item of items) {
    progress.current++
    progress.currentFile = item.title

    try {
      // 1. 下载文件到本地
      progress.stage = 'downloading'
      onProgress?.(progress)

      const ext = getExtFromUrl(item.fileUrl || '') || getExtFromMime(item.mimeType)
      const filename = `${sanitizeName(item.title).slice(0, 50)}_${Date.now()}${ext}`
      const filePath = path.join(destDir, filename)

      if (item.source === 'wikimedia') {
        await downloadWikimediaImage(item.fileUrl!, destDir, filename)
      } else if (item.source === 'internet-archive') {
        await downloadInternetArchiveFile(item.fileUrl!, destDir, filename)
      } else if (item.source === 'pexels') {
        await downloadPexelsMedia(item.fileUrl!, destDir, filename)
      }

      // 2. 上传到 COS
      progress.stage = 'uploading'
      onProgress?.(progress)

      const cosKey = await generateCosKey({
        category: 'file-resource',
        filename,
      })
      const uploadResult = await uploadFileToCos(filePath, cosKey)

      const uploadErrorMessage = !uploadResult.ok
        ? 'msg' in uploadResult
          ? String(uploadResult.msg || '未知错误')
          : '未知错误'
        : ''
      if (!uploadResult.ok) {
        throw new Error(`COS 上传失败: ${uploadErrorMessage}`)
      }

      // 3. 写入 file-resource 记录
      progress.stage = 'saving'
      onProgress?.(progress)

      await saveFileResource({
        url: uploadResult.url,
        name: item.title,
        description: item.description,
        mimeType: item.mimeType,
        fileSize: fs.statSync(filePath).size,
        mediaType: item.mediaType,
        source: item.source,
        sourceId: item.id,
        license: item.license,
        creator: item.creator,
        thumbnailUrl: item.thumbnailUrl,
        cosKey: uploadResult.key,
        duration: item.duration,
        width: item.width,
        height: item.height,
      })

      // 清理临时文件
      fs.unlinkSync(filePath)

      progress.successCount++
    } catch (error: any) {
      progress.failCount++
      progress.errors.push(`${item.title}: ${error?.message || String(error)}`)
    }

    onProgress?.(progress)
  }

  progress.stage = 'done'
  onProgress?.(progress)

  return {
    success: progress.successCount,
    failed: progress.failCount,
    errors: progress.errors,
  }
}

// ─── 工具函数 ──────────────────────────────────────────────

/** 调后端 API 写入 file-resource 记录 */
async function saveFileResource(data: Record<string, any>): Promise<void> {
  const apiBase = await getBackendApiBase()
  const token = await getCurrentAccessToken()
  if (!token) throw new Error('未登录，无法保存文件记录')

  const { default: axios } = await import('axios')
  await axios.post(
    `${apiBase}/media-collect/import`,
    { items: [data] },
    { headers: { Authorization: `Bearer ${token}` } }
  )
}

function getExtFromUrl(url: string): string {
  const m = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
  return m ? `.${m[1].toLowerCase()}` : ''
}

function getExtFromMime(mime?: string): string {
  if (!mime) return ''
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/svg+xml': '.svg', 'image/webp': '.webp',
    'video/webm': '.webm', 'video/mp4': '.mp4', 'video/ogg': '.ogg',
    'audio/wav': '.wav', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
    'audio/flac': '.flac',
  }
  return map[mime] || ''
}

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
}

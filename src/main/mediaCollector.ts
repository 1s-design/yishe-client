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
import { searchOpenverse, downloadOpenverseFile, type OpenversePhoto, type OpenverseSearchResult } from './openverse'
import { searchNappy, downloadNappyImage, type NappyPhoto, type NappySearchResult } from './nappy'
import { generateCosKey, uploadFileToCos } from './cos'
import { getBackendApiBase, getCurrentAccessToken } from './cos'

// ─── 类型定义 ──────────────────────────────────────────────

export type MediaSource = 'wikimedia' | 'internet-archive' | 'openverse' | 'nappy' | 'pexels'
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
  { key: 'openverse', name: 'Openverse', supportedTypes: ['image', 'audio'] },
  { key: 'nappy', name: 'Nappy', supportedTypes: ['image'] },
  { key: 'pexels', name: 'Pexels', supportedTypes: ['image', 'video'] },
]

// ─── 搜索 ──────────────────────────────────────────────

export function listSources(): MediaSourceInfo[] {
  return SOURCES
}

export async function searchMedia(params: MediaSearchParams): Promise<MediaSearchResult> {
  const { source, query, mediaType, page = 1, pageSize = 20 } = params
  console.log(`[MediaCollect] searchMedia: source=${source}, query=${query}, mediaType=${mediaType}, page=${page}, pageSize=${pageSize}`)

  if (source === 'wikimedia') {
    return searchWikimediaMedia(query, mediaType, page, pageSize)
  } else if (source === 'internet-archive') {
    return searchInternetArchiveMedia(query, mediaType, page, pageSize)
  } else if (source === 'openverse') {
    return searchOpenverseMedia(query, mediaType, page, pageSize)
  } else if (source === 'nappy') {
    return searchNappyMedia(query, mediaType, page, pageSize)
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

async function searchOpenverseMedia(
  query: string,
  mediaType: MediaType | undefined,
  page: number,
  pageSize: number
): Promise<MediaSearchResult> {
  const result: OpenverseSearchResult = await searchOpenverse(query, {
    mediaType,
    page,
    pageSize,
  })

  console.log(`[MediaCollect:openverse] search result: success=${result.success}, count=${result.count}, total=${result.total}, items=${result.items?.length}`)

  if (!result.success) {
    throw new Error(result.error || '搜索失败')
  }

  const items: MediaAsset[] = result.items.map((f) => ({
    id: f.id,
    source: 'openverse' as MediaSource,
    title: f.title,
    description: f.description,
    mediaType: f.mediaType || 'image',
    mimeType: undefined,
    thumbnailUrl: f.thumbnail || undefined,
    previewUrl: f.mediaType === 'audio' ? (f.waveformUrl || f.thumbnail) : f.image,
    fileUrl: f.downloadUrl || f.image,
    fileSize: f.fileSize,
    width: f.width,
    height: f.height,
    duration: f.duration,
    license: f.license,
    creator: f.author,
    tags: f.tags ? f.tags.split(',') : [],
  }))

  return {
    total: result.total || result.count,
    page,
    pageSize,
    items,
    hasMore: result.nextPage != null,
  }
}

async function searchNappyMedia(
  query: string,
  mediaType: MediaType | undefined,
  page: number,
  pageSize: number
): Promise<MediaSearchResult> {
  console.log(`[MediaCollect:nappy] 搜索: query="${query}", page=${page}`)
  const result: NappySearchResult = await searchNappy(query, { page, pageSize })
  console.log(`[MediaCollect:nappy] 结果: success=${result.success}, count=${result.count}`)

  if (!result.success) {
    throw new Error(result.error || '搜索失败')
  }

  const items: MediaAsset[] = result.items.map((f) => ({
    id: f.id,
    source: 'nappy' as MediaSource,
    title: `Nappy ${f.id.slice(0, 8)}`,
    description: '',
    mediaType: 'image' as MediaType,
    mimeType: 'image/jpeg',
    thumbnailUrl: f.thumbnail,
    previewUrl: f.url,
    fileUrl: f.url,
    license: 'Nappy License (Free for commercial use)',
  }))

  return {
    total: 0, // Nappy 不返回总数
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
  console.log(`[MediaCollect] importMedia 开始, items=${items?.length}`)
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

      let downloadOk = false
      if (item.source === 'wikimedia') {
        await downloadWikimediaImage(item.fileUrl!, destDir, filename)
        downloadOk = true
      } else if (item.source === 'internet-archive') {
        await downloadInternetArchiveFile(item.fileUrl!, destDir, filename)
        downloadOk = true
      } else if (item.source === 'openverse') {
        const dl = await downloadOpenverseFile(item.fileUrl!, { filename, mediaType: item.mediaType, destDir })
        downloadOk = dl.success
        if (!downloadOk) throw new Error(dl.error || 'Openverse 下载失败')
      } else if (item.source === 'nappy') {
        const dl = await downloadNappyImage(item.fileUrl!, { filename, destDir })
        downloadOk = dl.success
        if (!downloadOk) throw new Error(dl.error || 'Nappy 下载失败')
      } else if (item.source === 'pexels') {
        await downloadPexelsMedia(item.fileUrl!, destDir, filename)
        downloadOk = true
      }
      if (!downloadOk) throw new Error('下载失败')

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
      const errMsg = `${item.title}: ${error?.message || String(error)}`
      progress.errors.push(errMsg)
      console.error(`[MediaCollect] 导入失败 [${item.source}] ${errMsg}`)
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
  const resp = await axios.post(
    `${apiBase}/media-collect/import`,
    { items: [data] },
    { headers: { Authorization: `Bearer ${token}` } }
  )
  console.log(`[MediaCollect] 保存记录响应:`, resp?.data)
  if (resp?.data?.code !== 0) {
    throw new Error(resp?.data?.message || '保存记录失败')
  }
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

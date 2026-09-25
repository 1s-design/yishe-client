import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
/**
 * Openverse 开放公共领域图库采集能力
 * API: https://api.openverse.org/v1/images/
 * 提供：图搜 / 单图下载 / 同步素材库
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { uploadFileToCos, generateCosKey } from './cos'
import { checkSiteAvailability } from './siteAvailability'

const OPENVERSE_SITE_URL = 'https://openverse.org/'
const OPENVERSE_IMAGE_API = 'https://api.openverse.org/v1/images/'
const OPENVERSE_AUDIO_API = 'https://api.openverse.org/v1/audio/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export type OpenverseMediaType = 'image' | 'audio'

export interface OpenversePhoto {
  id: string
  title: string
  description: string
  image: string
  thumbnail: string
  downloadUrl?: string
  link: string
  url: string
  width?: number | null
  height?: number | null
  author?: string
  license?: string
  licenseVersion?: string
  licenseUrl?: string
  provider?: string
  source?: string
  isFree?: boolean
  tags?: string
  /** 音频独有字段 */
  mediaType?: OpenverseMediaType
  duration?: number
  fileSize?: number
  waveformUrl?: string
  bitRate?: number
  sampleRate?: number
}

export interface OpenverseSearchResult {
  success: boolean
  query: string
  count: number
  total?: number
  items: OpenversePhoto[]
  links: string[]
  page: number
  nextPage: number | null
  error?: string
}

interface OpenverseSearchOptions {
  page?: number
  limit?: number
  pageSize?: number
  license?: string
  provider?: string
  mediaType?: OpenverseMediaType
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim()
}

/**
 * 检查 Openverse 服务状态
 */
export async function getOpenverseStatus() {
  const site = await checkSiteAvailability(OPENVERSE_SITE_URL, { timeoutMs: 5000 })
  return {
    key: 'openverse',
    pluginKey: 'openverse',
    label: 'Openverse 开放公共领域图库',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Openverse 可用' : `Openverse 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime']
  }
}

/**
 * 搜索 Openverse 图库（图片 / 音频）
 * mediaType 可选 'image' | 'audio'，不传默认图片
 */
export async function searchOpenverse(
  query: string,
  options: OpenverseSearchOptions = {}
): Promise<OpenverseSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return {
      success: false,
      query: '',
      count: 0,
      items: [],
      links: [],
      page: 1,
      nextPage: null,
      error: '缺少搜索关键词'
    }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit || options.pageSize) || 20, 1), 100)
  const mediaType = options.mediaType === 'audio' ? 'audio' : 'image'

  try {
    const fetchFn = await getFetchImpl()
    const baseUrl = mediaType === 'audio' ? OPENVERSE_AUDIO_API : OPENVERSE_IMAGE_API

    let apiUrl = `${baseUrl}?q=${encodeURIComponent(keyword)}&page=${page}&page_size=${limit}`
    if (options.license) {
      apiUrl += `&license=${encodeURIComponent(options.license)}`
    }
    if (options.provider) {
      apiUrl += `&source=${encodeURIComponent(options.provider)}`
    }

    console.log(`[Openverse] 搜索: ${apiUrl}`)

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/plain, */*',
    }

    const res = await fetchFn(apiUrl, { method: 'GET', headers })
    console.log(`[Openverse] HTTP 状态: ${res.status}`)
    if (!res.ok) {
      return {
        success: false,
        query: keyword,
        count: 0,
        items: [],
        links: [],
        page,
        nextPage: null,
        error: `Openverse API 请求失败: HTTP ${res.status}`
      }
    }

    const json = await res.json()
    const rawItems = json?.results || (Array.isArray(json) ? json : [])
    // Openverse API 的 result_count / page_count / next 字段均不可靠
    // 根据实际返回数量判断：返回满页说明可能还有下一页
    const hasMore = rawItems.length >= limit
    console.log(`[Openverse] 返回 ${rawItems.length} 条，page=${page}, hasMore=${hasMore}`)

    const photos: OpenversePhoto[] = rawItems
      .filter((item: any) => item && typeof item === 'object')
      .map((item: any) => normalizeOpenversePhoto(item, mediaType))
      .filter((photo: OpenversePhoto | null): photo is OpenversePhoto => photo !== null)

    const finalPhotos = photos.slice(0, limit)
    return {
      success: true,
      query: keyword,
      count: finalPhotos.length,
      total: 0, // 不返回总数
      items: finalPhotos,
      links: finalPhotos.map((p) => p.image).filter(Boolean),
      page,
      nextPage: hasMore ? page + 1 : null,
    }
  } catch (error: any) {
    console.error(`[Openverse] 搜索异常:`, error?.message || String(error))
    return {
      success: false,
      query: keyword,
      count: 0,
      items: [],
      links: [],
      page,
      nextPage: null,
      error: error?.message || String(error)
    }
  }
}

/**
 * 标准化 Openverse API 项
 * mediaType: 'image' | 'audio'
 */
function normalizeOpenversePhoto(item: any, mediaType: OpenverseMediaType = 'image'): OpenversePhoto | null {
  if (!item) return null
  const id = String(item.id || item.uuid || Math.random().toString(36).slice(2, 10))

  let image = item.url || item.image || item.imageUrl || ''
  let thumbnail = item.thumbnail || item.preview || image

  if (typeof image === 'string' && image.startsWith('//')) {
    image = `https:${image}`
  }
  if (typeof thumbnail === 'string' && thumbnail.startsWith('//')) {
    thumbnail = `https:${thumbnail}`
  }

  if (!image) return null

  const title = item.title || item.name || item.alt || `Openverse #${id.slice(0, 8)}`
  const mediaPath = mediaType === 'audio' ? 'audio' : 'image'
  let link = item.foreign_landing_url || item.detail_url || item.url || `https://openverse.org/${mediaPath}/${id}`
  if (typeof link === 'string' && link.startsWith('/')) {
    link = `https://openverse.org${link}`
  }

  const tagsArr = Array.isArray(item.tags)
    ? item.tags.map((t: any) => (typeof t === 'string' ? t : t.name)).filter(Boolean)
    : []

  const licenseCode = (item.license || 'CC').toUpperCase()
  const licenseVer = item.license_version ? ` ${item.license_version}` : ''

  return {
    id,
    title,
    description: item.description || tagsArr.slice(0, 5).join(', ') || '',
    image,
    thumbnail: thumbnail || image,
    downloadUrl: image,
    link,
    url: link,
    width: item.width || null,
    height: item.height || null,
    author: item.creator || item.author || 'Openverse Contributor',
    license: `${licenseCode}${licenseVer}`,
    licenseVersion: item.license_version || '',
    licenseUrl: item.license_url || 'https://creativecommons.org/',
    provider: item.provider || item.source || 'Openverse',
    source: item.source || item.provider || 'Openverse',
    isFree: true,
    tags: tagsArr.join(', '),
    mediaType,
    duration: item.duration || null,
    fileSize: item.file_size || item.fileSize || null,
    waveformUrl: item.waveform_url || item.waveformUrl || null,
    bitRate: item.bit_rate || item.bitRate || null,
    sampleRate: item.sample_rate || item.sampleRate || null,
  }
}

/**
 * 下载 Openverse 文件（图片 / 音频）
 */
export async function downloadOpenverseFile(
  fileUrl: string,
  options: { filename?: string; mediaType?: OpenverseMediaType; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!/^https?:\/\//.test(fileUrl)) {
    return { success: false, error: `无效地址: ${fileUrl}` }
  }

  try {
    const fetchFn = await getFetchImpl()

    const r = await fetchFn(fileUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT }
    })

    if (!r.ok) {
      return { success: false, error: `Openverse 下载失败: HTTP ${r.status}` }
    }

    const arrayBuffer = await r.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 优先使用传入的 destDir，否则用默认下载目录
    const saveDir = options.destDir
      ? options.destDir
      : join(app.getPath('userData'), 'openverse-downloads')
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true })
    }

    // 根据 content-type 推断后缀
    const contentType = r.headers.get('content-type') || ''
    let ext = options.mediaType === 'audio' ? '.mp3' : '.jpg'
    if (contentType.includes('png')) ext = '.png'
    else if (contentType.includes('webp')) ext = '.webp'
    else if (contentType.includes('wav')) ext = '.wav'
    else if (contentType.includes('ogg')) ext = '.ogg'
    else if (contentType.includes('mpeg') || contentType.includes('mp3')) ext = '.mp3'
    else if (contentType.includes('flac')) ext = '.flac'
    else if (contentType.includes('svg')) ext = '.svg'

    const fileName = options.filename
      ? sanitizeName(options.filename)
      : `openverse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`

    const filePath = join(saveDir, fileName.endsWith(ext) ? fileName : `${fileName}${ext}`)
    fs.writeFileSync(filePath, buffer)

    return { success: true, filePath }
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) }
  }
}

/** 向后兼容：下载图片 */
export async function downloadOpenverseImage(
  imageUrl: string,
  options: { filename?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  return downloadOpenverseFile(imageUrl, { ...options, mediaType: 'image' })
}

/**
 * 同步 Openverse 图片至素材库 (支持 COS 上传)
 */
export async function syncOpenverseToMaterialLibrary(
  clientIdOrUrl: string,
  dataOrMetadata?: any
): Promise<{ success: boolean; message: string; materialId?: string; cosUrl?: string; data?: any }> {
  const imageUrl = typeof dataOrMetadata?.imageUrl === 'string' ? dataOrMetadata.imageUrl : clientIdOrUrl
  const metadata = (typeof dataOrMetadata?.imageUrl === 'string' ? dataOrMetadata.metadata : dataOrMetadata) || {}

  const downloadResult = await downloadOpenverseImage(imageUrl, {
    filename: metadata?.title ? `${sanitizeName(metadata.title)}` : undefined,
  })

  if (!downloadResult.success || !downloadResult.filePath) {
    return {
      success: false,
      message: downloadResult.error || '图片下载失败',
    }
  }


  const localFilePath = downloadResult.filePath
  try {
    const fileName = localFilePath.split('/').pop() || `openverse_${Date.now()}.jpg`
    const title = metadata?.title || metadata?.name || fileName.replace(/\.(jpg|png|jpeg|webp)$/i, '')
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'openverse',
      group: 'openverse',
      source: 'Openverse',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'openverse',
        uploadedAt: new Date().toISOString(),
      },
    })

    if (!materialResult.ok) {
      return { success: false, message: materialResult.msg || '素材库保存失败' }
    }

    return {
      success: true,
      message: '已成功同步至素材库',
      materialId: materialResult.materialId,
      cosUrl: materialResult.materialUrl,
      data: {
        materialId: materialResult.materialId,
        cosUrl: materialResult.materialUrl,
        localFilePath,
      },
    }
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || String(err),
    }
  }
}

// ─── fetch 实现 ───
let fetchImplPromise: Promise<typeof fetch> | null = null

async function getFetchImpl(): Promise<typeof fetch> {
  if (!fetchImplPromise) {
    fetchImplPromise = (async () => {
      try {
        const electron = await import('electron')
        const net = electron.net
        if (net && typeof (net as any).fetch === 'function') {
          return (net as any).fetch.bind(net) as typeof fetch
        }
      } catch {
        // non-electron env
      }
      return fetch
    })()
  }
  return fetchImplPromise
}

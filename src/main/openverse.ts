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
const OPENVERSE_API_URL = 'https://api.openverse.org/v1/images/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

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
 * 搜索 Openverse 图库
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

  try {
    const fetchFn = await getFetchImpl()

    let apiUrl = `${OPENVERSE_API_URL}?q=${encodeURIComponent(keyword)}&page=${page}&page_size=${limit}`
    if (options.license) {
      apiUrl += `&license=${encodeURIComponent(options.license)}`
    }
    if (options.provider) {
      apiUrl += `&source=${encodeURIComponent(options.provider)}`
    }

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/plain, */*',
    }

    const res = await fetchFn(apiUrl, { method: 'GET', headers })
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
    const totalCount = json?.result_count || json?.page_count * limit || rawItems.length

    const photos: OpenversePhoto[] = rawItems
      .filter((item: any) => item && typeof item === 'object')
      .map((item: any) => normalizeOpenversePhoto(item))
      .filter((photo: OpenversePhoto | null): photo is OpenversePhoto => photo !== null)

    const finalPhotos = photos.slice(0, limit)
    return {
      success: true,
      query: keyword,
      count: finalPhotos.length,
      total: totalCount,
      items: finalPhotos,
      links: finalPhotos.map((p) => p.image).filter(Boolean),
      page,
      nextPage: finalPhotos.length >= limit ? page + 1 : null,
    }
  } catch (error: any) {
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
 */
function normalizeOpenversePhoto(item: any): OpenversePhoto | null {
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
  let link = item.foreign_landing_url || item.detail_url || item.url || `https://openverse.org/image/${id}`
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
    tags: tagsArr.join(', ')
  }
}

/**
 * 下载单张 Openverse 图片
 */
export async function downloadOpenverseImage(
  imageUrl: string,
  options: { filename?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!/^https?:\/\//.test(imageUrl)) {
    return { success: false, error: `无效的图片地址: ${imageUrl}` }
  }

  try {
    const fetchFn = await getFetchImpl()

    const r = await fetchFn(imageUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT }
    })

    if (!r.ok) {
      return { success: false, error: `Openverse 图片下载失败: HTTP ${r.status}` }
    }

    const arrayBuffer = await r.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const workspaceDir = app.getPath('userData')
    const saveDir = join(workspaceDir, 'openverse-downloads')
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true })
    }

    let ext = '.jpg'
    const contentType = r.headers.get('content-type') || ''
    if (contentType.includes('png')) ext = '.png'
    else if (contentType.includes('webp')) ext = '.webp'

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

/**
 * 同步 Openverse 图片至素材库 (支持 COS 上传)
 */
export async function syncOpenverseToMaterialLibrary(
  imageUrl: string,
  metadata: Record<string, any> = {}
): Promise<{ success: boolean; message: string; data?: any }> {
  const downloadResult = await downloadOpenverseImage(imageUrl, {
    filename: metadata.title ? `${sanitizeName(metadata.title)}` : undefined,
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
    const cosKey = await generateCosKey({ category: 'openverse', filename: fileName })
    const cosResult = await uploadFileToCos(localFilePath, cosKey)
    if (!cosResult.ok || !cosResult.url) {
      return { success: false, message: 'COS 上传失败' }
    }

    return {
      success: true,
      message: '已成功同步至素材库',
      data: {
        cosUrl: cosResult.url,
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

/**
 * Rawpixel 免费与公共领域艺术图库采集能力
 * 提供：图搜 / 单图下载 / 同步素材库
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { uploadFileToCos, generateCosKey } from './cos'
import { checkSiteAvailability } from './siteAvailability'

const RAWPIXEL_SITE_URL = 'https://www.rawpixel.com/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface RawpixelPhoto {
  id: string
  title: string
  description: string
  image: string
  thumbnail: string
  link: string
  url: string
  width?: number
  height?: number
  author?: string
  license?: string
  isFree?: boolean
  tags?: string
}

export interface RawpixelSearchResult {
  success: boolean
  query: string
  count: number
  total?: number
  items: RawpixelPhoto[]
  links: string[]
  page: number
  nextPage: number | null
  error?: string
}

interface RawpixelSearchOptions {
  page?: number
  limit?: number
  pageSize?: number
  sort?: string
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim()
}

/**
 * 检查 Rawpixel 服务状态
 */
export async function getRawpixelStatus() {
  const site = await checkSiteAvailability(RAWPIXEL_SITE_URL, { timeoutMs: 5000 })
  return {
    key: 'rawpixel',
    pluginKey: 'rawpixel',
    label: 'Rawpixel 图库采集',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Rawpixel 可用' : `Rawpixel 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime']
  }
}

/**
 * 搜索 Rawpixel 图库
 */
export async function searchRawpixel(
  query: string,
  options: RawpixelSearchOptions = {}
): Promise<RawpixelSearchResult> {
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
  const limit = Math.min(Math.max(Number(options.limit || options.pageSize) || 25, 1), 100)
  const sort = options.sort || 'curated'

  try {
    const fetchImpl = await getFetchImpl()

    // 优先构建 API 搜索 URL
    const apiUrl = `https://www.rawpixel.com/api/v1/search?keys=${encodeURIComponent(keyword)}&page=${page}&sort=${encodeURIComponent(sort)}`
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': `https://www.rawpixel.com/search/${encodeURIComponent(keyword)}`,
    }

    const r = await fetchImpl(apiUrl, { method: 'GET', headers })
    let rawItems: any[] = []

    if (r.ok) {
      const contentType = r.headers?.get?.('content-type') || ''
      if (contentType.includes('application/json')) {
        const json = await r.json()
        rawItems = json?.results || json?.data || json?.items || (Array.isArray(json) ? json : [])
      }
    }

    // 如果 API 直接被拦或无结果，尝试解析网页结构
    if (!rawItems.length) {
      const pageUrl = `https://www.rawpixel.com/search/${encodeURIComponent(keyword)}?page=${page}&sort=${encodeURIComponent(sort)}`
      const pageRes = await fetchImpl(pageUrl, { method: 'GET', headers })
      if (pageRes.ok) {
        const html = await pageRes.text()
        rawItems = parseRawpixelHtml(html)
      }
    }

    const photos: RawpixelPhoto[] = rawItems
      .filter((item: any) => item && typeof item === 'object')
      .map((item: any) => normalizeRawpixelPhoto(item))
      .filter((photo: RawpixelPhoto | null): photo is RawpixelPhoto => photo !== null)

    const finalPhotos = photos.slice(0, limit)
    return {
      success: true,
      query: keyword,
      count: finalPhotos.length,
      total: photos.length,
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
 * 将 Rawpixel API 或 HTML 项标准化
 */
function normalizeRawpixelPhoto(item: any): RawpixelPhoto | null {
  if (!item) return null
  const id = String(item.id || item.imageId || item.contentId || Math.random().toString(36).slice(2, 10))
  
  let image = item.image || item.imageUrl || item.url || item.src || ''
  let thumbnail = item.thumbnail || item.thumb || item.preview || image

  if (image && image.startsWith('//')) {
    image = `https:${image}`
  }
  if (thumbnail && thumbnail.startsWith('//')) {
    thumbnail = `https:${thumbnail}`
  }

  if (thumbnail && !image) {
    image = thumbnail.replace(/image_\d+/, 'image_1300')
  }

  if (!image) return null

  const title = item.title || item.name || item.alt || `Rawpixel #${id}`
  const description = item.description || item.caption || item.tags || ''
  const link = item.link || item.pageUrl || `https://www.rawpixel.com/image/${id}`

  return {
    id,
    title,
    description,
    image,
    thumbnail: thumbnail || image,
    link,
    url: link,
    width: item.width || item.imageWidth,
    height: item.height || item.imageHeight,
    author: item.author || item.artist || item.credit || 'Rawpixel',
    license: item.license || (item.free ? 'Public Domain / Free' : 'Rawpixel License'),
    isFree: item.free !== false,
    tags: Array.isArray(item.tags) ? item.tags.join(', ') : item.tags || ''
  }
}

function parseRawpixelHtml(html: string): any[] {
  try {
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)
    if (nextDataMatch && nextDataMatch[1]) {
      const parsed = JSON.parse(nextDataMatch[1])
      const feed = parsed?.props?.pageProps?.results || parsed?.props?.pageProps?.feed || parsed?.props?.pageProps?.initialData
      if (Array.isArray(feed)) {
        return feed
      }
    }
  } catch (e) {
    // ignore
  }
  return []
}

/**
 * 下载单张图片
 */
export async function downloadRawpixelImage(
  imageUrl: string,
  options: { filename?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!/^https?:\/\//.test(imageUrl)) {
    return { success: false, error: `无效的图片地址: ${imageUrl}` }
  }

  try {
    const fetchImpl = await getFetchImpl()
    const r = await fetchImpl(imageUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT }
    })

    if (!r.ok) {
      return { success: false, error: `Rawpixel 图片下载失败: HTTP ${r.status}` }
    }

    const arrayBuffer = await r.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const workspaceDir = app.getPath('userData')
    const destDir = join(workspaceDir, 'rawpixel')
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }

    const finalName = options.filename ? sanitizeName(options.filename) : `rawpixel_${Date.now()}.jpg`
    const filePath = join(destDir, finalName)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

/**
 * 同步单图或批量素材到素材库
 */
export async function syncRawpixelToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) {
    return { success: false, message: '缺少图片 URL' }
  }

  try {
    const fetchImpl = await getFetchImpl()
    const res = await fetchImpl(imageUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': RAWPIXEL_SITE_URL }
    })
    if (!res.ok) {
      return { success: false, message: `下载图片失败: HTTP ${res.status}` }
    }

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const workspaceDir = app.getPath('userData')
    const outputDir = join(workspaceDir, 'rawpixel')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const title = metadata?.title || `rawpixel-${metadata?.id || Date.now()}`
    const safeName = sanitizeName(title).slice(0, 60) || `rawpixel-${Date.now()}`
    const fileName = `${safeName}.jpg`
    const localFilePath = join(outputDir, fileName)
    fs.writeFileSync(localFilePath, buffer)

    const cosKey = await generateCosKey({ category: 'rawpixel', filename: fileName })
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

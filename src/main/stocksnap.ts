/**
 * StockSnap 免版权高清图库采集能力
 * 提供：图搜 / 单图下载 / 同步素材库
 */
import fs from 'fs'
import { join } from 'path'
import { app, session } from 'electron'
import { uploadFileToCos, generateCosKey } from './cos'
import { checkSiteAvailability } from './siteAvailability'

const STOCKSNAP_SITE_URL = 'https://stocksnap.io/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface StockSnapPhoto {
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
  isFree?: boolean
  tags?: string
}

export interface StockSnapSearchResult {
  success: boolean
  query: string
  count: number
  total?: number
  items: StockSnapPhoto[]
  links: string[]
  page: number
  nextPage: number | null
  error?: string
}

interface StockSnapSearchOptions {
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
 * 检查 StockSnap 服务状态
 */
export async function getStockSnapStatus() {
  const site = await checkSiteAvailability(STOCKSNAP_SITE_URL, { timeoutMs: 5000 })
  return {
    key: 'stocksnap',
    pluginKey: 'stocksnap',
    label: 'StockSnap 免版权图库采集',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'StockSnap 可用' : `StockSnap 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime']
  }
}

/**
 * 搜索 StockSnap 图库
 */
export async function searchStockSnap(
  query: string,
  options: StockSnapSearchOptions = {}
): Promise<StockSnapSearchResult> {
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
  const sort = options.sort || 'date'

  try {
    const fetchFn = session?.defaultSession?.fetch
      ? session.defaultSession.fetch.bind(session.defaultSession)
      : globalThis.fetch

    let rawItems: any[] = []

    // 策略 1：StockSnap XHR API 接口
    try {
      const sortField = sort === 'popular' ? 'views' : 'date'
      const apiUrl = `https://stocksnap.io/api/search-photos/${encodeURIComponent(keyword)}/${sortField}/desc/${page}`
      const headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://stocksnap.io/',
      }

      const r1 = await fetchFn(apiUrl, { method: 'GET', headers })
      if (r1.ok) {
        const contentType = r1.headers?.get?.('content-type') || ''
        if (contentType.includes('application/json')) {
          const json = await r1.json()
          rawItems = json?.results || json?.photos || json?.data || (Array.isArray(json) ? json : [])
        }
      }
    } catch {
      // ignore
    }

    // 策略 2：搜索 SSR HTML 页面解析
    if (!rawItems.length) {
      try {
        const pageUrl = page > 1
          ? `https://stocksnap.io/search/${encodeURIComponent(keyword)}/page/${page}`
          : `https://stocksnap.io/search/${encodeURIComponent(keyword)}`
        const headers = {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://stocksnap.io/',
        }

        const r2 = await fetchFn(pageUrl, { method: 'GET', headers })
        if (r2.ok) {
          const html = await r2.text()
          rawItems = parseStockSnapHtml(html)
        }
      } catch {
        // ignore
      }
    }

    const photos: StockSnapPhoto[] = rawItems
      .filter((item: any) => item && typeof item === 'object')
      .map((item: any) => normalizeStockSnapPhoto(item))
      .filter((photo: StockSnapPhoto | null): photo is StockSnapPhoto => photo !== null)

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
 * 将 StockSnap API 或 HTML 项标准化
 */
function normalizeStockSnapPhoto(item: any): StockSnapPhoto | null {
  if (!item) return null
  const id = String(item.img_id || item.photo_id || item.id || item.img_slug || Math.random().toString(36).slice(2, 10))

  let image = item.img_url || item.image || item.imageUrl || item.url || ''
  let thumbnail = item.thumb_url || item.thumbnail || item.preview || image

  if (id && !image) {
    image = `https://cdn.stocksnap.io/img-thumbs/960w/${id}.jpg`
    thumbnail = `https://cdn.stocksnap.io/img-thumbs/280h/${id}.jpg`
  }

  if (typeof image === 'string' && image.startsWith('//')) {
    image = `https:${image}`
  }
  if (typeof thumbnail === 'string' && thumbnail.startsWith('//')) {
    thumbnail = `https:${thumbnail}`
  }

  if (!image) return null

  const title = item.title || item.img_title || item.alt || item.description || (item.tags ? String(item.tags).split(',')[0].trim() : `StockSnap #${id}`)
  let link = item.link || item.url || `https://stocksnap.io/photo/${id}`
  if (typeof link === 'string' && link.startsWith('/')) {
    link = `https://stocksnap.io${link}`
  }

  return {
    id,
    title,
    description: item.description || item.tags || '',
    image,
    thumbnail: thumbnail || image,
    downloadUrl: `https://stocksnap.io/photo/download/${id}`,
    link,
    url: link,
    width: item.img_width || item.width || null,
    height: item.img_height || item.height || null,
    author: item.author_name && item.author_name !== 'undefined' ? (item.author_name || item.author || 'StockSnap Photographer') : 'StockSnap Photographer',
    license: item.license || 'CC0 Free for Commercial Use',
    isFree: true,
    tags: Array.isArray(item.tags) ? item.tags.join(', ') : item.tags || ''
  }
}

function parseStockSnapHtml(html: string): any[] {
  const items: any[] = []
  const imgRegex = /<a[^>]*href="(\/photo\/([^"]+))"[^>]*>.*?<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/gs
  let match: RegExpExecArray | null

  while ((match = imgRegex.exec(html)) !== null) {
    const href = match[1]
    const photoSlug = match[2]
    const thumbUrl = match[3]
    const alt = match[4]

    const photoId = photoSlug.includes('-') ? photoSlug.split('-').pop() : photoSlug
    const hdImage = thumbUrl.replace('/280h/', '/960w/')
    const detailLink = href.startsWith('/') ? `https://stocksnap.io${href}` : href
    const title = alt.trim() ? alt.trim() : `StockSnap #${photoId}`

    items.push({
      id: photoId,
      title,
      description: alt.trim(),
      image: hdImage,
      thumbnail: thumbUrl,
      downloadUrl: `https://stocksnap.io/photo/download/${photoId}`,
      link: detailLink,
      url: detailLink,
      author: 'StockSnap Photographer',
      license: 'CC0 Free for Commercial Use',
      isFree: true,
    })
  }

  return items
}

/**
 * 下载单张图片
 */
export async function downloadStockSnapImage(
  imageUrl: string,
  options: { filename?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!/^https?:\/\//.test(imageUrl)) {
    return { success: false, error: `无效的图片地址: ${imageUrl}` }
  }

  try {
    const fetchFn = session?.defaultSession?.fetch
      ? session.defaultSession.fetch.bind(session.defaultSession)
      : globalThis.fetch

    const r = await fetchFn(imageUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://stocksnap.io/' }
    })

    if (!r.ok) {
      return { success: false, error: `StockSnap 图片下载失败: HTTP ${r.status}` }
    }

    const arrayBuffer = await r.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const workspaceDir = app.getPath('userData')
    const saveDir = join(workspaceDir, 'stocksnap-downloads')
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true })
    }

    let ext = '.jpg'
    const contentType = r.headers.get('content-type') || ''
    if (contentType.includes('png')) ext = '.png'
    else if (contentType.includes('webp')) ext = '.webp'

    const fileName = options.filename
      ? sanitizeName(options.filename)
      : `stocksnap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`

    const filePath = join(saveDir, fileName.endsWith(ext) ? fileName : `${fileName}${ext}`)
    fs.writeFileSync(filePath, buffer)

    return { success: true, filePath }
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) }
  }
}

/**
 * 同步 StockSnap 图片至素材库 (支持 COS 上传)
 */
export async function syncStockSnapToMaterialLibrary(
  imageUrl: string,
  metadata: Record<string, any> = {}
): Promise<{ success: boolean; message: string; data?: any }> {
  const downloadResult = await downloadStockSnapImage(imageUrl, {
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
    const fileName = localFilePath.split('/').pop() || `stocksnap_${Date.now()}.jpg`
    const cosKey = await generateCosKey({ category: 'stocksnap', filename: fileName })
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

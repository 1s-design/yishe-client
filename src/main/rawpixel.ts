import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
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
      error: '请输入搜索关键词'
    }
  }

  const page = options.page || 1
  const limit = options.limit || options.pageSize || 20
  const sort = options.sort || 'curated'

  try {
    const fetchImpl = await getFetchImpl()
    let rawItems: any[] = []

    // 策略 1：用户提供的完整真实 XHR API 接口
    try {
      const exactApiUrl = `https://www.rawpixel.com/api/v1/search?curated_tag=${encodeURIComponent(keyword)}&image_type=image%2Ctemplate%2Cvideo&keys=${encodeURIComponent(keyword)}&lang=en&page=${page}&published_status=published&safe_search=true&show_creative_brushes=true&sort=${encodeURIComponent(sort)}`
      const headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://www.rawpixel.com/all/${encodeURIComponent(keyword)}?page=${page}&sort=${encodeURIComponent(sort)}`,
      }

      const r1 = await fetchImpl(exactApiUrl, { method: 'GET', headers })
      if (r1.ok) {
        const contentType = r1.headers?.get?.('content-type') || ''
        if (contentType.includes('application/json')) {
          const json = await r1.json()
          rawItems = json?.results || json?.data || json?.items || (Array.isArray(json) ? json : [])
        }
      }
    } catch {
      // ignore
    }

    // 策略 2：Category SSR HTML 页面解析 (校验分类/词条匹配度，防止兜底到无关固定画板)
    if (!rawItems.length) {
      try {
        const categoryUrl = `https://www.rawpixel.com/category/${encodeURIComponent(keyword)}`
        const headers = {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }

        const r2 = await fetchImpl(categoryUrl, { method: 'GET', headers })
        if (r2.ok) {
          const html = await r2.text()
          rawItems = parseRawpixelHtml(html, keyword)
        }
      } catch {
        // ignore
      }
    }

    // 策略 3：标准 API 接口
    if (!rawItems.length) {
      try {
        const simpleApiUrl = `https://www.rawpixel.com/api/v1/search?keys=${encodeURIComponent(keyword)}&page=${page}&sort=${encodeURIComponent(sort)}`
        const headers = {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        }

        const r3 = await fetchImpl(simpleApiUrl, { method: 'GET', headers })
        if (r3.ok) {
          const json = await r3.json()
          rawItems = json?.results || json?.data || json?.items || (Array.isArray(json) ? json : [])
        }
      } catch {
        // ignore
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
 * 规格化 Rawpixel 素材对象
 */
function normalizeRawpixelPhoto(item: any): RawpixelPhoto | null {
  if (!item) return null
  const id = String(item.entity_id || item.id || item.imageId || item.uid || Math.random().toString(36).slice(2, 10))
  
  let image = item.image_cover_420 || item.image_cover_uri || item.image_opengraph || item.image || item.imageUrl || item.url || item.thumbnail || item.src || ''
  let thumbnail = item.image_cover_uri || item.image_cover_420 || item.thumbnail || item.thumb || item.preview || image

  if (typeof image === 'string' && image.startsWith('//')) {
    image = `https:${image}`
  }
  if (typeof thumbnail === 'string' && thumbnail.startsWith('//')) {
    thumbnail = `https:${thumbnail}`
  }

  if (thumbnail && !image) {
    image = String(thumbnail).replace(/image_\d+/, 'image_1300')
  }

  if (!image) return null

  const title = item.title || item.short_title || item.image_alt || item.name || item.alt || `Rawpixel #${id}`
  const description = item.description || item.image_alt || item.caption || item.tags || ''
  let link = item.url || item.url_relative || item.link || item.pageUrl || `https://www.rawpixel.com/image/${id}`
  if (typeof link === 'string' && link.startsWith('/')) {
    link = `https://www.rawpixel.com${link}`
  }

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

function parseRawpixelHtml(html: string, keyword: string): any[] {
  try {
    const scriptMatch = html.match(/<script[^>]*>(\{"props":\{"pageProps":.*?\})<\/script>/s)
    if (scriptMatch && scriptMatch[1]) {
      const parsed = JSON.parse(scriptMatch[1])
      const pageProps = parsed?.props?.pageProps
      if (pageProps) {
        const queries = pageProps?.initialState?.dehydratedState?.queries || []
        for (const q of queries) {
          const qdata = q?.state?.data
          if (qdata && typeof qdata === 'object') {
            const list = qdata.results || qdata.data || qdata.items
            if (Array.isArray(list) && list.length > 0) {
              // 关键逻辑：过滤 Rawpixel 的全网页通用兜底画板 (CDC Health and Wellness Images)
              const firstTitle = String(list[0]?.title || list[0]?.short_title || list[0]?.image_alt || '').toLowerCase()
              const kwLower = keyword.toLowerCase()
              if (firstTitle.includes('cdc health') && !kwLower.includes('cdc') && !kwLower.includes('health')) {
                // 这是默认降级画板，并非用户搜索的目标词条结果，舍弃该降级数据
                return []
              }
              return list
            }
          }
        }
        const directList = pageProps.results || pageProps.feed || pageProps.initialData
        if (Array.isArray(directList)) {
          return directList
        }
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
    return { success: false, error: '无效的图片 URL' }
  }

  try {
    const fetchImpl = await getFetchImpl()
    const res = await fetchImpl(imageUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': RAWPIXEL_SITE_URL }
    })
    if (!res.ok) {
      return { success: false, error: `下载图片失败: HTTP ${res.status}` }
    }

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const workspaceDir = app.getPath('userData')
    const outputDir = join(workspaceDir, 'rawpixel')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const safeName = options.filename ? sanitizeName(options.filename) : `rawpixel-${Date.now()}`
    const fileName = safeName.endsWith('.jpg') || safeName.endsWith('.png') ? safeName : `${safeName}.jpg`
    const filePath = join(outputDir, fileName)

    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

/**
 * 同步单张图片到 COS 与全局素材库
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


    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'rawpixel',
      group: 'rawpixel',
      source: 'Rawpixel',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'rawpixel',
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

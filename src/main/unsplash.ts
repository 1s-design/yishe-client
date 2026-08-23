/**
 * Unsplash 顶级美学与商业摄影图搜与采集能力
 * 基于 Unsplash 网页开放检索接口，无需 API Key，直连高质量原图
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

const UNSPLASH_SITE = 'https://unsplash.com/'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface UnsplashPhoto {
  id: string
  title: string
  description: string
  image: string
  thumbnail: string
  link: string
  url: string
  width?: number | null
  height?: number | null
  author?: string
  tags?: string
  color?: string
}

export interface UnsplashSearchResult {
  success: boolean
  query: string
  count: number
  items: UnsplashPhoto[]
  links: string[]
  page: number
  nextPage: number | null
  error?: string
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim()
}

export async function getUnsplashStatus() {
  const site = await checkSiteAvailability(UNSPLASH_SITE, { timeoutMs: 5000 })
  return {
    key: 'unsplash',
    pluginKey: 'unsplash',
    label: 'Unsplash 摄影图搜',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Unsplash 服务可用' : `Unsplash 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect']
  }
}

export async function searchUnsplash(
  query: string,
  options: { page?: number; limit?: number; pageSize?: number } = {}
): Promise<UnsplashSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 50)

  try {
    const url = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(keyword)}&per_page=${limit}&page=${page}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://unsplash.com/s/photos/' + encodeURIComponent(keyword),
        'Accept': 'application/json',
      }
    })

    if (!res.ok) {
      throw new Error(`Unsplash 接口返回 HTTP ${res.status}`)
    }

    const data: any = await res.json()
    const rawList = Array.isArray(data?.results) ? data.results : []
    const items: UnsplashPhoto[] = []
    const seen = new Set<string>()

    for (const item of rawList) {
      const imgUrl = item.urls?.full || item.urls?.regular || item.urls?.raw
      if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) continue
      if (seen.has(imgUrl)) continue
      seen.add(imgUrl)

      const id = String(item.id || items.length + 1)
      const author = item.user?.name || item.user?.username || 'Unsplash Photographer'
      const title = sanitizeName(item.alt_description || item.description || `${keyword} by ${author}`).slice(0, 100)

      items.push({
        id,
        title,
        description: item.description || item.alt_description || title,
        image: imgUrl,
        thumbnail: item.urls?.small || item.urls?.thumb || imgUrl,
        link: item.links?.html || `https://unsplash.com/photos/${id}`,
        url: item.links?.html || `https://unsplash.com/photos/${id}`,
        width: Number(item.width) || null,
        height: Number(item.height) || null,
        author,
        tags: keyword,
        color: item.color || undefined,
      })
      if (items.length >= limit) break
    }

    return {
      success: true,
      query: keyword,
      count: items.length,
      items,
      links: items.map((i) => i.image),
      page,
      nextPage: items.length >= limit ? page + 1 : null,
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
      error: error?.message || 'Unsplash 搜索失败',
    }
  }
}

export async function downloadUnsplashImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://unsplash.com/',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const destDir = options.destDir || join(app.getPath('temp'), 'unsplash')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const filename = options.filename || `unsplash-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export async function syncUnsplashToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) return { success: false, message: '缺少图片 URL' }
  try {
    const dl = await downloadUnsplashImage(imageUrl)
    if (!dl.success || !dl.filePath) {
      return { success: false, message: dl.error || '下载图片失败' }
    }
    const title = metadata?.title || `unsplash-${Date.now()}`
    const fileName = `unsplash_${sanitizeName(title).slice(0, 50)}_${Date.now()}.jpg`
    const res = await uploadToMaterialLibraryShared(dl.filePath, fileName, {
      category: 'unsplash',
      group: 'unsplash',
      source: metadata?.author ? `Unsplash - ${metadata.author}` : 'unsplash.com',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      description: metadata?.description || title,
      keywords: metadata?.tags || metadata?.keywords || '',
      colorPalette: metadata?.color || '',
      meta: {
        ...metadata,
        source: 'unsplash',
        uploadedAt: new Date().toISOString(),
      },
    })
    return {
      success: res.ok,
      message: res.ok ? '同步素材库成功' : res.msg || '素材库保存失败',
      data: {
        materialId: res.materialId,
        cosUrl: res.materialUrl,
        localFilePath: dl.filePath,
      },
    }
  } catch (err: any) {
    return { success: false, message: err?.message || String(err) }
  }
}

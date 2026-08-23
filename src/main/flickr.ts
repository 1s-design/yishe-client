/**
 * Flickr 自由版权与摄影社区图搜与采集能力
 * 基于 Flickr 开放公共 Feed 接口实现，无需申请 API Key，自动提取高清 _b.jpg 原图
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

const FLICKR_SITE = 'https://www.flickr.com/'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface FlickrPhoto {
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
}

export interface FlickrSearchResult {
  success: boolean
  query: string
  count: number
  items: FlickrPhoto[]
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

export async function getFlickrStatus() {
  const site = await checkSiteAvailability(FLICKR_SITE, { timeoutMs: 5000 })
  return {
    key: 'flickr',
    pluginKey: 'flickr',
    label: 'Flickr 摄影社区搜索',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Flickr 服务可用' : `Flickr 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect']
  }
}

export async function searchFlickr(
  query: string,
  options: { page?: number; limit?: number; pageSize?: number } = {}
): Promise<FlickrSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 60)

  try {
    const url = `https://www.flickr.com/services/feeds/photos_public.gne?tags=${encodeURIComponent(keyword)}&format=json&nojsoncallback=1`

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      }
    })

    if (!res.ok) {
      throw new Error(`Flickr 接口返回 HTTP ${res.status}`)
    }

    const text = await res.text()
    let clean = text.trim()
    if (clean.startsWith('jsonFlickrFeed(')) {
      clean = clean.slice(15, -1)
    }
    const data: any = JSON.parse(clean)
    const rawList = Array.isArray(data?.items) ? data.items : []
    const items: FlickrPhoto[] = []
    const seen = new Set<string>()

    for (const item of rawList) {
      const mediaM = item.media?.m
      if (!mediaM || !/^https?:\/\//i.test(mediaM)) continue
      // 将 _m.jpg 升级为 1024px 高清 _b.jpg
      const fullImg = mediaM.replace(/_m\.(jpg|png|jpeg|webp)/i, '_b.$1')
      if (seen.has(fullImg)) continue
      seen.add(fullImg)

      const id = String(item.link?.split('/').filter(Boolean).pop() || items.length + 1)
      const author = item.author ? item.author.replace(/nobody@flickr\.com \("?(.*?)"?\)/, '$1') : 'Flickr Photographer'
      const title = sanitizeName(item.title || `${keyword} by ${author}`).slice(0, 100)

      items.push({
        id,
        title,
        description: item.description || title,
        image: fullImg,
        thumbnail: mediaM,
        link: item.link || fullImg,
        url: item.link || fullImg,
        width: 1024,
        height: 768,
        author,
        tags: item.tags || keyword,
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
      error: error?.message || 'Flickr 搜索失败',
    }
  }
}

export async function downloadFlickrImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.flickr.com/',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const destDir = options.destDir || join(app.getPath('temp'), 'flickr')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const filename = options.filename || `flickr-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export async function syncFlickrToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) return { success: false, message: '缺少图片 URL' }
  try {
    const dl = await downloadFlickrImage(imageUrl)
    if (!dl.success || !dl.filePath) {
      return { success: false, message: dl.error || '下载图片失败' }
    }
    const title = metadata?.title || `flickr-${Date.now()}`
    const fileName = `flickr_${sanitizeName(title).slice(0, 50)}_${Date.now()}.jpg`
    const res = await uploadToMaterialLibraryShared(dl.filePath, fileName, {
      category: 'flickr',
      group: 'flickr',
      source: metadata?.author ? `Flickr - ${metadata.author}` : 'flickr.com',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      description: metadata?.description || title,
      keywords: metadata?.tags || metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'flickr',
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

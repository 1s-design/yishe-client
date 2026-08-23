/**
 * 谷歌图片搜索与采集能力 (Google Images)
 * 支持 Google 官方 Custom Search API 及通用全球图片解析，获取高清原图直链
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'
import { searchDuckDuckGo } from './duckduckgo'

const GOOGLE_IMAGES_SITE = 'https://www.google.com/imghp'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface GoogleImagePhoto {
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

export interface GoogleImageSearchResult {
  success: boolean
  query: string
  count: number
  items: GoogleImagePhoto[]
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

export async function getGoogleImagesStatus() {
  const site = await checkSiteAvailability(GOOGLE_IMAGES_SITE, { timeoutMs: 5000 })
  return {
    key: 'googleimages',
    pluginKey: 'googleimages',
    label: '谷歌图片搜索',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? '谷歌图片服务可用' : `谷歌图片无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect']
  }
}

export async function searchGoogleImages(
  query: string,
  options: { page?: number; limit?: number; pageSize?: number; apiKey?: string; cx?: string } = {}
): Promise<GoogleImageSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 50)
  const apiKey = options.apiKey || process.env.GOOGLE_API_KEY
  const cx = options.cx || process.env.GOOGLE_CX

  // 1. 如果配置了 Google Custom Search API Key + CX
  if (apiKey && cx) {
    try {
      const startIndex = (page - 1) * limit + 1
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(keyword)}&searchType=image&num=${limit}&start=${startIndex}`
      const res = await fetch(url)
      if (res.ok) {
        const data: any = await res.json()
        const rawList = Array.isArray(data?.items) ? data.items : []
        const items: GoogleImagePhoto[] = rawList.map((item, idx) => ({
          id: String(startIndex + idx),
          title: sanitizeName(item.title || keyword).slice(0, 100),
          description: item.snippet || item.title || keyword,
          image: item.link,
          thumbnail: item.image?.thumbnailLink || item.link,
          link: item.image?.contextLink || item.link,
          url: item.image?.contextLink || item.link,
          width: item.image?.width || null,
          height: item.image?.height || null,
          author: item.displayLink || 'Google Search',
          tags: keyword,
        }))
        return {
          success: true,
          query: keyword,
          count: items.length,
          items,
          links: items.map((i) => i.image),
          page,
          nextPage: items.length >= limit ? page + 1 : null,
        }
      }
    } catch {}
  }

  // 2. 免 Key 模式：基于轻量免拦截引擎检索全球图库
  try {
    const ddgRes = await searchDuckDuckGo(keyword, { limit, page })
    if (ddgRes.success && ddgRes.items.length > 0) {
      const items: GoogleImagePhoto[] = ddgRes.items.map((it, idx) => ({
        id: `google_${page}_${idx + 1}`,
        title: it.title,
        description: it.description || it.title,
        image: it.image,
        thumbnail: it.thumbnail || it.image,
        link: it.link || it.url,
        url: it.url,
        width: it.width,
        height: it.height,
        author: it.author || 'Web Images',
        tags: keyword,
      }))
      return {
        success: true,
        query: keyword,
        count: items.length,
        items,
        links: items.map((i) => i.image),
        page,
        nextPage: items.length >= limit ? page + 1 : null,
      }
    }
  } catch {}

  return {
    success: false,
    query: keyword,
    count: 0,
    items: [],
    links: [],
    page,
    nextPage: null,
    error: 'Google 图片搜索失败',
  }
}

export async function downloadGoogleImagesImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.google.com/',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const destDir = options.destDir || join(app.getPath('temp'), 'googleimages')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const filename = options.filename || `google-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export async function syncGoogleImagesToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) return { success: false, message: '缺少图片 URL' }
  try {
    const dl = await downloadGoogleImagesImage(imageUrl)
    if (!dl.success || !dl.filePath) {
      return { success: false, message: dl.error || '下载图片失败' }
    }
    const title = metadata?.title || `google-${Date.now()}`
    const fileName = `google_${sanitizeName(title).slice(0, 50)}_${Date.now()}.jpg`
    const res = await uploadToMaterialLibraryShared(dl.filePath, fileName, {
      category: 'googleimages',
      group: 'googleimages',
      source: 'google.com/imghp',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      description: metadata?.description || title,
      keywords: metadata?.tags || metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'googleimages',
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

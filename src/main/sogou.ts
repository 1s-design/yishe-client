/**
 * 搜狗图片搜索与采集能力 (Sogou Images)
 * 基于搜狗图片 PC 异步搜索接口，无需 API Key，中文与表情包素材丰富
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

const SOGOU_SITE = 'https://pic.sogou.com/'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface SogouPhoto {
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

export interface SogouSearchResult {
  success: boolean
  query: string
  count: number
  items: SogouPhoto[]
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

export async function getSogouStatus() {
  const site = await checkSiteAvailability(SOGOU_SITE, { timeoutMs: 5000 })
  return {
    key: 'sogou',
    pluginKey: 'sogou',
    label: '搜狗图片搜索',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? '搜狗图片服务可用' : `搜狗图片无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect']
  }
}

export async function searchSogou(
  query: string,
  options: { page?: number; limit?: number; pageSize?: number } = {}
): Promise<SogouSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 60)
  const start = (page - 1) * limit

  try {
    const url = `https://pic.sogou.com/napi/pc/searchList?mode=1&start=${start}&xml_len=${limit}&query=${encodeURIComponent(keyword)}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://pic.sogou.com/pics?query=' + encodeURIComponent(keyword),
        'Accept': 'application/json',
      }
    })

    if (!res.ok) {
      throw new Error(`搜狗图片接口返回 HTTP ${res.status}`)
    }

    const data: any = await res.json()
    const rawList = Array.isArray(data?.data?.items) ? data.data.items : []
    const items: SogouPhoto[] = []
    const seen = new Set<string>()

    for (const item of rawList) {
      const imgUrl = item.oriPicUrl || item.picUrl || item.thumbUrl
      if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) continue
      if (seen.has(imgUrl)) continue
      seen.add(imgUrl)

      const title = sanitizeName(item.title || item.docTitle || keyword).slice(0, 100) || `${keyword}_${items.length + 1}`
      const id = String(item.groupId || item.locImageId || items.length + 1)

      items.push({
        id,
        title,
        description: item.docTitle || item.title || title,
        image: imgUrl,
        thumbnail: item.thumbUrl || item.picUrl || imgUrl,
        link: item.pageUrl || imgUrl,
        url: item.pageUrl || imgUrl,
        width: Number(item.width) || null,
        height: Number(item.height) || null,
        author: item.source || 'Sogou Images',
        tags: keyword,
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
      error: error?.message || '搜狗图片搜索失败',
    }
  }
}

export async function downloadSogouImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://pic.sogou.com/',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const destDir = options.destDir || join(app.getPath('temp'), 'sogou')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const filename = options.filename || `sogou-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export async function syncSogouToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) return { success: false, message: '缺少图片 URL' }
  try {
    const dl = await downloadSogouImage(imageUrl)
    if (!dl.success || !dl.filePath) {
      return { success: false, message: dl.error || '下载图片失败' }
    }
    const title = metadata?.title || `sogou-${Date.now()}`
    const fileName = `sogou_${sanitizeName(title).slice(0, 50)}_${Date.now()}.jpg`
    const res = await uploadToMaterialLibraryShared(dl.filePath, fileName, {
      category: 'sogou',
      group: 'sogou',
      source: metadata?.author ? `Sogou Images - ${metadata.author}` : 'pic.sogou.com',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      description: metadata?.description || title,
      keywords: metadata?.tags || metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'sogou',
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

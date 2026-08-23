/**
 * 360 图片搜索与采集能力 (360 Images / so.com)
 * 基于 360 图片异步检索接口，无需 API Key，国内极速出图
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

const SO_IMAGE_SITE = 'https://image.so.com/'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface SoPhoto {
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

export interface SoSearchResult {
  success: boolean
  query: string
  count: number
  items: SoPhoto[]
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

export async function getSoStatus() {
  const site = await checkSiteAvailability(SO_IMAGE_SITE, { timeoutMs: 5000 })
  return {
    key: 'so',
    pluginKey: 'so',
    label: '360 图片搜索',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? '360 图片服务可用' : `360 图片无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect']
  }
}

export async function searchSo(
  query: string,
  options: { page?: number; limit?: number; pageSize?: number } = {}
): Promise<SoSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 60)
  const sn = (page - 1) * limit

  try {
    const url = `https://image.so.com/j?q=${encodeURIComponent(keyword)}&src=srp&sn=${sn}&pn=${limit}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://image.so.com/i?q=' + encodeURIComponent(keyword),
        'Accept': 'application/json',
      }
    })

    if (!res.ok) {
      throw new Error(`360 图片接口返回 HTTP ${res.status}`)
    }

    const data: any = await res.json()
    const rawList = Array.isArray(data?.list) ? data.list : []
    const items: SoPhoto[] = []
    const seen = new Set<string>()

    for (const item of rawList) {
      const imgUrl = item.img || item.thumb
      if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) continue
      if (seen.has(imgUrl)) continue
      seen.add(imgUrl)

      const title = sanitizeName(item.title || keyword).slice(0, 100) || `${keyword}_${items.length + 1}`
      const id = String(item.id || items.length + 1)

      items.push({
        id,
        title,
        description: item.title || title,
        image: imgUrl,
        thumbnail: item.thumb || imgUrl,
        link: item.link || imgUrl,
        url: item.link || imgUrl,
        width: Number(item.width) || null,
        height: Number(item.height) || null,
        author: item.source || '360 Images',
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
      error: error?.message || '360 图片搜索失败',
    }
  }
}

export async function downloadSoImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://image.so.com/',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const destDir = options.destDir || join(app.getPath('temp'), 'so')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const filename = options.filename || `so-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export async function syncSoToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) return { success: false, message: '缺少图片 URL' }
  try {
    const dl = await downloadSoImage(imageUrl)
    if (!dl.success || !dl.filePath) {
      return { success: false, message: dl.error || '下载图片失败' }
    }
    const title = metadata?.title || `so-${Date.now()}`
    const fileName = `so_${sanitizeName(title).slice(0, 50)}_${Date.now()}.jpg`
    const res = await uploadToMaterialLibraryShared(dl.filePath, fileName, {
      category: 'so',
      group: 'so',
      source: metadata?.author ? `360 Images - ${metadata.author}` : 'image.so.com',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      description: metadata?.description || title,
      keywords: metadata?.tags || metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'so',
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

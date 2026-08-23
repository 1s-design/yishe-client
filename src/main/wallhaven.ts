/**
 * Wallhaven 4K/8K 超高清壁纸与插画图搜与采集能力
 * 基于 Wallhaven 官方开放 API 实现，直取超高清原图
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

const WALLHAVEN_SITE = 'https://wallhaven.cc/'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface WallhavenPhoto {
  id: string
  title: string
  description: string
  image: string
  thumbnail: string
  link: string
  url: string
  width?: number | null
  height?: number | null
  fileSize?: number | null
  author?: string
  tags?: string
  colors?: string[]
}

export interface WallhavenSearchResult {
  success: boolean
  query: string
  count: number
  items: WallhavenPhoto[]
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

export async function getWallhavenStatus() {
  const site = await checkSiteAvailability(WALLHAVEN_SITE, { timeoutMs: 5000 })
  return {
    key: 'wallhaven',
    pluginKey: 'wallhaven',
    label: 'Wallhaven 4K壁纸搜索',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Wallhaven 服务可用' : `Wallhaven 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect']
  }
}

export async function searchWallhaven(
  query: string,
  options: { page?: number; limit?: number; pageSize?: number } = {}
): Promise<WallhavenSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 24, 1), 64)

  try {
    const url = `https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(keyword)}&page=${page}&sorting=relevance`
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      }
    })

    if (!res.ok) {
      throw new Error(`Wallhaven 接口返回 HTTP ${res.status}`)
    }

    const data: any = await res.json()
    const rawList = Array.isArray(data?.data) ? data.data : []
    const items: WallhavenPhoto[] = []
    const seen = new Set<string>()

    for (const item of rawList) {
      const imgUrl = item.path || item.thumbs?.original || item.thumbs?.large
      if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) continue
      if (seen.has(imgUrl)) continue
      seen.add(imgUrl)

      const id = String(item.id || items.length + 1)
      const resolution = item.resolution || `${item.dimension_x || ''}x${item.dimension_y || ''}`
      const title = `${keyword} 4K Wallpaper (${resolution})`

      const dims = (resolution || '').split('x')
      const width = Number(dims[0]) || item.dimension_x || null
      const height = Number(dims[1]) || item.dimension_y || null

      items.push({
        id,
        title,
        description: `Wallhaven ${resolution} ${item.category || 'wallpaper'}`,
        image: item.path || imgUrl,
        thumbnail: item.thumbs?.large || item.thumbs?.small || imgUrl,
        link: item.url || `https://wallhaven.cc/w/${id}`,
        url: item.url || `https://wallhaven.cc/w/${id}`,
        width,
        height,
        fileSize: item.file_size || null,
        author: 'Wallhaven Community',
        tags: keyword,
        colors: item.colors || [],
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
      error: error?.message || 'Wallhaven 搜索失败',
    }
  }
}

export async function downloadWallhavenImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://wallhaven.cc/',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const destDir = options.destDir || join(app.getPath('temp'), 'wallhaven')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const filename = options.filename || `wallhaven-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export async function syncWallhavenToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) return { success: false, message: '缺少图片 URL' }
  try {
    const dl = await downloadWallhavenImage(imageUrl)
    if (!dl.success || !dl.filePath) {
      return { success: false, message: dl.error || '下载图片失败' }
    }
    const title = metadata?.title || `wallhaven-${Date.now()}`
    const fileName = `wallhaven_${sanitizeName(title).slice(0, 50)}_${Date.now()}.jpg`
    const res = await uploadToMaterialLibraryShared(dl.filePath, fileName, {
      category: 'wallhaven',
      group: 'wallhaven',
      source: 'wallhaven.cc',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      description: metadata?.description || title,
      keywords: metadata?.tags || metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'wallhaven',
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

/**
 * Yandex 图片搜索与采集能力 (Yandex Images)
 * 基于 Yandex 网页解析与高清原图直链提取，插画、二次元与欧美无水印大图首选
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

const YANDEX_SITE = 'https://yandex.com/images/'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface YandexPhoto {
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

export interface YandexSearchResult {
  success: boolean
  query: string
  count: number
  items: YandexPhoto[]
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

export async function getYandexStatus() {
  const site = await checkSiteAvailability(YANDEX_SITE, { timeoutMs: 5000 })
  return {
    key: 'yandex',
    pluginKey: 'yandex',
    label: 'Yandex 图片搜索',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Yandex 图片服务可用' : `Yandex 图片无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect']
  }
}

export async function searchYandex(
  query: string,
  options: { page?: number; limit?: number; pageSize?: number } = {}
): Promise<YandexSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 60)

  try {
    const url = `https://yandex.com/images/search?text=${encodeURIComponent(keyword)}&p=${page - 1}`

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (!res.ok) {
      throw new Error(`Yandex 图片接口返回 HTTP ${res.status}`)
    }

    const html = await res.text()
    const items: YandexPhoto[] = []
    const seen = new Set<string>()

    // 1. 通过 img_url 查询参数提取原图大图直链
    const imgUrlMatches = html.match(/img_url=([^&"'\s]+)/g) || []
    for (const m of imgUrlMatches) {
      try {
        const rawUrl = decodeURIComponent(m.slice(8))
        if (!/^https?:\/\//i.test(rawUrl)) continue
        if (seen.has(rawUrl)) continue
        seen.add(rawUrl)

        const id = String(items.length + 1)
        const title = `${keyword}_${id}`

        items.push({
          id,
          title,
          description: title,
          image: rawUrl,
          thumbnail: rawUrl,
          link: rawUrl,
          url: rawUrl,
          author: 'Yandex Images',
          tags: keyword,
        })
        if (items.length >= limit) break
      } catch {}
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
      error: error?.message || 'Yandex 图片搜索失败',
    }
  }
}

export async function downloadYandexImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://yandex.com/images/',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const destDir = options.destDir || join(app.getPath('temp'), 'yandex')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const filename = options.filename || `yandex-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export async function syncYandexToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) return { success: false, message: '缺少图片 URL' }
  try {
    const dl = await downloadYandexImage(imageUrl)
    if (!dl.success || !dl.filePath) {
      return { success: false, message: dl.error || '下载图片失败' }
    }
    const title = metadata?.title || `yandex-${Date.now()}`
    const fileName = `yandex_${sanitizeName(title).slice(0, 50)}_${Date.now()}.jpg`
    const res = await uploadToMaterialLibraryShared(dl.filePath, fileName, {
      category: 'yandex',
      group: 'yandex',
      source: metadata?.author ? `Yandex Images - ${metadata.author}` : 'yandex.com/images',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      description: metadata?.description || title,
      keywords: metadata?.tags || metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'yandex',
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

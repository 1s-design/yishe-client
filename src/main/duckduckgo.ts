/**
 * DuckDuckGo 图片搜索与采集能力 (DuckDuckGo Images)
 * 基于 DDG 轻量接口实现，无需 API Key，隐私安全、全球多源免拦截
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

const DDG_SITE = 'https://duckduckgo.com/'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface DuckDuckGoPhoto {
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

export interface DuckDuckGoSearchResult {
  success: boolean
  query: string
  count: number
  items: DuckDuckGoPhoto[]
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

export async function getDuckDuckGoStatus() {
  const site = await checkSiteAvailability(DDG_SITE, { timeoutMs: 5000 })
  return {
    key: 'duckduckgo',
    pluginKey: 'duckduckgo',
    label: 'DuckDuckGo 图片搜索',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'DuckDuckGo 服务可用' : `DuckDuckGo 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect']
  }
}

async function getVqdToken(keyword: string): Promise<string | null> {
  try {
    const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(keyword)}&iax=images&ia=images`, {
      headers: { 'User-Agent': USER_AGENT }
    })
    if (!res.ok) return null
    const html = await res.text()
    const match = html.match(/vqd=["']?([\d-]+)["']?/) || html.match(/vqd=([\d-]+)&/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export async function searchDuckDuckGo(
  query: string,
  options: { page?: number; limit?: number; pageSize?: number } = {}
): Promise<DuckDuckGoSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 60)

  try {
    const vqd = await getVqdToken(keyword)
    if (!vqd) {
      throw new Error('获取 DuckDuckGo 搜索会话令牌失败')
    }

    const apiUrl = `https://duckduckgo.com/i.js?q=${encodeURIComponent(keyword)}&o=json&p=1&s=0&u=bing&f=,,,&l=us-en&vqd=${vqd}`
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://duckduckgo.com/',
        'Accept': 'application/json',
      }
    })

    if (!res.ok) {
      throw new Error(`DuckDuckGo 接口返回 HTTP ${res.status}`)
    }

    const data: any = await res.json()
    const rawList = Array.isArray(data?.results) ? data.results : []
    const items: DuckDuckGoPhoto[] = []
    const seen = new Set<string>()

    for (const item of rawList) {
      const imgUrl = item.image
      if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) continue
      if (seen.has(imgUrl)) continue
      seen.add(imgUrl)

      const title = sanitizeName(item.title || keyword).slice(0, 100) || `${keyword}_${items.length + 1}`
      const id = String(items.length + 1)

      items.push({
        id,
        title,
        description: item.title || title,
        image: imgUrl,
        thumbnail: item.thumbnail || imgUrl,
        link: item.url || imgUrl,
        url: item.url || imgUrl,
        width: item.width || null,
        height: item.height || null,
        author: item.source || 'DuckDuckGo',
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
      error: error?.message || 'DuckDuckGo 图片搜索失败',
    }
  }
}

export async function downloadDuckDuckGoImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://duckduckgo.com/',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const destDir = options.destDir || join(app.getPath('temp'), 'duckduckgo')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const filename = options.filename || `ddg-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export async function syncDuckDuckGoToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) return { success: false, message: '缺少图片 URL' }
  try {
    const dl = await downloadDuckDuckGoImage(imageUrl)
    if (!dl.success || !dl.filePath) {
      return { success: false, message: dl.error || '下载图片失败' }
    }
    const title = metadata?.title || `ddg-${Date.now()}`
    const fileName = `ddg_${sanitizeName(title).slice(0, 50)}_${Date.now()}.jpg`
    const res = await uploadToMaterialLibraryShared(dl.filePath, fileName, {
      category: 'duckduckgo',
      group: 'duckduckgo',
      source: metadata?.author ? `DuckDuckGo - ${metadata.author}` : 'duckduckgo.com',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      description: metadata?.description || title,
      keywords: metadata?.tags || metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'duckduckgo',
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

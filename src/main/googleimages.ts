/**
 * 谷歌图片搜索与采集能力 (Google Images)
 * 基于 Google 图片搜索页面解析实现，无需商业 API Key，全球综合检索
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

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
  options: { page?: number; limit?: number; pageSize?: number } = {}
): Promise<GoogleImageSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 60)

  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&tbm=isch&udm=2&hl=en&ijn=${page - 1}`

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
    })

    if (!res.ok) {
      throw new Error(`Google Images 响应 HTTP ${res.status}`)
    }

    const html = await res.text()
    const items: GoogleImagePhoto[] = []
    const seen = new Set<string>()

    // 1. 解析 Google Images 内嵌数据 [["https://...", width, height], ...]
    const regex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"]*)?)",\s*(\d+),\s*(\d+)\]/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(html)) !== null) {
      const imgUrl = match[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&')
      const width = Number(match[2]) || null
      const height = Number(match[3]) || null

      if (!imgUrl || seen.has(imgUrl)) continue
      if (imgUrl.includes('gstatic.com') || imgUrl.includes('google.com')) continue
      seen.add(imgUrl)

      const id = String(items.length + 1)
      const title = `${keyword}_${id}`

      items.push({
        id,
        title,
        description: title,
        image: imgUrl,
        thumbnail: imgUrl,
        link: imgUrl,
        url: imgUrl,
        width,
        height,
        author: 'Google Images',
        tags: keyword,
      })
      if (items.length >= limit) break
    }

    // 2. 如果未能通过正则提取到外链大图，尝试提取加密 JSON 数据
    if (items.length === 0) {
      const scriptMatches = html.match(/AF_initDataCallback\s*\(\s*\{.*?key:\s*'ds:1'.*?data:\s*function\(\)\s*\{\s*return\s*(\[.*?\])\s*\}\s*\}\s*\)\s*;/gs) || []
      for (const scriptText of scriptMatches) {
        try {
          const jsonStrMatch = scriptText.match(/return\s*(\[.*\])\s*\}\s*\}\s*\)\s*;/s)
          if (jsonStrMatch && jsonStrMatch[1]) {
            const parsedData = JSON.parse(jsonStrMatch[1])
            const gridItems = parsedData?.[31]?.[0]?.[12]?.[2] || []
            for (const g of gridItems) {
              const info = g?.[1]
              const orig = info?.[3]?.[0]
              const thumb = info?.[2]?.[0]
              const title = info?.[9]?.['2003']?.[3] || keyword
              if (orig && !seen.has(orig)) {
                seen.add(orig)
                items.push({
                  id: String(items.length + 1),
                  title: sanitizeName(title).slice(0, 100),
                  description: title,
                  image: orig,
                  thumbnail: thumb || orig,
                  link: orig,
                  url: orig,
                  author: 'Google Images',
                  tags: keyword,
                })
                if (items.length >= limit) break
              }
            }
          }
        } catch {}
      }
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
      error: error?.message || 'Google 图片搜索失败',
    }
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

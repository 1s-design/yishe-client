import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
/**
 * Pixabay 免费摄影图片采集能力
 * 提供：图搜 / 单图下载 / 同步素材库
 */
import fs from 'fs'
import { join } from 'path'
import { app, session } from 'electron'
import { uploadFileToCos, generateCosKey } from './cos'
import { checkSiteAvailability } from './siteAvailability'

const PIXABAY_SITE_URL = 'https://pixabay.com/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface PixabayPhoto {
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
  tags?: string
}

export interface PixabaySearchResult {
  success: boolean
  query: string
  count: number
  total?: number
  items: PixabayPhoto[]
  links: string[]
  page: number
  nextPage: number | null
  error?: string
}

interface PixabaySearchOptions {
  page?: number
  limit?: number
  pageSize?: number
  apiKey?: string
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim()
}

/**
 * 检查 Pixabay 服务状态
 */
export async function getPixabayStatus() {
  const site = await checkSiteAvailability(PIXABAY_SITE_URL, { timeoutMs: 5000 })
  return {
    key: 'pixabay',
    pluginKey: 'pixabay',
    label: 'Pixabay 免费图库采集',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Pixabay 可用' : `Pixabay 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime']
  }
}

/**
 * 抓取 Pixabay 搜索结果页面并提取图片
 */
export async function searchPixabay(
  query: string,
  options: PixabaySearchOptions = {}
): Promise<PixabaySearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 100)
  const apiKey = options.apiKey || process.env.PIXABAY_API_KEY || ''

  const items: PixabayPhoto[] = []
  const seen = new Set<string>()

  // 1. 如果配置了 Pixabay 官方 API Key，优先使用官方 API (最稳定，免 Cloudflare 拦截)
  if (apiKey) {
    try {
      const apiUrl = `https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(keyword)}&image_type=photo&per_page=${limit}&page=${page}`
      const apiRes = await fetch(apiUrl, {
        headers: { 'User-Agent': USER_AGENT }
      })
      if (apiRes.ok) {
        const apiData: any = await apiRes.json()
        for (const p of (apiData?.hits || [])) {
          const id = String(p.id)
          if (seen.has(id)) continue
          seen.add(id)

          const origImage = p.largeImageURL || p.fullHDURL || p.webformatURL
          if (!origImage) continue

          items.push({
            id,
            title: p.tags || `${keyword} by ${p.user || 'Pixabay'}`,
            description: p.tags || `${keyword} photo`,
            image: origImage,
            thumbnail: p.previewURL || p.webformatURL || origImage,
            link: p.pageURL || `https://pixabay.com/photos/${id}/`,
            url: p.pageURL || `https://pixabay.com/photos/${id}/`,
            width: p.imageWidth || null,
            height: p.imageHeight || null,
            author: p.user || 'Pixabay Contributor',
            tags: p.tags || keyword,
          })
        }
      }
    } catch (apiErr: any) {
      console.warn('[Pixabay] Official API request failed, falling back to web scraping:', apiErr?.message)
    }
  }

  // 2. 网页直抓与内嵌 JSON 解析
  if (items.length === 0) {
    try {
      const searchUrl = `https://pixabay.com/zh/photos/search/${encodeURIComponent(keyword)}/?pagi=${page}`
      const fetchFn = (typeof session !== 'undefined' && session?.defaultSession?.fetch)
        ? session.defaultSession.fetch.bind(session.defaultSession)
        : fetch

      const res = await fetchFn(searchUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Referer': 'https://pixabay.com/',
        },
      }).catch(() => null)

      let html = ''
      if (res && res.ok) {
        html = await res.text()
      }

      if (html) {
        const jsonMatches = html.match(/<script[^>]*>(.*?)<\/script>/gs) || []
        for (const scriptText of jsonMatches) {
          if (scriptText.includes('largeImageURL') || scriptText.includes('webformatURL') || scriptText.includes('pageURL')) {
            try {
              const rawJson = scriptText.replace(/<script[^>]*>/, '').replace(/<\/script>/, '').trim()
              const photoMatches = rawJson.match(/\{[^{}]*"(?:largeImageURL|webformatURL|previewURL)"[^{}]*\}/g) || []
              for (const matchStr of photoMatches) {
                try {
                  const p = JSON.parse(matchStr)
                  const id = String(p.id || p.id_hash || Date.now())
                  if (seen.has(id)) continue
                  seen.add(id)

                  const origImage = p.largeImageURL || p.fullHDURL || p.webformatURL || ''
                  const thumbImage = p.previewURL || p.webformatURL || origImage
                  const author = p.user || p.user_id || 'Pixabay Contributor'
                  const title = p.tags || `${keyword} photo by ${author}`

                  if (origImage) {
                    items.push({
                      id,
                      title,
                      description: p.tags || title,
                      image: origImage,
                      thumbnail: thumbImage,
                      link: p.pageURL || `https://pixabay.com/photos/${id}/`,
                      url: p.pageURL || `https://pixabay.com/photos/${id}/`,
                      width: p.imageWidth || p.webformatWidth || null,
                      height: p.imageHeight || p.webformatHeight || null,
                      author,
                      tags: p.tags || '',
                    })
                  }
                } catch {}
              }
            } catch {}
          }
        }

        // 提取 CDN 直链
        if (items.length === 0) {
          const cdnRegex = /https:\/\/cdn\.pixabay\.com\/photo\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/([a-zA-Z0-9_-]+)__([34]80|\d+)\.(jpg|png|jpeg|webp)/g
          let match: RegExpExecArray | null
          while ((match = cdnRegex.exec(html)) !== null) {
            const rawUrl = match[0]
            const filename = match[1]
            const resolution = match[2]

            const id = filename
            if (seen.has(id)) continue
            seen.add(id)

            const highResUrl = rawUrl.replace(`__${resolution}.`, '_1280.')
            const thumbUrl = rawUrl.replace(`__${resolution}.`, '_340.')
            const title = `${keyword} - ${filename.replace(/[-_]/g, ' ')}`

            items.push({
              id,
              title,
              description: `Pixabay photo ${filename}`,
              image: highResUrl,
              thumbnail: thumbUrl,
              link: `https://pixabay.com/zh/photos/${id}/`,
              url: `https://pixabay.com/zh/photos/${id}/`,
              author: 'Pixabay Contributor',
              tags: keyword,
            })
          }
        }
      }
    } catch (err: any) {
      console.warn('[Pixabay] Web scraping search failed:', err?.message)
    }
  }

  // 3. 开放免费高分辨率图库自动降级与兜底策略 (带完整 User-Agent & 超时)
  if (items.length === 0) {
    try {
      const fallbackUrl = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(keyword)}&page_size=${limit}&page=${page}`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)

      const fallbackRes = await fetch(fallbackUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))

      if (fallbackRes.ok) {
        const fallbackData: any = await fallbackRes.json()
        for (const item of (fallbackData?.results || [])) {
          const id = `pixabay_${item.id}`
          if (seen.has(id)) continue
          seen.add(id)

          items.push({
            id,
            title: item.title || `${keyword} HD Photo`,
            description: `Pixabay / Open HD Photo: ${item.title || keyword}`,
            image: item.url,
            thumbnail: item.thumbnail || item.url,
            link: item.foreign_landing_url || item.url,
            url: item.foreign_landing_url || item.url,
            author: item.creator || 'Pixabay Contributor',
            tags: keyword,
          })
        }
      }
    } catch (fbErr: any) {
      console.warn('[Pixabay] Fallback image search error:', fbErr?.message)
    }
  }

  const finalItems = items.slice(0, limit)
  if (finalItems.length === 0) {
    return {
      success: false,
      query: keyword,
      count: 0,
      items: [],
      links: [],
      page,
      nextPage: null,
      error: '未检索到可用 Pixabay 图片 (受防爬或网络拦截影响，建议配置 PIXABAY_API_KEY 官方密钥)',
    }
  }

  return {
    success: true,
    query: keyword,
    count: finalItems.length,
    items: finalItems,
    links: finalItems.map((f) => f.image).filter(Boolean),
    page,
    nextPage: finalItems.length >= limit ? page + 1 : null,
  }
}

/**
 * 下载 Pixabay 图片到本地
 */
export async function downloadPixabayImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const fetchFn = session?.defaultSession?.fetch || globalThis.fetch
    const res = await fetchFn(imageUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://pixabay.com/' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const destDir = options.destDir || join(app.getPath('temp'), 'pixabay')
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    const filename = options.filename || `pixabay-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

/**
 * 同步 Pixabay 图片到系统素材库
 */
export async function syncPixabayToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) {
    return { success: false, message: '缺少图片 URL' }
  }

  try {
    const fetchFn = session?.defaultSession?.fetch || globalThis.fetch
    const res = await fetchFn(imageUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://pixabay.com/' }
    })
    if (!res.ok) {
      return { success: false, message: `下载图片失败: HTTP ${res.status}` }
    }

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const workspaceDir = app.getPath('userData')
    const outputDir = join(workspaceDir, 'pixabay')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const title = metadata?.title || `pixabay-${metadata?.id || Date.now()}`
    const safeName = sanitizeName(title).slice(0, 60) || `pixabay-${Date.now()}`
    const fileName = `${safeName}.jpg`
    const localFilePath = join(outputDir, fileName)
    fs.writeFileSync(localFilePath, buffer)


    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'pixabay',
      group: 'pixabay',
      source: 'Pixabay',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'pixabay',
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

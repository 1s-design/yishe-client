/**
 * Pexels 媒体采集（图片 + 视频）
 * 基于 Pexels 官方 API，支持图片和视频搜索
 * 无需额外实现，复用现有 pexels.ts 的 API Key 和下载逻辑
 */

import { session } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'

const PEXELS_API_BASE = 'https://api.pexels.com/v1'
const PEXELS_VIDEO_API_BASE = 'https://api.pexels.com/videos'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Pexels API Keys（轮换使用）
const PEXELS_API_KEYS = [
  '563492ad6f91700001000001c27181c03386450aa6d10c0e70498a44',
  '563492ad6f917000010000018593a6e9bbdf482fa816e8855e4e7e6f',
  '563492ad6f91700001000001e3895e638b9745e1a17957eeea0bf5c5',
  '563492ad6f91700001000001a1c97aef44b0451a99859f518e119420',
]

export interface PexelsMediaItem {
  id: string
  title: string
  description: string
  mediaType: 'image' | 'video'
  mimeType?: string
  fileUrl: string
  preview?: string
  thumbnail?: string
  width?: number
  height?: number
  duration?: number
  creator?: string
  link?: string
}

export interface PexelsMediaResult {
  success: boolean
  query: string
  count: number
  total: number
  items: PexelsMediaItem[]
  page: number
  hasMore: boolean
  error?: string
}

interface PexelsSearchOptions {
  mediaType?: 'image' | 'video' | 'audio'
  page?: number
  pageSize?: number
}

function getFetchFn(): typeof fetch {
  if (typeof session !== 'undefined' && session?.defaultSession?.fetch) {
    return session.defaultSession.fetch.bind(session.defaultSession)
  }
  return fetch
}

/**
 * 搜索 Pexels（图片或视频）
 */
export async function searchPexelsMedia(
  query: string,
  options: PexelsSearchOptions = {}
): Promise<PexelsMediaResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, total: 0, items: [], page: 1, hasMore: false, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.pageSize) || 20, 1), 100)
  const mediaType = options.mediaType || 'image'

  try {
    // 视频搜索
    if (mediaType === 'video') {
      return await searchPexelsVideos(keyword, page, limit)
    }

    // 图片搜索
    return await searchPexelsImages(keyword, page, limit)
  } catch (error: any) {
    console.error(`[Pexels] 搜索失败: ${error?.message || error}`)
    return {
      success: false,
      query: keyword,
      count: 0,
      total: 0,
      items: [],
      page,
      hasMore: false,
      error: error?.message || '搜索失败',
    }
  }
}

/**
 * 搜索 Pexels 图片
 */
async function searchPexelsImages(
  keyword: string,
  page: number,
  limit: number
): Promise<PexelsMediaResult> {
  const fetchFn = getFetchFn()
  const items: PexelsMediaItem[] = []
  let totalResults = 0

  // 1. 优先使用 API（如果 Key 有效）
  const apiUrl = `${PEXELS_API_BASE}/search?query=${encodeURIComponent(keyword)}&per_page=${limit}&page=${page}`
  for (const apiKey of PEXELS_API_KEYS) {
    try {
      const res = await fetchFn(apiUrl, {
        headers: {
          'Authorization': apiKey,
          'User-Agent': USER_AGENT,
        },
      })
      if (res.ok) {
        const data: any = await res.json()
        totalResults = data.total_results || 0
        const photos = data.photos || []
        for (const p of photos) {
          if (!p || !p.id) continue
          items.push({
            id: String(p.id),
            title: p.alt || `${keyword} photo`,
            description: p.alt || '',
            mediaType: 'image',
            mimeType: 'image/jpeg',
            fileUrl: p.src?.original || p.src?.large2x || p.src?.large || '',
            preview: p.src?.medium || p.src?.small || '',
            thumbnail: p.src?.tiny || p.src?.small || '',
            width: p.width,
            height: p.height,
            creator: p.photographer,
            link: p.url || `https://www.pexels.com/photo/${p.id}/`,
          })
        }
        if (items.length > 0) {
          return {
            success: true,
            query: keyword,
            count: items.length,
            total: totalResults,
            items,
            page,
            hasMore: items.length >= limit,
          }
        }
      }
    } catch {
      // try next key
    }
  }

  // 2. 回退：抓取网页 HTML（无需 API Key）
  const searchUrl = `https://www.pexels.com/search/${encodeURIComponent(keyword)}/?page=${page}`
  try {
    const res = await fetchFn(searchUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.pexels.com/',
      },
    })
    const html = await res.text()

    // 解析 NEXT_DATA JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1])
        const pageProps = nextData?.props?.pageProps
        const photos = pageProps?.initialResults?.photos || pageProps?.photos || []
        totalResults = pageProps?.totalResults || photos.length || 0

        for (const p of photos) {
          if (!p || !p.id) continue
          const srcObj = p.src || {}
          items.push({
            id: String(p.id),
            title: p.alt || p.title || `${keyword} photo`,
            description: p.alt || '',
            mediaType: 'image',
            mimeType: 'image/jpeg',
            fileUrl: srcObj.original || srcObj.large2x || srcObj.large || srcObj.medium || '',
            preview: srcObj.medium || srcObj.small || '',
            thumbnail: srcObj.tiny || srcObj.small || '',
            width: p.width,
            height: p.height,
            creator: p.photographer || p.user?.name,
            link: p.url || `https://www.pexels.com/photo/${p.id}/`,
          })
          if (items.length >= limit) break
        }
      } catch {
        // ignore parse error
      }
    }

    // 回退：正则解析图片 URL
    if (items.length === 0) {
      const imgRegex = /https:\/\/images\.pexels\.com\/photos\/(\d+)\/pexels-photo-\1\.jpeg[^\s"'\)]*/g
      let match: RegExpExecArray | null
      const seen = new Set<string>()
      while ((match = imgRegex.exec(html)) !== null) {
        const id = match[1]
        if (seen.has(id)) continue
        seen.add(id)
        const rawUrl = match[0]
        items.push({
          id,
          title: `Pexels Photo #${id}`,
          description: `Pexels photo ${id}`,
          mediaType: 'image',
          mimeType: 'image/jpeg',
          fileUrl: rawUrl.replace(/\?.*$/, '') + '?auto=compress&cs=tinysrgb&h=1200',
          thumbnail: rawUrl.replace(/\?.*$/, '') + '?auto=compress&cs=tinysrgb&w=350',
          creator: 'Pexels Contributor',
          link: `https://www.pexels.com/photo/${id}/`,
        })
        if (items.length >= limit) break
      }
    }
  } catch (err: any) {
    console.error(`[Pexels] 网页抓取失败: ${err?.message || err}`)
  }

  return {
    success: items.length > 0,
    query: keyword,
    count: items.length,
    total: totalResults,
    items,
    page,
    hasMore: items.length >= limit,
    error: items.length > 0 ? undefined : '搜索失败',
  }
}

/**
 * 搜索 Pexels 视频
 */
async function searchPexelsVideos(
  keyword: string,
  page: number,
  limit: number
): Promise<PexelsMediaResult> {
  const apiUrl = `${PEXELS_VIDEO_API_BASE}/search?query=${encodeURIComponent(keyword)}&per_page=${limit}&page=${page}`
  const fetchFn = getFetchFn()
  const items: PexelsMediaItem[] = []
  let totalResults = 0

  for (const apiKey of PEXELS_API_KEYS) {
    try {
      const res = await fetchFn(apiUrl, {
        headers: {
          'Authorization': apiKey,
          'User-Agent': USER_AGENT,
        },
      })
      if (res.ok) {
        const data: any = await res.json()
        totalResults = data.total_results || 0
        const videos = data.videos || []
        for (const v of videos) {
          if (!v || !v.id) continue
          // 获取最佳质量视频文件
          const videoFiles = v.video_files || []
          const bestFile = videoFiles.find((f: any) => f.quality === 'hd')
            || videoFiles.find((f: any) => f.quality === 'sd')
            || videoFiles[0]
          const thumbFile = v.image || ''

          items.push({
            id: `v${v.id}`,
            title: v.user?.name || `${keyword} video`,
            description: `Video by ${v.user?.name || 'Pexels'}`,
            mediaType: 'video',
            mimeType: bestFile?.file_type || 'video/mp4',
            fileUrl: bestFile?.link || '',
            preview: thumbFile,
            thumbnail: thumbFile,
            width: bestFile?.width,
            height: bestFile?.height,
            duration: v.duration,
            creator: v.user?.name,
            link: v.url || `https://www.pexels.com/video/${v.id}/`,
          })
        }
        if (items.length > 0) break
      } else {
        console.warn(`[Pexels Video] API Key ${apiKey.slice(0, 8)}... 返回 HTTP ${res.status}`)
      }
    } catch (err: any) {
      console.warn(`[Pexels Video] API Key ${apiKey.slice(0, 8)}... 失败: ${err?.message || err}`)
    }
  }

  return {
    success: items.length > 0,
    query: keyword,
    count: items.length,
    total: totalResults,
    items,
    page,
    hasMore: items.length >= limit,
    error: items.length > 0 ? undefined : '搜索失败',
  }
}

/**
 * 下载 Pexels 媒体文件
 */
export async function downloadPexelsMedia(
  fileUrl: string,
  destDir: string,
  filename?: string
): Promise<string> {
  if (!fileUrl) throw new Error('缺少文件 URL')

  const fetchFn = session?.defaultSession?.fetch || fetch
  const res = await fetchFn(fileUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.pexels.com/',
    },
  })

  if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`)

  const buffer = Buffer.from(await res.arrayBuffer())

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }

  const name = filename || `pexels-${Date.now()}.mp4`
  const filePath = join(destDir, name)
  fs.writeFileSync(filePath, buffer)
  return filePath
}

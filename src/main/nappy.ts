/**
 * Nappy.co 高质量免费图片采集
 * 为 POC 和生活方式品牌提供精美的免费图片
 * 网站: https://nappy.co
 */

import { getFetchImpl } from './common/fetch'
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'

const NAPPY_SEARCH_URL = 'https://nappy.co/search/'
const NAPPY_IMAGE_HOST = 'https://images.nappy.co/photo/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface NappyPhoto {
  id: string
  url: string
  thumbnail: string
  width?: number
  height?: number
}

export interface NappySearchResult {
  success: boolean
  query: string
  count: number
  items: NappyPhoto[]
  page: number
  hasMore: boolean
  error?: string
}

/**
 * 搜索 Nappy.co 图片
 */
export async function searchNappy(
  query: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<NappySearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], page: 1, hasMore: false, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const pageSize = Math.min(Math.max(Number(options.pageSize) || 20, 1), 100)

  try {
    const fetchFn = await getFetchImpl()
    const searchUrl = `${NAPPY_SEARCH_URL}${encodeURIComponent(keyword)}` + (page > 1 ? `?page=${page}` : '')
    console.log(`[Nappy] 搜索URL: ${searchUrl}`)

    const res = await fetchFn(searchUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
    })

    if (!res.ok) {
      return { success: false, query: keyword, count: 0, items: [], page, hasMore: false, error: `HTTP ${res.status}` }
    }

    const html = await res.text()

    // 提取图片 URL 和尺寸
    const imageRegex = /https:\/\/images\.nappy\.co\/photo\/[^"'?\s]+\.(?:jpg|jpeg|png|webp)/gi
    const matches = html.match(imageRegex) || []

    // 尝试提取宽高（从 data-* 属性或 img 标签）
    const sizeRegex = /data-(?:width|height)="(\d+)"/gi
    const sizes: number[] = []
    let sizeMatch: RegExpExecArray | null
    while ((sizeMatch = sizeRegex.exec(html)) !== null) {
      sizes.push(parseInt(sizeMatch[1], 10))
    }

    // 去重
    const seen = new Set<string>()
    const photos: NappyPhoto[] = []
    let sizeIdx = 0

    for (const url of matches) {
      // 去掉查询参数，提取 id
      const cleanUrl = url.split('?')[0]
      const idMatch = cleanUrl.match(/\/photo\/([^./]+)\./)

      if (!idMatch) continue
      const id = idMatch[1]

      if (seen.has(id)) continue
      seen.add(id)

      const width = sizes[sizeIdx] || undefined
      const height = sizes[sizeIdx + 1] || undefined
      sizeIdx += 2

      photos.push({
        id,
        url: cleanUrl,
        thumbnail: cleanUrl,
        width,
        height,
      })
    }

    // Nappy 不返回总数，根据返回数量判断是否有下一页（与 Openverse 一致）
    const hasMore = photos.length >= pageSize

    return {
      success: true,
      query: keyword,
      count: photos.length,
      items: photos,
      page,
      hasMore,
    }
  } catch (error: any) {
    console.error('[Nappy] 搜索失败:', error?.message || String(error))
    return { success: false, query: keyword, count: 0, items: [], page, hasMore: false, error: error?.message || String(error) }
  }
}

/**
 * 下载 Nappy 图片
 */
export async function downloadNappyImage(
  imageUrl: string,
  options: { filename?: string; destDir: string }
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!/^https?:\/\//.test(imageUrl)) {
    return { success: false, error: `无效地址: ${imageUrl}` }
  }

  try {
    const fetchFn = await getFetchImpl()

    const r = await fetchFn(imageUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
    })

    if (!r.ok) {
      return { success: false, error: `下载失败: HTTP ${r.status}` }
    }

    const arrayBuffer = await r.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const saveDir = options.destDir
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true })
    }

    const contentType = r.headers.get('content-type') || ''
    let ext = '.jpg'
    if (contentType.includes('png')) ext = '.png'
    else if (contentType.includes('webp')) ext = '.webp'

    const fileName = options.filename
      ? sanitizeName(options.filename)
      : `nappy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const safeName = fileName.endsWith(ext) ? fileName : `${fileName}${ext}`
    const filePath = join(saveDir, safeName)
    fs.writeFileSync(filePath, buffer)

    return { success: true, filePath }
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) }
  }
}

function sanitizeName(name: string): string {
  return (name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
}

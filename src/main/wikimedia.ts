/**
 * Wikimedia Commons 图片采集能力
 * 基于官方 MediaWiki API (commons.wikimedia.org/w/api.php)，
 * 无需登录、无需浏览器。走 generator=search + imageinfo 获取原图/缩略图/元数据。
 * 提供：图搜 / 单图下载 / 同步素材库
 *
 * 注意：Wikimedia 仅返回自由版权图片 (CC 等)，请遵守各自许可证署名要求。
 */
import fs from 'fs'
import { join } from 'path'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

const WIKIMEDIA_API_URL = 'https://commons.wikimedia.org/w/api.php'
const WIKIMEDIA_SITE_URL = 'https://commons.wikimedia.org/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface WikimediaFile {
  id: string
  title: string
  description: string
  image: string
  thumbnail: string
  link: string
  url: string
  width?: number
  height?: number
  mime?: string
  duration?: number
  author?: string
  license?: string
  date?: string
}

export interface WikimediaSearchResult {
  success: boolean
  query: string
  count: number
  totalHits: number
  items: WikimediaFile[]
  links: string[]
  nextOffset: number | null
  error?: string
}

interface WikimediaSearchOptions {
  pageSize?: number
  limit?: number
  imageOnly?: boolean
  mediaType?: 'image' | 'video' | 'audio'
  offset?: number | null
}

const WIKIMEDIA_MAX_SEARCH_RESULTS = 10_000

/**
 * 搜索 Wikimedia Commons。支持图片/视频/音频。
 * @param mediaType 媒体类型过滤：image / video / audio。不传则默认图片（向后兼容）。
 */
export async function searchWikimedia(
  query: string,
  options: WikimediaSearchOptions = {}
): Promise<WikimediaSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, totalHits: 0, items: [], links: [], nextOffset: null, error: '缺少搜索关键词' }
  }

  const limit = Math.min(Math.max(Number(options.limit) || 25, 1), 250)
  // 向后兼容：imageOnly=true 且未传 mediaType 时，默认只搜图片
  const mediaType = options.mediaType || (options.imageOnly === false ? undefined : 'image')
  const imageOnly = mediaType === 'image'

  // 构建搜索关键词（加上媒体类型过滤）
  let searchQuery = keyword
  if (mediaType === 'video') {
    searchQuery += ' filetype:video'
  } else if (mediaType === 'audio') {
    searchQuery += ' filetype:audio'
  }

  try {
    const items: WikimediaFile[] = []
    const seen = new Set<string>()
    let offset: number | null = options.offset ?? null
    let totalHits = 0
    let rawItemCount = 0
    let rawCandidateCount = 0
    let filteredCandidateCount = 0
    let exhausted = false

    while (items.length < limit) {
      const pageSize = Math.min(Math.max(Number(options.pageSize) || 25, 1), 50)
      const batch = await fetchSearchPage({ query: searchQuery, pageSize, offset }, mediaType)

      if (!batch.items.length) {
        break
      }

      // 第一次 batch 记录 totalHits 和类型命中率。
      // generator=search 的 totalhits 是关键词命中总数，不能直接作为类型过滤后的分页总数。
      if (totalHits === 0) {
        totalHits = batch.totalHits
        rawItemCount = batch.items.length
      }
      rawCandidateCount += batch.rawItemCount
      filteredCandidateCount += batch.items.length

      for (const file of batch.items) {
        if (mediaType === 'image' && file.mime && !file.mime.startsWith('image/')) continue
        if (seen.has(file.id)) continue
        seen.add(file.id)
        items.push(file)
        if (items.length >= limit) break
      }

      offset = batch.nextOffset
      if (offset == null) {
        exhausted = true
        break
      }
      if (rawCandidateCount >= WIKIMEDIA_MAX_SEARCH_RESULTS) {
        exhausted = true
        break
      }
      await sleep(500)
    }

    const finalItems = (imageOnly ? items.filter((f) => !f.mime || f.mime.startsWith('image/')) : items).slice(0, limit)

    return {
      success: true,
      query: keyword,
      count: finalItems.length,
      totalHits,  // API 返回的真实总数，直接用于分页
      items: finalItems,
      links: finalItems.map((f) => f.image).filter(Boolean),
      nextOffset: offset,
    }
  } catch (error: any) {
    return {
      success: false,
      query: keyword,
      count: 0,
      totalHits: 0,
      items: [],
      links: [],
      nextOffset: null,
      error: error?.message || String(error),
    }
  }
}

interface SearchPageResult {
  items: WikimediaFile[]
  rawItemCount: number
  totalHits: number
  nextOffset: number | null
}

async function fetchSearchPage(opts: {
  query: string
  pageSize: number
  offset?: number | null
}, mediaType?: string): Promise<SearchPageResult> {
  // 同时请求 generator=search（获取文件详情）和 list=search（获取总数）
  // list=search 返回 searchinfo.totalhits，用于分页显示总数
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    // generator=search 获取文件详情
    generator: 'search',
    gsrsearch: opts.query,
    gsrnamespace: '6', // File 命名空间
    gsrlimit: String(opts.pageSize),
    gsrsort: 'relevance',
    // 同时请求 list=search 以获取 totalhits
    list: 'search',
    srsearch: opts.query,
    srnamespace: '6',
    srlimit: '1',      // 只需要总数，不需要结果
    srinfo: 'totalhits',
    // 文件详情
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '2048',
    iilimit: String(opts.pageSize),
  })
  if (opts.offset != null) params.set('gsroffset', String(opts.offset))

  const url = `${WIKIMEDIA_API_URL}?${params.toString()}`
  const r = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'User-Agent': `${USER_AGENT} (yishe; contact: admin@1s.design)`,
      Accept: 'application/json',
    },
  })

  if (!r.ok) {
    throw new Error(`Wikimedia 接口返回 HTTP ${r.status}`)
  }
  const data = await r.json()
  const pages = data?.query?.pages
  if (!pages || typeof pages !== 'object') {
    return { items: [], rawItemCount: 0, totalHits: 0, nextOffset: null }
  }

  const items: WikimediaFile[] = Object.values(pages)
    .filter((p: any) => p && typeof p === 'object' && p.pageid)
    .map((p: any) => normalizeFile(p))
    .filter((f: WikimediaFile | null): f is WikimediaFile => f !== null)

  // 按 index 排序，保持相关性顺序
  items.sort((a, b) => {
    const ia = Number((pages as any)[a.id]?.index) || 0
    const ib = Number((pages as any)[b.id]?.index) || 0
    return ia - ib
  })

  // 客户端过滤媒体类型，并保留原始数量用于估算过滤后的结果总数。
  let filteredItems = items
  if (mediaType === 'video') {
    filteredItems = items.filter((f) => f.mime?.startsWith('video/'))
  } else if (mediaType === 'audio') {
    filteredItems = items.filter((f) => f.mime?.startsWith('audio/'))
  } else if (mediaType === 'image') {
    filteredItems = items.filter((f) => f.mime?.startsWith('image/') || f.mime === 'image/svg+xml')
  }

  let nextOffset: number | null = null
  const cont = data?.continue
  if (cont && typeof cont.gsroffset === 'number') {
    nextOffset = cont.gsroffset
  }

  // 从 list=search 的 searchinfo 获取真实总数
  const totalHits = data?.query?.searchinfo?.totalhits || filteredItems.length

  return { items: filteredItems, rawItemCount: items.length, totalHits, nextOffset }
}

function normalizeFile(page: any, searchItem?: any): WikimediaFile | null {
  const id = String(page?.pageid || '')
  const ii = page?.imageinfo?.[0]
  if (!id || !ii || !ii.url) return null

  const mime = ii.mime || ''
  const isVideo = mime.startsWith('video/')
  const isAudio = mime.startsWith('audio/')

  // 图片：优先使用 2048px 高清缩略图，避免下载超大原图
  // 视频：使用 thumburl 作为缩略图，原始文件为 url
  // 音频：没有真实缩略图
  const rawUrl = stripUtm(ii.url)
  const thumbUrl = ii.thumburl ? stripUtm(ii.thumburl) : ''
  const image = isVideo ? rawUrl : (ii.thumburl && Number(ii.width) > 2048) ? thumbUrl : rawUrl
  const thumbnail = isAudio ? '' : thumbUrl
  const ext = ii.extmetadata || {}

  return {
    id,
    title: cleanTitle(page?.title || ''),
    description: stripHtml(firstText(ext.ImageDescription)) || stripHtml(firstText(ext.ObjectName)) || (searchItem?.snippet ? stripHtml(searchItem.snippet) : ''),
    image,
    thumbnail,
    link: page?.title ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/^File:/, ''))}` : '',
    url: page?.descriptionurl || '',
    width: ii.width,
    height: ii.height,
    mime: ii.mime,
    duration: ii.duration || undefined,
    author: stripHtml(firstText(ext.Artist)) || '',
    license: firstText(ext.LicenseShortName) || '',
    date: firstText(ext.DateTimeOriginal) || '',
  }
}

export async function getWikimediaStatus() {
  const site = await checkSiteAvailability(WIKIMEDIA_SITE_URL, { timeoutMs: 6000 })
  return {
    ok: site.ok,
    siteUrl: WIKIMEDIA_SITE_URL,
    siteAvailable: site.ok,
    siteStatus: site.status,
    siteLatencyMs: site.latencyMs,
    siteCheckedAt: site.checkedAt,
    siteError: site.error,
    message: site.ok ? 'Wikimedia Commons 可用' : site.error ? `Wikimedia Commons 不可用: ${site.error}` : 'Wikimedia Commons 不可用',
  }
}

/**
 * 下载图片到本地（Wikimedia 缩略图或原图均为公开直链，无需会话）
 */
export async function downloadWikimediaImage(
  imageUrl: string,
  destDir: string,
  filename?: string
): Promise<string> {
  if (!/^https?:\/\//.test(imageUrl)) {
    throw new Error(`无效的图片地址: ${imageUrl}`)
  }
  const r = await fetchWithRetry(imageUrl, { method: 'GET', headers: { 'User-Agent': USER_AGENT } })
  if (!r.ok) {
    throw new Error(`图片下载失败: HTTP ${r.status}`)
  }
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 100) {
    throw new Error('图片下载异常 (内容过小)')
  }

  const ext = guessExt(r.headers.get('content-type')) || guessExtFromUrl(imageUrl)
  const name = filename || `${Date.now()}${ext}`
  const filePath = join(destDir, name)
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }
  fs.writeFileSync(filePath, buf)
  return filePath
}

/**
 * 下载 Wikimedia 图片并同步到素材库（复用 COS + sticker/create 链路）
 */
export async function syncWikimediaToMaterialLibrary(options: {
  imageUrl: string
  workspaceDir: string
  metadata?: {
    title?: string
    description?: string
    link?: string
    author?: string
    license?: string
    date?: string
    image?: string
    width?: number
    height?: number
    mime?: string
    id?: string
  }
}): Promise<{ ok: boolean; msg?: string; filePath?: string; fileName?: string; fileSize?: number; materialLibraryOk?: boolean }> {
  const { imageUrl, workspaceDir, metadata } = options

  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
    return { ok: false, msg: '请输入有效的 Wikimedia 图片链接' }
  }
  if (!workspaceDir) return { ok: false, msg: '工作目录未设置' }

  try {
    const outputDir = join(workspaceDir, 'wikimedia')
    const title = metadata?.title || `wikimedia-${metadata?.id || Date.now()}`
    const safeName = sanitizeName(title).slice(0, 60) || `wikimedia-${Date.now()}`
    const fileName = `${safeName}_${Date.now()}.jpg`
    const filePath = await downloadWikimediaImage(imageUrl, outputDir, fileName)
    const size = fs.statSync(filePath).size

    const materialResult = await uploadToMaterialLibrary(filePath, fileName, undefined, metadata)
    return {
      ok: materialResult.ok,
      filePath,
      fileName,
      fileSize: size,
      materialLibraryOk: materialResult.ok,
      msg: materialResult.ok ? undefined : materialResult.msg,
    }
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) }
  }
}

/**
 * 上传 COS 并入库素材库（复用通用素材库模块）
 */
async function uploadToMaterialLibrary(
  localPath: string,
  fileName: string,
  _apiBase: string | undefined,
  metadata?: {
    title?: string
    description?: string
    link?: string
    author?: string
    license?: string
    date?: string
    image?: string
    width?: number
    height?: number
    mime?: string
    id?: string
  }
): Promise<{ ok: boolean; msg?: string }> {
  const title = metadata?.title || fileName.replace(/\.(jpg|png|jpeg|webp)$/i, '')
  const description = metadata?.description || ''
  const author = metadata?.author || ''
  const license = metadata?.license || ''
  const link = metadata?.link || ''

  const keywordsEn = [title, author, license, 'wikimedia', 'commons', 'image'].filter(Boolean).join(',')
  const keywordsCn = [title, author].filter(Boolean).join(',')

  return uploadToMaterialLibraryShared(localPath, fileName, {
    category: 'wikimedia',
    group: 'wikimedia',
    source: author ? `Wikimedia Commons - ${author}` : 'commons.wikimedia.org',
    originUrl: metadata?.image || '',
    suffix: 'jpg',
    name: title,
    nameEn: title,
    description,
    descriptionEn: description,
    keywords: keywordsCn,
    keywordsEn,
    colorPalette: '',
    meta: {
      title,
      description,
      link,
      author,
      license,
      date: metadata?.date || '',
      width: metadata?.width ?? null,
      height: metadata?.height ?? null,
      mime: metadata?.mime || null,
      wikimediaId: metadata?.id || null,
      source: 'wikimedia',
    },
  })
}

// ─── 工具函数 ──────────────────────────────────────────────

function stripUtm(url: string): string {
  try {
    const u = new URL(url)
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith('utm_')) u.searchParams.delete(key)
    }
    return u.toString()
  } catch {
    return url
  }
}

function cleanTitle(title: string): string {
  return title.replace(/^File:\s*/i, '').replace(/\.[A-Za-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim()
}

function stripHtml(html: string): string {
  if (!html) return ''
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstText(ext: any): string {
  if (!ext || typeof ext !== 'object') return ''
  return String(ext?.value || '').trim()
}

function sanitizeName(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
}

function guessExt(contentType?: string | null): string {
  if (!contentType) return '.jpg'
  if (contentType.includes('png')) return '.png'
  if (contentType.includes('webp')) return '.webp'
  if (contentType.includes('gif')) return '.gif'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg'
  return '.jpg'
}

function guessExtFromUrl(url: string): string {
  const m = url.match(/\.(png|webp|gif|jpe?g)(\?|$)/i)
  if (!m) return '.jpg'
  const ext = m[1].toLowerCase()
  return ext === 'jpeg' ? '.jpg' : ext === 'jpg' ? '.jpg' : `.${ext}`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── fetch 实现选择与重试 (Electron 优先 net/fetch 走系统栈，更稳) ───

let fetchImplPromise: Promise<typeof fetch> | null = null

async function getFetchImpl(): Promise<typeof fetch> {
  if (!fetchImplPromise) {
    fetchImplPromise = (async () => {
      try {
        const electron = await import('electron')
        const net = electron.net
        if (net && typeof (net as any).fetch === 'function') {
          return (net as any).fetch.bind(net) as typeof fetch
        }
      } catch {
        // 非 Electron 环境
      }
      return fetch
    })()
  }
  return fetchImplPromise
}

/**
 * 带重试的 fetch：Wikimedia 对高频请求会间歇性重置连接 (ECONNRESET)，
 * 重试 3 次并递增退避可显著提高成功率。
 */
async function fetchWithRetry(url: string, init: RequestInit, retries = 4): Promise<Response> {
  const fetchImpl = await getFetchImpl()
  let lastError: any
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetchImpl(url, init)
      // 5xx / 429 也重试
      if (r.status !== 429 && r.status < 500) {
        return r
      }
      lastError = new Error(`HTTP ${r.status}`)
      await r.text().catch(() => {})
    } catch (error: any) {
      lastError = error
    }
    await sleep(Math.min(600 * Math.pow(2, attempt - 1), 4000))
  }
  throw lastError || new Error('fetch failed')
}

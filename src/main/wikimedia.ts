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
import { uploadFileToCos, generateCosKey } from './cos'
import { checkSiteAvailability } from './siteAvailability'

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
  author?: string
  license?: string
  date?: string
}

export interface WikimediaSearchResult {
  success: boolean
  query: string
  count: number
  items: WikimediaFile[]
  links: string[]
  nextOffset: number | null
  error?: string
}

interface WikimediaSearchOptions {
  pageSize?: number
  limit?: number
  imageOnly?: boolean
  offset?: number | null
}

/**
 * 搜索 Wikimedia Commons 图片。仅保留图片类型 (mime 以 image/ 开头)。
 */
export async function searchWikimedia(
  query: string,
  options: WikimediaSearchOptions = {}
): Promise<WikimediaSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], nextOffset: null, error: '缺少搜索关键词' }
  }

  const limit = Math.min(Math.max(Number(options.limit) || 25, 1), 250)
  const imageOnly = options.imageOnly ?? true

  try {
    const items: WikimediaFile[] = []
    const seen = new Set<string>()
    let offset: number | null = options.offset ?? null

    while (items.length < limit) {
      const pageSize = Math.min(Math.max(Number(options.pageSize) || 25, 1), 50)
      const batch = await fetchSearchPage({ query: keyword, pageSize, offset })

      if (!batch.items.length) {
        break
      }

      for (const file of batch.items) {
        if (imageOnly && file.mime && !file.mime.startsWith('image/')) continue
        if (seen.has(file.id)) continue
        seen.add(file.id)
        items.push(file)
        if (items.length >= limit) break
      }

      offset = batch.nextOffset
      if (offset == null) break
      await sleep(500)
    }

    const finalItems = (imageOnly ? items.filter((f) => !f.mime || f.mime.startsWith('image/')) : items).slice(0, limit)
    return {
      success: true,
      query: keyword,
      count: finalItems.length,
      items: finalItems,
      links: finalItems.map((f) => f.image).filter(Boolean),
      nextOffset: offset,
    }
  } catch (error: any) {
    return {
      success: false,
      query: keyword,
      count: 0,
      items: [],
      links: [],
      nextOffset: null,
      error: error?.message || String(error),
    }
  }
}

interface SearchPageResult {
  items: WikimediaFile[]
  nextOffset: number | null
}

async function fetchSearchPage(opts: {
  query: string
  pageSize: number
  offset?: number | null
}): Promise<SearchPageResult> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    utilityProps: '', // placeholder avoid trailing equal
    gsrsearch: opts.query,
    gsrnamespace: '6', // File 命名空间
    gsrlimit: String(opts.pageSize),
    gsrsort: 'relevance',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '400',
    iilimit: String(opts.pageSize),
  })
  params.delete('utilityProps')
  if (opts.offset != null) params.set('gsroffset', String(opts.offset))

  // 避免 URLSearchParams 编码 `|` 造成兼容问题，用原始查询串
  const rawQuery = [
    'action=query',
    'format=json',
    'generator=search',
    `gsrsearch=${encodeURIComponent(opts.query)}`,
    'gsrnamespace=6',
    `gsrlimit=${opts.pageSize}`,
    'gsrsort=relevance',
    'prop=imageinfo',
    'iiprop=url|size|mime|extmetadata',
    'iiurlwidth=400',
    `iilimit=${opts.pageSize}`,
    ...(opts.offset != null ? [`gsroffset=${opts.offset}`] : []),
  ].join('&')

  const url = `${WIKIMEDIA_API_URL}?${rawQuery}`
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
    return { items: [], nextOffset: null }
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

  let nextOffset: number | null = null
  const cont = data?.continue
  if (cont && typeof cont.gsroffset === 'number') {
    nextOffset = cont.gsroffset
  }

  return { items, nextOffset }
}

function normalizeFile(page: any): WikimediaFile | null {
  const id = String(page?.pageid || '')
  const ii = page?.imageinfo?.[0]
  if (!id || !ii || !ii.url) return null

  const image = stripUtm(ii.url)
  const thumbnail = ii.thumburl ? stripUtm(ii.thumburl) : image
  const ext = ii.extmetadata || {}

  return {
    id,
    title: cleanTitle(page?.title || ''),
    description: stripHtml(firstText(ext.ImageDescription)) || stripHtml(firstText(ext.ObjectName)) || '',
    image,
    thumbnail,
    link: page?.title ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/^File:/, ''))}` : '',
    url: page?.descriptionurl || '',
    width: ii.width,
    height: ii.height,
    mime: ii.mime,
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
      ok: true,
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
 * 上传 COS 并入库素材库（仿 pinterest.ts 的 uploadToMaterialLibrary）
 */
async function uploadToMaterialLibrary(
  localPath: string,
  fileName: string,
  apiBase: string = 'https://api.1s.design/api',
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
  const cosKey = await generateCosKey({ category: 'wikimedia', filename: fileName })
  const cosResult = await uploadFileToCos(localPath, cosKey)
  if (!cosResult.ok || !cosResult.url) {
    return { ok: false, msg: 'msg' in cosResult ? (cosResult.msg as string) : 'COS 上传失败' }
  }

  try {
    const { getTokenValue } = await getServerModule()
    const token = getTokenValue()

    const title = metadata?.title || fileName.replace(/\.(jpg|png|jpeg|webp)$/i, '')
    const description = metadata?.description || ''
    const author = metadata?.author || ''
    const license = metadata?.license || ''
    const link = metadata?.link || ''

    const keywordsEn = [title, author, license, 'wikimedia', 'commons', 'image'].filter(Boolean).join(',')
    const keywordsCn = [title, author].filter(Boolean).join(',')

    const postData = JSON.stringify({
      url: cosResult.url,
      key: cosResult.key,
      suffix: 'jpg',
      originUrl: metadata?.image || '',
      source: author ? `Wikimedia Commons - ${author}` : 'commons.wikimedia.org',
      group: 'wikimedia',
      isPublic: true,
      isTexture: false,
      isCustom: false,
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
        collectedAt: new Date().toISOString(),
      },
    })

    const apiUrl = new URL(`${apiBase}/sticker/create`)
    const req = await fetch(apiUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: postData,
    })

    if (req.status >= 400) {
      return { ok: false, msg: `素材库接口 HTTP ${req.status}` }
    }
    const result = await req.json()
    return result?.code === 200 || result?.ok ? { ok: true } : { ok: false, msg: result?.message || '素材库入库失败' }
  } catch (error: any) {
    return { ok: false, msg: `素材库入库失败: ${error?.message || String(error)}` }
  }
}

type ServerModule = typeof import('./server')
let serverModulePromise: Promise<ServerModule> | null = null
function getServerModule() {
  if (!serverModulePromise) {
    serverModulePromise = import('./server')
  }
  return serverModulePromise
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
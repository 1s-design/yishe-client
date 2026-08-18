/**
 * Pinterest 非官方接口核心能力
 * 纯 Node 原生 fetch 直连 Pinterest 内部资源接口 (BaseSearchResource)，
 * 无需登录、无需浏览器、无需外部二进制。支持系统代理 (Pinterest 需代理访问)。
 * 提供：图搜 / 单图下载 / 同步素材库
 */
import fs from 'fs'
import { join } from 'path'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

const PINTEREST_SITE_URL = 'https://www.pinterest.com/'
const SEARCH_RESOURCE = '/resource/BaseSearchResource/get/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface PinterestPin {
  id: string
  title: string
  description: string
  image: string
  thumbnail: string
  link: string
  url: string
  boardName: string
  pinner: string
  width?: number
  height?: number
  isVideo: boolean
}

export interface PinterestSearchResult {
  success: boolean
  query: string
  count: number
  items: PinterestPin[]
  links: string[]
  bookmark: string | null
  error?: string
}

interface PinSearchOptions {
  query: string
  scope?: 'pins' | 'videos' | 'boards'
  pageSize?: number
  limit?: number
  imageOnly?: boolean
  bookmark?: string | null
}

// 每个 Pinterest 请求独立会话，不共享会话 (避免会话污染/限流连带)
export async function searchPinterest(
  query: string,
  options: Partial<PinSearchOptions> = {}
): Promise<PinterestSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], bookmark: null, error: '缺少搜索关键词' }
  }

  const scope = options.scope || 'pins'
  const limit = Math.min(Math.max(Number(options.limit) || 25, 1), 250)
  const imageOnly = options.imageOnly ?? true

  try {
    const items: PinterestPin[] = []
    const seen = new Set<string>()
    let bookmark: string | null = options.bookmark || null

    while (items.length < limit) {
      const pageSize = Math.min(Math.max(Number(options.pageSize) || 25, 1), 250)
      const batch = await fetchSearchPage({
        query: keyword,
        scope,
        pageSize,
        bookmark,
      })

      if (!batch.items.length) {
        break
      }

      for (const pin of batch.items) {
        if (imageOnly && pin.isVideo) continue
        if (seen.has(pin.id)) continue
        seen.add(pin.id)
        items.push(pin)
        if (items.length >= limit) break
      }

      bookmark = batch.bookmark
      if (!bookmark || bookmark === '-end-') break
      await sleep(800)
    }

    const finalItems = items.slice(0, limit)
    return {
      success: true,
      query: keyword,
      count: finalItems.length,
      items: finalItems,
      links: finalItems.map((p) => p.image).filter(Boolean),
      bookmark,
    }
  } catch (error: any) {
    return {
      success: false,
      query: keyword,
      count: 0,
      items: [],
      links: [],
      bookmark: null,
      error: error?.message || String(error),
    }
  }
}

interface SearchPageResult {
  items: PinterestPin[]
  bookmark: string | null
}

async function fetchSearchPage(opts: {
  query: string
  scope: string
  pageSize: number
  bookmark?: string | null
}): Promise<SearchPageResult> {
  const client = new PinterestClient()
  return client.searchPage(opts)
}

/**
 * 每个实例维护自己的 cookie 会话 (csrftoken / _pinterest_sess)
 */
export class PinterestClient {
  private cookies: Record<string, string> = {}
  private seeded = false

  async seed() {
    if (this.seeded) return
    const r = await this.request(PINTEREST_SITE_URL, { method: 'GET' })
    const headerCookies = parseCookies(getSetCookies(r.headers))
    const sessionCookies = await getElectronSessionCookies(PINTEREST_SITE_URL)
    // Electron net.fetch 可能不暴露 Set-Cookie 响应头，此时从 session cookie 存储兜底
    this.cookies = { ...sessionCookies, ...headerCookies }
    if (!this.cookies['csrftoken']) {
      throw new Error('未获取到 Pinterest 会话 (csrftoken 为空)，可能被风控或需要代理')
    }
    this.seeded = true
  }

  async searchPage(opts: {
    query: string
    scope: string
    pageSize: number
    bookmark?: string | null
  }): Promise<SearchPageResult> {
    await this.seed()

    const sourceUrl = `/search/pins/?q=${encodeURIComponent(opts.query)}`
    const options: Record<string, any> = {
      query: opts.query,
      scope: opts.scope,
      page_size: opts.pageSize,
    }
    if (opts.bookmark) {
      options.bookmarks = [opts.bookmark]
    }

    const payload = JSON.stringify({ options, context: {} })
    const body = `source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(payload)}`

    const headers: Record<string, string> = {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': this.cookies['csrftoken'] || '',
      'X-Pinterest-Source-Url': sourceUrl,
      Referer: `https://www.pinterest.com${sourceUrl}`,
    }

    let r = await this.request(`https://www.pinterest.com${SEARCH_RESOURCE}`, {
      method: 'POST',
      headers,
      body,
    })
    this.mergeCookies(getSetCookies(r.headers))

    // CSRF 失效 (Bad CSRF token)：重置会话重试一次
    if (r.status === 403 && /bad csrf/i.test(await r.clone().text())) {
      this.resetSession()
      await this.seed()
      const retryHeaders: Record<string, string> = {
        ...headers,
        'X-CSRFToken': this.cookies['csrftoken'] || '',
      }
      r = await this.request(`https://www.pinterest.com${SEARCH_RESOURCE}`, {
        method: 'POST',
        headers: retryHeaders,
        body,
      })
      this.mergeCookies(getSetCookies(r.headers))
    }

    const data = await parseJsonResponse(r)
    const resource = data?.resource_response || {}
    const results = resource?.data?.results
    if (!Array.isArray(results)) {
      if (r.status === 429) {
        throw new Error(`Pinterest 限流 (429)，请稍后重试或增加间隔`)
      }
      if (r.status === 403) {
        throw new Error(`Pinterest 拒绝访问 (403): ${data?.message || 'CSRF 校验失败或账号被风控'}`)
      }
      if (r.status >= 400) {
        throw new Error(`Pinterest 接口返回 ${r.status}: ${(data?.message || resource?.message) || 'Invalid Resource Request'}`)
      }
      throw new Error('Pinterest 返回数据格式异常 (可能被风控，请稍后重试)')
    }

    const items: PinterestPin[] = results
      .filter((pin: any) => pin && typeof pin === 'object')
      .map((pin: any) => normalizePin(pin))
      .filter((pin: PinterestPin | null): pin is PinterestPin => pin !== null)

    let bookmark: string | null = null
    const bk = resource?.bookmark
    if (Array.isArray(bk)) bookmark = bk[0] || null
    else if (typeof bk === 'string') bookmark = bk

    return { items, bookmark }
  }

  resetSession() {
    this.cookies = {}
    this.seeded = false
  }

  /** 下载图片到本地 */
  async downloadImage(imageUrl: string, destDir: string, filename?: string): Promise<string> {
    if (!/^https?:\/\//.test(imageUrl)) {
      throw new Error(`无效的图片地址: ${imageUrl}`)
    }
    await this.seed()
    const r = await this.request(imageUrl, { method: 'GET' })
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

  private mergeCookies(setCookie: string[]) {
    Object.assign(this.cookies, parseCookies(setCookie))
  }

  private async request(url: string, init: { method: string; headers?: Record<string, string>; body?: string }) {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      ...(init.headers || {}),
    }
    const cookieStr = Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
    if (cookieStr) {
      headers['Cookie'] = cookieStr
    }

    const fetchImpl = await getFetchImpl()
    return fetchImpl(url, { ...init, headers } as RequestInit)
  }
}

function normalizePin(pin: any): PinterestPin | null {
  const images = pin?.images || {}
  const orig = images?.orig || {}
  const thumb = images?.['736x'] || images?.['474x'] || {}
  const id = String(pin?.id || '')
  const image = orig?.url || thumb?.url || ''
  if (!id || !image) return null

  return {
    id,
    title: pin?.title || pin?.grid_title || '',
    description: pin?.description || '',
    image,
    thumbnail: thumb?.url || '',
    link: pin?.link || '',
    url: pin?.url || '',
    boardName: pin?.board?.name || '',
    pinner: pin?.pinner?.username || '',
    width: orig?.width,
    height: orig?.height,
    isVideo: !!(pin?.video || pin?.videos),
  }
}

export async function getPinterestStatus() {
  const site = await checkSiteAvailability(PINTEREST_SITE_URL, { timeoutMs: 6000 })
  return {
    ok: site.ok,
    siteUrl: PINTEREST_SITE_URL,
    siteAvailable: site.ok,
    siteStatus: site.status,
    siteLatencyMs: site.latencyMs,
    siteCheckedAt: site.checkedAt,
    siteError: site.error,
    message: site.ok ? 'Pinterest 可用' : site.error ? `Pinterest 不可用: ${site.error}` : 'Pinterest 不可用',
  }
}

/**
 * 下载 Pinterest 图片并同步到素材库
 * 复用 COS 上传 + 素材库 sticker/create 接口 (与 googleArt 同链路)
 */
export async function syncPinterestToMaterialLibrary(options: {
  imageUrl: string
  workspaceDir: string
  metadata?: {
    title?: string
    description?: string
    link?: string
    boardName?: string
    pinner?: string
    image?: string
    width?: number
    height?: number
    id?: string
    isVideo?: boolean
  }
}): Promise<{ ok: boolean; msg?: string; filePath?: string; fileName?: string; fileSize?: number; materialLibraryOk?: boolean }> {
  const { imageUrl, workspaceDir, metadata } = options

  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
    return { ok: false, msg: '请输入有效的 Pinterest 图片链接' }
  }
  if (!workspaceDir) return { ok: false, msg: '工作目录未设置' }

  try {
    const client = new PinterestClient()
    const outputDir = join(workspaceDir, 'pinterest')
    const title = metadata?.title || `pinterest-${metadata?.id || Date.now()}`
    const safeName = sanitizeName(title).slice(0, 60) || `pinterest-${Date.now()}`
    const fileName = `${safeName}_${Date.now()}.jpg`
    const filePath = await client.downloadImage(imageUrl, outputDir, fileName)
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
    boardName?: string
    pinner?: string
    image?: string
    width?: number
    height?: number
    id?: string
    isVideo?: boolean
  }
): Promise<{ ok: boolean; msg?: string }> {
  const title = metadata?.title || fileName.replace(/\.(jpg|png|jpeg|webp)$/i, '')
  const description = metadata?.description || ''
  const boardName = metadata?.boardName || ''
  const pinner = metadata?.pinner || ''
  const link = metadata?.link || ''

  const keywordsEn = [title, boardName, pinner, 'pinterest', 'image'].filter(Boolean).join(',')
  const keywordsCn = [title, boardName, pinner].filter(Boolean).join(',')

  return uploadToMaterialLibraryShared(localPath, fileName, {
    category: 'pinterest',
    group: 'pinterest',
    source: boardName ? `Pinterest - ${boardName}` : 'pinterest.com',
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
      boardName,
      pinner,
      width: metadata?.width ?? null,
      height: metadata?.height ?? null,
      pinterestId: metadata?.id || null,
      isVideo: metadata?.isVideo ?? null,
      source: 'pinterest',
    },
  })
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

function parseCookies(setCookie: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of setCookie) {
    const [pair] = c.split(';')
    const eq = pair?.indexOf('=')
    if (!pair || eq === -1) continue
    const key = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (key && value !== '') out[key] = value
  }
  return out
}

/**
 * 跨环境读取 Set-Cookie 响应头。
 * 标准 Headers.getSetCookie() 仅在较新 Node/Undici 可用；
 * Electron net.fetch 及部分实现只有 get('set-cookie') (可能被逗号合并)。
 */
function getSetCookies(headers: Headers | any): string[] {
  try {
    if (typeof headers?.getSetCookie === 'function') {
      const list = headers.getSetCookie()
      if (Array.isArray(list)) return list
    }
  } catch {
    // ignore
  }
  try {
    const raw = headers?.get?.('set-cookie')
    if (typeof raw === 'string' && raw) return [raw]
  } catch {
    // ignore
  }
  try {
    const raw = headers?.raw?.('set-cookie')
    if (Array.isArray(raw)) return raw
  } catch {
    // ignore
  }
  return []
}

/**
 * Electron 环境下从 session cookie 存储读取 Pinterest 域名 cookie。
 * Chromium 的 net.fetch 遵循 Fetch 规范禁止 JS 读取 Set-Cookie 响应头，
 * 但 Set-Cookie 会被自动写入 session 的 cookie 管理器，从这里读取最可靠。
 * 非 Electron / 无 session 时返回空对象。
 */
async function getElectronSessionCookies(url: string): Promise<Record<string, string>> {
  try {
    const { session } = await import('electron')
    const s = session?.defaultSession
    if (!s || typeof s.cookies?.get !== 'function') return {}
    const list = await s.cookies.get({ url })
    const out: Record<string, string> = {}
    for (const c of Array.isArray(list) ? list : []) {
      if (c?.name && c.value !== undefined) out[c.name] = c.value
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 安全解析响应 JSON；非 JSON 时给出可读错误 (Pinterest 会返回 "Bad CSRF token" 纯文本)。
 */
async function parseJsonResponse(r: Response): Promise<any> {
  const contentType = r.headers?.get?.('content-type') || ''
  if (contentType.includes('application/json')) {
    return r.json()
  }
  const text = await r.text()
  try {
    return JSON.parse(text)
  } catch {
    if (/bad csrf/i.test(text)) {
      throw new Error(`Pinterest CSRF 校验失败 (HTTP ${r.status})，请稍后重试`)
    }
    throw new Error(`Pinterest 接口返回非 JSON 数据 (HTTP ${r.status}): ${text.slice(0, 200) || '空响应'}`)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── fetch 实现选择 (Electron 环境优先 net.fetch，自动走系统代理) ───

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

import { spawn } from 'child_process'
import fs from 'fs'
import { app, session } from 'electron'
import { join, resolve } from 'path'
import { uploadFileToCos, generateCosKey } from './cos'
import https from 'https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { URL } from 'url'
import { checkSiteAvailability } from './siteAvailability'

type ServerModule = typeof import('./server')

let serverModulePromise: Promise<ServerModule> | null = null

function getServerModule() {
  if (!serverModulePromise) {
    serverModulePromise = import('./server')
  }

  return serverModulePromise
}

interface ZoomLevel {
  idx: number
  label: string
  width: number
  height: number
  tiles: number
}

const GOOGLE_ART_SITE_URL = 'https://www.google.com/'

function getPlatformBinaryName(platform: NodeJS.Platform): string | null {
  const binaryNames: Record<string, string> = {
    win32: 'dezoomify-rs-win.exe',
    darwin: 'dezoomify-rs-mac',
    linux: 'dezoomify-rs-linux'
  }

  return binaryNames[platform] || null
}

export async function getGoogleArtStatus() {
  const binary = resolveBinaryPath()
  const platformName =
    process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : process.platform
  const supported = ['win32', 'darwin', 'linux'].includes(process.platform)
  const site = await checkSiteAvailability(GOOGLE_ART_SITE_URL, { timeoutMs: 5000 })
  const binaryExists = !!binary
  const available = site.ok
  let message = ''

  if (!site.ok) {
    message = site.error ? `Google Art 网站不可用: ${site.error}` : 'Google Art 网站不可用'
  } else if (!binaryExists) {
    message = supported ? 'Google Art 可用，但二进制缺失' : `当前平台 ${platformName} 不支持 Google Art`
  } else {
    message = 'Google Art 可用'
  }

  return {
    ok: available,
    platform: process.platform,
    platformName,
    supported,
    binaryExists,
    binaryPath: binary,
    siteUrl: GOOGLE_ART_SITE_URL,
    siteAvailable: site.ok,
    siteStatus: site.status,
    siteLatencyMs: site.latencyMs,
    siteCheckedAt: site.checkedAt,
    siteError: site.error,
    message
  }
}

function resolveBinaryPath(): string | null {
  const binaryName = getPlatformBinaryName(process.platform)
  if (!binaryName) {
    return null
  }

  // 优先按内部 google-art 平台目录查找，同时兼容历史平铺目录和旧 plugin 目录。
  const candidateRelatives = [
    ['resources', 'google-art', process.platform, binaryName],
    ['resources', 'google-art', binaryName],
    ['resources', 'plugin', process.platform, binaryName],
    ['resources', 'plugin', binaryName],
    ['resources', binaryName]
  ]

  const candidateAbs = candidateRelatives.flatMap((parts) => {
    const rel = join(...parts)
    return [
      resolve(__dirname, '../../', rel), // dev
      join(process.resourcesPath, rel), // prod
      join(app.getAppPath(), rel) // fallback
    ]
  })

  for (const p of candidateAbs) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function sanitizeName(name: string) {
  return name.replace(/[<>:"/\\|?*]/g, '_')
}

export async function getGoogleArtZooms(
  url: string
): Promise<{ ok: boolean; zooms?: ZoomLevel[]; msg?: string }> {
  if (!url || !/^https?:\/\/(www\.)?artsandculture\.google\.com\//.test(url)) {
    return { ok: false, msg: '请输入有效的 Google Arts 链接（以 artsandculture.google.com 开头）' }
  }

  const binary = resolveBinaryPath()
  if (!binary) {
    const platformName = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : process.platform
    const binaryName = getPlatformBinaryName(process.platform) || 'dezoomify-rs'
    return { ok: false, msg: `缺少 ${binaryName}，请放置在 resources/google-art/${process.platform}/ (当前平台: ${platformName})` }
  }

  return new Promise((resolvePromise) => {
    const child = spawn(binary, [url], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let zooms: ZoomLevel[] = []

    const regex = /^\s*(\d+)\.\s*(.+)\(\s*(\d+)\s*x\s*(\d+)\s*pixels,\s*(\d+)\s*tiles\)/gm

    const tryParse = () => {
      const list: ZoomLevel[] = []
      let m: RegExpExecArray | null
      while ((m = regex.exec(output))) {
        list.push({
          idx: Number(m[1]),
          label: m[2].trim(),
          width: Number(m[3]),
          height: Number(m[4]),
          tiles: Number(m[5])
        })
      }
      if (list.length) zooms = list
    }

    const timer = setTimeout(() => {
      tryParse()
      child.kill()
      resolvePromise(zooms.length ? { ok: true, zooms } : { ok: false, msg: '未能获取分辨率' })
    }, 9000)

    child.stdout.on('data', (buf) => {
      output += buf.toString()
      if (/Which level do you want to download\?/i.test(output)) {
        tryParse()
        if (zooms.length) {
          clearTimeout(timer)
          child.kill()
          resolvePromise({ ok: true, zooms })
        }
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolvePromise({ ok: false, msg: err.message })
    })

    child.on('close', () => {
      clearTimeout(timer)
      tryParse()
      resolvePromise(zooms.length ? { ok: true, zooms } : { ok: false, msg: '未能获取分辨率' })
    })
  })
}

async function uploadToMaterialLibrary(
  localPath: string,
  fileName: string,
  apiBase: string = 'https://api.1s.design/api',
  originUrl?: string,
  metadata?: {
    title?: string;
    artist?: string;
    date?: string;
    institution?: string;
    color?: string;        // 主色调 hex
    thumbnail?: string;    // 缩略图 URL
    aspectRatio?: number;  // 宽高比
    hasPixels?: boolean;   // 是否有全景图
    id?: string;           // Google Art 作品 ID
  }
): Promise<{ ok: boolean; msg?: string }> {
  // 1. 先上传到 COS（使用新的分类路径）
  const cosKey = await generateCosKey({
    category: 'google-art',
    filename: fileName
  })
  const cosResult = await uploadFileToCos(localPath, cosKey)
  
  if (!cosResult.ok) {
    const errMsg = 'msg' in cosResult ? cosResult.msg : 'COS 上传失败'
    return { ok: false, msg: errMsg }
  }
  if (!cosResult.url) {
    return { ok: false, msg: 'COS 上传失败' }
  }

  // 2. 调用素材库 API（改为直接入库到贴纸素材库）
  try {
    const apiUrl = new URL(`${apiBase}/sticker/create`)
    const { getTokenValue } = await getServerModule()
    const token = getTokenValue()
    
    const title = metadata?.title || fileName.replace(/\.jpg$/, '')
    const artist = metadata?.artist || ''
    const date = metadata?.date || ''
    const institution = metadata?.institution || ''
    const color = metadata?.color || ''

    // 中文名称内容
    const nameCn = title  // 如果将来有中文翻译可修改 name
    // 描述：作者 - 年代 (展馆)
    const descriptionStr = [artist, date, institution].filter(Boolean).join(' · ')
    // 英文描述
    const descriptionEnStr = [
      artist ? `Artist: ${artist}` : '',
      date ? `Date: ${date}` : '',
      institution ? `Collection: ${institution}` : '',
    ].filter(Boolean).join(' | ')
    // 关键词展开：名称 + 作者 + 展馆 + impressionism
    const keywordsCn = [title, artist, institution].filter(Boolean).join(',')
    const keywordsEn = [
      title, artist, institution,
      'google arts culture', 'fine art', 'painting',
    ].filter(Boolean).join(',')
    // 色板：把 API 返回的主色调存为 colorPalette
    const colorPalette = color ? color : ''

    const postData = JSON.stringify({
      // 基础字段
      url: cosResult.url,
      key: cosResult.key,
      suffix: 'jpg',
      originUrl: originUrl || '',
      source: institution ? `Google Arts & Culture - ${institution}` : 'artsandculture.google.com',
      group: 'google-art',
      isPublic: true,
      isTexture: false,
      isCustom: false,
      // 名称（中文写作品名，英文同样写进去）
      name: nameCn,
      nameEn: title,
      // 描述
      description: descriptionStr,
      descriptionEn: descriptionEnStr,
      // 关键词
      keywords: keywordsCn,
      keywordsEn: keywordsEn,
      // 色板
      colorPalette,
      // 完整元数据 (JSON)
      meta: {
        title,
        artist,
        date,
        institution,
        color,
        thumbnail: metadata?.thumbnail || null,
        aspectRatio: metadata?.aspectRatio ?? null,
        hasPixels: metadata?.hasPixels ?? null,
        googleArtId: metadata?.id || null,
        source: 'google_arts_culture',
        collectedAt: new Date().toISOString(),
      },
    })

    const options = {
      hostname: apiUrl.hostname,
      port: apiUrl.port || 443,
      path: apiUrl.pathname + apiUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        // 贴纸创建接口需要登录态，这里复用主进程中保存的 Token
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      rejectUnauthorized: false
    }

    return new Promise((resolve) => {
      const req = https.request(options, (res: any) => {
        let data = ''
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString()
        })
        res.on('end', () => {
          try {
            // 检查 HTTP 状态码
            if (res.statusCode && res.statusCode >= 400) {
              resolve({ ok: false, msg: `HTTP ${res.statusCode}: 请求失败` })
              return
            }
            
            const result = JSON.parse(data)
            // 后端使用 TransformInterceptor，响应格式为 { code: 0, data: ..., message: ..., status: true }
            if (result.code === 0 && result.status === true) {
              resolve({ ok: true })
            } else {
              resolve({ ok: false, msg: result.message || result.msg || '素材库保存失败' })
            }
          } catch (e) {
            resolve({ ok: false, msg: '素材库 API 响应解析失败' })
          }
        })
      })

      req.on('error', (err: Error) => {
        resolve({ ok: false, msg: `素材库 API 请求失败: ${err.message}` })
      })

      req.write(postData)
      req.end()
    })
  } catch (error: any) {
    return { ok: false, msg: `上传到素材库失败: ${error.message}` }
  }
}

export async function syncGoogleArtToMaterialLibrary(options: {
  url: string
  zoomLevel?: number
  qualityPreference?: 'max' | 'min'
  workspaceDir: string
  metadata?: {
    title?: string;
    artist?: string;
    date?: string;
    institution?: string;
    color?: string;
    thumbnail?: string;
    aspectRatio?: number;
    hasPixels?: boolean;
    id?: string;
  }
}): Promise<{ ok: boolean; msg?: string; filePath?: string; fileName?: string; fileSize?: number; materialLibraryOk?: boolean }> {
  const { url, workspaceDir, metadata, qualityPreference = 'min' } = options
  let zoomLevel = options.zoomLevel

  if (!url || !/^https?:\/\/(www\.)?artsandculture\.google\.com\//.test(url)) {
    return { ok: false, msg: '请输入有效的 Google Arts 链接（以 artsandculture.google.com 开头）' }
  }
  if (!workspaceDir) return { ok: false, msg: '工作目录未设置' }

  // 若未指定具体数字 zoomLevel，按 qualityPreference (max/min) 自动分析并选择缩放层级
  if (typeof zoomLevel !== 'number') {
    try {
      const zoomRes = await getGoogleArtZooms(url)
      if (zoomRes.ok && zoomRes.zooms && zoomRes.zooms.length > 0) {
        const sorted = [...zoomRes.zooms].sort((a, b) => (a.width * a.height) - (b.width * b.height))
        if (qualityPreference === 'min') {
          zoomLevel = sorted[0].idx
        } else {
          zoomLevel = sorted[sorted.length - 1].idx
        }
      } else {
        zoomLevel = 1
      }
    } catch {
      zoomLevel = 1
    }
  }

  const binary = resolveBinaryPath()
  if (!binary) {
    const platformName = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : process.platform
    const binaryName = getPlatformBinaryName(process.platform) || 'dezoomify-rs'
    return { ok: false, msg: `缺少 ${binaryName}，请放置在 resources/google-art/${process.platform}/ (当前平台: ${platformName})` }
  }

  const nameMatch = url.match(/\/asset\/([^/]+)/)
  const rawName = nameMatch ? decodeURIComponent(nameMatch[1]) : `google-art-${Date.now()}`
  const safeName = sanitizeName(rawName) || `google-art-${Date.now()}`

  const outputDir = join(workspaceDir, 'google-art')
  ensureDir(outputDir)
  const fileName = `${safeName}_${Date.now()}.jpg`
  const outputPath = join(outputDir, fileName)

  return new Promise((resolvePromise) => {
    const args = ['--zoom-level', String(zoomLevel), url, outputPath]
    const child = spawn(binary, args, { stdio: 'inherit' })

    child.on('close', async (code) => {
      if (code !== 0) {
        resolvePromise({ ok: false, msg: '下载失败，请稍后重试' })
        return
      }
      let size = 0
      try {
        const stat = fs.statSync(outputPath)
        size = stat.size
      } catch {}

      const materialResult = await uploadToMaterialLibrary(outputPath, fileName, undefined, url, metadata)
      resolvePromise({
        ok: materialResult.ok,
        filePath: outputPath,
        fileName,
        fileSize: size,
        materialLibraryOk: materialResult.ok,
        msg: materialResult.ok ? undefined : materialResult.msg
      })
    })

    child.on('error', (err) => {
      resolvePromise({ ok: false, msg: err.message })
    })
  })
}


// ─── Google Arts API 搜索（无需浏览器）───

const GOOGLE_ART_API = 'https://artsandculture.google.com/api/search'
const GOOGLE_ART_IMAGES_API = 'https://artsandculture.google.com/api/assets/images'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface GoogleArtSearchItem {
  id: string
  title: string
  artist: string | null
  thumbnail: string | null
  url: string
  color: string | null
  aspectRatio: number | null
  hasPixels: boolean
  institution: string | null
}

interface GoogleArtSearchResult {
  success: boolean
  query: string
  page: number
  total: number
  count: number
  items: GoogleArtSearchItem[]
  links: string[]
  nextCursor: string | null
  error?: string
}

export async function searchGoogleArts(
  payload:
    | {
        keyword?: string
        page?: number
        hl?: string
        maxCount?: number
        cursor?: string | null
      }
    | string,
  pageParam = 1,
  hlParam = 'en'
): Promise<GoogleArtSearchResult> {
  let keyword = ''
  let page = pageParam
  let hl = hlParam
  let maxCount: number | undefined | null = undefined
  let cursor: string | null = null

  if (typeof payload === 'string') {
    keyword = payload
  } else if (payload && typeof payload === 'object') {
    keyword = payload.keyword || ''
    page = payload.page ?? pageParam
    hl = payload.hl ?? hlParam
    maxCount = payload.maxCount
    cursor = payload.cursor ?? null
  }

  keyword = keyword.trim() || 'impressionism'

  console.log(`[GoogleArts] 搜索请求: keyword="${keyword}", page=${page}, maxCount=${maxCount}, cursor=${cursor ? 'yes' : 'no'}`)

  try {
    // 传入 cursor 且目标页 > 1：优先用 /api/assets/images 拿指定游标对应的批次（真分页）
    if (cursor && page > 1) {
      try {
        return await fetchImagesPage(keyword, hl, cursor, page, maxCount)
      } catch (newErr) {
        console.warn(`[GoogleArts] assets/images 翻页失败，回退旧方式: ${newErr?.message || String(newErr)}`)
        return fetchPage(keyword, hl, cursor, page, maxCount)
      }
    }

    // 否则从第一页开始逐页前进（第一页用 /api/search 获取初始 cursor）
    let currentCursor: string | null = null
    for (let i = 0; i < page - 1; i++) {
      const result =
        i === 0
          ? await fetchPage(keyword, hl, null, i + 1, null)
          : await (async () => {
              try {
                return await fetchImagesPage(keyword, hl, currentCursor, i + 1, maxCount ?? 24)
              } catch (newErr) {
                console.warn(`[GoogleArts] assets/images 翻页失败，回退旧方式: ${newErr?.message || String(newErr)}`)
                return fetchPage(keyword, hl, currentCursor, i + 1, null)
              }
            })()
      currentCursor = result.nextCursor
      if (!currentCursor) {
        return { success: true, query: keyword, page, total: 0, count: 0, items: [], links: [], nextCursor: null }
      }
    }

    // 目标页：第一页走 /api/search，后续页优先 /api/assets/images
    if (page === 1) {
      return fetchPage(keyword, hl, null, page, maxCount)
    }
    try {
      return await fetchImagesPage(keyword, hl, currentCursor, page, maxCount)
    } catch (newErr) {
      console.warn(`[GoogleArts] assets/images 翻页失败，回退旧方式: ${newErr?.message || String(newErr)}`)
      return fetchPage(keyword, hl, currentCursor, page, maxCount)
    }
  } catch (error: any) {
    console.error(`[GoogleArts] 搜索失败: ${error?.message || String(error)}`)
    return { success: false, query: keyword, page, total: 0, count: 0, items: [], links: [], nextCursor: null, error: error?.message || String(error) }
  }
}

/**
 * 获取有效代理 URL（优先环境变量，其次 Electron 系统代理解析）
 * 使用 session.defaultSession.resolveProxy() 可感知 macOS 系统代理/VPN/PAC 文件
 */
async function getEffectiveProxyUrl(targetUrl: string): Promise<string | null> {
  // 1. 先查环境变量
  const envProxy =
    process.env.ALL_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.all_proxy ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    ''
  if (envProxy.trim()) {
    return envProxy.trim()
  }

  // 2. 使用 Electron session 解析系统代理（感知 macOS 系统设置 / VPN / PAC）
  try {
    const proxyInfo = await session.defaultSession.resolveProxy(targetUrl)
    // proxyInfo 格式: "PROXY host:port" | "SOCKS5 host:port" | "DIRECT"
    if (proxyInfo && !proxyInfo.startsWith('DIRECT')) {
      const parts = proxyInfo.trim().split(/\s+/)
      const scheme = parts[0]?.toUpperCase()
      const hostPort = parts[1]
      if (hostPort) {
        const prefix = scheme === 'SOCKS5' ? 'socks5://' : scheme === 'SOCKS4' ? 'socks4://' : 'http://'
        const resolved = `${prefix}${hostPort}`
        console.log(`[GoogleArts] 使用系统代理: ${resolved} (来源: Electron resolveProxy)`)
        return resolved
      }
    }
  } catch (e) {
    console.warn('[GoogleArts] resolveProxy 失败，将直连:', e)
  }

  return null
}

async function httpGetText(targetUrl: string, headers: Record<string, string>): Promise<string> {
  const proxyUrl = await getEffectiveProxyUrl(targetUrl)
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined
  if (proxyUrl) {
    console.log(`[GoogleArts] HTTP 请求代理: ${proxyUrl} → ${targetUrl}`)
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl)
    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers,
      agent,
    }

    const req = https.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`Google Arts API 返回 ${res.statusCode}: ${res.statusMessage}`))
      }
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve(body))
    })

    req.on('error', (err) => reject(err))
    req.end()
  })
}

async function fetchPage(
  query: string,
  hl: string,
  cursor: string | null,
  page = 1,
  maxCount?: number | null,
): Promise<GoogleArtSearchResult> {
  const params = new URLSearchParams({ q: query, hl })
  if (cursor) params.set('cursor', cursor)

  const url = `${GOOGLE_ART_API}?${params.toString()}`

  let raw = await httpGetText(url, {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    Referer: 'https://artsandculture.google.com/',
  })

  if (raw.startsWith(")]}'")) {
    raw = raw.slice(4).replace(/^\s*\n/, '')
  }

  const data = JSON.parse(raw)
  const inner = data[0]
  const section = inner[3]
  const assetsRaw = section[2]
  const total = section[4]
  const nextCursor = section[8]

  const items: GoogleArtSearchItem[] = []
  for (const asset of assetsRaw) {
    const info = asset[10] && Array.isArray(asset[10]) ? asset[10] : []
    items.push({
      id: info[0] || '',
      title: asset[1] || '',
      artist: asset[2] || null,
      thumbnail: asset[3] ? `https:${asset[3]}` : null,
      url: asset[4] ? `https://artsandculture.google.com${asset[4]}` : '',
      color: asset[8] || null,
      aspectRatio: info[1] ?? null,
      hasPixels: info[10] || false,
      institution: info[12] || null,
    })
  }

  // 按 maxCount 截断
  let finalItems = items
  if (maxCount && maxCount > 0 && maxCount < items.length) {
    finalItems = items.slice(0, maxCount)
  }

  return {
    success: true,
    query,
    page,
    total,
    count: finalItems.length,
    items: finalItems,
    links: finalItems.map((item) => item.url),
    nextCursor: nextCursor || null,
  }
}

/**
 * /api/assets/images 分页请求（真实游标翻页）
 * 响应结构: data[0][0] → sec[2]=资产数组, sec[4]=总数, sec[8]=下一批游标
 * pt 为必填参数；s 为每批条数（上限约 64，实测 96 会 500）
 */
async function fetchImagesPage(
  query: string,
  hl: string,
  pt: string | null,
  page = 1,
  maxCount?: number | null,
): Promise<GoogleArtSearchResult> {
  const size = Math.min(Math.max(maxCount ?? 24, 1), 64)

  const params = new URLSearchParams({
    q: query,
    s: String(size),
    hl,
    _reqid: String(Math.floor(Math.random() * 9999999)),
    rt: 'j',
  })
  if (pt) params.set('pt', pt)

  const url = `${GOOGLE_ART_IMAGES_API}?${params.toString()}`

  let raw = await httpGetText(url, {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    Referer: 'https://artsandculture.google.com/search/asset?q=' + encodeURIComponent(query),
    'X-Requested-With': 'XMLHttpRequest',
  })

  if (raw.startsWith(")]}'")) {
    raw = raw.slice(4).replace(/^\s*\n/, '')
  }

  const data = JSON.parse(raw)
  const section = data[0][0]
  const assetsRaw = section[2] || []
  const total = section[4]
  const nextCursor = section[8]

  const items: GoogleArtSearchItem[] = []
  for (const asset of assetsRaw) {
    const info = asset[10] && Array.isArray(asset[10]) ? asset[10] : []
    items.push({
      id: info[0] || '',
      title: asset[1] || '',
      artist: asset[2] || null,
      thumbnail: asset[3] ? `https:${asset[3]}` : null,
      url: asset[4] ? `https://artsandculture.google.com${asset[4]}` : '',
      color: asset[8] || null,
      aspectRatio: info[1] ?? null,
      hasPixels: info[10] || false,
      institution: info[12] || null,
    })
  }

  // 按 maxCount 截断
  let finalItems = items
  if (maxCount && maxCount > 0 && maxCount < items.length) {
    finalItems = items.slice(0, maxCount)
  }

  return {
    success: true,
    query,
    page,
    total,
    count: finalItems.length,
    items: finalItems,
    links: finalItems.map((item) => item.url),
    nextCursor: nextCursor || null,
  }
}

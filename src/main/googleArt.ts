import { spawn } from 'child_process'
import fs from 'fs'
import { app } from 'electron'
import { join, resolve } from 'path'
import { uploadFileToCos, generateCosKey } from './cos'
import https from 'https'
import { URL } from 'url'
import { getTokenValue } from './server'
import { checkSiteAvailability } from './siteAvailability'

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
  apiBase: string = 'https://1s.design:1520/api',
  originUrl?: string
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
    
    const postData = JSON.stringify({
      // 贴纸基础字段
      url: cosResult.url,
      key: cosResult.key,
      name: fileName.replace(/\.jpg$/, ''),
      description: '',
      keywords: '',
      suffix: 'jpg',
      originUrl: originUrl || '',
      source: 'google.artsandculture.com',
      // 默认作为公开素材入库（后端会异步补充宽高、色系、AI 文案等）
      isPublic: true,
      isTexture: false,
      isCustom: false
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
        ...(getTokenValue() ? { Authorization: `Bearer ${getTokenValue()}` } : {})
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
  zoomLevel: number
  workspaceDir: string
}): Promise<{ ok: boolean; msg?: string; filePath?: string; fileName?: string; fileSize?: number; materialLibraryOk?: boolean }> {
  const { url, zoomLevel, workspaceDir } = options

  if (!url || !/^https?:\/\/(www\.)?artsandculture\.google\.com\//.test(url)) {
    return { ok: false, msg: '请输入有效的 Google Arts 链接（以 artsandculture.google.com 开头）' }
  }
  if (typeof zoomLevel !== 'number') {
    return { ok: false, msg: '请先选择分辨率' }
  }
  if (!workspaceDir) return { ok: false, msg: '工作目录未设置' }

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

      const materialResult = await uploadToMaterialLibrary(outputPath, fileName, undefined, url)
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


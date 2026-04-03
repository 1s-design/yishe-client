import fs from 'fs'
import path from 'path'
import { BrowserWindow } from 'electron'
import http from 'http'
import https from 'https'
import { URL } from 'url'
import { createDecipheriv, createHash } from 'crypto'

type CosConfig = {
  SecretId: string
  SecretKey: string
  Bucket: string
  Region: string
}

const SERVICE_MODE_STORAGE_KEY = 'yishe.serviceMode'
const BASIC_CONFIG_SECRET = '1s'
const DEV_REMOTE_API_BASE = process.env.YISHE_LOCAL_API_BASE || 'http://localhost:1520/api'
const PROD_REMOTE_API_BASE = process.env.YISHE_REMOTE_API_BASE || 'https://1s.design:1520/api'

let cachedCosConfig: CosConfig | null = null
let cachedCosConfigSource: string | null = null
let cachedCosConfigToken: string | null = null
let pendingRemoteConfigPromise: Promise<CosConfig> | null = null

type UploadResult =
  | { ok: true; url: string; key: string }
  | { ok: false; msg: string }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeCfg(cfg: any): CosConfig | null {
  if (!cfg) return null
  const flat = cfg.COS || cfg
  if (flat.SecretId && flat.SecretKey && flat.Bucket && flat.Region) {
    return {
      SecretId: String(flat.SecretId),
      SecretKey: String(flat.SecretKey),
      Bucket: String(flat.Bucket),
      Region: String(flat.Region)
    }
  }
  return null
}

async function getCurrentAccessToken(): Promise<string | null> {
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null
    }

    const token = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        try {
          if (window.api && typeof window.api.getToken === 'function') {
            const value = await window.api.getToken()
            return typeof value === 'string' && value.trim() ? value.trim() : null
          }
        } catch (error) {}
        return null
      })()
    `)

    return typeof token === 'string' && token.trim() ? token.trim() : null
  } catch (error) {
    console.warn('[COS] 读取当前登录 token 失败:', error)
    return null
  }
}

function loadCosSdk(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const COS = require('cos-nodejs-sdk-v5')
    return COS
  } catch (error: any) {
    console.error('[COS] 未安装 cos-nodejs-sdk-v5，请执行 npm install 或 yarn add cos-nodejs-sdk-v5')
    return null
  }
}

async function getCurrentServiceMode(): Promise<'local' | 'remote'> {
  if (process.env.NODE_ENV !== 'development') {
    return 'remote'
  }

  try {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow || mainWindow.isDestroyed()) {
      return 'local'
    }

    const mode = await mainWindow.webContents.executeJavaScript(`
      (() => {
        try {
          const value = localStorage.getItem(${JSON.stringify(SERVICE_MODE_STORAGE_KEY)})
          return value === 'local' || value === 'remote' ? value : null
        } catch (error) {
          return null
        }
      })()
    `)

    return mode === 'remote' ? 'remote' : 'local'
  } catch (error) {
    console.warn('[COS] 读取服务模式失败，开发环境默认使用本地服务:', error)
    return 'local'
  }
}

async function getBackendApiBase(): Promise<string> {
  const mode = await getCurrentServiceMode()
  const base = mode === 'local' ? DEV_REMOTE_API_BASE : PROD_REMOTE_API_BASE
  return String(base || '').replace(/\/$/, '')
}

function extractEncryptedConfig(payload: any): string {
  if (typeof payload === 'string') {
    return payload
  }
  if (payload && typeof payload.data === 'string') {
    return payload.data
  }
  throw new Error('COS 配置响应格式无效')
}

function parseMaybeJson(raw: string): any {
  const normalized = String(raw || '').trim()
  if (!normalized) {
    return normalized
  }

  try {
    return JSON.parse(normalized)
  } catch (error) {
    return normalized
  }
}

function deriveKeyAndIv(password: Buffer, salt: Buffer, keyLength: number, ivLength: number) {
  let derived: Buffer = Buffer.alloc(0)
  let block: Buffer = Buffer.alloc(0)

  while (derived.length < keyLength + ivLength) {
    block = createHash('md5')
      .update(Buffer.concat([block, password, salt]))
      .digest()
    derived = Buffer.concat([derived, block])
  }

  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, keyLength + ivLength)
  }
}

function decryptConfig(encryptedString: string): CosConfig {
  try {
    const cipherBuffer = Buffer.from(String(encryptedString || '').trim(), 'base64')
    if (!cipherBuffer.length) {
      throw new Error('密文为空')
    }

    let salt = Buffer.alloc(0)
    let ciphertext = cipherBuffer

    if (cipherBuffer.subarray(0, 8).toString('utf8') === 'Salted__') {
      salt = cipherBuffer.subarray(8, 16)
      ciphertext = cipherBuffer.subarray(16)
    }

    const { key, iv } = deriveKeyAndIv(
      Buffer.from(BASIC_CONFIG_SECRET, 'utf8'),
      salt,
      32,
      16
    )

    const decipher = createDecipheriv('aes-256-cbc', key, iv)
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8')

    const config = normalizeCfg(JSON.parse(decrypted))
    if (!config) {
      throw new Error('配置字段不完整')
    }

    return config
  } catch (error: any) {
    throw new Error(`[COS] 解密配置失败: ${error?.message || '未知错误'}`)
  }
}

function requestText(
  urlString: string,
  method: 'POST' | 'GET' = 'POST',
  body?: string,
  headers?: Record<string, string>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString)
    const client = url.protocol === 'https:' ? https : http
    const payload = body || ''
    const requestHeaders: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      ...(headers || {})
    }

    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: requestHeaders
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw || '请求失败'}`))
            return
          }
          resolve(raw)
        })
      }
    )

    req.on('error', reject)

    if (payload) {
      req.write(payload)
    }

    req.end()
  })
}

async function fetchRemoteCosConfig(): Promise<CosConfig> {
  const apiBase = await getBackendApiBase()
  const token = await getCurrentAccessToken()

  if (!token) {
    cachedCosConfig = null
    cachedCosConfigSource = null
    cachedCosConfigToken = null
    throw new Error('未检测到登录 token，请先登录后再获取 COS 配置')
  }

  if (
    cachedCosConfig &&
    cachedCosConfigSource === apiBase &&
    cachedCosConfigToken === token
  ) {
    return cachedCosConfig
  }

  if (pendingRemoteConfigPromise) {
    return pendingRemoteConfigPromise
  }

  pendingRemoteConfigPromise = (async () => {
    let lastError: any = null

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const responseText = await requestText(
          `${apiBase}/getBasicConfig`,
          'POST',
          '{}',
          token ? { Authorization: `Bearer ${token}` } : undefined
        )
        const encryptedConfig = extractEncryptedConfig(parseMaybeJson(responseText))
        const config = decryptConfig(encryptedConfig)
        cachedCosConfig = config
        cachedCosConfigSource = apiBase
        cachedCosConfigToken = token
        return config
      } catch (error: any) {
        lastError = error
        if (attempt < 3) {
          await sleep(500 * attempt)
        }
      }
    }

    throw lastError || new Error('获取 COS 配置失败')
  })()

  try {
    return await pendingRemoteConfigPromise
  } finally {
    pendingRemoteConfigPromise = null
  }
}

async function getCosConfig(): Promise<CosConfig | null> {
  return fetchRemoteCosConfig()
}

/**
 * 清理文件名，移除特殊字符
 */
function sanitizeFilename(filename: string): string {
  if (!filename) return 'file'
  
  // 移除路径分隔符和特殊字符
  let sanitized = filename.replace(/[<>:"/\\|?*]/g, '_')
  
  // 保留字母、数字、下划线、连字符、点号
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_')
  
  // 最大长度限制：200 字符（保留扩展名）
  const extMatch = sanitized.match(/\.([^.]+)$/)
  const ext = extMatch ? extMatch[1] : ''
  const nameWithoutExt = extMatch ? sanitized.slice(0, -(ext.length + 1)) : sanitized
  
  if (nameWithoutExt.length > 200) {
    sanitized = nameWithoutExt.substring(0, 200) + (ext ? `.${ext}` : '')
  }
  
  return sanitized || 'file'
}

/**
 * 获取当前用户账号
 * 优先级：已登录用户账号（account）> 已登录用户ID > anonymous
 * 注意：不使用系统用户名，只使用客户端登录的用户账号
 * 从 localStorage 读取用户信息（getUserInfo 接口返回的信息）
 */
async function getCurrentUserAccount(): Promise<string> {
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow || mainWindow.isDestroyed()) {
      return 'anonymous'
    }
    
    const account = await mainWindow.webContents.executeJavaScript(`
      (() => {
        try {
          const stored = localStorage.getItem('userInfo')
          if (stored) {
            const info = JSON.parse(stored)
            return info?.account || info?.id || null
          }
        } catch (e) {}
        return null
      })()
    `)
    
    if (account && typeof account === 'string' && account.trim()) {
      const cleaned = account.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().substring(0, 50)
      if (cleaned) {
        return cleaned
      }
    }
  } catch (e) {
    console.warn('[COS] 无法从 localStorage 获取用户信息:', e)
  }
  
  return 'anonymous'
}

/**
 * 生成 COS Key（文件路径）
 * 格式：{category}/{dateYYYYMMDD}/{account}/{subDirectory}/{timestamp}_{filename}
 * 例如：google-art/20250115/admin/1736937600000_artwork.jpg
 * 例如（带子目录）：sticker-psd-set/20250115/admin/psdSetId123/1736937600000_image.png
 */
export interface CosKeyOptions {
  category: string        // 大类
  account?: string         // 用户账号（可选，会自动获取）
  filename: string        // 文件名
  timestamp?: number      // 时间戳（可选，默认当前时间）
  date?: Date            // 日期（可选，默认当前日期）
  subDirectory?: string   // 子目录（可选，如 psdSetId）
}

export async function generateCosKey(options: CosKeyOptions): Promise<string> {
  const { category, filename, timestamp, date, subDirectory } = options
  
  // 获取用户账号（如果未提供，则自动获取）
  const account = options.account || await getCurrentUserAccount()
  
  // 获取日期并格式化为 YYYYMMDD
  const now = date || new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const dateStr = `${year}${month}${day}` // 格式：20250115
  
  // 获取时间戳
  const ts = timestamp || now.getTime()
  
  // 清理文件名
  const sanitizedFilename = sanitizeFilename(filename)
  
  // 清理子目录（如果提供）
  const sanitizedSubDir = subDirectory ? sanitizeFilename(subDirectory) : ''
  
  // 生成路径：{category}/{dateYYYYMMDD}/{account}/{subDirectory}/{timestamp}_{filename}
  // 如果有子目录，则包含子目录；否则直接是 {category}/{dateYYYYMMDD}/{account}/{timestamp}_{filename}
  const cosKey = subDirectory && sanitizedSubDir
    ? `${category}/${dateStr}/${account}/${sanitizedSubDir}/${ts}_${sanitizedFilename}`
    : `${category}/${dateStr}/${account}/${ts}_${sanitizedFilename}`
  
  return cosKey
}

export async function uploadFileToCos(filePath: string, key?: string): Promise<UploadResult> {

  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, msg: '文件不存在，无法上传' }
  }

  const cosConfig = await getCosConfig()
  if (!cosConfig) {
    return { ok: false, msg: 'COS 配置缺失，请检查后端 getBasicConfig' }
  }

  const COS = loadCosSdk()
  if (!COS) {
    return { ok: false, msg: '未安装 cos-nodejs-sdk-v5，请先安装依赖' }
  }

  const cosClient = new COS({
    SecretId: cosConfig.SecretId,
    SecretKey: cosConfig.SecretKey
  })

  const fileName = path.basename(filePath)
  const cosKey = key || `google-art/${Date.now()}_${fileName}`
  const fileBuffer = fs.readFileSync(filePath)

  return new Promise((resolve) => {
    cosClient.putObject(
      {
        Bucket: cosConfig.Bucket,
        Region: cosConfig.Region,
        Key: cosKey,
        Body: fileBuffer
      },
      (err: any, data: any) => {
        if (err) {
          console.error('[COS] 上传失败:', err)
          resolve({ ok: false, msg: err?.message || 'COS 上传失败' })
        } else {
          resolve({ ok: true, url: `https://${data.Location}`, key: cosKey })
        }
      }
    )
  })
}


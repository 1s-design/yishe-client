import fs from 'fs'
import path from 'path'
import { BrowserWindow } from 'electron'
import http from 'http'
import https from 'https'
import { URL } from 'url'
import { createDecipheriv, createHash } from 'crypto'
import {
  buildCosObjectKey,
  sanitizeCosAccount,
  sanitizeCosUserId,
} from './cosPath'

type CosConfig = {
  SecretId: string
  SecretKey: string
  Bucket: string
  Region: string
}

const SERVICE_MODE_STORAGE_KEY = 'yishe.serviceMode'
const CUSTOM_SERVER_URL_STORAGE_KEY = 'yishe.customServerUrl'
const BASIC_CONFIG_SECRET = process.env.YISHE_COS_CONFIG_SECRET || '1s'
const DEV_REMOTE_API_BASE = process.env.YISHE_LOCAL_API_BASE || 'http://localhost:1520/api'
const PROD_REMOTE_API_BASE = process.env.YISHE_REMOTE_API_BASE || 'https://api.1s.design/api'

const COS_CONFIG_TTL_MS = 30 * 60 * 1000 // 30 分钟缓存有效期，支持定时更新
let cachedCosConfig: CosConfig | null = null
let cachedCosConfigSource: string | null = null
let cachedCosConfigToken: string | null = null
let cachedCosConfigTime = 0
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

export async function getCurrentAccessToken(): Promise<string | null> {
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
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow || mainWindow.isDestroyed()) {
      return process.env.NODE_ENV === 'development' ? 'local' : 'remote'
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

    if (mode === 'local' || mode === 'remote') {
      return mode
    }
  } catch (error) {
    console.warn('[COS] 读取服务模式失败:', error)
  }

  return process.env.NODE_ENV === 'development' ? 'local' : 'remote'
}

async function getBackendApiBase(): Promise<string> {
  const mode = await getCurrentServiceMode()
  if (mode === 'local') {
    return DEV_REMOTE_API_BASE.replace(/\/$/, '')
  }

  // remote 模式：优先读取用户在渲染层配置的 customServerUrl
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow && !mainWindow.isDestroyed()) {
      const customUrl = await mainWindow.webContents.executeJavaScript(`
        (() => {
          try {
            const value = localStorage.getItem(${JSON.stringify(CUSTOM_SERVER_URL_STORAGE_KEY)})
            return typeof value === 'string' && value.trim() ? value.trim() : null
          } catch (e) {
            return null
          }
        })()
      `)

      if (customUrl) {
        const cleaned = customUrl.replace(/\/+$/, '')
        return cleaned.endsWith('/api') ? cleaned : `${cleaned}/api`
      }
    }
  } catch (error) {
    console.warn('[COS] 读取自定义服务器地址失败:', error)
  }

  return PROD_REMOTE_API_BASE.replace(/\/$/, '')
}

/** 供其他模块复用：获取当前生效的后端 API 基地址（与 COS 配置获取保持一致） */
export { getBackendApiBase }

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

  const now = Date.now()
  if (
    cachedCosConfig &&
    cachedCosConfigSource === apiBase &&
    cachedCosConfigToken === token &&
    now - cachedCosConfigTime < COS_CONFIG_TTL_MS
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
        cachedCosConfigTime = Date.now()
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

/** 手动使 COS 缓存失效（配置更新或鉴权失效时调用） */
export function invalidateCosConfig(): void {
  cachedCosConfig = null
  cachedCosConfigSource = null
  cachedCosConfigToken = null
  cachedCosConfigTime = 0
}

async function getCosConfig(): Promise<CosConfig | null> {
  return fetchRemoteCosConfig()
}

// ─── STS 临时凭据（优先），失败回退永久密钥 ───────────────────

type StsCredential = {
  TmpSecretId: string
  TmpSecretKey: string
  SecurityToken: string
  ExpiredTime: number
  Bucket: string
  Region: string
}

let cachedSts: StsCredential | null = null
let cachedStsTime = 0
/** 提前 5 分钟过期，避免上传中途失效 */
const STS_REFRESH_AHEAD_MS = 5 * 60 * 1000

export function invalidateStsCredential(): void {
  cachedSts = null
  cachedStsTime = 0
}

/**
 * 获取 COS STS 临时凭据（服务端 /cos/sts 签发）
 * 返回 null 表示当前后端不支持 STS，调用方应回退旧的永久密钥模式
 */
async function fetchStsCredential(): Promise<StsCredential | null> {
  const apiBase = await getBackendApiBase()
  const token = await getCurrentAccessToken()
  if (!token) return null

  const now = Date.now()
  if (cachedSts && now - cachedStsTime < STS_REFRESH_AHEAD_MS) {
    // 未临近过期则直接用缓存
    const remain = (cachedSts.ExpiredTime || 0) * 1000 - now
    if (remain > STS_REFRESH_AHEAD_MS) {
      return cachedSts
    }
  }

  try {
    const responseText = await requestText(
      `${apiBase}/cos/sts`,
      'GET',
      undefined,
      { Authorization: `Bearer ${token}` },
    )
    const parsed = parseMaybeJson(responseText)
    const data = parsed?.data ?? parsed
    if (
      data &&
      data.TmpSecretId &&
      data.TmpSecretKey &&
      data.SecurityToken &&
      data.ExpiredTime
    ) {
      cachedSts = {
        TmpSecretId: String(data.TmpSecretId),
        TmpSecretKey: String(data.TmpSecretKey),
        SecurityToken: String(data.SecurityToken),
        ExpiredTime: Number(data.ExpiredTime),
        Bucket: String(data.Bucket || data.bucket || ''),
        Region: String(data.Region || data.region || ''),
      }
      cachedStsTime = now
      console.log(
        `[COS] STS 临时凭据已获取，有效至 ${new Date(cachedSts.ExpiredTime * 1000).toISOString()}`,
      )
      return cachedSts
    }
    return null
  } catch (error: any) {
    console.warn('[COS] STS 凭据获取失败（将回退永久密钥模式）:', error?.message || error)
    return null
  }
}

export async function getCurrentUserIdentity(): Promise<{ userId: string; account: string }> {
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow || mainWindow.isDestroyed()) {
      return {
        userId: sanitizeCosUserId(),
        account: sanitizeCosAccount(),
      }
    }

    const identity = await mainWindow.webContents.executeJavaScript(`
      (() => {
        try {
          const candidates = ['USER', 'userInfo']

          for (const key of candidates) {
            const stored = localStorage.getItem(key)
            if (!stored) {
              continue
            }

            const parsed = JSON.parse(stored)
            const user = parsed?.user || parsed || {}
            const userId = user?.id ?? parsed?.id ?? null
            const account =
              user?.account
              ?? user?.shortName
              ?? user?.name
              ?? parsed?.account
              ?? parsed?.shortName
              ?? parsed?.name
              ?? null

            if (userId != null || account) {
              return { userId, account }
            }
          }

          return null
        } catch (error) {
          return null
        }
      })()
    `)

    return {
      userId: sanitizeCosUserId(identity?.userId),
      account: sanitizeCosAccount(identity?.account),
    }
  } catch (error) {
    console.warn('[COS] 无法从 localStorage 获取用户信息:', error)
  }

  return {
    userId: sanitizeCosUserId(),
    account: sanitizeCosAccount(),
  }
}

/**
 * 生成 COS Key（文件路径）
 * 格式：users/{userId}_{account}/{category}/{dateYYYYMMDD}/{entityId?}/{timestamp}_{filename}
 */
export interface CosKeyOptions {
  category?: string
  account?: string
  userId?: string | number
  filename: string
  timestamp?: number
  date?: Date
  entityId?: string | number
  subDirectory?: string
  isThumbnail?: boolean
}

export async function generateCosKey(options: CosKeyOptions): Promise<string> {
  const identity = await getCurrentUserIdentity()

  return buildCosObjectKey(options.filename, {
    category: options.category,
    account: options.account ?? identity.account,
    userId: options.userId ?? identity.userId,
    entityId: options.entityId ?? options.subDirectory,
    isThumbnail: options.isThumbnail,
    timestamp: options.timestamp,
    date: options.date,
  })
}

async function registerFileAssetBestEffort(payload: Record<string, any>): Promise<void> {
  try {
    const apiBase = await getBackendApiBase()
    const token = await getCurrentAccessToken()
    if (!token) return
    await requestText(`${apiBase}/file-asset/register`, 'POST', JSON.stringify({
      provider: 'tencent-cos',
      sourceApp: 'yishe-client',
      ...payload,
    }), { Authorization: `Bearer ${token}` })
  } catch (error: any) {
    console.warn('[file-asset] 登记失败，不影响 COS 上传:', error?.message || error)
  }
}

export async function uploadFileToCos(filePath: string, key?: string): Promise<UploadResult> {

  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, msg: '文件不存在，无法上传' }
  }

  // 优先 STS 临时凭据；后端不支持或失败时回退永久密钥（getBasicConfig）
  const sts = await fetchStsCredential()
  let cosConfig: CosConfig | null = null
  if (!sts) {
    cosConfig = await getCosConfig()
    if (!cosConfig) {
      return { ok: false, msg: 'COS 配置缺失，请检查后端 getBasicConfig' }
    }
  }

  const COS = loadCosSdk()
  if (!COS) {
    return { ok: false, msg: '未安装 cos-nodejs-sdk-v5，请先安装依赖' }
  }

  const cosClient = sts
    ? new COS({
        getAuthorization: (_options: any, callback: (auth: any) => void) => {
          callback({
            TmpSecretId: sts.TmpSecretId,
            TmpSecretKey: sts.TmpSecretKey,
            SecurityToken: sts.SecurityToken,
            ExpiredTime: sts.ExpiredTime,
          })
        },
      })
    : new COS({
        SecretId: cosConfig!.SecretId,
        SecretKey: cosConfig!.SecretKey,
      })

  // STS 模式下 bucket/region 以凭据为准
  const bucket = sts?.Bucket || cosConfig!.Bucket
  const region = sts?.Region || cosConfig!.Region

  const fileName = path.basename(filePath)
  const cosKey = key || await generateCosKey({
    category: 'uncategorized',
    filename: fileName,
  })
  const fileBuffer = fs.readFileSync(filePath)

  return new Promise((resolve) => {
    cosClient.putObject(
      {
        Bucket: bucket,
        Region: region,
        Key: cosKey,
        Body: fileBuffer
      },
      (err: any, data: any) => {
        if (err) {
          console.error('[COS] 上传失败:', err)
          if (
            err?.statusCode === 403 ||
            err?.code === 'SignatureDoesNotMatch' ||
            err?.code === 'AccessDenied' ||
            err?.code === 'RequestTimeTooSkewed'
          ) {
            console.warn('[COS] 凭据已失效或过期，清除本地 COS/STS 缓存准备重试刷新')
            invalidateCosConfig()
            invalidateStsCredential()
          }
          resolve({ ok: false, msg: err?.message || 'COS 上传失败' })
        } else {
          const url = `https://${data.Location}`
          void registerFileAssetBestEffort({
            bucket,
            region,
            objectKey: cosKey,
            url,
            fileName,
            size: fs.statSync(filePath).size,
            sourceModule: cosKey.split('/')[2] || 'uncategorized',
            category: cosKey.split('/')[2] || 'uncategorized',
            metadata: { uploadMode: sts ? 'electron-main-sts' : 'electron-main' },
          })
          resolve({ ok: true, url, key: cosKey })
        }
      }
    )
  })
}


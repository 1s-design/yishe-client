/**
 * 透明抠图「自动去掉四周多余空白」——纯客户端本地处理。
 *
 * 两个入口共用同一套裁切规则：
 * - trimTransparentMargins：采集引擎下载到字节后、写临时文件 / 上传 COS 之前调用。
 * - trimTransparentMarginsInDataUrl：插件手动采集（/api/material-upload）的 base64 数据。
 * 服务端完全不参与图片解码与重编码，不消耗任何服务端 CPU / 内存 / 带宽。
 *
 * 做法：读 RGBA 原始像素 → 算 alpha 通道的最小外接矩形 → 四周留一点安全边裁切。
 * 不依赖 sharp.trim()（那个按四角颜色判断，遇到左上角有内容或羽化边会裁歪）。
 * 全不透明 / 无空白边的图直接返回 null，连重编码都不做，不影响采集速度。
 */
import sharp from 'sharp'
import { formatFromContentType, sniffImageFormat } from './imageFormat'

export interface AlphaTrimInfo {
  from: { width: number; height: number }
  to: { width: number; height: number }
  left: number
  top: number
  padding: number
  /** 相对原图减少的面积比例 0~1 */
  reducedRatio: number
  originalBytes: number
  trimmedBytes: number
}

export interface AlphaTrimOptions {
  /** 显式关闭自动裁切（个别源需要保留原始构图时可用） */
  enabled?: boolean
  /** 四周安全边像素；不传则按短边自适应（约 0.4%，夹在 2~24px） */
  padding?: number
  /** alpha 阈值 0~255，低于等于该值视为「空白」，默认 8（过滤不可见的半透明噪点） */
  alphaThreshold?: number
}

/** 超过这个像素量就不解码，避免大图 raw 缓冲吃掉几百 MB 内存 */
const MAX_PIXELS = 40_000_000
/** 至少裁掉 1% 面积才值得重编码覆盖 */
const MIN_REDUCED_RATIO = 0.01

export async function trimTransparentMargins(
  input: Buffer,
  format: string,
  options: AlphaTrimOptions = {},
): Promise<{ buffer: Buffer; info: AlphaTrimInfo } | null> {
  if (options.enabled === false) return null
  const fmt = String(format || '').toLowerCase()
  // 只处理可能带透明通道的位图；动图 WebP 交给原样保存（裁了会定住首帧）
  if (fmt !== 'png' && fmt !== 'webp') return null
  if (fmt === 'webp' && input.subarray(0, 4).toString('ascii') === 'RIFF' && input.includes('ANMF')) {
    return null
  }

  try {
    const probe = sharp(input, { limitInputPixels: false, failOn: 'none' })
    const meta = await probe.metadata()
    if (!meta.width || !meta.height) return null
    // 快速路径：没有 alpha 通道直接放行（jpg / 不透明 png），零解码、零重编码开销
    if (meta.hasAlpha === false) return null
    if (meta.width * meta.height > MAX_PIXELS) return null

    const { data, info } = await sharp(input, { limitInputPixels: false, failOn: 'none' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const width = info.width
    const height = info.height
    const channels = info.channels
    const threshold = Math.max(0, Math.min(254, options.alphaThreshold ?? 8))

    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    let hasTransparent = false

    for (let y = 0; y < height; y++) {
      const row = y * width * channels
      for (let x = 0; x < width; x++) {
        const alpha = data[row + x * channels + 3]
        if (alpha <= threshold) {
          hasTransparent = true
          continue
        }
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }

    // 全不透明（无空白边）或全透明（脏图）都不动
    if (!hasTransparent || maxX < 0) return null

    const autoPadding = Math.max(2, Math.round(Math.min(width, height) * 0.004))
    const padding = Math.max(0, Math.min(24, options.padding ?? autoPadding))
    const left = Math.max(0, minX - padding)
    const top = Math.max(0, minY - padding)
    const right = Math.min(width - 1, maxX + padding)
    const bottom = Math.min(height - 1, maxY + padding)
    const tw = right - left + 1
    const th = bottom - top + 1
    const reducedRatio = 1 - (tw * th) / (width * height)
    if (reducedRatio < MIN_REDUCED_RATIO || tw < 8 || th < 8) return null

    // 统一输出无损 PNG：透明通道一定被下游识别成 RGBA，抠图标记不会漏；
    // 同时避免 webp 有损重编码把羽化边缘弄出白边。
    const buffer = await sharp(input, { limitInputPixels: false, failOn: 'none' })
      .extract({ left, top, width: tw, height: th })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer()
    if (!buffer.length) return null

    return {
      buffer,
      info: {
        from: { width, height },
        to: { width: tw, height: th },
        left,
        top,
        padding,
        reducedRatio: Number(reducedRatio.toFixed(4)),
        originalBytes: input.length,
        trimmedBytes: buffer.length,
      },
    }
  } catch (e: any) {
    // 裁剪是增强能力，任何异常都不能阻断采集入库
    console.warn('[AlphaTrim] 跳过自动裁切:', e?.message || e)
    return null
  }
}

export interface AlphaTrimDataUrlResult {
  /** 裁切后的无损 PNG dataURL */
  dataUrl: string
  contentType: 'image/png'
  suffix: 'png'
  width: number
  height: number
  fileSize: number
  info: AlphaTrimInfo
}

function decodeImageDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  if (typeof dataUrl !== 'string') return null
  const matched = dataUrl.trim().match(/^data:([^;,]+)?;base64,([\s\S]+)$/)
  if (!matched || !matched[2]) return null
  try {
    const buffer = Buffer.from(matched[2], 'base64')
    if (!buffer.length) return null
    return { buffer, contentType: String(matched[1] || '').toLowerCase() }
  } catch {
    return null
  }
}

/**
 * dataURL 版透明边距裁切：解析 base64 → 按真实文件头判格式 → 复用 trimTransparentMargins。
 * 没裁动（非 png/webp、无 alpha、无空白边、超限）时返回 null，调用方保持原 payload 不动。
 */
export async function trimTransparentMarginsInDataUrl(
  dataUrl: string,
  options: AlphaTrimOptions = {},
): Promise<AlphaTrimDataUrlResult | null> {
  const decoded = decodeImageDataUrl(dataUrl)
  if (!decoded) return null

  const format = sniffImageFormat(decoded.buffer) || formatFromContentType(decoded.contentType)
  const trimmed = await trimTransparentMargins(decoded.buffer, format || '', options)
  if (!trimmed) return null

  return {
    dataUrl: `data:image/png;base64,${trimmed.buffer.toString('base64')}`,
    contentType: 'image/png',
    suffix: 'png',
    width: trimmed.info.to.width,
    height: trimmed.info.to.height,
    fileSize: trimmed.buffer.length,
    info: trimmed.info,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 采集图片「上传前质量闸门」
//
// 聚合源（Bing / CleanPNG 等）常混入三类垃圾图：
//   1) JPEG / 无 alpha 的 PNG —— 白底，不能做透明印花；
//   2) WEBP 预览图 —— 列表缩略图转码，400px 且无透明；
//   3) PNG 带 RGBA 但 alpha 全 255 —— 「假透明」，isCutout 会被误标 true。
// 过去这三类都是先传 COS、再人工复核淘汰，白耗上行流量与存储。
// 现在在「下载得到 Buffer」之后、「写临时文件 / 上传 COS / 写库」之前拦截：
// 不合格直接 throw，由采集引擎既有的单张失败处理链丢弃，云端零写入。
//
// 默认策略：放行常见图片格式（png/jpeg/webp），按分辨率过滤缩略图与低清垃圾图，
// 长边 >= 400px、短边 >= 200px。不要求透明通道——高清壁纸类素材（jpeg 无 alpha）
// 同样是合法采集目标；透明真实性检查仅在调用方显式 requireRealAlpha 时启用。
// 逃生开关：任一调用方传 imagePolicy='off' 即关闭；传对象可覆盖阈值；
//           传 'png,webp' 之类字符串可收窄格式白名单。
// ─────────────────────────────────────────────────────────────────────────────

export interface CollectImagePolicy {
  allowedFormats?: string[]
  requireRealAlpha?: boolean
  minLongEdge?: number
  minShortEdge?: number
  /** alpha 低于该值才算透明像素；默认 250 */
  alphaThreshold?: number
  /** 超过此像素量跳过逐像素统计，只按 hasAlpha 判定，防内存爆炸 */
  maxPixels?: number
}

export type CollectImagePolicyInput =
  | CollectImagePolicy
  | 'off'
  | 'on'
  | 'none'
  | string
  | boolean
  | null
  | undefined

export const DEFAULT_COLLECT_IMAGE_POLICY: Required<CollectImagePolicy> = {
  allowedFormats: ['png', 'jpeg', 'jpg', 'webp'],
  requireRealAlpha: false,
  minLongEdge: 400,
  minShortEdge: 200,
  alphaThreshold: 250,
  maxPixels: 40_000_000,
}

const POLICY_OFF_TOKENS = new Set(['off', 'none', 'disabled', 'false'])

/**
 * 按优先级解析策略：第一个显式传入的值生效，都没传则用默认严格策略。
 * 调用方可从 download hook 的 options.imagePolicy / collect_run 的
 * params.imagePolicy、params.meta.imagePolicy / 源 meta.imagePolicy 处关闭或覆盖。
 */
export function resolveCollectImagePolicy(
  ...candidates: CollectImagePolicyInput[]
): CollectImagePolicy | 'off' {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    if (candidate === false) return 'off'
    if (candidate === true || candidate === 'on') return { ...DEFAULT_COLLECT_IMAGE_POLICY }
    if (typeof candidate === 'string') {
      const token = candidate.trim().toLowerCase()
      if (!token || POLICY_OFF_TOKENS.has(token)) return 'off'
      return {
        ...DEFAULT_COLLECT_IMAGE_POLICY,
        allowedFormats: token.split(',').map((s) => s.trim()).filter(Boolean),
      }
    }
    if (typeof candidate === 'object') {
      const defined = Object.fromEntries(
        Object.entries(candidate).filter(([, v]) => v !== undefined),
      )
      return { ...DEFAULT_COLLECT_IMAGE_POLICY, ...defined }
    }
  }
  return { ...DEFAULT_COLLECT_IMAGE_POLICY }
}

export interface CollectImageVerdict {
  ok: boolean
  reason?: string
  format?: string
  width?: number
  height?: number
  hasAlpha?: boolean
  minAlpha?: number
}

function errorText(e: unknown): string {
  return String((e as any)?.message || e || '').slice(0, 160)
}

function normalizePolicy(policy: CollectImagePolicy | 'off'): Required<CollectImagePolicy> {
  const raw = { ...DEFAULT_COLLECT_IMAGE_POLICY, ...(policy || {}) }
  return {
    allowedFormats: Array.isArray(raw.allowedFormats)
      ? raw.allowedFormats
      : DEFAULT_COLLECT_IMAGE_POLICY.allowedFormats,
    requireRealAlpha: raw.requireRealAlpha !== false,
    minLongEdge: Number(raw.minLongEdge) || DEFAULT_COLLECT_IMAGE_POLICY.minLongEdge,
    minShortEdge: Number(raw.minShortEdge) || DEFAULT_COLLECT_IMAGE_POLICY.minShortEdge,
    alphaThreshold: Number(raw.alphaThreshold) || DEFAULT_COLLECT_IMAGE_POLICY.alphaThreshold,
    maxPixels: Number(raw.maxPixels) || DEFAULT_COLLECT_IMAGE_POLICY.maxPixels,
  }
}

/** 只做检查、不抛错；便于日志与统计复用 */
export async function inspectCollectImage(
  input: Buffer,
  policy: CollectImagePolicy | 'off' = DEFAULT_COLLECT_IMAGE_POLICY,
): Promise<CollectImageVerdict> {
  if (policy === 'off' || !policy) return { ok: true }
  const p = normalizePolicy(policy)
  let meta: any
  try {
    meta = await sharp(input, { limitInputPixels: false, failOn: 'none' }).metadata()
  } catch (e) {
    return { ok: false, reason: `sharp 无法解码: ${errorText(e)}` }
  }
  const format = String(meta?.format || '').toLowerCase()
  const width = Number(meta?.width || 0)
  const height = Number(meta?.height || 0)
  const hasAlpha = meta?.hasAlpha === true
  const base: CollectImageVerdict = { ok: false, format, width, height, hasAlpha }

  const allowed = p.allowedFormats.map((f) => String(f).toLowerCase())
  if (!allowed.includes(format)) {
    return { ...base, reason: `格式 ${format || '未知'} 不在白名单 [${allowed.join(',')}]` }
  }
  if (!width || !height) return { ...base, reason: '宽高为 0' }
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  if (longEdge < p.minLongEdge) {
    return { ...base, reason: `长边 ${longEdge} < ${p.minLongEdge}（疑似缩略图）` }
  }
  if (shortEdge < p.minShortEdge) {
    return { ...base, reason: `短边 ${shortEdge} < ${p.minShortEdge}（疑似缩略图）` }
  }
  if (p.requireRealAlpha) {
    if (!hasAlpha) return { ...base, reason: '无 alpha 通道（白底图）' }
    if (width * height <= p.maxPixels) {
      try {
        // stats() 只返回每通道 min/max，不生成整图 raw Buffer，比逐像素循环省内存。
        // ensureAlpha() 保证最后一个通道一定是 alpha。
        const stats = await sharp(input, { limitInputPixels: false, failOn: 'none' })
          .ensureAlpha()
          .stats()
        const channels: any[] = Array.isArray(stats?.channels) ? stats.channels : []
        const alpha = channels[channels.length - 1]
        const minAlpha = typeof alpha?.min === 'number' ? alpha.min : 255
        if (!(minAlpha < p.alphaThreshold)) {
          return { ...base, minAlpha, reason: `alpha 最小值 ${minAlpha}，全不透明（假透明 PNG）` }
        }
        return { ...base, ok: true, minAlpha }
      } catch (e) {
        return { ...base, reason: `alpha 检测失败: ${errorText(e)}` }
      }
    }
  }
  return { ...base, ok: true }
}

/** 采集链路统一入口：不合格直接 throw，调用方既有的单张失败处理会跳过该图 */
export async function assertCollectImage(
  input: Buffer,
  policy: CollectImagePolicy | 'off',
  sourceLabel?: string,
): Promise<CollectImageVerdict> {
  const verdict = await inspectCollectImage(input, policy)
  if (!verdict.ok) {
    const msg =
      `[图片质量闸门] 拒绝上传: ${verdict.reason}` +
      ` (格式=${verdict.format} 尺寸=${verdict.width}x${verdict.height} alpha=${verdict.hasAlpha})` +
      (sourceLabel ? ` 来源=${String(sourceLabel).slice(0, 180)}` : '')
    console.warn(msg)
    throw new Error(msg)
  }
  return verdict
}

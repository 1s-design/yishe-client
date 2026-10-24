/**
 * 按文件内容（magic bytes）判定图片真实格式。
 * 采集站点常出现「URL 后缀是 .jpg、实际返回 PNG」的情况，
 * 必须以后者为准，否则入库后缀与实际内容不一致，下游按后缀解码会失败。
 */

export type ImageFormat = 'jpg' | 'png' | 'gif' | 'webp' | 'bmp' | 'avif' | 'tiff' | 'svg'

/**
 * 识别图片格式；不是图片时返回 null（例如 HTML 错误页、XML、空内容）
 */
export function sniffImageFormat(buf: Buffer): ImageFormat | null {
  if (!buf || buf.length < 12) return null

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  // GIF: GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif'
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'webp'
  // BMP: BM
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp'
  // TIFF: II*\0 / MM\0*
  if (
    (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
    (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)
  ) return 'tiff'
  // AVIF: ....ftypavif / ftypavis
  if (
    buf.length > 12 &&
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70 &&
    buf[8] === 0x61 && buf[9] === 0x76 && (buf[10] === 0x69 || buf[10] === 0x76)
  ) return 'avif'
  // SVG: 文本，可能带 BOM/空白/XML 声明/注释
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '')
    .replace(/^(<!--[\s\S]*?-->\s*)*/, '')
    .replace(/^\s+/, '')
    .toLowerCase()
  if (head.startsWith('<svg') || head.startsWith('<?xml') && head.includes('<svg')) return 'svg'

  return null
}

/** 与 content-type 兜底：magic bytes 认不出时，用响应头里的 image/* 类型 */
export function formatFromContentType(contentType?: string): ImageFormat | null {
  const ct = String(contentType || '').toLowerCase()
  if (!ct.startsWith('image/')) return null
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
  if (ct.includes('png')) return 'png'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('bmp')) return 'bmp'
  if (ct.includes('avif')) return 'avif'
  if (ct.includes('tiff')) return 'tiff'
  if (ct.includes('svg')) return 'svg'
  return null
}

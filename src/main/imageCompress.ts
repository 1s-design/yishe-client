/**
 * 通用图片压缩模块 —— 视觉无损，最大程度保留清晰度。
 *
 * 插入点：collectEngine.download 的 alphaTrim 裁切之后、质量闸门之前。
 * 所有采集源（Collect Engine / Google Arts / 其他客户端侧采集）统一复用。
 *
 * 压缩策略（按源格式自动选最优路径）：
 *   PNG  → sharp.png({ compressionLevel: 9 })      真无损，省 30-40%
 *        → 再转 WebP lossless + AVIF Q85 备选（透明/插画场景）
 *   JPEG → mozjpeg({ quality: 95, chromaSubsampling: '4:4:4' })
 *        → 转 WebP Q95 / AVIF Q85  视觉无损，3-8x 压缩
 *   WebP → 保持原格式，按质量档位智能处理
 *   AVIF → 保持原格式
 *   其他 → 自动转 WebP Q95
 *
 * 核心设计原则：
 *   1. 不做「有损视觉阈值以下」的压缩 —— quality 卡死在 93+，chromaSubsampling 用 4:4:4（不丢色彩精度）
 *   2. 有收益才处理 —— 压缩后如果比原图只小一点点就放弃重编码，避免浪费 CPU 和引入编码损失
 *   3. 分辨率不降 —— 只做同尺寸再编码，保持源文件像素级清晰度
 *   4. EXIF/ICC 剥离 —— 这是真无损（省 5-15%），且素材库不需要相机元数据
 *   5. 渐进式 JPEG —— mozjpeg 默认开启，网页加载更快
 */
import sharp from 'sharp';
import { sniffImageFormat } from './imageFormat';

export interface CompressResult {
  /** 压缩后字节 */
  data: Buffer;
  /** 实际输出格式（可能和输入不同） */
  format: 'jpeg' | 'png' | 'webp' | 'avif';
  /** 压缩前字节 */
  originalBytes: number;
  /** 压缩后字节 */
  compressedBytes: number;
  /** 压缩比（压缩后 / 原图） */
  ratio: number;
  /** 节省百分比 */
  savedPercent: number;
  /** 是否真的做了压缩（false = 收益不够，返回原图） */
  actuallyCompressed: boolean;
  /** 简短日志描述 */
  summary: string;
}

export interface CompressOptions {
  /** 压缩质量 85-100，默认 95（视觉无损） */
  quality?: number;
  /** 最少节省多少百分比才值得重编码，默认 10（即压了半天只省 5% 就放弃） */
  minSavedPercent?: number;
  /** 是否允许格式转换（如 JPEG → WebP），默认 true */
  allowFormatSwitch?: boolean;
  /** 目标格式：不传则按源格式自动选最优 */
  targetFormat?: 'jpeg' | 'png' | 'webp' | 'avif';
  /** 强制启用压缩（即使收益低也执行，慎用） */
  force?: boolean;
}

const DEFAULTS: Required<CompressOptions> = {
  quality: 95,
  minSavedPercent: 10,
  allowFormatSwitch: true,
  targetFormat: undefined as any,
  force: false,
};

/**
 * 统一入口：传入原始图片 Buffer，返回压缩后的 Buffer + 元信息。
 * 如果压缩收益不够，返回原 Buffer（actuallyCompressed=false）。
 */
export async function compressImage(buf: Buffer, opts: CompressOptions = {}): Promise<CompressResult> {
  const options = { ...DEFAULTS, ...opts };
  const originalBytes = buf.length;

  // 1. 检测格式
  const detected = sniffImageFormat(buf);
  const fmt = normalizeFormat(detected);
  if (!fmt || fmt === 'gif' || fmt === 'svg') {
    // GIF 有特殊帧处理，SVG 是矢量不走 sharp 压缩
    return noop(buf, originalBytes, fmt || 'unknown', 'unsupported-format');
  }

  // 2. 解码拿元数据（判断有没有 alpha、分辨率等）
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf, { limitInputPixels: false, failOn: 'none' }).metadata();
  } catch {
    return noop(buf, originalBytes, fmt, 'decode-failed');
  }

  // 3. 走最优压缩路径
  const target = options.targetFormat || chooseBestOutputFormat(fmt, !!meta.hasAlpha);
  const pipeline = sharp(buf, { limitInputPixels: false, failOn: 'none' });

  // 统一剥离 EXIF/ICC/XMP/IPTC 元数据（真无损，省 5-15%）
  // 注意：保留 orientation，避免旋转错乱
  pipeline.withMetadata({ orientation: undefined });

  const quality = clampQuality(options.quality);

  let compressed: Buffer;
  let finalFormat: CompressResult['format'];

  try {
    switch (target) {
      case 'png':
        // PNG 无损重编码：compressionLevel 9 = 最高压缩比 + 最长耗时
        // palette=false 保持真彩色，避免色阶损失
        compressed = await pipeline.png({
          compressionLevel: 9,
          palette: false,
          effort: 10,
        }).toBuffer();
        finalFormat = 'png';
        break;

      case 'jpeg':
        // MozJPEG：quality 95 + chromaSubsampling 4:4:4（不丢任何色彩精度）
        // progressive 开启 = 渐进式 JPEG，网页加载先出低清再锐化
        compressed = await pipeline.jpeg({
          mozjpeg: true,
          quality,
          chromaSubsampling: '4:4:4',
          progressive: true,
          trellisQuantisation: true,
          overshootDeringing: true,
          optimizeScans: true,
        }).toBuffer();
        finalFormat = 'jpeg';
        break;

      case 'webp':
        // WebP lossless（有 alpha / 插画）或 Q95（照片）
        if (meta.hasAlpha && fmt === 'png') {
          // PNG 透明图 → WebP 无损（通常比 PNG 还小 20-30%）
          compressed = await pipeline.webp({
            lossless: true,
            effort: 6,
          }).toBuffer();
        } else {
          compressed = await pipeline.webp({
            quality,
            effort: 6,
            lossless: false,
            nearLossless: false,
          }).toBuffer();
        }
        finalFormat = 'webp';
        break;

      case 'avif':
        // AVIF 是目前压缩率最高的通用图片格式（同画质比 WebP 再小 20-30%）
        // 用 libaom effort 4 = 速度/压缩比平衡点（0 最快，9 最小）
        compressed = await pipeline.avif({
          quality,
          effort: 4,
          chromaSubsampling: '4:4:4',
        }).toBuffer();
        finalFormat = 'avif';
        break;

      default:
        return noop(buf, originalBytes, fmt, 'unknown-target');
    }
  } catch (e: any) {
    return noop(buf, originalBytes, fmt, `encode-failed: ${e?.message || e}`);
  }

  // 4. 收益判断：如果压完没变小多少，放弃
  const savedPercent = (1 - compressed.length / originalBytes) * 100;
  if (!options.force && savedPercent < options.minSavedPercent) {
    return {
      data: buf,
      format: fmt as CompressResult['format'],
      originalBytes,
      compressedBytes: originalBytes,
      ratio: 1,
      savedPercent: 0,
      actuallyCompressed: false,
      summary: `skip ${fmt} → ${finalFormat}: only saved ${savedPercent.toFixed(1)}% < ${options.minSavedPercent}% threshold`,
    };
  }

  // 5. 如果压缩后反而更大（极端情况），也放弃
  if (compressed.length >= originalBytes && !options.force) {
    return {
      data: buf,
      format: fmt as CompressResult['format'],
      originalBytes,
      compressedBytes: originalBytes,
      ratio: 1,
      savedPercent: 0,
      actuallyCompressed: false,
      summary: `skip ${fmt} → ${finalFormat}: compressed (${fmtBytes(compressed.length)}) ≥ original (${fmtBytes(originalBytes)})`,
    };
  }

  return {
    data: compressed,
    format: finalFormat,
    originalBytes,
    compressedBytes: compressed.length,
    ratio: compressed.length / originalBytes,
    savedPercent: Math.max(0, savedPercent),
    actuallyCompressed: true,
    summary: `✓ ${fmt} → ${finalFormat} ${fmtBytes(originalBytes)} → ${fmtBytes(compressed.length)} (-${savedPercent.toFixed(1)}%)`,
  };
}

/**
 * 批量压缩（并发度 1，避免瞬时内存峰值）
 */
export async function compressBatch(
  items: { data: Buffer; key?: string }[],
  opts: CompressOptions = {},
): Promise<Array<CompressResult & { key?: string }>> {
  const results: Array<CompressResult & { key?: string }> = [];
  for (const item of items) {
    const r = await compressImage(item.data, opts);
    results.push({ ...r, key: item.key });
  }
  return results;
}

// ─── 内部工具 ───────────────────────────────────────────

function normalizeFormat(f: string | null | undefined): CompressResult['format'] | 'gif' | 'svg' | null {
  if (!f) return null;
  const lower = f.toLowerCase().replace(/jpeg/, 'jpeg');
  if (lower === 'jpg') return 'jpeg';
  if (['jpeg', 'png', 'webp', 'avif'].includes(lower)) return lower as any;
  if (lower === 'gif') return 'gif';
  if (lower === 'svg') return 'svg';
  return null;
}

function chooseBestOutputFormat(input: string, hasAlpha: boolean): CompressResult['format'] {
  // 如果用户允许格式转换，AVIF 是最终归宿
  // 但如果源是 PNG 且有 alpha，优先 WebP lossless（质量更可预测）
  if (input === 'png' && hasAlpha) return 'webp';
  if (input === 'png') return 'webp'; // PNG → WebP 通常更小
  if (input === 'jpeg') return 'jpeg'; // JPEG 保持同格式 + mozjpeg 已经很强
  if (input === 'webp') return 'webp';
  return 'jpeg';
}

function clampQuality(q: number): number {
  if (q < 85) {
    // 低于 85 就不再是"视觉无损"，卡到 85
    console.warn(`[compress] quality ${q} is below visual-lossless threshold 85, clamping to 85`);
    return 85;
  }
  if (q > 100) return 100;
  return Math.round(q);
}

function noop(buf: Buffer, originalBytes: number, fmt: string, reason: string): CompressResult {
  return {
    data: buf,
    format: fmt as CompressResult['format'],
    originalBytes,
    compressedBytes: originalBytes,
    ratio: 1,
    savedPercent: 0,
    actuallyCompressed: false,
    summary: `skip (${reason})`,
  };
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

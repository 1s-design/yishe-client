/**
 * AI 超分推理核心
 *
 * 推理引擎使用 @xenova/transformers（基于 onnxruntime），负责：
 *   - 模型加载与缓存
 *   - 图像预处理（pad 到 window_size 倍数、归一化 /255、HWC→NCHW）
 *   - ONNX 推理
 *   - 后处理（squeeze、clamp、*255、uint8）
 *
 * 本模块只负责工程层的 tile 分块调度与接缝拼接（标准 overlap-tile 算法），
 * 不涉及模型推理细节。
 */
import sharp from 'sharp';
import { env, AutoProcessor, Swin2SRForImageSuperResolution, RawImage } from '@xenova/transformers';
import type { UpscaleModelDefinition } from './models';

// 配置 transformers.js：只用本地随包模型，不走网络
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useFS = true;
env.localModelPath = '.';

export interface UpscaleHooks {
  onProgress?: (progress: number, detail: { done: number; total: number }) => void;
  shouldCancel?: () => boolean;
}

interface LoadedModel {
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  model: Awaited<ReturnType<typeof Swin2SRForImageSuperResolution.from_pretrained>>;
}

const modelCache = new Map<string, LoadedModel>();

/**
 * 加载模型（processor + onnx session），带缓存。
 * @param modelDir 模型目录（包含 config.json / preprocessor_config.json / onnx/model.onnx）
 */
export async function loadModel(modelDir: string): Promise<LoadedModel> {
  const cached = modelCache.get(modelDir);
  if (cached) return cached;

  const [processor, model] = await Promise.all([
    AutoProcessor.from_pretrained(modelDir),
    Swin2SRForImageSuperResolution.from_pretrained(modelDir, { quantized: false }),
  ]);

  const loaded = { processor, model };
  modelCache.set(modelDir, loaded);
  return loaded;
}

/**
 * 单 tile 推理：输入一块 RGB buffer，返回放大后的 RGB buffer。
 * 预处理 / onnx / 后处理全部交给 transformers.js。
 */
async function inferTile(
  loaded: LoadedModel,
  scale: number,
  tileRgb: Uint8Array,
  tileW: number,
  tileH: number,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { processor, model } = loaded;

  // 构造 RawImage（HWC uint8）
  const image = new RawImage(tileRgb, tileW, tileH, 3);

  // processor 负责 pad + rescale + NCHW
  const inputs = await processor(image);

  // onnx 输入名可能是 'input' / 'pixel_values' 等，按 session 实际期望映射
  const feeds: Record<string, unknown> = {};
  for (const name of model.session.inputNames) {
    feeds[name] = inputs.pixel_values;
  }

  const outputs = await model(feeds);
  const outputKey = model.session.outputNames[0];
  const recon = outputs[outputKey];

  // 后处理：squeeze + clamp(0,1) + *255 + uint8 → RawImage
  const out = recon.squeeze().clamp_(0, 1).mul_(255).round_().to('uint8');
  const outImg = RawImage.fromTensor(out);

  // 裁回 tile 有效放大尺寸（去掉 processor pad 多出来的边缘）
  const targetW = tileW * scale;
  const targetH = tileH * scale;
  let finalImg = outImg;
  if (outImg.width !== targetW || outImg.height !== targetH) {
    finalImg = await outImg.crop([0, 0, targetW, targetH]);
  }

  return { data: finalImg.data as Uint8Array, width: finalImg.width, height: finalImg.height };
}

/** 从完整图像 buffer 截取一个 tile 的 RGB 数据 */
function extractTile(
  src: Uint8Array,
  srcWidth: number,
  x: number,
  y: number,
  w: number,
  h: number,
): Uint8Array {
  const out = new Uint8Array(w * h * 3);
  for (let row = 0; row < h; row++) {
    const srcRow = (y + row) * srcWidth * 3 + x * 3;
    const dstRow = row * w * 3;
    out.set(src.subarray(srcRow, srcRow + w * 3), dstRow);
  }
  return out;
}

/** 将一个输出 tile 写入完整输出 buffer，仅保留核心区域（去掉重叠边） */
function placeTile(
  dst: Uint8Array,
  dstWidth: number,
  tileData: Uint8Array,
  tileW: number,
  outX: number,
  outY: number,
  coreW: number,
  coreH: number,
  offsetX: number,
  offsetY: number,
) {
  for (let row = 0; row < coreH; row++) {
    const srcRow = (offsetY + row) * tileW * 3 + offsetX * 3;
    const dstRow = (outY + row) * dstWidth * 3 + outX * 3;
    dst.set(tileData.subarray(srcRow, srcRow + coreW * 3), dstRow);
  }
}

/**
 * 完整推理流程：解码 → tile 分块推理 → 半 overlap 拼接 → 编码。
 *
 * 每个 tile 独立调用 transformers.js 完成 pad / 推理 / 裁回，
 * 本函数只做 tile 调度和无缝拼接。
 */
export async function upscaleImage(
  modelDir: string,
  model: UpscaleModelDefinition,
  inputPath: string,
  outputPath: string,
  hooks: UpscaleHooks = {},
): Promise<void> {
  const scale = model.scale;
  const tileSize = model.tileSize;
  const overlap = model.tileOverlap;

  // 解码为 RGB raw buffer
  const { data, info } = await sharp(inputPath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;

  const outWidth = width * scale;
  const outHeight = height * scale;
  const output = new Uint8Array(outWidth * outHeight * 3);

  // 加载模型（带缓存）
  const loaded = await loadModel(modelDir);

  const step = tileSize - overlap;
  const cols = Math.max(1, Math.ceil((width - overlap) / step));
  const rows = Math.max(1, Math.ceil((height - overlap) / step));
  const total = cols * rows;
  let done = 0;

  for (let y = 0; y < height; y += step) {
    const tileH = Math.min(tileSize, height - y);
    for (let x = 0; x < width; x += step) {
      if (hooks.shouldCancel?.()) {
        throw new Error('AI 超分任务已取消');
      }
      const tileW = Math.min(tileSize, width - x);

      const tileRgb = extractTile(data, width, x, y, tileW, tileH);
      const tileResult = await inferTile(loaded, scale, tileRgb, tileW, tileH);

      // 半 overlap 中心裁剪：相邻 tile 核心区在 step 处无缝衔接
      const halfOverlap = Math.floor(overlap / 2);
      const leftOverlap = x > 0 ? halfOverlap : 0;
      const topOverlap = y > 0 ? halfOverlap : 0;
      const rightOverlap = x + tileW < width ? halfOverlap : 0;
      const bottomOverlap = y + tileH < height ? halfOverlap : 0;

      const offsetX = leftOverlap * scale;
      const offsetY = topOverlap * scale;
      let coreW = (tileW - leftOverlap - rightOverlap) * scale;
      let coreH = (tileH - topOverlap - bottomOverlap) * scale;
      let outX = (x + leftOverlap) * scale;
      let outY = (y + topOverlap) * scale;

      // 边界保护
      if (outX + coreW > outWidth) coreW = outWidth - outX;
      if (outY + coreH > outHeight) coreH = outHeight - outY;
      if (coreW <= 0 || coreH <= 0) {
        done += 1;
        continue;
      }

      placeTile(
        output,
        outWidth,
        tileResult.data,
        tileResult.width,
        outX,
        outY,
        coreW,
        coreH,
        offsetX,
        offsetY,
      );

      done += 1;
      hooks.onProgress?.(Math.round((done / total) * 100), { done, total });
    }
  }

  // 编码输出
  const ext = outputPath.split('.').pop()?.toLowerCase() || 'png';
  let pipeline = sharp(output, { raw: { width: outWidth, height: outHeight, channels: 3 } });
  if (ext === 'jpg' || ext === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: 95 });
  } else if (ext === 'webp') {
    pipeline = pipeline.webp({ quality: 95 });
  } else {
    pipeline = pipeline.png();
  }
  await pipeline.toFile(outputPath);
}

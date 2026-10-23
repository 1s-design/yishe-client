/**
 * AI 图片超分（主进程原生实现）
 *
 * 对外暴露 aiUpscale(inputPath, outputPath, params, hooks)，内部使用 onnxruntime-node
 * 加载随包分发的 ONNX 模型，无需 Web 环境、无需用户下载模型。
 */
import sharp from 'sharp';
import fs from 'fs';
import {
  DEFAULT_UPSCALE_MODEL_ID,
  UPSCALE_MODELS,
  getUpscaleModel,
  listUpscaleModels,
  type UpscaleModelDefinition,
} from './models';
import { ensureModel, isModelBundled } from './model-cache';
import { upscaleImage, type UpscaleHooks } from './inference';

export interface AiUpscaleParams {
  /** 模型 ID，默认 realesr-general-x4v3 */
  modelId?: string;
  /** 放大倍数（由模型决定，传入仅做校验） */
  scale?: number;
}

export interface AiUpscaleResult {
  model: UpscaleModelDefinition;
  modelPath: string;
}

/**
 * 对图片执行 AI 超分辨率放大。
 *
 * @param inputPath  输入图片本地路径
 * @param outputPath 输出图片本地路径（扩展名决定格式，建议 .png）
 * @param params     超分参数
 * @param hooks      进度 / 取消钩子
 */
export async function aiUpscale(
  inputPath: string,
  outputPath: string,
  params: AiUpscaleParams = {},
  hooks: UpscaleHooks = {},
): Promise<AiUpscaleResult> {
  const modelId = params.modelId || DEFAULT_UPSCALE_MODEL_ID;
  const model = getUpscaleModel(modelId);

  if (params.scale !== undefined && params.scale !== model.scale) {
    throw new Error(
      `模型 ${model.label} 仅支持 ${model.scale}x 放大，无法使用 ${params.scale}x`,
    );
  }

  // 定位模型目录（随包优先，缺失才联网下载）
  const modelDir = await ensureModel(modelId);

  // 执行推理（推理核心由 @xenova/transformers 负责）
  await upscaleImage(modelDir, model, inputPath, outputPath, hooks);

  return { model, modelPath: modelDir };
}

/** 读取图片基本信息，用于 UI 预览与体积校验 */
export async function readImageMeta(inputPath: string) {
  const meta = await sharp(inputPath).metadata();
  const stat = await sharp(inputPath).stats().catch(() => null);
  return {
    width: meta.width || 0,
    height: meta.height || 0,
    format: meta.format || '',
    hasAlpha: Boolean(meta.hasAlpha),
    sizeBytes: fs.statSync(inputPath).size,
    meanColor: stat ? stat.channels.slice(0, 3).map((c) => Math.round(c.mean)) : null,
  };
}

/** 模型清单 + 是否随包就绪，供 UI 展示 */
export function listUpscaleModelsWithStatus() {
  return UPSCALE_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    scale: m.scale,
    category: m.category,
    sizeMB: m.sizeMB,
    bundled: isModelBundled(m.id),
  }));
}

export { listUpscaleModels, getUpscaleModel, isModelBundled, DEFAULT_UPSCALE_MODEL_ID };

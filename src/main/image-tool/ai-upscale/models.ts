/**
 * AI 超分模型注册表（对齐 bg2x 支持的 10 个模型）
 * 所有模型均已随客户端打包在 resources/ai-upscale-models 下，用户无需下载。
 * 输入/输出 tensor 名留空时由推理代码自动从 session 探测。
 */

export interface UpscaleModelDefinition {
  id: string;
  label: string;
  description: string;
  /** 放大倍数 */
  scale: number;
  /** 随包分发的模型文件名 */
  file: string;
  /** 归类：anime 动漫插画 / general 通用 / photo 写实照片 */
  category: 'anime' | 'general' | 'photo';
  /** tile 推理的单块边长（px） */
  tileSize: number;
  /** tile 之间的重叠像素（消除接缝） */
  tileOverlap: number;
  /** 输入边长对齐要求（如 Swin2SR 需要 8 的倍数，不足时边缘填充后裁回） */
  align?: number;
  /** 模型体积（MB），用于展示 */
  sizeMB: number;
  /** 官方下载地址，仅作为模型缺失时的兜底 */
  url?: string;
  inputName?: string;
  outputName?: string;
}

export const UPSCALE_MODELS: UpscaleModelDefinition[] = [
  {
    id: 'realesr-general-x4v3',
    label: 'Real-ESRGAN General x4v3',
    description: '通用场景 4x 超分，速度快，适合大多数照片与截图，推荐日常使用',
    scale: 4,
    file: 'realesr-general-x4v3.onnx',
    category: 'general',
    tileSize: 256,
    tileOverlap: 16,
    sizeMB: 4.9,
    url: 'https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/main/realesr-general-x4v3.onnx',
  },
  {
    id: 'real-esrgan-x4plus',
    label: 'Real-ESRGAN x4plus',
    description: '通用写实 4x 超分，细节还原最完整，速度较慢，适合高质量出图',
    scale: 4,
    file: 'real-esrgan-x4plus.onnx',
    category: 'photo',
    tileSize: 192,
    tileOverlap: 16,
    sizeMB: 64,
    url: 'https://huggingface.co/SceneWorks/real-esrgan-onnx/resolve/main/real_esrgan_x4.onnx',
  },
  {
    id: 'real-esrgan-animevideov3',
    label: 'Real-ESRGAN AnimeVideo v3',
    description: '轻量动漫视频 4x 超分，体积最小速度最快，适合动漫截图与线稿',
    scale: 4,
    file: 'real-esrgan-animevideov3.onnx',
    category: 'anime',
    tileSize: 256,
    tileOverlap: 16,
    sizeMB: 2.4,
    url: 'https://huggingface.co/skillsafe-ai/realesr-animevideov3/resolve/main/model.onnx',
  },
  {
    id: 'real-esrgan-x4plus-anime-6b',
    label: 'Real-ESRGAN x4plus Anime',
    description: '动漫插画 4x 超分，6B 大模型，细节最细腻，速度偏慢',
    scale: 4,
    file: 'real-esrgan-x4plus-anime-6b.onnx',
    category: 'anime',
    tileSize: 192,
    tileOverlap: 16,
    sizeMB: 17.9,
    url: 'https://huggingface.co/deepghs/imgutils-models/resolve/main/real_esrgan/RealESRGAN_x4plus_anime_6B.onnx',
  },
  {
    id: 'real-esrgan-x4plus-anime-4b32f',
    label: 'Real-ESRGAN x4plus Anime 4B32F',
    description: '动漫插画 4x 超分，体积小细节好，动漫场景性价比最高',
    scale: 4,
    file: 'real-esrgan-x4plus-anime-4b32f.onnx',
    category: 'anime',
    tileSize: 256,
    tileOverlap: 16,
    sizeMB: 5.2,
    url: 'https://huggingface.co/deepghs/imgutils-models/resolve/main/real_esrgan/RealESRGAN_x4plus_anime_4B32F.onnx',
  },
  {
    id: 'real-cugan-2x',
    label: 'Real-CUGAN 2x (HFA2k)',
    description: '二次元 2x 超分，放大一倍、降噪效果好，速度快',
    scale: 2,
    file: 'real-cugan-2x.onnx',
    category: 'anime',
    tileSize: 256,
    tileOverlap: 16,
    sizeMB: 5.2,
    url: 'https://huggingface.co/nesaorg/2xHFA2kReal-CUGAN_fp32_opset17/resolve/main/2xHFA2kReal-CUGAN_fp32_opset17.onnx',
  },
  {
    id: 'swin2sr-lightweight-x2',
    label: 'Swin2SR Lightweight x2',
    description: '轻量 Transformer 2x 超分，画质细腻，速度中等',
    scale: 2,
    file: 'swin2sr-lightweight-x2.onnx',
    category: 'general',
    tileSize: 128,
    tileOverlap: 8,
    align: 8,
    sizeMB: 8.1,
    url: 'https://huggingface.co/Xenova/swin2SR-lightweight-x2-64/resolve/main/onnx/model.onnx',
  },
  {
    id: 'swin2sr-classical-x4',
    label: 'Swin2SR Classical x4',
    description: 'Transformer 4x 超分，经典退化模型，画质好但速度很慢',
    scale: 4,
    file: 'swin2sr-classical-x4.onnx',
    category: 'photo',
    tileSize: 128,
    tileOverlap: 8,
    align: 8,
    sizeMB: 55,
    url: 'https://huggingface.co/Xenova/swin2SR-classical-sr-x4-64/resolve/main/onnx/model.onnx',
  },
  {
    id: 'swin2sr-realworld-x4',
    label: 'Swin2SR RealWorld x4',
    description: '面向真实世界照片的 Transformer 4x 超分，适合手机照片，速度很慢',
    scale: 4,
    file: 'swin2sr-realworld-x4.onnx',
    category: 'photo',
    tileSize: 128,
    tileOverlap: 8,
    align: 8,
    sizeMB: 53,
    url: 'https://huggingface.co/Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr/resolve/main/onnx/model.onnx',
  },
  {
    id: 'swin2sr-compressed-x4',
    label: 'Swin2SR Compressed x4',
    description: '针对 JPEG 压缩痕迹优化的 Transformer 4x 超分，适合压缩过度的老图，速度很慢',
    scale: 4,
    file: 'swin2sr-compressed-x4.onnx',
    category: 'photo',
    tileSize: 128,
    tileOverlap: 8,
    align: 8,
    sizeMB: 55,
    url: 'https://huggingface.co/Xenova/swin2SR-compressed-sr-x4-48/resolve/main/onnx/model.onnx',
  },
];

export const DEFAULT_UPSCALE_MODEL_ID = 'realesr-general-x4v3';

export function getUpscaleModel(modelId: string): UpscaleModelDefinition {
  const model = UPSCALE_MODELS.find((m) => m.id === modelId);
  if (!model) {
    throw new Error(
      `不支持的超分模型: ${modelId}，可选: ${UPSCALE_MODELS.map((m) => m.id).join(', ')}`,
    );
  }
  return model;
}

export function listUpscaleModels() {
  return UPSCALE_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    scale: m.scale,
    category: m.category,
    sizeMB: m.sizeMB,
  }));
}

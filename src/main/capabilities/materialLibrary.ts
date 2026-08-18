/**
 * 客户端通用能力 — 素材库上传
 * 将本地文件上传到用户素材库（COS + 服务端 sticker 表）。
 * 所有采集平台（google-art / pinterest / wikimedia / …）与后续新工具均可复用，
 * 避免各平台重复实现上传链路。
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { uploadToMaterialLibrary } from '../materialLibrary';

// ─── material_upload ─────────────────────────────────────
const materialUploadDef: CapabilityDefinition = {
  name: 'upload',
  namespace: 'materialLibrary',
  description:
    '将本地文件上传到用户的素材库（COS + 服务端贴纸库 sticker 表）。用于任意采集/生成的图片、文件入库。',
  riskLevel: 'write',
  argsSchema: z.object({
    filePath: z.string().describe('要上传的本地文件绝对路径'),
    category: z
      .string()
      .optional()
      .default('agent-upload')
      .describe('COS 路径分类与素材分组，如 google-art / pinterest / wikimedia / custom'),
    title: z.string().optional().describe('素材标题'),
    description: z.string().optional().describe('素材描述'),
    source: z.string().optional().describe('来源描述，如 Google Arts & Culture - MoMA'),
    originUrl: z.string().optional().describe('原始来源链接'),
    keywords: z.array(z.string()).optional().describe('中文关键词列表'),
    keywordsEn: z.array(z.string()).optional().describe('英文关键词列表'),
    meta: z.record(z.string(), z.any()).optional().describe('扩展元数据，会写入素材的 meta 字段'),
  }),
  async handler(args: {
    filePath: string;
    category?: string;
    title?: string;
    description?: string;
    source?: string;
    originUrl?: string;
    keywords?: string[];
    keywordsEn?: string[];
    meta?: Record<string, any>;
  }) {
    const filePath = path.resolve(args.filePath);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { success: false, error: `文件不存在或不是文件: ${filePath}` };
    }

    const category = args.category || 'agent-upload';
    const fileName = path.basename(filePath);
    const title =
      args.title || fileName.replace(/\.(jpg|png|jpeg|webp|gif|svg)$/i, '');

    const result = await uploadToMaterialLibrary(filePath, fileName, {
      category,
      group: category,
      source: args.source || 'agent',
      originUrl: args.originUrl || '',
      suffix: path.extname(fileName).replace(/^\./, '') || 'jpg',
      name: title,
      nameEn: title,
      description: args.description || '',
      descriptionEn: args.description || '',
      keywords: (args.keywords || []).join(','),
      keywordsEn: (args.keywordsEn || args.keywords || []).join(','),
      colorPalette: '',
      meta: {
        title,
        source: 'agent',
        ...(args.meta || {}),
      },
    });

    if (!result.ok) {
      return { success: false, error: result.msg || '素材库上传失败' };
    }
    return { success: true, data: { materialLibraryOk: true, fileName, fileSize: fs.statSync(filePath).size } };
  },
};

/** 注册素材库通用能力 */
export function registerMaterialLibraryCapabilities(): void {
  CapabilityRegistry.registerAll([materialUploadDef]);
}
/**
 * 客户端通用能力 — Magnific 视频素材
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchMagnific,
  getMagnificStatus,
  downloadMagnificFile,
  syncMagnificToMaterialLibrary,
  type MagnificItem,
  type MagnificResourceType,
} from '../magnific';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  pages?: number;
  perPage?: number;
  items: MagnificItem[];
  page?: number;
  nextPage?: number | null;
  error?: string;
}) {
  return {
    success: result.success,
    query: result.query,
    count: result.count,
    total: result.total ?? null,
    pages: result.pages ?? null,
    perPage: result.perPage ?? null,
    page: result.page ?? 1,
    nextPage: result.nextPage ?? null,
    error: result.error || null,
    items: (result.items || []).map((item) => ({
      id: item.id,
      name: item.name,
      title: item.title,
      description: item.description,
      mediaType: item.mediaType,
      resourceType: item.resourceType,
      fileUrl: item.fileUrl, // 采集目标直链（视频=clear mp4；图标=512 PNG；图片=放大预览 jpg）
      videoUrl: item.videoUrl,
      previewUrl: item.previewUrl,
      image: item.image,
      thumbnail: item.thumbnail,
      link: item.link,
      url: item.url,
      duration: item.duration ?? null,
      quality: item.quality || null,
      premium: item.premium ?? false,
      isAIGenerated: item.isAIGenerated ?? false,
      itemSubtype: item.itemSubtype || null,
      width: item.width ?? null,
      height: item.height ?? null,
      author: item.author || null,
      license: item.license || 'Magnific Free',
      tags: item.tags || '',
      suffix: item.suffix,
    })),
  };
}

// ─── magnific.search ─────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'magnific',
  description: '在 Magnific 搜索素材：视频（无水印预览 mp4）、图标（免费 PNG）、图片/矢量（预览 jpg）。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, city, nature'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20).describe('仅视频类型生效（图标固定96/页、图片固定50/页）'),
    resourceType: z.enum(['video', 'icon', 'photo', 'vector']).optional().default('video').describe('资源类型'),
    license: z.enum(['free', 'premium', 'all']).optional().default('free').describe('仅视频：free=无水印，premium=带水印，all=全部'),
    order: z.enum(['relevance', 'recent']).optional().default('relevance'),
    iconType: z.enum(['standard', 'animated', 'all']).optional().default('standard').describe('仅图标：standard=静态，animated=动图，all=混合'),
  }),
  async handler(args: {
    keyword: string;
    page?: number;
    limit?: number;
    resourceType?: MagnificResourceType;
    license?: 'free' | 'premium' | 'all';
    order?: 'relevance' | 'recent';
    iconType?: 'standard' | 'animated' | 'all';
  }) {
    const rawResult = await searchMagnific(args.keyword, {
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      resourceType: args.resourceType,
      license: args.license,
      order: args.order,
      iconType: args.iconType,
    });
    return normalizeSearchResult(rawResult);
  },
};

// ─── magnific.download ───────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'magnific',
  description: '下载 Magnific 素材文件（视频 mp4 / 图标 PNG / 图片 jpg）到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    fileUrl: z.string().describe('素材直连地址（视频=签名 mp4，图标=PNG，图片=预览 jpg）'),
    filename: z.string().optional().describe('自定义保存文件名（不含扩展名）'),
    suffix: z.string().optional().describe('文件后缀 mp4|png|jpg，缺省按 URL 推断'),
  }),
  async handler(args: { fileUrl: string; filename?: string; suffix?: string }) {
    const res = await downloadMagnificFile(args.fileUrl, {
      filename: args.filename,
      suffix: args.suffix,
    });
    return {
      success: res.success,
      filePath: res.filePath || null,
      error: res.error || null,
    };
  },
};

// ─── magnific.collect ────────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'magnific',
  description: '将 Magnific 素材（视频/图标/图片）下载并上传至 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    fileUrl: z.string().describe('素材直连地址'),
    title: z.string().optional().describe('素材标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  async handler(args: { fileUrl: string; title?: string; metadata?: Record<string, any> }) {
    const res = await syncMagnificToMaterialLibrary('local', {
      fileUrl: args.fileUrl,
      metadata: {
        title: args.title,
        ...(args.metadata || {}),
      },
    });
    return {
      success: res.success,
      localFilePath: res.localFilePath || null,
      cosUrl: res.cosUrl || null,
      error: res.error || null,
    };
  },
};

// ─── magnific.status ─────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'magnific',
  description: '获取 Magnific 服务连接状态与能力列表。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getMagnificStatus();
    return {
      success: st.connected,
      ...st,
    };
  },
};

/** 注册 Magnific 通用能力 */
export function registerMagnificCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

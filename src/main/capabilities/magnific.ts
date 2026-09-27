/**
 * 客户端通用能力 — Magnific 视频素材
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchMagnific,
  getMagnificStatus,
  downloadMagnificVideo,
  syncMagnificToMaterialLibrary,
  type MagnificVideo,
} from '../magnific';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  pages?: number;
  items: MagnificVideo[];
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
    page: result.page ?? 1,
    nextPage: result.nextPage ?? null,
    error: result.error || null,
    items: (result.items || []).map((item) => ({
      id: item.id,
      name: item.name,
      title: item.title,
      description: item.description,
      mediaType: 'video' as const,
      videoUrl: item.videoUrl, // 无水印预览 mp4
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
      license: item.license || 'Magnific Free (clear preview)',
      tags: item.tags || '',
    })),
  };
}

// ─── magnific.search ─────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'magnific',
  description: '在 Magnific 搜索免费商业视频素材（无水印预览 mp4）。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, city, nature'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    license: z.enum(['free', 'premium', 'all']).optional().default('free').describe('free=仅免费(无水印)，premium=仅付费(带水印)，all=全部'),
    order: z.enum(['relevance', 'recent']).optional().default('relevance'),
  }),
  async handler(args: {
    keyword: string;
    page?: number;
    limit?: number;
    license?: 'free' | 'premium' | 'all';
    order?: 'relevance' | 'recent';
  }) {
    const rawResult = await searchMagnific(args.keyword, {
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      license: args.license,
      order: args.order,
    });
    return normalizeSearchResult(rawResult);
  },
};

// ─── magnific.download ───────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'magnific',
  description: '下载 Magnific 视频预览文件到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    videoUrl: z.string().describe('预览 mp4 直连地址（签名 CDN URL）'),
    filename: z.string().optional().describe('自定义保存文件名（不含扩展名）'),
  }),
  async handler(args: { videoUrl: string; filename?: string }) {
    const res = await downloadMagnificVideo(args.videoUrl, {
      filename: args.filename,
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
  description: '将 Magnific 视频素材下载并上传至 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    videoUrl: z.string().describe('预览 mp4 直连地址（签名 CDN URL）'),
    title: z.string().optional().describe('素材标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  async handler(args: { videoUrl: string; title?: string; metadata?: Record<string, any> }) {
    const res = await syncMagnificToMaterialLibrary('local', {
      videoUrl: args.videoUrl,
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

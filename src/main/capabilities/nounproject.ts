/**
 * 客户端通用能力 — The Noun Project 图标与摄影图库
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchNounProject,
  getNounProjectStatus,
  downloadNounProjectAsset,
  syncNounProjectToMaterialLibrary,
  type NounProjectAsset,
} from '../nounproject';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: NounProjectAsset[];
  page?: number;
  totalPages?: number;
  nextPage?: number | null;
  error?: string;
}) {
  return {
    success: result.success,
    query: result.query,
    count: result.count,
    total: result.total ?? result.count,
    page: result.page ?? 1,
    totalPages: result.totalPages ?? 1,
    nextPage: result.nextPage ?? null,
    error: result.error || null,
    items: (result.items || []).map((item) => ({
      id: item.id,
      name: item.name,
      title: item.title,
      image: item.image,
      svgUrl: item.svgUrl,
      pngUrl: item.pngUrl,
      thumbnail: item.thumbnail,
      downloadUrl: item.downloadUrl || item.svgUrl || item.pngUrl || item.image,
      link: item.link,
      url: item.url,
      author: item.author || 'Noun Project Community',
      license: item.license || 'Creative Commons / Royalty-free',
      isFree: item.isFree ?? true,
      format: item.format || 'svg',
      tags: item.tags || '',
    })),
  };
}

// ─── nounproject.search ───────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'nounproject',
  description: '在 The Noun Project 搜索图标或摄影图素材，支持 Photos 与 Icons 双模式。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, app, flower, banner'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    maxCount: z.number().optional().default(20),
    pageSize: z.number().optional().default(20),
    mediaType: z.string().optional().describe('搜索模式：photos 或 icons'),
    color: z.string().optional().describe('可选颜色筛选'),
  }),
  async handler(args: {
    keyword: string;
    page?: number;
    limit?: number;
    maxCount?: number;
    pageSize?: number;
    mediaType?: string;
    color?: string;
  }) {
    console.log('[Noun Project Capability] search 收到调用:', JSON.stringify(args));
    const limit = args.limit || args.maxCount || args.pageSize || 20;
    const mediaType = (args.mediaType || 'icons').toLowerCase().includes('photo') ? 'photos' : 'icons';
    const rawResult = await searchNounProject(args.keyword, {
      page: args.page ?? 1,
      limit,
      mediaType,
      color: args.color,
    });
    console.log(`[Noun Project Capability] search 完成，获取 ${rawResult.items?.length || 0} 条结果`);
    return normalizeSearchResult(rawResult);
  },
};

// ─── nounproject.download ─────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'nounproject',
  description: '下载 The Noun Project SVG/PNG/JPG 素材到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('素材下载地址（SVG/PNG/JPG）'),
    filename: z.string().optional().describe('自定义保存文件名'),
    format: z.string().optional().describe('保存格式偏好 (svg, png, jpg)'),
  }),
  async handler(args: { imageUrl: string; filename?: string; format?: string }) {
    console.log('[Noun Project Capability] download 收到调用:', args.imageUrl);
    const res = await downloadNounProjectAsset(args.imageUrl, {
      filename: args.filename,
      format: args.format as any,
    });
    return {
      success: res.success,
      filePath: res.filePath || null,
      filename: res.filename || null,
      error: res.error || null,
    };
  },
};

// ─── nounproject.collect ──────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'nounproject',
  description: '将 The Noun Project 素材下载并上传至用户个人 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('素材直连地址'),
    title: z.string().optional().describe('素材标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  async handler(args: { imageUrl: string; title?: string; metadata?: Record<string, any> }) {
    console.log('[Noun Project Capability] collect 收到调用:', JSON.stringify(args, null, 2));
    const res = await syncNounProjectToMaterialLibrary('local', {
      imageUrl: args.imageUrl,
      metadata: {
        title: args.title,
        ...(args.metadata || {}),
      },
    });
    console.log('[Noun Project Capability] collect 返回结果:', JSON.stringify(res, null, 2));
    return {
      success: res.success,
      localFilePath: res.localFilePath || null,
      cosUrl: res.cosUrl || null,
      error: res.error || null,
    };
  },
};

// ─── nounproject.status ───────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'nounproject',
  description: '获取 The Noun Project 服务连通性与能力状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getNounProjectStatus();
    return {
      success: st.connected,
      ...st,
    };
  },
};

/** 注册 The Noun Project 通用能力 */
export function registerNounProjectCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

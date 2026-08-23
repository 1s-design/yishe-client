/**
 * 客户端通用能力 — Vecteezy 免版税素材
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchVecteezy,
  getVecteezyStatus,
  downloadVecteezyAsset,
  syncVecteezyToMaterialLibrary,
  type VecteezyAsset,
} from '../vecteezy';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: VecteezyAsset[];
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
      description: item.description,
      image: item.image,
      svgUrl: item.svgUrl,
      pngUrl: item.pngUrl,
      jpgUrl: item.jpgUrl,
      thumbnail: item.thumbnail,
      downloadUrl: item.downloadUrl || item.image,
      link: item.link,
      url: item.url,
      width: item.width ?? null,
      height: item.height ?? null,
      author: item.author || 'Vecteezy Contributor',
      license: item.license || 'Vecteezy Free License',
      isFree: true,
      format: item.format,
      mediaType: item.mediaType,
    })),
  };
}

// ─── vecteezy.search ───────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'vecteezy',
  description: '在 Vecteezy 搜索免版税摄影图片、透明 PNG 或矢量插画素材。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, nature, business'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    maxCount: z.number().optional().default(20),
    pageSize: z.number().optional().default(20),
    mediaType: z.string().optional().describe('素材类型 (photos, png, vector)'),
  }),
  async handler(args: { keyword: string; page?: number; limit?: number; maxCount?: number; pageSize?: number; mediaType?: string }) {
    console.log('[Vecteezy Capability] search 收到调用:', JSON.stringify(args));
    const limit = args.limit || args.maxCount || args.pageSize || 20;
    const rawResult = await searchVecteezy(args.keyword, {
      page: args.page ?? 1,
      limit,
      mediaType: (args.mediaType as any) || 'photos',
    });
    console.log(`[Vecteezy Capability] search 完成，获取 ${rawResult.items?.length || 0} 条结果`);
    return normalizeSearchResult(rawResult);
  },
};

// ─── vecteezy.download ─────────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'vecteezy',
  description: '下载 Vecteezy 素材到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('素材下载地址'),
    filename: z.string().optional().describe('自定义保存文件名'),
    format: z.string().optional().describe('保存格式 (svg, png, jpg)'),
  }),
  async handler(args: { imageUrl: string; filename?: string; format?: string }) {
    console.log('[Vecteezy Capability] download 收到调用:', args.imageUrl);
    const res = await downloadVecteezyAsset(args.imageUrl, {
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

// ─── vecteezy.collect ──────────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'vecteezy',
  description: '将 Vecteezy 素材下载并上传至用户个人 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('素材图片直连地址'),
    title: z.string().optional().describe('素材标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  async handler(args: { imageUrl: string; title?: string; metadata?: Record<string, any> }) {
    console.log('[Vecteezy Capability] collect 收到调用:', JSON.stringify(args, null, 2));
    const res = await syncVecteezyToMaterialLibrary('local', {
      imageUrl: args.imageUrl,
      metadata: {
        title: args.title,
        ...(args.metadata || {}),
      },
    });
    console.log('[Vecteezy Capability] collect 返回结果:', JSON.stringify(res, null, 2));
    return {
      success: res.success,
      localFilePath: res.localFilePath || null,
      cosUrl: res.cosUrl || null,
      error: res.error || null,
    };
  },
};

// ─── vecteezy.status ───────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'vecteezy',
  description: '获取 Vecteezy 服务连通性与能力状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getVecteezyStatus();
    return {
      success: st.connected,
      ...st,
    };
  },
};

/** 注册 Vecteezy 通用能力 */
export function registerVecteezyCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

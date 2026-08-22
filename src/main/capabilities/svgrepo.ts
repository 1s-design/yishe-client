/**
 * 客户端通用能力 — SVGRepo 50万+开源矢量图库
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchSvgrepo,
  getSvgrepoStatus,
  downloadSvgrepoImage,
  syncSvgrepoToMaterialLibrary,
  type SvgrepoItem,
} from '../svgrepo';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: SvgrepoItem[];
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
      thumbnail: item.thumbnail,
      downloadUrl: item.downloadUrl || item.svgUrl,
      link: item.link,
      url: item.url,
      style: item.style || 'monotone',
      author: item.author || 'SVGRepo',
      license: item.license || 'CC0 / Open Source',
      isFree: true,
    })),
  };
}

// ─── svgrepo.search ─────────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'svgrepo',
  description: '在 SVGRepo 搜索 50万+ 开源矢量图标与插画素材。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 dog, cat, animal, tech'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(24),
    style: z.string().optional().default('all'),
  }),
  async handler(args: { keyword: string; page?: number; limit?: number; style?: string }) {
    const cleanStyle = args.style && args.style.trim() && args.style !== 'all' ? args.style.trim() : undefined;
    const rawResult = await searchSvgrepo(args.keyword, {
      page: args.page ?? 1,
      limit: args.limit ?? 24,
      style: cleanStyle,
    });
    return normalizeSearchResult(rawResult);
  },
};

// ─── svgrepo.download ───────────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'svgrepo',
  description: '下载 SVGRepo SVG 矢量文件到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('SVG 矢量文件下载地址'),
    filename: z.string().optional().describe('自定义保存文件名'),
  }),
  async handler(args: { imageUrl: string; filename?: string }) {
    const res = await downloadSvgrepoImage(args.imageUrl, {
      filename: args.filename,
    });
    return {
      success: res.success,
      filePath: res.filePath || null,
      filename: res.filename || null,
      error: res.error || null,
    };
  },
};

// ─── svgrepo.collect ────────────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'svgrepo',
  description: '将 SVGRepo 矢量图素材下载并上传至用户个人 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('SVG 矢量图片直连地址'),
    title: z.string().optional().describe('素材标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  async handler(args: { imageUrl: string; title?: string; metadata?: Record<string, any> }) {
    const res = await syncSvgrepoToMaterialLibrary('local', {
      imageUrl: args.imageUrl,
      metadata: {
        title: args.title,
        ...(args.metadata || {}),
      },
    });
    return {
      success: res.success,
      message: res.message || (res.success ? '已成功下载 SVGRepo 矢量图并上传入库' : res.error),
      materialId: res.materialId || null,
      cosUrl: res.cosUrl || null,
      localFilePath: res.localFilePath || null,
      data: res.data || null,
      error: res.error || null,
    };
  },
};

// ─── svgrepo.status ─────────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'svgrepo',
  description: '获取 SVGRepo 服务连通性与能力状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getSvgrepoStatus();
    return {
      success: st.connected,
      ...st,
    };
  },
};

/** 注册 svgrepo 通用能力 */
export function registerSvgrepoCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

/**
 * 客户端通用能力 — Openclipart 免费矢量插画图库
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchOpenclipart,
  getOpenclipartStatus,
  downloadOpenclipartImage,
  syncOpenclipartToMaterialLibrary,
  type OpenclipartPhoto,
} from '../openclipart';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: OpenclipartPhoto[];
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
      image: item.image, // 2000px 超清 PNG 或 SVG
      svgUrl: item.svgUrl,
      pngUrl: item.pngUrl,
      thumbnail: item.thumbnail,
      downloadUrl: item.downloadUrl || item.svgUrl,
      link: item.link,
      url: item.url,
      width: item.width ?? 2000,
      height: item.height ?? 2000,
      author: item.author || 'Openclipart Community',
      license: item.license || 'CC0 1.0 Universal (Public Domain)',
      isFree: true,
    })),
  };
}

// ─── openclipart.search ───────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'openclipart',
  description: '在 Openclipart 搜索 CC0 免费商用矢量插画与超清透明背景图素材。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, robot, flower, banner'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    formatPreference: z.enum(['svg', 'png']).optional().describe('偏好格式：svg 或 png'),
  }),
  async handler(args: { keyword: string; page?: number; limit?: number; formatPreference?: 'svg' | 'png' }) {
    const rawResult = await searchOpenclipart(args.keyword, {
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      formatPreference: args.formatPreference,
    });
    return normalizeSearchResult(rawResult);
  },
};

// ─── openclipart.download ─────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'openclipart',
  description: '下载 Openclipart 矢量 SVG 或超清 PNG 素材到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('矢量 SVG 或超清 PNG 直连下载地址'),
    filename: z.string().optional().describe('自定义保存文件名'),
    format: z.enum(['svg', 'png']).optional().describe('保存格式偏好'),
  }),
  async handler(args: { imageUrl: string; filename?: string; format?: 'svg' | 'png' }) {
    const res = await downloadOpenclipartImage(args.imageUrl, {
      filename: args.filename,
      format: args.format,
    });
    return {
      success: res.success,
      filePath: res.filePath || null,
      filename: res.filename || null,
      error: res.error || null,
    };
  },
};

// ─── openclipart.collect ──────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'openclipart',
  description: '将 Openclipart 矢量插画素材下载并上传至用户个人 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('矢量 SVG 或超清 PNG 图片直连地址'),
    title: z.string().optional().describe('素材标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  async handler(args: { imageUrl: string; title?: string; metadata?: Record<string, any> }) {
    const res = await syncOpenclipartToMaterialLibrary('local', {
      imageUrl: args.imageUrl,
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

// ─── openclipart.status ───────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'openclipart',
  description: '获取 Openclipart 服务连通性与能力状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getOpenclipartStatus();
    return {
      success: st.connected,
      ...st,
    };
  },
};

/** 注册 Openclipart 通用能力 */
export function registerOpenclipartCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

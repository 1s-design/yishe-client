/**
 * 客户端通用能力 — undraw 开源插画图库
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchUndraw,
  getUndrawStatus,
  downloadUndrawImage,
  syncUndrawToMaterialLibrary,
  type UndrawPhoto,
} from '../undraw';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: UndrawPhoto[];
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
      color: item.color,
      defaultColor: item.defaultColor,
      width: item.width ?? 1000,
      height: item.height ?? 1000,
      author: item.author || 'undraw / Katerina Limpitsouni',
      license: item.license || 'Free for commercial and personal use',
      isFree: true,
    })),
  };
}

// ─── undraw.search ─────────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'undraw',
  description: '在 undraw 搜索开源插画素材，支持自定义主题色。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, robot, flower, banner'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    color: z.string().optional().describe('自定义主题色 (hex, 如 #6C63FF)'),
  }),
  async handler(args: { keyword: string; page?: number; limit?: number; color?: string }) {
    const rawResult = await searchUndraw(args.keyword, {
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      color: args.color,
    });
    return normalizeSearchResult(rawResult);
  },
};

// ─── undraw.download ───────────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'undraw',
  description: '下载 undraw SVG 插画矢量文件到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('SVG 矢量文件下载地址'),
    filename: z.string().optional().describe('自定义保存文件名'),
    color: z.string().optional().describe('自定义主题色'),
  }),
  async handler(args: { imageUrl: string; filename?: string; color?: string }) {
    const res = await downloadUndrawImage(args.imageUrl, {
      filename: args.filename,
      color: args.color,
    });
    return {
      success: res.success,
      filePath: res.filePath || null,
      filename: res.filename || null,
      error: res.error || null,
    };
  },
};

// ─── undraw.collect ────────────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'undraw',
  description: '将 undraw 插画素材下载并上传至用户个人 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('SVG 矢量图片直连地址'),
    title: z.string().optional().describe('素材标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  async handler(args: { imageUrl: string; title?: string; metadata?: Record<string, any> }) {
    const res = await syncUndrawToMaterialLibrary('local', {
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

// ─── undraw.status ─────────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'undraw',
  description: '获取 undraw 服务连通性与能力状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getUndrawStatus();
    return {
      success: st.connected,
      ...st,
    };
  },
};

/** 注册 undraw 通用能力 */
export function registerUndrawCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

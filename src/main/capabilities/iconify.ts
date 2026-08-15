/**
 * 客户端通用能力 — Iconify 图标聚合平台
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchIconify,
  getIconifyStatus,
  downloadIconifyIcon,
  syncIconifyToMaterialLibrary,
  type IconifyIcon,
} from '../iconify';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: IconifyIcon[];
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
      thumbnail: item.thumbnail,
      downloadUrl: item.downloadUrl || item.svgUrl,
      link: item.link,
      url: item.url,
      prefix: item.prefix,
      tags: item.tags,
      width: item.width ?? 24,
      height: item.height ?? 24,
      author: item.author || 'Iconify',
      license: item.license || 'Apache 2.0 / MIT / CC BY 4.0',
      isFree: true,
    })),
  };
}

// ─── iconify.search ───────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'iconify',
  description: '在 Iconify 搜索 200,000+ 矢量图标，支持 100+ 图标集（Material Icons, Font Awesome, Heroicons 等）。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, home, user, arrow, heart'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    prefix: z.string().optional().describe('过滤指定图标集，如 mdi, fa, heroicons'),
    color: z.string().optional().describe('自定义图标颜色 (hex, 如 #6C63FF)'),
  }),
  async handler(args: { keyword: string; page?: number; limit?: number; prefix?: string; color?: string }) {
    const rawResult = await searchIconify(args.keyword, {
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      prefix: args.prefix,
      color: args.color,
    });
    return normalizeSearchResult(rawResult);
  },
};

// ─── iconify.download ─────────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'iconify',
  description: '下载 Iconify SVG 矢量图标到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('SVG 矢量图标下载地址'),
    filename: z.string().optional().describe('自定义保存文件名'),
    color: z.string().optional().describe('自定义图标颜色'),
  }),
  async handler(args: { imageUrl: string; filename?: string; color?: string }) {
    const res = await downloadIconifyIcon(args.imageUrl, {
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

// ─── iconify.collect ──────────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'iconify',
  description: '将 Iconify 矢量图标下载并上传至用户个人 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('SVG 矢量图标直连地址'),
    title: z.string().optional().describe('图标标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  async handler(args: { imageUrl: string; title?: string; metadata?: Record<string, any> }) {
    const res = await syncIconifyToMaterialLibrary('local', {
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

// ─── iconify.status ───────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'iconify',
  description: '获取 Iconify 服务连通性与能力状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getIconifyStatus();
    return {
      success: st.connected,
      ...st,
    };
  },
};

/** 注册 Iconify 通用能力 */
export function registerIconifyCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

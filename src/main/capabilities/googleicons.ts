/**
 * 客户端通用能力 — Google Material Icons
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchGoogleIcons,
  getGoogleIconsStatus,
  downloadGoogleIcon,
  syncGoogleIconsToMaterialLibrary,
  type GoogleIcon,
} from '../googleicons';

function normalizeSearchResult(result: {
  success: boolean; query: string; count: number; total?: number;
  items: GoogleIcon[]; page?: number; totalPages?: number; nextPage?: number | null; error?: string;
}) {
  return {
    success: result.success, query: result.query, count: result.count,
    total: result.total ?? result.count, page: result.page ?? 1,
    totalPages: result.totalPages ?? 1, nextPage: result.nextPage ?? null,
    error: result.error || null,
    items: (result.items || []).map((item) => ({
      id: item.id, name: item.name, title: item.title, description: item.description,
      image: item.image, svgUrl: item.svgUrl, pngUrl: item.pngUrl, thumbnail: item.thumbnail,
      downloadUrl: item.downloadUrl || item.svgUrl, link: item.link, url: item.url,
      group: item.group, style: item.style, tags: item.tags,
      author: item.author || 'Google', license: item.license || 'Apache License 2.0', isFree: true,
    })),
  };
}

const searchDef: CapabilityDefinition = {
  name: 'search', namespace: 'google-icons',
  description: '在 Google Material Icons 搜索图标素材，支持多种风格。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, heart, home'),
    page: z.number().optional().default(1), limit: z.number().optional().default(20),
    style: z.enum(['outlined', 'rounded', 'sharp', 'two-tone']).optional().describe('图标风格'),
    size: z.number().optional().describe('图标尺寸 (20/24/40/48)'),
  }),
  async handler(args: { keyword: string; page?: number; limit?: number; style?: 'outlined' | 'rounded' | 'sharp' | 'two-tone'; size?: number }) {
    return normalizeSearchResult(await searchGoogleIcons(args.keyword, {
      page: args.page ?? 1, limit: args.limit ?? 20, style: args.style, size: args.size,
    }));
  },
};

const downloadDef: CapabilityDefinition = {
  name: 'download', namespace: 'google-icons',
  description: '下载 Google Material Icon SVG/PNG 到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({ imageUrl: z.string(), filename: z.string().optional(), style: z.string().optional() }),
  async handler(args: { imageUrl: string; filename?: string; style?: string }) {
    const res = await downloadGoogleIcon(args.imageUrl, { filename: args.filename, style: args.style });
    return { success: res.success, filePath: res.filePath || null, filename: res.filename || null, error: res.error || null };
  },
};

const collectDef: CapabilityDefinition = {
  name: 'collect', namespace: 'google-icons',
  description: '将 Google Material Icon 下载并上传至用户个人 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({ imageUrl: z.string(), title: z.string().optional(), metadata: z.record(z.string(), z.any()).optional() }),
  async handler(args: { imageUrl: string; title?: string; metadata?: Record<string, any> }) {
    const res = await syncGoogleIconsToMaterialLibrary('local', { imageUrl: args.imageUrl, metadata: { title: args.title, ...(args.metadata || {}) } });
    return { success: res.success, localFilePath: res.localFilePath || null, cosUrl: res.cosUrl || null, error: res.error || null };
  },
};

const statusDef: CapabilityDefinition = {
  name: 'status', namespace: 'google-icons', description: '获取 Google Icons 服务连通性与能力状态。',
  riskLevel: 'read', argsSchema: z.object({}),
  async handler() {
    const st = await getGoogleIconsStatus();
    return { success: st.connected, ...st };
  },
};

export function registerGoogleIconsCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

/**
 * 客户端通用能力 — Emojipedia Emoji/Sticker
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchEmojipedia,
  getEmojipediaStatus,
  downloadEmojipediaItem,
  syncEmojipediaToMaterialLibrary,
  type EmojipediaItem,
} from '../emojipedia';

function normalizeSearchResult(result: {
  success: boolean; query: string; count: number; total?: number;
  items: EmojipediaItem[]; page?: number; totalPages?: number; nextPage?: number | null; error?: string;
}) {
  return {
    success: result.success, query: result.query, count: result.count,
    total: result.total ?? result.count, page: result.page ?? 1,
    totalPages: result.totalPages ?? 1, nextPage: result.nextPage ?? null,
    error: result.error || null,
    items: (result.items || []).map((item) => ({
      id: item.id, name: item.name, title: item.title, description: item.description,
      image: item.image, svgUrl: item.svgUrl, pngUrl: item.pngUrl, thumbnail: item.thumbnail,
      downloadUrl: item.downloadUrl || item.image, link: item.link, url: item.url,
      emoji: item.emoji, platform: item.platform, tags: item.tags,
      author: item.author || 'Emojipedia', license: item.license || 'CC BY-SA 4.0', isFree: true,
    })),
  };
}

const searchDef: CapabilityDefinition = {
  name: 'search', namespace: 'emojipedia',
  description: '在 Emojipedia 搜索 Emoji/Sticker 素材，支持多平台风格。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, heart, smile'),
    page: z.number().optional().default(1), limit: z.number().optional().default(20),
    category: z.string().optional().describe('分类: stickers, emojis'),
    platform: z.string().optional().describe('平台: apple, google, samsung'),
  }),
  async handler(args: { keyword: string; page?: number; limit?: number; category?: string; platform?: string }) {
    return normalizeSearchResult(await searchEmojipedia(args.keyword, {
      page: args.page ?? 1, limit: args.limit ?? 20, category: args.category, platform: args.platform,
    }));
  },
};

const downloadDef: CapabilityDefinition = {
  name: 'download', namespace: 'emojipedia',
  description: '下载 Emojipedia 图片到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({ imageUrl: z.string(), filename: z.string().optional(), platform: z.string().optional() }),
  async handler(args: { imageUrl: string; filename?: string; platform?: string }) {
    const res = await downloadEmojipediaItem(args.imageUrl, { filename: args.filename, platform: args.platform });
    return { success: res.success, filePath: res.filePath || null, filename: res.filename || null, error: res.error || null };
  },
};

const collectDef: CapabilityDefinition = {
  name: 'collect', namespace: 'emojipedia',
  description: '将 Emojipedia 素材下载并上传至用户个人 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({ imageUrl: z.string(), title: z.string().optional(), metadata: z.record(z.string(), z.any()).optional() }),
  async handler(args: { imageUrl: string; title?: string; metadata?: Record<string, any> }) {
    const res = await syncEmojipediaToMaterialLibrary('local', { imageUrl: args.imageUrl, metadata: { title: args.title, ...(args.metadata || {}) } });
    return { success: res.success, localFilePath: res.localFilePath || null, cosUrl: res.cosUrl || null, error: res.error || null };
  },
};

const statusDef: CapabilityDefinition = {
  name: 'status', namespace: 'emojipedia', description: '获取 Emojipedia 服务连通性与能力状态。',
  riskLevel: 'read', argsSchema: z.object({}),
  async handler() {
    const st = await getEmojipediaStatus();
    return { success: st.connected, ...st };
  },
};

export function registerEmojipediaCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

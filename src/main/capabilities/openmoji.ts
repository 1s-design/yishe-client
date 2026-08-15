/**
 * 客户端通用能力 — OpenMoji 开源 Emoji
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchOpenMoji,
  getOpenMojiStatus,
  downloadOpenMojiEmoji,
  syncOpenMojiToMaterialLibrary,
  type OpenMojiEmoji,
} from '../openmoji';

function normalizeSearchResult(result: {
  success: boolean; query: string; count: number; total?: number;
  items: OpenMojiEmoji[]; page?: number; totalPages?: number; nextPage?: number | null; error?: string;
}) {
  return {
    success: result.success, query: result.query, count: result.count,
    total: result.total ?? result.count, page: result.page ?? 1,
    totalPages: result.totalPages ?? 1, nextPage: result.nextPage ?? null,
    error: result.error || null,
    items: (result.items || []).map((item) => ({
      id: item.id, name: item.name, title: item.title, description: item.description,
      image: item.image, svgUrl: item.svgUrl, svgBlackUrl: item.svgBlackUrl,
      pngUrl: item.pngUrl, pngBlackUrl: item.pngBlackUrl, thumbnail: item.thumbnail,
      downloadUrl: item.downloadUrl || item.svgUrl, link: item.link, url: item.url,
      emoji: item.emoji, hexcode: item.hexcode, group: item.group, subGroup: item.subGroup,
      tags: item.tags, author: item.author || 'OpenMoji Community',
      license: item.license || 'CC BY-SA 4.0', isFree: true,
    })),
  };
}

const searchDef: CapabilityDefinition = {
  name: 'search', namespace: 'openmoji',
  description: '在 OpenMoji 搜索开源 Emoji 图标素材，支持彩色/黑白风格。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, heart, smile'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    style: z.enum(['color', 'black']).optional().describe('彩色或黑白风格'),
    group: z.string().optional().describe('按分组过滤'),
  }),
  async handler(args: { keyword: string; page?: number; limit?: number; style?: 'color' | 'black'; group?: string }) {
    return normalizeSearchResult(await searchOpenMoji(args.keyword, {
      page: args.page ?? 1, limit: args.limit ?? 20, style: args.style, group: args.group,
    }));
  },
};

const downloadDef: CapabilityDefinition = {
  name: 'download', namespace: 'openmoji',
  description: '下载 OpenMoji SVG/PNG 到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('SVG/PNG 下载地址'),
    filename: z.string().optional(), style: z.enum(['color', 'black']).optional(),
  }),
  async handler(args: { imageUrl: string; filename?: string; style?: 'color' | 'black' }) {
    const res = await downloadOpenMojiEmoji(args.imageUrl, { filename: args.filename, style: args.style });
    return { success: res.success, filePath: res.filePath || null, filename: res.filename || null, error: res.error || null };
  },
};

const collectDef: CapabilityDefinition = {
  name: 'collect', namespace: 'openmoji',
  description: '将 OpenMoji Emoji 下载并上传至用户个人 COS 素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('SVG/PNG 直连地址'),
    title: z.string().optional(), metadata: z.record(z.string(), z.any()).optional(),
  }),
  async handler(args: { imageUrl: string; title?: string; metadata?: Record<string, any> }) {
    const res = await syncOpenMojiToMaterialLibrary('local', {
      imageUrl: args.imageUrl, metadata: { title: args.title, ...(args.metadata || {}) },
    });
    return { success: res.success, localFilePath: res.localFilePath || null, cosUrl: res.cosUrl || null, error: res.error || null };
  },
};

const statusDef: CapabilityDefinition = {
  name: 'status', namespace: 'openmoji', description: '获取 OpenMoji 服务连通性与能力状态。',
  riskLevel: 'read', argsSchema: z.object({}),
  async handler() {
    const st = await getOpenMojiStatus();
    return { success: st.connected, ...st };
  },
};

export function registerOpenMojiCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

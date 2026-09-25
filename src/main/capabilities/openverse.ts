/**
 * 客户端通用能力 — Openverse 开放公共领域图库
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchOpenverse,
  getOpenverseStatus,
  downloadOpenverseImage,
  downloadOpenverseFile,
  syncOpenverseToMaterialLibrary,
} from '../openverse';
import type { OpenversePhoto } from '../openverse';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  items: OpenversePhoto[];
  page?: number;
  nextPage?: number | null;
  error?: string;
}) {
  return {
    success: result.success,
    query: result.query,
    count: result.count,
    page: result.page ?? 1,
    nextPage: result.nextPage ?? null,
    error: result.error || null,
    items: (result.items || []).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      image: item.image,
      thumbnail: item.thumbnail,
      downloadUrl: item.downloadUrl || item.image,
      link: item.link,
      url: item.url,
      width: item.width ?? null,
      height: item.height ?? null,
      author: item.author || null,
      license: item.license || 'CC / Public Domain',
      tags: item.tags || '',
      mediaType: item.mediaType || 'image',
      duration: item.duration || null,
      fileSize: item.fileSize || null,
    })),
  };
}

// ─── openverse_search ────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'openverse',
  description: '在 Openverse 搜索全球 6 亿+ CC / CC0 公共领域免费图片与音频素材。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, vintage, nature, music'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    mediaType: z.enum(['image', 'audio']).optional().default('image').describe('媒体类型: image(图片) 或 audio(音频)'),
  }),
  handler: async (args: { keyword: string; page?: number; limit?: number; mediaType?: 'image' | 'audio' }) => {
    const res = await searchOpenverse(args.keyword, {
      page: args.page,
      limit: args.limit,
      mediaType: args.mediaType,
    });
    return normalizeSearchResult(res);
  },
};

// ─── openverse_download ──────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'openverse',
  description: '从 Openverse 下载 CC 高清图片或音频到本地缓存目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    fileUrl: z.string().url().describe('Openverse 文件 URL（图片或音频）'),
    filename: z.string().optional().describe('自定义文件名'),
    mediaType: z.enum(['image', 'audio']).optional().default('image').describe('媒体类型'),
  }),
  handler: async (args: { fileUrl: string; filename?: string; mediaType?: 'image' | 'audio' }) => {
    const res = await downloadOpenverseFile(args.fileUrl, { filename: args.filename, mediaType: args.mediaType });
    if (!res.success) {
      return { success: false, error: res.error || '下载失败' };
    }
    return {
      success: true,
      data: {
        filePath: res.filePath,
      },
    };
  },
};

// ─── openverse_collect ───────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'openverse',
  description: '批量搜索 Openverse 并将 CC 图片/音频转存上传至 COS 与素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词'),
    maxCount: z.number().optional().default(10).describe('最多转存数量 (1-50)'),
    mediaType: z.enum(['image', 'audio']).optional().default('image').describe('媒体类型: image(图片) 或 audio(音频)'),
  }),
  handler: async (args: { keyword: string; maxCount?: number; mediaType?: 'image' | 'audio' }) => {
    const maxCount = Math.min(Math.max(args.maxCount || 10, 1), 50);
    const mediaType = args.mediaType || 'image';
    const searchRes = await searchOpenverse(args.keyword, { limit: maxCount, page: 1, mediaType });
    if (!searchRes.success || !searchRes.items.length) {
      return { success: false, error: searchRes.error || '未检索到可转存的 Openverse 素材' };
    }

    let successCount = 0;
    let failCount = 0;
    const syncedUrls: string[] = [];

    for (const item of searchRes.items) {
      try {
        const syncRes = await syncOpenverseToMaterialLibrary(item.image, {
          title: item.title,
          url: item.url,
          author: item.author,
          width: item.width,
          height: item.height,
          id: item.id,
        });
        if (syncRes.success) {
          successCount++;
          syncedUrls.push(syncRes.data?.cosUrl || item.image);
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    return {
      success: true,
      data: {
        successCount,
        failCount,
        images: syncedUrls,
        items: searchRes.items,
      },
    };
  },
};

// ─── openverse_status ────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'openverse',
  description: '查询 Openverse 服务就绪与连通状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const status = await getOpenverseStatus();
    return { success: true, data: status };
  },
};

export function registerOpenverseCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

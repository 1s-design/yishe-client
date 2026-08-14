/**
 * 客户端通用能力 — StockSnap 免版权图库
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchStockSnap,
  getStockSnapStatus,
  downloadStockSnapImage,
  syncStockSnapToMaterialLibrary,
} from '../stocksnap';
import type { StockSnapPhoto } from '../stocksnap';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  items: StockSnapPhoto[];
  links: string[];
  page: number;
  nextPage: number | null;
  error?: string;
}): { success: boolean; data?: any; error?: string } {
  if (!result.success) {
    return { success: false, error: result.error || '搜索失败' };
  }
  return {
    success: true,
    data: {
      query: result.query,
      count: result.count,
      page: result.page,
      nextPage: result.nextPage,
      items: result.items,
      links: result.links,
    },
  };
}

// ─── stocksnap_search ────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'stocksnap',
  description: '在 StockSnap 搜索 CC0 免版权高清摄影图库素材。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, vintage, nature'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    sort: z.string().optional().default('date'),
  }),
  handler: async (args: { keyword: string; page?: number; limit?: number; sort?: string }) => {
    const res = await searchStockSnap(args.keyword, {
      page: args.page,
      limit: args.limit,
      sort: args.sort,
    });
    return normalizeSearchResult(res);
  },
};

// ─── stocksnap_download ──────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'stocksnap',
  description: '从 StockSnap 下载 CC0 高清原图到本地缓存目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().url().describe('StockSnap 图片 URL'),
    filename: z.string().optional().describe('自定义文件名'),
  }),
  handler: async (args: { imageUrl: string; filename?: string }) => {
    const res = await downloadStockSnapImage(args.imageUrl, { filename: args.filename });
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

// ─── stocksnap_collect ───────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'stocksnap',
  description: '批量搜索 StockSnap 并将 CC0 高清原图转存上传至 COS 与素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词'),
    maxCount: z.number().optional().default(10).describe('最多转存图片张数 (1-50)'),
    sort: z.string().optional().default('date'),
  }),
  handler: async (args: { keyword: string; maxCount?: number; sort?: string }) => {
    const maxCount = Math.min(Math.max(args.maxCount || 10, 1), 50);
    const searchRes = await searchStockSnap(args.keyword, { limit: maxCount, page: 1, sort: args.sort });
    if (!searchRes.success || !searchRes.items.length) {
      return { success: false, error: searchRes.error || '未检索到可转存的 StockSnap 图片' };
    }

    let successCount = 0;
    let failCount = 0;
    const syncedImages: string[] = [];

    for (const item of searchRes.items) {
      try {
        const syncRes = await syncStockSnapToMaterialLibrary(item.image, {
          title: item.title,
          url: item.url,
          author: item.author,
          width: item.width,
          height: item.height,
          id: item.id,
        });
        if (syncRes.success) {
          successCount++;
          syncedImages.push(syncRes.data?.cosUrl || item.image);
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
        images: syncedImages,
        items: searchRes.items,
      },
    };
  },
};

// ─── stocksnap_status ────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'stocksnap',
  description: '查询 StockSnap 服务就绪与连通状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const status = await getStockSnapStatus();
    return { success: true, data: status };
  },
};

export function registerStockSnapCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

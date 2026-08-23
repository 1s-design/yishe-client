/**
 * 客户端通用能力 — Rawpixel 图库图搜与下载
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { searchRawpixel, getRawpixelStatus, downloadRawpixelImage, syncRawpixelToMaterialLibrary } from '../rawpixel';
import type { RawpixelPhoto } from '../rawpixel';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: RawpixelPhoto[];
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
      total: result.total || result.count,
      page: result.page,
      nextPage: result.nextPage,
      items: result.items,
      links: result.links,
    },
  };
}

// ─── rawpixel_search ────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'rawpixel',
  description: '在 Rawpixel 搜索免版权艺术、矢量与摄影图库素材。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, vintage, art'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    pageSize: z.number().optional().default(20),
    maxCount: z.number().optional(),
    sort: z.string().optional().default('curated'),
  }),
  handler: async (args: {
    keyword: string;
    page?: number;
    limit?: number;
    pageSize?: number;
    maxCount?: number;
    sort?: string;
  }) => {
    const limit = args.maxCount || args.limit || args.pageSize || 20;
    const res = await searchRawpixel(args.keyword, {
      page: args.page,
      limit,
      sort: args.sort,
    });
    return normalizeSearchResult(res);
  },
};

// ─── rawpixel_download ──────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'rawpixel',
  description: '从 Rawpixel 下载原图到本地缓存目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('Rawpixel 图片 URL'),
    filename: z.string().optional().describe('自定义文件名'),
  }),
  handler: async (args: { imageUrl: string; filename?: string }) => {
    const res = await downloadRawpixelImage(args.imageUrl, { filename: args.filename });
    if (!res.success) {
      return { success: false, error: res.error || '下载失败' };
    }
    return {
      success: true,
      data: {
        filePath: res.filePath,
        filename: res.filename,
      },
    };
  },
};

// ─── rawpixel_collect ───────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'rawpixel',
  description: '将 Rawpixel 图片转存上传至 COS 与素材库（支持单素材入库与批量搜索入库）。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().optional().describe('单张图片下载直链'),
    title: z.string().optional().describe('图片标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('附加元数据'),
    keyword: z.string().optional().describe('批量搜索关键词'),
    maxCount: z.number().optional().default(10).describe('批量采集最多张数 (1-50)'),
    sort: z.string().optional().default('curated'),
  }),
  handler: async (args: {
    imageUrl?: string;
    title?: string;
    metadata?: Record<string, any>;
    keyword?: string;
    maxCount?: number;
    sort?: string;
  }) => {
    // 模式 1：单素材精准转存入库
    if (args.imageUrl) {
      const syncRes = await syncRawpixelToMaterialLibrary(args.imageUrl, {
        title: args.title,
        ...(args.metadata || {}),
      });
      return {
        success: syncRes.success,
        message: syncRes.message,
        data: syncRes.data,
        error: syncRes.success ? undefined : syncRes.message,
      };
    }

    // 模式 2：根据关键词批量检索并转存入库
    const keyword = (args.keyword || '').trim();
    if (!keyword) {
      return { success: false, error: '缺少 imageUrl 或 keyword 参数' };
    }

    const maxCount = Math.min(Math.max(args.maxCount || 10, 1), 50);
    const searchRes = await searchRawpixel(keyword, { limit: maxCount, page: 1, sort: args.sort });
    if (!searchRes.success || !searchRes.items.length) {
      return { success: false, error: searchRes.error || '未检索到可转存的 Rawpixel 图片' };
    }

    let successCount = 0;
    let failCount = 0;
    const syncedImages: string[] = [];

    for (const item of searchRes.items) {
      try {
        const syncRes = await syncRawpixelToMaterialLibrary(item.image, {
          title: item.title,
          url: item.url,
          author: item.author,
          width: item.width,
          height: item.height,
          id: item.id,
          tags: item.tags,
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
      success: successCount > 0,
      data: {
        successCount,
        failCount,
        images: syncedImages,
        items: searchRes.items,
      },
      error: successCount === 0 ? '所有图片转存失败' : undefined,
    };
  },
};

// ─── rawpixel_status ────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'rawpixel',
  description: '查询 Rawpixel 服务就绪与连通状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const status = await getRawpixelStatus();
    return { success: true, data: status };
  },
};

export function registerRawpixelCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

/**
 * 客户端通用能力 — Pexels 高清摄影图搜与下载
 * 注册到 Capability Registry 后，自动暴露为:
 *   1. REST API  POST /api/capabilities/pexels/search|download|collect|status
 *   2. MCP 工具  pexels_search / pexels_download / pexels_collect / pexels_status
 */

import { z } from 'zod';
import path from 'path';
import os from 'os';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { searchPexels, getPexelsStatus } from '../pexels';
import type { PexelsPhoto } from '../pexels';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  items: PexelsPhoto[];
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
      links: result.links,
      items: result.items,
    },
  };
}

// ─── pexels_search ─────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'pexels',
  description: '搜索 Pexels 高清摄影图片素材，返回原图链接与摄影师信息。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词 (如 cat, landscape)'),
    limit: z.number().optional().default(20).describe('最多返回结果数，最大 100'),
    page: z.number().optional().default(1).describe('页码'),
  }),
  handler: async ({ keyword, limit, page }) => {
    if (!keyword || !keyword.trim()) {
      return { success: false, error: '缺少搜索关键词 keyword' };
    }
    const result = await searchPexels(keyword.trim(), { limit, page });
    return normalizeSearchResult(result);
  },
};

// ─── pexels_download ───────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'pexels',
  description: '下载单张 Pexels 图片到客户端本地临时文件路径。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('Pexels 图片直链'),
    filename: z.string().optional().describe('自定义文件名'),
  }),
  handler: async ({ imageUrl, filename }) => {
    if (!imageUrl) return { success: false, error: '缺少 imageUrl' };
    try {
      const { downloadPexelsImage } = await import('../pexels');
      const res = await downloadPexelsImage(imageUrl, {
        filename,
        destDir: path.join(os.tmpdir(), 'pexels'),
      });
      if (!res.success) {
        return { success: false, error: res.error || '下载失败' };
      }
      return { success: true, data: { filePath: res.filePath } };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  },
};

// ─── pexels_collect ────────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'pexels',
  description: '批量检索并采集 Pexels 图片到系统素材库。',
  riskLevel: 'write',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词'),
    maxCount: z.number().optional().default(10).describe('最多采集数量'),
    syncToMaterial: z.boolean().optional().default(true).describe('是否同步上传素材库'),
  }),
  handler: async ({ keyword, maxCount, syncToMaterial }) => {
    if (!keyword || !keyword.trim()) {
      return { success: false, error: '缺少搜索关键词' };
    }
    const limit = Math.min(Math.max(Number(maxCount) || 10, 1), 50);
    const searchRes = await searchPexels(keyword.trim(), { limit });
    if (!searchRes.success || !searchRes.items.length) {
      return { success: false, error: searchRes.error || '未检索到可用 Pexels 图片' };
    }

    if (!syncToMaterial) {
      return {
        success: true,
        data: {
          successCount: searchRes.items.length,
          failCount: 0,
          images: searchRes.items.map((i) => i.image),
          items: searchRes.items,
        },
      };
    }

    const { syncPexelsToMaterialLibrary } = await import('../pexels');
    let successCount = 0;
    let failCount = 0;
    const syncedImages: string[] = [];

    for (const item of searchRes.items) {
      if (!item.image) continue;
      try {
        const syncRes = await syncPexelsToMaterialLibrary(item.image, {
          title: item.title,
          url: item.url,
          photographer: item.photographer,
          photographerUrl: item.photographerUrl,
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

// ─── pexels_status ─────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'pexels',
  description: '查询 Pexels 服务就绪与连通状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const status = await getPexelsStatus();
    return { success: true, data: status };
  },
};

export function registerPexelsCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

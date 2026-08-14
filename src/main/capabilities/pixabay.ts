/**
 * 客户端通用能力 — Pixabay 免费图库图搜与下载
 * 注册到 Capability Registry 后，自动暴露为:
 *   1. REST API  POST /api/capabilities/pixabay/search|download|collect|status
 *   2. MCP 工具  pixabay_search / pixabay_download / pixabay_collect / pixabay_status
 */

import { z } from 'zod';
import path from 'path';
import os from 'os';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { searchPixabay, getPixabayStatus } from '../pixabay';
import type { PixabayPhoto } from '../pixabay';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  items: PixabayPhoto[];
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

// ─── pixabay_search ─────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'pixabay',
  description: '搜索 Pixabay 免费摄影与插画素材，返回高清图片直链与元数据。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词 (如 cat, hi, nature)'),
    limit: z.number().optional().default(20).describe('最多返回结果数，最大 100'),
    page: z.number().optional().default(1).describe('页码'),
  }),
  handler: async ({ keyword, limit, page }) => {
    if (!keyword || !keyword.trim()) {
      return { success: false, error: '缺少搜索关键词 keyword' };
    }
    const result = await searchPixabay(keyword.trim(), { limit, page });
    return normalizeSearchResult(result);
  },
};

// ─── pixabay_download ───────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'pixabay',
  description: '下载单张 Pixabay 图片到客户端本地临时文件路径。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('Pixabay 图片直链'),
    filename: z.string().optional().describe('自定义文件名'),
  }),
  handler: async ({ imageUrl, filename }) => {
    if (!imageUrl) return { success: false, error: '缺少 imageUrl' };
    try {
      const { downloadPixabayImage } = await import('../pixabay');
      const res = await downloadPixabayImage(imageUrl, {
        filename,
        destDir: path.join(os.tmpdir(), 'pixabay'),
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

// ─── pixabay_collect ────────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'pixabay',
  description: '批量检索并采集 Pixabay 图片到系统素材库。',
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
    const searchRes = await searchPixabay(keyword.trim(), { limit });
    if (!searchRes.success || !searchRes.items.length) {
      return { success: false, error: searchRes.error || '未检索到可用 Pixabay 图片' };
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

    const { syncPixabayToMaterialLibrary } = await import('../pixabay');
    let successCount = 0;
    let failCount = 0;
    const syncedImages: string[] = [];

    for (const item of searchRes.items) {
      if (!item.image) continue;
      try {
        const syncRes = await syncPixabayToMaterialLibrary(item.image, {
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

// ─── pixabay_status ─────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'pixabay',
  description: '查询 Pixabay 服务就绪与连通状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const status = await getPixabayStatus();
    return { success: true, data: status };
  },
};

export function registerPixabayCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

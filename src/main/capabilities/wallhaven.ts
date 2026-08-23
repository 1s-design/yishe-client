/**
 * 客户端通用能力 — Wallhaven 4K/8K 壁纸图搜与采集 (Wallhaven)
 * 注册到 Capability Registry 后，自动暴露为:
 *   1. REST API  POST /api/capabilities/wallhaven/search|download|collect|status
 *   2. MCP 工具  wallhaven_search / wallhaven_download / wallhaven_collect / wallhaven_status
 */
import { z } from 'zod';
import path from 'path';
import os from 'os';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { searchWallhaven, getWallhavenStatus, downloadWallhavenImage, syncWallhavenToMaterialLibrary } from '../wallhaven';

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'wallhaven',
  description: '在 Wallhaven 搜索 2K/4K/8K 顶级高清电脑与手机壁纸、插画和场景渲染图。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().optional().describe('搜索关键词 (如 cyberpunk, anime, landscape, abstract)'),
    query: z.string().optional().describe('搜索关键词'),
    limit: z.number().optional().default(24).describe('最多返回结果数，最大 64'),
    pageSize: z.number().optional().describe('每页数量'),
    page: z.number().optional().default(1).describe('页码'),
  }),
  handler: async (args: { keyword?: string; query?: string; limit?: number; pageSize?: number; page?: number }) => {
    const keyword = (args.keyword || args.query || '').trim();
    if (!keyword) {
      return { success: false, error: '缺少搜索关键词 keyword/query' };
    }
    const limit = args.limit || args.pageSize || 24;
    const page = args.page || 1;
    const result = await searchWallhaven(keyword, { limit, page });
    return {
      success: result.success,
      data: result.success ? {
        query: result.query,
        count: result.count,
        page: result.page,
        nextPage: result.nextPage,
        links: result.links,
        items: result.items,
      } : undefined,
      error: result.error,
    };
  },
};

const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'wallhaven',
  description: '下载单张 Wallhaven 4K 超清壁纸到本地临时路径。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().optional().describe('Wallhaven 壁纸原图直链'),
    image: z.string().optional().describe('图片直链'),
    url: z.string().optional().describe('图片直链'),
    filename: z.string().optional().describe('自定义文件名'),
  }),
  handler: async (args: { imageUrl?: string; image?: string; url?: string; filename?: string }) => {
    const imageUrl = args.imageUrl || args.image || args.url || '';
    if (!imageUrl) return { success: false, error: '缺少 imageUrl' };
    const res = await downloadWallhavenImage(imageUrl, {
      filename: args.filename,
      destDir: path.join(os.tmpdir(), 'wallhaven'),
    });
    return { success: res.success, data: { filePath: res.filePath }, error: res.error };
  },
};

const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'wallhaven',
  description: '将 Wallhaven 4K 超清壁纸下载并同步至素材库（支持单图入库或批量搜索入库）。',
  riskLevel: 'write',
  argsSchema: z.object({
    keyword: z.string().optional().describe('搜索关键词（批量采集时使用）'),
    query: z.string().optional().describe('搜索关键词'),
    maxCount: z.number().optional().default(10).describe('最多采集数量'),
    limit: z.number().optional().describe('最多采集数量'),
    syncToMaterial: z.boolean().optional().default(true).describe('是否同步上传素材库'),
    imageUrl: z.string().optional().describe('单张壁纸直链（单图采集时使用）'),
    image: z.string().optional().describe('图片直链'),
    title: z.string().optional().describe('素材标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  handler: async (args: {
    keyword?: string;
    query?: string;
    maxCount?: number;
    limit?: number;
    syncToMaterial?: boolean;
    imageUrl?: string;
    image?: string;
    title?: string;
    metadata?: Record<string, any>;
  }) => {
    const imageUrl = args.imageUrl || args.image;
    // 1. 单图精准入库模式
    if (imageUrl) {
      const syncRes = await syncWallhavenToMaterialLibrary(imageUrl, {
        title: args.title,
        ...(args.metadata || {}),
      });
      return {
        success: syncRes.success,
        data: syncRes.data,
        error: syncRes.success ? undefined : syncRes.message,
      };
    }

    // 2. 批量搜索入库模式
    const keyword = (args.keyword || args.query || '').trim();
    if (!keyword) {
      return { success: false, error: '缺少搜索关键词 keyword 或 imageUrl' };
    }

    const limit = Math.min(Math.max(Number(args.maxCount) || Number(args.limit) || 10, 1), 50);
    const searchRes = await searchWallhaven(keyword, { limit });
    if (!searchRes.success || !searchRes.items.length) {
      return { success: false, error: searchRes.error || '未检索到可用 Wallhaven 壁纸' };
    }

    const syncToMaterial = args.syncToMaterial !== false;
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

    let successCount = 0;
    let failCount = 0;
    const syncedImages: string[] = [];

    for (const item of searchRes.items) {
      if (!item.image) continue;
      try {
        const syncRes = await syncWallhavenToMaterialLibrary(item.image, {
          title: item.title,
          description: item.description,
          url: item.url,
          author: item.author,
          width: item.width,
          height: item.height,
          id: item.id,
          colors: item.colors,
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
    };
  },
};

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'wallhaven',
  description: '查询 Wallhaven 服务就绪状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const status = await getWallhavenStatus();
    return { success: status.connected, data: status };
  },
};

export function registerWallhavenCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

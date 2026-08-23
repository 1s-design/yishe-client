/**
 * 客户端通用能力 — 搜狗图片搜索与采集 (Sogou Images)
 * 注册到 Capability Registry 后，自动暴露为:
 *   1. REST API  POST /api/capabilities/sogou/search|download|collect|status
 *   2. MCP 工具  sogou_search / sogou_download / sogou_collect / sogou_status
 */
import { z } from 'zod';
import path from 'path';
import os from 'os';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { searchSogou, getSogouStatus, downloadSogouImage, syncSogouToMaterialLibrary } from '../sogou';

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'sogou',
  description: '在搜狗图片搜索中文配图、壁纸与素材，返回原图直链。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().optional().describe('搜索关键词 (如 极简插画, 萌宠, 国风)'),
    query: z.string().optional().describe('搜索关键词'),
    limit: z.number().optional().default(20).describe('最多返回结果数，最大 60'),
    pageSize: z.number().optional().describe('每页数量'),
    page: z.number().optional().default(1).describe('页码'),
  }),
  handler: async (args: { keyword?: string; query?: string; limit?: number; pageSize?: number; page?: number }) => {
    const keyword = (args.keyword || args.query || '').trim();
    if (!keyword) {
      return { success: false, error: '缺少搜索关键词 keyword/query' };
    }
    const limit = args.limit || args.pageSize || 20;
    const page = args.page || 1;
    const result = await searchSogou(keyword, { limit, page });
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
  namespace: 'sogou',
  description: '下载单张搜狗图片到本地临时路径。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().optional().describe('搜狗图片直链'),
    image: z.string().optional().describe('图片直链'),
    url: z.string().optional().describe('图片直链'),
    filename: z.string().optional().describe('自定义文件名'),
  }),
  handler: async (args: { imageUrl?: string; image?: string; url?: string; filename?: string }) => {
    const imageUrl = args.imageUrl || args.image || args.url || '';
    if (!imageUrl) return { success: false, error: '缺少 imageUrl' };
    const res = await downloadSogouImage(imageUrl, {
      filename: args.filename,
      destDir: path.join(os.tmpdir(), 'sogou'),
    });
    return { success: res.success, data: { filePath: res.filePath }, error: res.error };
  },
};

const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'sogou',
  description: '将搜狗图片下载并同步至素材库（支持单图入库或批量搜索入库）。',
  riskLevel: 'write',
  argsSchema: z.object({
    keyword: z.string().optional().describe('搜索关键词（批量采集时使用）'),
    query: z.string().optional().describe('搜索关键词'),
    maxCount: z.number().optional().default(10).describe('最多采集数量'),
    limit: z.number().optional().describe('最多采集数量'),
    syncToMaterial: z.boolean().optional().default(true).describe('是否同步上传素材库'),
    imageUrl: z.string().optional().describe('单张图片直链（单图采集时使用）'),
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
      const syncRes = await syncSogouToMaterialLibrary(imageUrl, {
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
    const searchRes = await searchSogou(keyword, { limit });
    if (!searchRes.success || !searchRes.items.length) {
      return { success: false, error: searchRes.error || '未检索到可用搜狗图片' };
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
        const syncRes = await syncSogouToMaterialLibrary(item.image, {
          title: item.title,
          description: item.description,
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
  namespace: 'sogou',
  description: '查询搜狗图片服务就绪状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const status = await getSogouStatus();
    return { success: status.connected, data: status };
  },
};

export function registerSogouCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

/**
 * 客户端通用能力 — DuckDuckGo 图片搜索与采集 (DuckDuckGo Images)
 * 注册到 Capability Registry 后，自动暴露为:
 *   1. REST API  POST /api/capabilities/duckduckgo/search|download|collect|status
 *   2. MCP 工具  duckduckgo_search / duckduckgo_download / duckduckgo_collect / duckduckgo_status
 */
import { z } from 'zod';
import path from 'path';
import os from 'os';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { searchDuckDuckGo, getDuckDuckGoStatus, downloadDuckDuckGoImage, syncDuckDuckGoToMaterialLibrary } from '../duckduckgo';

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'duckduckgo',
  description: '在 DuckDuckGo 搜索国际化高清图片素材，隐私安全、极速出图。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词 (如 vintage poster, nature, coffee)'),
    limit: z.number().optional().default(20).describe('最多返回结果数，最大 60'),
    page: z.number().optional().default(1).describe('页码'),
  }),
  handler: async ({ keyword, limit, page }) => {
    if (!keyword || !keyword.trim()) {
      return { success: false, error: '缺少搜索关键词 keyword' };
    }
    const result = await searchDuckDuckGo(keyword.trim(), { limit, page });
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
  namespace: 'duckduckgo',
  description: '下载单张 DuckDuckGo 图片到本地临时路径。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('DuckDuckGo 图片直链'),
    filename: z.string().optional().describe('自定义文件名'),
  }),
  handler: async ({ imageUrl, filename }) => {
    if (!imageUrl) return { success: false, error: '缺少 imageUrl' };
    const res = await downloadDuckDuckGoImage(imageUrl, {
      filename,
      destDir: path.join(os.tmpdir(), 'duckduckgo'),
    });
    return { success: res.success, data: { filePath: res.filePath }, error: res.error };
  },
};

const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'duckduckgo',
  description: '将 DuckDuckGo 图片下载并同步至素材库（支持单图入库或批量搜索入库）。',
  riskLevel: 'write',
  argsSchema: z.object({
    keyword: z.string().optional().describe('搜索关键词（批量采集时使用）'),
    maxCount: z.number().optional().default(10).describe('最多采集数量'),
    syncToMaterial: z.boolean().optional().default(true).describe('是否同步上传素材库'),
    imageUrl: z.string().optional().describe('单张图片直链（单图采集时使用）'),
    title: z.string().optional().describe('素材标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  handler: async ({ keyword, maxCount, syncToMaterial, imageUrl, title, metadata }) => {
    // 1. 单图精准入库模式
    if (imageUrl) {
      const syncRes = await syncDuckDuckGoToMaterialLibrary(imageUrl, {
        title,
        ...(metadata || {}),
      });
      return {
        success: syncRes.success,
        data: syncRes.data,
        error: syncRes.success ? undefined : syncRes.message,
      };
    }

    // 2. 批量搜索入库模式
    if (!keyword || !keyword.trim()) {
      return { success: false, error: '缺少搜索关键词 keyword 或 imageUrl' };
    }

    const limit = Math.min(Math.max(Number(maxCount) || 10, 1), 50);
    const searchRes = await searchDuckDuckGo(keyword.trim(), { limit });
    if (!searchRes.success || !searchRes.items.length) {
      return { success: false, error: searchRes.error || '未检索到可用 DuckDuckGo 图片' };
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

    let successCount = 0;
    let failCount = 0;
    const syncedImages: string[] = [];

    for (const item of searchRes.items) {
      if (!item.image) continue;
      try {
        const syncRes = await syncDuckDuckGoToMaterialLibrary(item.image, {
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
  namespace: 'duckduckgo',
  description: '查询 DuckDuckGo 图片服务就绪状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const status = await getDuckDuckGoStatus();
    return { success: status.connected, data: status };
  },
};

export function registerDuckDuckGoCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

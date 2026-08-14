/**
 * 客户端通用能力 — Wikimedia Commons 图搜与下载
 * 注册到 Capability Registry 后，自动暴露为:
 *   1. REST API  POST /api/capabilities/wikimedia/search|download|collect|status
 *   2. MCP 工具  wikimedia_search / wikimedia_download / wikimedia_collect / wikimedia_status
 */

import { z } from 'zod';
import path from 'path';
import os from 'os';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { searchWikimedia, getWikimediaStatus } from '../wikimedia';
import type { WikimediaFile } from '../wikimedia';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  items: WikimediaFile[];
  links: string[];
  nextOffset: number | null;
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
      nextOffset: result.nextOffset,
      links: result.links,
      items: result.items,
    },
  };
}

// ─── wikimedia_search ─────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'wikimedia',
  description: '搜索 Wikimedia Commons 自由版权图片，返回原图链接和元数据（作者/许可证）。无需登录。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词 (中英文均可)'),
    limit: z.number().optional().default(25).describe('最多返回结果数，最大 250'),
    imageOnly: z.boolean().optional().default(true).describe('是否只返回静态图片'),
    offset: z.number().optional().nullable().describe('分页游标 (nextOffset)'),
  }),
  handler: async ({ keyword, limit, imageOnly, offset }) => {
    if (!keyword || !keyword.trim()) {
      return { success: false, error: '缺少搜索关键词 keyword' };
    }
    const result = await searchWikimedia(keyword.trim(), { limit, imageOnly, offset });
    return normalizeSearchResult(result);
  },
};

// ─── wikimedia_download ───────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'wikimedia',
  description: '下载单张 Wikimedia Commons 图片到工作目录 (无需同步素材库)。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('Wikimedia 图片直链 (upload.wikimedia.org)'),
    filename: z.string().optional().describe('自定义文件名'),
  }),
  handler: async ({ imageUrl, filename }) => {
    if (!/^https?:\/\//.test(imageUrl)) {
      return { success: false, error: '缺少有效的图片链接 imageUrl' };
    }
    try {
      const { downloadWikimediaImage } = await import('../wikimedia');
      const destDir = path.join(
        process.env.WIKIMEDIA_TMP_DIR || os.tmpdir(),
        'wikimedia'
      );
      const filePath = await downloadWikimediaImage(imageUrl, destDir, filename);
      return { success: true, data: { imageUrl, filePath } };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  },
};

// ─── wikimedia_collect ────────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'wikimedia',
  description: '从 Wikimedia Commons 批量搜索并下载图片到工作目录并同步素材库 (推荐工具)。',
  riskLevel: 'write',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词 (中英文均可)'),
    maxCount: z.number().optional().default(5).describe('采集数量，最大 50'),
    imageOnly: z.boolean().optional().default(true).describe('是否只采集静态图片'),
    syncToMaterial: z.boolean().optional().default(true).describe('是否同步到素材库'),
  }),
  handler: async ({ keyword, maxCount, imageOnly, syncToMaterial }) => {
    if (!keyword || !keyword.trim()) {
      return { success: false, error: '缺少搜索关键词 keyword' };
    }
    const count = Math.min(Math.max(Number(maxCount) || 5, 1), 50);
    try {
      const { syncWikimediaToMaterialLibrary, downloadWikimediaImage } = await import('../wikimedia');
      const search = await searchWikimedia(keyword.trim(), { limit: count, imageOnly });
      if (!search.success || !search.items.length) {
        return { success: false, error: search.error || '未搜索到任何图片' };
      }

      const images: Array<Record<string, any>> = [];
      let successCount = 0;
      let failCount = 0;
      const errors: string[] = [];
      const workspaceDir = await getWorkspaceDirFromStore();

      for (const item of search.items) {
        try {
          if (syncToMaterial && workspaceDir) {
            const result = await syncWikimediaToMaterialLibrary({
              imageUrl: item.image,
              workspaceDir,
              metadata: {
                title: item.title,
                description: item.description,
                link: item.link,
                author: item.author,
                license: item.license,
                date: item.date,
                image: item.image,
                width: item.width,
                height: item.height,
                mime: item.mime,
                id: item.id,
              },
            });
            if (result.ok) {
              images.push({ url: result.filePath, originUrl: item.image, materialLibraryOk: result.materialLibraryOk });
              successCount++;
            } else {
              failCount++;
              errors.push(result.msg || item.image);
            }
          } else {
            const destDir = path.join(os.tmpdir(), 'wikimedia');
            const filePath = await downloadWikimediaImage(item.image, destDir);
            images.push({ url: filePath, originUrl: item.image });
            successCount++;
          }
        } catch (error: any) {
          failCount++;
          errors.push(`${item.image}: ${error?.message || String(error)}`);
        }
      }

      return {
        success: true,
        data: {
          keyword,
          collected: search.items.length,
          successCount,
          failCount,
          images,
          ...(errors.length ? { errors } : {}),
        },
      };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  },
};

// ─── wikimedia_status ─────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'wikimedia',
  description: '检查 Wikimedia Commons 服务可用性',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const status = await getWikimediaStatus();
    return {
      success: status.ok,
      data: status,
      ...(status.ok ? {} : { error: status.message }),
    };
  },
};

async function getWorkspaceDirFromStore(): Promise<string> {
  try {
    const ElectronStore = (await import('electron-store')).default;
    const StoreConstructor = (ElectronStore as any).default || ElectronStore;
    const store = new StoreConstructor({ defaults: { workspaceDirectory: '' } });
    return ((store as any).get('workspaceDirectory', '') as string) || '';
  } catch {
    return '';
  }
}

export function registerWikimediaCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

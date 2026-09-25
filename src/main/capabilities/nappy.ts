/**
 * 客户端通用能力 — Nappy 免费图片采集
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchNappy,
  downloadNappyImage,
  type NappyPhoto,
  type NappySearchResult,
} from '../nappy';

function normalizeSearchResult(result: NappySearchResult) {
  return {
    success: result.success,
    query: result.query,
    count: result.count,
    page: result.page,
    hasMore: result.hasMore,
    error: result.error || null,
    items: (result.items || []).map((item) => ({
      id: item.id,
      url: item.url,
      thumbnail: item.thumbnail,
    })),
  };
}

// ─── nappy_search ────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'nappy',
  description: '在 Nappy 搜索免费高质量图片素材，专为 POC 和生活方式品牌设计。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 iphone, woman, nature'),
    page: z.number().optional().default(1),
  }),
  handler: async (args: { keyword: string; page?: number }) => {
    const res = await searchNappy(args.keyword, { page: args.page });
    return normalizeSearchResult(res);
  },
};

// ─── nappy_download ──────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'nappy',
  description: '从 Nappy 下载图片到本地缓存目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    fileUrl: z.string().url().describe('Nappy 图片 URL'),
    filename: z.string().optional().describe('自定义文件名'),
  }),
  handler: async (args: { fileUrl: string; filename?: string }) => {
    const res = await downloadNappyImage(args.fileUrl, { filename: args.filename });
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

export function registerNappyCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef]);
}

/**
 * 客户端通用能力 — Kaboompics 免费高清图库
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import {
  searchKaboompics,
  getKaboompicsStatus,
  downloadKaboompicsImage,
  syncKaboompicsToMaterialLibrary,
  type KaboompicsPhoto,
} from '../kaboompics';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  count: number;
  items: KaboompicsPhoto[];
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
      name: item.name,
      title: item.title,
      description: item.description,
      image: item.image, // 原图全尺寸链接 (Full Original)
      thumbnail: item.thumbnail,
      downloadUrl: item.downloadUrl || item.image,
      link: item.link,
      url: item.url,
      width: item.width ?? null,
      height: item.height ?? null,
      author: item.author || null,
      license: item.license || 'Kaboompics License (Free for commercial use)',
      tags: item.tags || '',
      colors: item.colors || [],
    })),
  };
}

// ─── kaboompics.search ───────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'kaboompics',
  description: '在 Kaboompics 搜索免费商业高清原图素材。',
  riskLevel: 'read',
  argsSchema: z.object({
    keyword: z.string().describe('搜索关键词，如 cat, coffee, nature'),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
  }),
  async handler(args: { keyword: string; page?: number; limit?: number }) {
    const rawResult = await searchKaboompics(args.keyword, {
      page: args.page ?? 1,
      limit: args.limit ?? 20,
    });
    return normalizeSearchResult(rawResult);
  },
};

// ─── kaboompics.download ─────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: 'download',
  namespace: 'kaboompics',
  description: '下载 Kaboompics 高清原图素材到本地目录。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('高清原图直连地址 (Full Size Image URL)'),
    filename: z.string().optional().describe('自定义保存文件名'),
  }),
  async handler(args: { imageUrl: string; filename?: string }) {
    const res = await downloadKaboompicsImage(args.imageUrl, {
      filename: args.filename,
    });
    return {
      success: res.success,
      filePath: res.filePath || null,
      error: res.error || null,
    };
  },
};

// ─── kaboompics.collect ──────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: 'collect',
  namespace: 'kaboompics',
  description: '将 Kaboompics 高清原图素材下载并上传至 COS 存储。',
  riskLevel: 'write',
  argsSchema: z.object({
    imageUrl: z.string().describe('高清原图直连地址'),
    title: z.string().optional().describe('素材标题'),
    metadata: z.record(z.string(), z.any()).optional().describe('关联元数据'),
  }),
  async handler(args: { imageUrl: string; title?: string; metadata?: Record<string, any> }) {
    const res = await syncKaboompicsToMaterialLibrary('local', {
      imageUrl: args.imageUrl,
      metadata: {
        title: args.title,
        ...(args.metadata || {}),
      },
    });
    return {
      success: res.success,
      localFilePath: res.localFilePath || null,
      cosUrl: res.cosUrl || null,
      error: res.error || null,
    };
  },
};

// ─── kaboompics.status ───────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'kaboompics',
  description: '获取 Kaboompics 服务连接状态与能力列表。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getKaboompicsStatus();
    return {
      success: st.connected,
      ...st,
    };
  },
};

/** 注册 Kaboompics 通用能力 */
export function registerKaboompicsCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, downloadDef, collectDef, statusDef]);
}

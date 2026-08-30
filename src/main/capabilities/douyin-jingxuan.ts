/**
 * 客户端通用能力 — 抖音精选视频采集
 */

import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { searchDouyinJingxuan, getDouyinJingxuanStatus } from '../douyin-jingxuan';
import type { DouyinVideo } from '../douyin-jingxuan';

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  category: string;
  count: number;
  total: number;
  items: DouyinVideo[];
  page: number;
  nextPage: number | null;
  error?: string;
}): { success: boolean; data?: any; error?: string } {
  if (!result.success) {
    return { success: false, error: result.error || '采集失败' };
  }
  return {
    success: true,
    data: {
      query: result.query,
      category: result.category,
      count: result.count,
      total: result.total,
      page: result.page,
      nextPage: result.nextPage,
      items: result.items,
    },
  };
}

// ─── douyin_jingxuan_search ────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'douyin_jingxuan',
  description: '采集抖音精选视频列表，支持分类筛选和数量控制。',
  riskLevel: 'read',
  argsSchema: z.object({
    category: z.string().optional().default('全部').describe('分类标签，如：全部、公开课、游戏、二次元、音乐、影视、美食、知识、小剧场、生活vlog、体育、旅行、亲子、动物、三农、汽车、美妆、穿搭'),
    limit: z.number().optional().default(20).describe('获取视频数量（1-100）'),
    maxCount: z.number().optional().describe('获取视频数量（与 limit 二选一）'),
    page: z.number().optional().default(1).describe('页码'),
  }),
  handler: async (args: {
    category?: string;
    limit?: number;
    maxCount?: number;
    page?: number;
  }) => {
    const limit = args.maxCount || args.limit || 20;
    const res = await searchDouyinJingxuan('', {
      category: args.category,
      limit,
      page: args.page,
    });
    return normalizeSearchResult(res);
  },
};

// ─── douyin_jingxuan_status ────────────────────────────
const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'douyin_jingxuan',
  description: '查询抖音精选服务就绪与连通状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const status = await getDouyinJingxuanStatus();
    return { success: true, data: status };
  },
};

export function registerDouyinJingxuanCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, statusDef]);
}

/**
 * Hacker News 热帖 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getHackernewsStatus, searchHN } from '../hackernews';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'hackernews',
  description: '获取 Hacker News 热帖 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getHackernewsStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'hackernews',
  description: '从 Hacker News 热帖 检索最新新闻报道与资讯列表。',
  riskLevel: 'read',
  argsSchema: z.object({
    query: z.string().optional(),
    keyword: z.string().optional(),
    category: z.string().optional(),
    type: z.string().optional(),
    sort: z.string().optional(),
    maxCount: z.number().optional().default(10),
  }),
  async handler(args: any) {
    const res = await (args => searchHN(args.type || "top", { keyword: args.keyword, limit: args.maxCount }))(args);
    return res;
  },
};

export function registerHackernewsCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

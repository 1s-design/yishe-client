/**
 * Reddit 社区热帖 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getRedditStatus, searchReddit } from '../reddit';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'reddit',
  description: '获取 Reddit 社区热帖 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getRedditStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'reddit',
  description: '从 Reddit 社区热帖 检索最新新闻报道与资讯列表。',
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
    const res = await (args => searchReddit(args.query || "technology", { limit: args.maxCount }))(args);
    return res;
  },
};

export function registerRedditCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

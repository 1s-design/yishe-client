/**
 * BBC News 英国广播公司 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getBbcnewsStatus, fetchBBC } from '../bbcnews';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'bbcnews',
  description: '获取 BBC News 英国广播公司 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getBbcnewsStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'bbcnews',
  description: '从 BBC News 英国广播公司 检索最新新闻报道与资讯列表。',
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
    const res = await (args => fetchBBC(args.category || "technology"))(args);
    return res;
  },
};

export function registerBbcnewsCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

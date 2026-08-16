/**
 * MIT Tech Review 麻省理工科技评论 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getMittechreviewStatus, fetchMIT } from '../mittechreview';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'mittechreview',
  description: '获取 MIT Tech Review 麻省理工科技评论 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getMittechreviewStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'mittechreview',
  description: '从 MIT Tech Review 麻省理工科技评论 检索最新新闻报道与资讯列表。',
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
    const res = await (args => fetchMIT(args.category || "all"))(args);
    return res;
  },
};

export function registerMittechreviewCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

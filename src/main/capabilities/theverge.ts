/**
 * The Verge 前沿科技 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getThevergeStatus, fetchVerge } from '../theverge';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'theverge',
  description: '获取 The Verge 前沿科技 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getThevergeStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'theverge',
  description: '从 The Verge 前沿科技 检索最新新闻报道与资讯列表。',
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
    const res = await (args => fetchVerge(args.category || "tech"))(args);
    return res;
  },
};

export function registerThevergeCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

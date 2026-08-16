/**
 * Reuters 路透社 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getReutersStatus, fetchReuters } from '../reuters';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'reuters',
  description: '获取 Reuters 路透社 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getReutersStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'reuters',
  description: '从 Reuters 路透社 检索最新新闻报道与资讯列表。',
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
    const res = await (args => fetchReuters(args.category || "technology"))(args);
    return res;
  },
};

export function registerReutersCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

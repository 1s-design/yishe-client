/**
 * Product Hunt 创新产品 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getProducthuntStatus, searchPH } from '../producthunt';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'producthunt',
  description: '获取 Product Hunt 创新产品 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getProducthuntStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'producthunt',
  description: '从 Product Hunt 创新产品 检索最新新闻报道与资讯列表。',
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
    const res = await (args => searchPH("", { first: args.maxCount }))(args);
    return res;
  },
};

export function registerProducthuntCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

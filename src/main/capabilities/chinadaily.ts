/**
 * 中国日报 China Daily 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getChinadailyStatus, fetchChinaDaily } from '../chinadaily';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'chinadaily',
  description: '获取 中国日报 China Daily 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getChinadailyStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'chinadaily',
  description: '从 中国日报 China Daily 检索最新新闻报道与资讯列表。',
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
    const res = await (args => fetchChinaDaily(args.category || "china"))(args);
    return res;
  },
};

export function registerChinadailyCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

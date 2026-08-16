/**
 * 中国政府网 政策发布 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getGovcnStatus, fetchGovCN } from '../govcn';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'govcn',
  description: '获取 中国政府网 政策发布 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getGovcnStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'govcn',
  description: '从 中国政府网 政策发布 检索最新新闻报道与资讯列表。',
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
    const res = await (args => fetchGovCN(args.category || "policy"))(args);
    return res;
  },
};

export function registerGovcnCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

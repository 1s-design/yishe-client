/**
 * NPR 美国国家公共电台 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getNprStatus, fetchNPR } from '../npr';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'npr',
  description: '获取 NPR 美国国家公共电台 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getNprStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'npr',
  description: '从 NPR 美国国家公共电台 检索最新新闻报道与资讯列表。',
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
    const res = await (args => fetchNPR(args.category || "technology"))(args);
    return res;
  },
};

export function registerNprCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

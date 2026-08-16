/**
 * The Guardian 卫报 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getTheguardianStatus, searchGuardian } from '../theguardian';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'theguardian',
  description: '获取 The Guardian 卫报 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getTheguardianStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'theguardian',
  description: '从 The Guardian 卫报 检索最新新闻报道与资讯列表。',
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
    const res = await (args => searchGuardian("", { category: args.category || "technology", maxCount: args.maxCount }))(args);
    return res;
  },
};

export function registerTheguardianCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

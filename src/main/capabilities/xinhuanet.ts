/**
 * 新华网 权威快讯 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getXinhuanetStatus, fetchXH } from '../xinhuanet';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'xinhuanet',
  description: '获取 新华网 权威快讯 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getXinhuanetStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'xinhuanet',
  description: '从 新华网 权威快讯 检索最新新闻报道与资讯列表。',
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
    const res = await (args => fetchXH(args.category || "tech"))(args);
    return res;
  },
};

export function registerXinhuanetCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

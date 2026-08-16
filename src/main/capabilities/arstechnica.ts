/**
 * Ars Technica 深度科技 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getArstechnicaStatus, fetchArs } from '../arstechnica';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'arstechnica',
  description: '获取 Ars Technica 深度科技 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getArstechnicaStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'arstechnica',
  description: '从 Ars Technica 深度科技 检索最新新闻报道与资讯列表。',
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
    const res = await (args => fetchArs(args.category || "all"))(args);
    return res;
  },
};

export function registerArstechnicaCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

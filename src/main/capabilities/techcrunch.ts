/**
 * TechCrunch 科技创投 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getTechcrunchStatus, fetchTC } from '../techcrunch';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'techcrunch',
  description: '获取 TechCrunch 科技创投 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getTechcrunchStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'techcrunch',
  description: '从 TechCrunch 科技创投 检索最新新闻报道与资讯列表。',
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
    const res = await (args => fetchTC(args.category || "all"))(args);
    return res;
  },
};

export function registerTechcrunchCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

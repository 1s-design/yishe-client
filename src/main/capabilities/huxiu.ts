/**
 * 虎嗅 商业科技 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getHuxiuStatus, fetchHuxiu } from '../huxiu';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'huxiu',
  description: '获取 虎嗅 商业科技 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getHuxiuStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'huxiu',
  description: '从 虎嗅 商业科技 检索最新新闻报道与资讯列表。',
  riskLevel: 'read',
  argsSchema: z.object({
    query: z.string().optional(),
    keyword: z.string().optional(),
    category: z.string().optional(),
    type: z.string().optional(),
    sort: z.string().optional(),
    maxCount: z.number().optional().default(10),
  }),
  async handler(_args: any) {
    const res = await fetchHuxiu();
    return res;
  },

};

export function registerHuxiuCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

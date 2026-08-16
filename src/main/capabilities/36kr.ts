/**
 * 36氪 商业创投 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { get36krStatus, fetch36Kr } from '../36kr';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: '36kr',
  description: '获取 36氪 商业创投 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await get36krStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: '36kr',
  description: '从 36氪 商业创投 检索最新新闻报道与资讯列表。',
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
    const res = await fetch36Kr();
    return res;
  },

};

export function register36krCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

export const register36KrCapabilities = register36krCapabilities;

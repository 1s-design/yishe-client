/**
 * wttr.in 终端天气 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getWttrStatus, searchWttr } from '../wttr';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'wttr',
  description: '获取 wttr.in 终端天气 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getWttrStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'wttr',
  description: '调用 wttr.in 终端天气 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ city: z.string().default("Beijing") }),
  async handler(args: any) {
    const res = await (args => searchWttr(args.city || "Beijing"))(args);
    return res;
  },
};

export function registerWttrCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

/**
 * Frankfurter 欧洲央行汇率 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getFrankfurterStatus, searchFrankfurter } from '../frankfurter';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'frankfurter',
  description: '获取 Frankfurter 欧洲央行汇率 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getFrankfurterStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'frankfurter',
  description: '调用 Frankfurter 欧洲央行汇率 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ from: z.string().default("USD"), to: z.string().default("CNY,EUR") }),
  async handler(args: any) {
    const res = await (args => searchFrankfurter({ from: args.from, to: args.to }))(args);
    return res;
  },
};

export function registerFrankfurterCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

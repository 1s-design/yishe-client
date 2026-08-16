/**
 * fawazahmed CDN全币种汇率 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getFawazahmedStatus, searchFawazahmed } from '../fawazahmed';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'fawazahmed',
  description: '获取 fawazahmed CDN全币种汇率 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getFawazahmedStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'fawazahmed',
  description: '调用 fawazahmed CDN全币种汇率 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ base: z.string().default("usd") }),
  async handler(args: any) {
    const res = await (args => searchFawazahmed(args.base || "usd"))(args);
    return res;
  },
};

export function registerFawazahmedCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

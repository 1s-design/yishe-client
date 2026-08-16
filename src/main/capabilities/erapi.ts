/**
 * ExchangeRate-API 实时外汇汇率 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getErapiStatus, searchErApi } from '../erapi';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'erapi',
  description: '获取 ExchangeRate-API 实时外汇汇率 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getErapiStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'erapi',
  description: '调用 ExchangeRate-API 实时外汇汇率 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ base: z.string().default("USD") }),
  async handler(args: any) {
    const res = await (args => searchErApi(args.base || "USD"))(args);
    return res;
  },
};

export function registerErapiCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

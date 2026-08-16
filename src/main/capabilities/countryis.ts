/**
 * country.is IP归属国家 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getCountryisStatus, searchCountryIs } from '../countryis';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'countryis',
  description: '获取 country.is IP归属国家 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getCountryisStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'countryis',
  description: '调用 country.is IP归属国家 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ ip: z.string().default("8.8.8.8") }),
  async handler(args: any) {
    const res = await (args => searchCountryIs(args.ip || "8.8.8.8"))(args);
    return res;
  },
};

export function registerCountryisCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

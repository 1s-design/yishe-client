/**
 * Zippopotam 邮编地理查询 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getZippopotamStatus, searchZippopotam } from '../zippopotam';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'zippopotam',
  description: '获取 Zippopotam 邮编地理查询 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getZippopotamStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'zippopotam',
  description: '调用 Zippopotam 邮编地理查询 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ countryCode: z.string().default("us"), zipCode: z.string().default("90210") }),
  async handler(args: any) {
    const res = await (args => searchZippopotam(args.countryCode || "us", args.zipCode || "90210"))(args);
    return res;
  },
};

export function registerZippopotamCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

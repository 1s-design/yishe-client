/**
 * Sunrise-Sunset 日出日落时间 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getSunrisesunsetStatus, searchSunrise } from '../sunrisesunset';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'sunrisesunset',
  description: '获取 Sunrise-Sunset 日出日落时间 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getSunrisesunsetStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'sunrisesunset',
  description: '调用 Sunrise-Sunset 日出日落时间 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ lat: z.number().default(39.9), lng: z.number().default(116.4) }),
  async handler(args: any) {
    const res = await (args => searchSunrise({ lat: args.lat, lng: args.lng }))(args);
    return res;
  },
};

export function registerSunrisesunsetCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

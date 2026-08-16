/**
 * Open-Meteo 天气预报 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getOpenmeteoStatus, searchOpenMeteo } from '../openmeteo';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'openmeteo',
  description: '获取 Open-Meteo 天气预报 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getOpenmeteoStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'openmeteo',
  description: '调用 Open-Meteo 天气预报 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ latitude: z.number().default(39.9), longitude: z.number().default(116.4) }),
  async handler(args: any) {
    const res = await (args => searchOpenMeteo({ latitude: args.latitude, longitude: args.longitude, current: true }))(args);
    return res;
  },
};

export function registerOpenmeteoCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

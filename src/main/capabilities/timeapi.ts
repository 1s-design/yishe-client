/**
 * timeapi.io 全球时区时间 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getTimeapiStatus, searchTimeApi } from '../timeapi';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'timeapi',
  description: '获取 timeapi.io 全球时区时间 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getTimeapiStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'timeapi',
  description: '调用 timeapi.io 全球时区时间 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ timezone: z.string().default("Asia/Shanghai") }),
  async handler(args: any) {
    const res = await (args => searchTimeApi(args.timezone || "Asia/Shanghai"))(args);
    return res;
  },
};

export function registerTimeapiCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

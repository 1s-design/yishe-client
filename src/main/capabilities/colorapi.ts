/**
 * The Color API 颜色代码解析 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getColorapiStatus, searchColorApi } from '../colorapi';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'colorapi',
  description: '获取 The Color API 颜色代码解析 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getColorapiStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'colorapi',
  description: '调用 The Color API 颜色代码解析 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ hex: z.string().default("24B1E0") }),
  async handler(args: any) {
    const res = await (args => searchColorApi(args.hex || "24B1E0"))(args);
    return res;
  },
};

export function registerColorapiCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

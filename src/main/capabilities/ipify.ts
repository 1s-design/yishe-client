/**
 * ipify 客户端公网IP查询 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getIpifyStatus, searchIpify } from '../ipify';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'ipify',
  description: '获取 ipify 客户端公网IP查询 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getIpifyStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'ipify',
  description: '调用 ipify 客户端公网IP查询 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler(_args: any) {
    const res = await searchIpify();
    return res;
  },

};

export function registerIpifyCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

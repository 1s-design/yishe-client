/**
 * JokeAPI 编程与趣味笑话 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getJokeStatus, searchJoke } from '../joke';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'joke',
  description: '获取 JokeAPI 编程与趣味笑话 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getJokeStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'joke',
  description: '调用 JokeAPI 编程与趣味笑话 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ category: z.string().default("Programming") }),
  async handler(_args: any) {
    const res = await searchJoke();
    return res;
  },


};

export function registerJokeCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

/**
 * Free Dictionary 英语词典 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getDictionaryStatus, searchDictionary } from '../dictionary';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'dictionary',
  description: '获取 Free Dictionary 英语词典 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getDictionaryStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'dictionary',
  description: '调用 Free Dictionary 英语词典 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ word: z.string().default("technology") }),
  async handler(args: any) {
    const res = await (args => searchDictionary(args.word || "technology"))(args);
    return res;
  },
};

export function registerDictionaryCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

/**
 * GDELT 全球事件与新闻 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getGdeltStatus, searchGdeltNews } from '../gdelt';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'gdelt',
  description: '获取 GDELT 全球事件与新闻 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getGdeltStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'gdelt',
  description: '从 GDELT 全球事件与新闻 检索最新新闻报道与资讯列表。',
  riskLevel: 'read',
  argsSchema: z.object({
    query: z.string().optional(),
    keyword: z.string().optional(),
    category: z.string().optional(),
    type: z.string().optional(),
    sort: z.string().optional(),
    maxCount: z.number().optional().default(10),
  }),
  async handler(args: any) {
    const res = await (args => searchGdeltNews(args.query || "technology", { maxrecords: args.maxCount }))(args);
    return res;
  },
};

export function registerGdeltCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

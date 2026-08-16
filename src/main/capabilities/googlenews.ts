/**
 * Google News 新闻 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getGooglenewsStatus, searchGoogleNews } from '../googlenews';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'googlenews',
  description: '获取 Google News 新闻 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getGooglenewsStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'googlenews',
  description: '从 Google News 新闻 检索最新新闻报道与资讯列表。',
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
    const res = await searchGoogleNews(args.query || "AI");
    return res;
  },

};

export function registerGooglenewsCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

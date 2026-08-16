/**
 * arXiv 学术论文 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getArxivStatus, searchArxiv } from '../arxiv';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'arxiv',
  description: '获取 arXiv 学术论文 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getArxivStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'arxiv',
  description: '从 arXiv 学术论文 检索最新新闻报道与资讯列表。',
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
    const res = await (args => searchArxiv(args.query || "cs.AI", { maxResults: args.maxCount }))(args);
    return res;
  },
};

export function registerArxivCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

/**
 * GitHub 仓库与趋势 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getGithubStatus, searchGithubRepos } from '../github';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'github',
  description: '获取 GitHub 仓库与趋势 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getGithubStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'github',
  description: '从 GitHub 仓库与趋势 检索最新新闻报道与资讯列表。',
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
    const res = await (args => searchGithubRepos(args.query || "vue", { perPage: args.maxCount, sort: args.sort }))(args);
    return res;
  },
};

export function registerGithubCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

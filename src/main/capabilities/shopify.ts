/**
 * Shopify 独立站公开商品目录 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getShopifyStatus, searchShopify } from '../shopify';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'shopify',
  description: '获取 Shopify 独立站公开商品目录 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getShopifyStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'shopify',
  description: '调用 Shopify 独立站公开商品目录 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ storeUrl: z.string().default("https://allbirds.com"), keyword: z.string().optional(), limit: z.number().default(10) }),
  async handler(args: any) {
    const res = await (args => searchShopify(args.storeUrl, { query: args.keyword, limit: args.limit }))(args);
    return res;
  },
};

export function registerShopifyCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

/**
 * CoinGecko 加密货币行情 通用能力
 */
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { getCoingeckoStatus, searchCoinGecko } from '../coingecko';

const statusDef: CapabilityDefinition = {
  name: 'status',
  namespace: 'coingecko',
  description: '获取 CoinGecko 加密货币行情 服务连接状态。',
  riskLevel: 'read',
  argsSchema: z.object({}),
  async handler() {
    const st = await getCoingeckoStatus();
    return { success: st.connected, ...st };
  },
};

const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'coingecko',
  description: '调用 CoinGecko 加密货币行情 查询数据。',
  riskLevel: 'read',
  argsSchema: z.object({ ids: z.string().default("bitcoin,ethereum"), vs_currencies: z.string().default("usd,cny") }),
  async handler(args: any) {
    const res = await (args => searchCoinGecko({ ids: args.ids, vs_currencies: args.vs_currencies }))(args);
    return res;
  },
};

export function registerCoingeckoCapabilities(): void {
  CapabilityRegistry.registerAll([statusDef, searchDef]);
}

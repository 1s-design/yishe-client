/**
 * V2EX热门话题平台模块
 *
 * 注意：核心采集逻辑已迁移至服务端能力定义（hotsearch-v2ex.capability.ts）
 * 本模块作为兼容层，通过 DynamicCapabilityManager 从服务端拉取最新脚本执行。
 *
 * 支持 executionMode：
 * - server: 服务端直接执行（默认）
 * - client: 客户端本地执行
 */

import type { PlatformModule } from '../types'
import { DynamicCapabilityManager } from '../../mcp-server/dynamic-capability-manager'
import axios from 'axios';

/**
 * 通过服务端执行（server 模式）
 */
async function executeViaServer(params: Record<string, any>): Promise<any> {
  const serverUrl = DynamicCapabilityManager.resolveServerUrl();
  const endpoint = `${serverUrl}/api/workflow/node-capabilities/hotsearch_v2ex/execute`;

  let authHeader = 'Bearer 1sdesign';
  try {
    const { getTokenValue } = await import('../../server');
    const clientToken = getTokenValue?.();
    if (clientToken) {
      authHeader = `Bearer ${clientToken}`;
    }
  } catch { /* fallback */ }

  const res = await axios.post(endpoint, {
    params: params || {},
  }, {
    timeout: 15000,
    headers: { authorization: authHeader },
  });

  const body = res.data;
  return body?.data?.data || body?.data || body;
}

const v2ex: PlatformModule = {
  config: {
    key: 'v2ex',
    name: 'V2EX',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const executionMode = (ctx as any)?.executionMode || 'server';
    const maxCount = (ctx as any)?.maxCount || this.config.maxItems;

    let result: any;

    if (executionMode === 'client') {
      result = await DynamicCapabilityManager.executeCapability('hotsearch_v2ex', { maxCount });
    } else {
      result = await executeViaServer({ maxCount });
    }

    if (result && Array.isArray(result.items)) {
      return result.items.map((item: any) => ({
        rank: item.rank,
        title: item.title,
        hot: item.hot,
        url: item.url,
        subtitle: item.subtitle,
      }));
    }

    return [];
  },
}

export default v2ex

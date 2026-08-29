/**
 * 抖音热搜平台模块
 *
 * 注意：核心采集逻辑已迁移至服务端能力定义（hotsearch-douyin.capability.ts）
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
  const endpoint = `${serverUrl}/api/workflow/node-capabilities/hotsearch_douyin/execute`;

  // 使用客户端统一的 token（如果已登录），否则使用内置 super token
  let authHeader = 'Bearer 1sdesign';
  try {
    const { getTokenValue } = await import('../../server');
    const clientToken = getTokenValue?.();
    if (clientToken) {
      authHeader = `Bearer ${clientToken}`;
    }
  } catch {
    // 无法导入 getTokenValue 时使用内置 token
  }

  const res = await axios.post(endpoint, {
    params: params || {},
  }, {
    timeout: 15000,
    headers: {
      authorization: authHeader,
    },
  });

  const body = res.data;
  return body?.data?.data || body?.data || body;
}

const douyin: PlatformModule = {
  config: {
    key: 'douyin',
    name: '抖音',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    // 优先从 context 获取 executionMode，默认 server
    const executionMode = (ctx as any)?.executionMode || 'server';
    const maxCount = (ctx as any)?.maxCount || this.config.maxItems;

    let result: any;

    if (executionMode === 'client') {
      // 客户端执行模式：从服务端拉取脚本，在客户端本地执行
      result = await DynamicCapabilityManager.executeCapability('hotsearch_douyin', { maxCount });
    } else {
      // 服务端执行模式（默认）：调用服务端执行接口
      result = await executeViaServer({ maxCount });
    }

    // 将服务端返回的标准格式转换为 PlatformModule 的 items 格式
    if (result && Array.isArray(result.items)) {
      return result.items.map((item: any) => ({
        rank: item.rank,
        title: item.title,
        hot: item.hot,
        tag: item.tag,
      }));
    }

    return [];
  },
}

export default douyin

/**
 * MCP Tool: hotsearch_collect_platform
 * 为每个平台生成独立的采集工具
 */

// 平台配置映射
const PLATFORM_CONFIGS: Record<string, { name: string; description: string; environment: string }> = {
  weibo: { name: '微博', description: '采集微博热搜榜', environment: 'direct' },
  douyin: { name: '抖音', description: '采集抖音热搜榜', environment: 'direct' },
  bilibili: { name: '哔哩哔哩', description: '采集B站热搜榜', environment: 'direct' },
  zhihu: { name: '知乎', description: '采集知乎热榜', environment: 'direct' },
  toutiao: { name: '今日头条', description: '采集今日头条热搜', environment: 'direct' },
  douban: { name: '豆瓣', description: '采集豆瓣热门话题', environment: 'direct' },
  kuaishou: { name: '快手', description: '采集快手热搜', environment: 'direct' },
  v2ex: { name: 'V2EX', description: '采集V2EX热门话题', environment: 'direct' },
  '36kr': { name: '36氪', description: '采集36氪热门资讯', environment: 'direct' },
  ithome: { name: 'IT之家', description: '采集IT之家热门资讯', environment: 'direct' },
  github: { name: 'GitHub', description: '采集GitHub Trending项目', environment: 'direct' },
  wikipedia: { name: '维基百科', description: '采集维基百科今日热点', environment: 'direct' },
  devto: { name: 'Dev.to', description: '采集Dev.to热门文章', environment: 'direct' },
  google_trends: { name: 'Google Trends', description: '采集Google趋势热搜', environment: 'proxy' },
  hackernews: { name: 'Hacker News', description: '采集Hacker News热门帖子', environment: 'proxy' },
  bbc_news: { name: 'BBC News', description: '采集BBC新闻热点', environment: 'proxy' },
  cnn: { name: 'CNN', description: '采集CNN新闻热点', environment: 'proxy' },
  nytimes: { name: 'New York Times', description: '采集纽约时报热点', environment: 'proxy' },
  aljazeera: { name: 'Al Jazeera', description: '采集半岛电视台热点', environment: 'proxy' },
  ebay_trending: { name: 'eBay Trending', description: '采集eBay热门商品趋势', environment: 'proxy' },
  shopify_trending: { name: 'Shopify Trending', description: '采集Shopify热门商品趋势', environment: 'proxy' },
};

/**
 * 获取所有平台配置
 */
export function getAllPlatformConfigs() {
  return PLATFORM_CONFIGS;
}

/**
 * 获取平台列表（用于工具定义）
 */
export function getPlatformToolDefinitions() {
  return Object.entries(PLATFORM_CONFIGS).map(([key, config]) => ({
    key,
    name: config.name,
    description: config.description,
    environment: config.environment,
  }));
}

import { DynamicCapabilityManager } from '../dynamic-capability-manager';
import axios from 'axios';

/**
 * 通过服务端执行节点能力（server 模式）
 */
async function executeViaServer(type: string, params: Record<string, any>): Promise<any> {
  const serverUrl = DynamicCapabilityManager.resolveServerUrl();
  const endpoint = `${serverUrl}/api/workflow/node-capabilities/${type}/execute`;

  console.log(`[MCP] 🔄 通过服务端执行节点能力: ${type} -> ${endpoint}`);

  // 使用客户端统一的 token（如果已登录），否则使用内置 super token
  let authHeader = 'Bearer 1sdesign';
  try {
    const { getTokenValue } = await import('../server');
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
  const result = body?.data?.data || body?.data || body;

  if (!result) {
    throw new Error(`服务端执行返回数据无效: ${JSON.stringify(body)}`);
  }

  return result;
}

/**
 * 执行单平台采集（同步返回结果）
 * 支持 executionMode 参数：
 * - server: 通过服务端执行（默认）
 * - client: 通过客户端本地执行（DynamicCapabilityManager）
 */
export async function executePlatformCollect(
  platformKey: string,
  executionMode: string = 'server',
  maxCount: number = 20,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    // 抖音平台：支持 executionMode 选择
    if (platformKey === 'douyin') {
      console.log(`[MCP] 🎯 抖音平台采集，执行模式: ${executionMode}`);

      let result: any;

      if (executionMode === 'client') {
        // 客户端执行模式：从服务端拉取脚本，在客户端本地执行
        result = await DynamicCapabilityManager.executeCapability('hotsearch_douyin', { maxCount });
      } else {
        // 服务端执行模式（默认）：调用服务端执行接口
        result = await executeViaServer('hotsearch_douyin', { maxCount });
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            source: executionMode === 'client' ? 'client_dynamic_capability' : 'server_direct',
            executionMode,
            ...result,
          }, null, 2),
        }],
        isError: false,
      };
    }

    // 其他平台：保持原有逻辑
    const { hotSearchService } = await import('../../hotsearch/hotsearch.service');
    const result = await hotSearchService.fetchAll([platformKey]);

    const platformResult = result.platforms?.[0];
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: platformResult?.success ?? false,
          platform: platformKey,
          name: PLATFORM_CONFIGS[platformKey]?.name || platformKey,
          itemCount: platformResult?.items?.length ?? 0,
          items: platformResult?.items?.slice(0, maxCount) ?? [],
          duration: platformResult?.duration,
          error: platformResult?.error,
          fetchedAt: (result as any).fetchedAt,
          reportResult: (result as any).reportResult,
        }, null, 2),
      }],
      isError: !platformResult?.success,
    };
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          platform: platformKey,
          executionMode,
          error: error?.message || String(error),
        }, null, 2),
      }],
      isError: true,
    };
  }
}

/**
 * 执行全平台采集（异步后台执行，立即返回）
 */
export function executeAllPlatformCollect(
  platformKeys?: string[],
  _reportToServer: boolean = false,
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  // 后台异步执行采集，不阻塞 MCP 响应
  (async () => {
    try {
      const { hotSearchService } = await import('../../hotsearch/hotsearch.service');
      const result = await hotSearchService.fetchAll(platformKeys);
      const successCount = result.platforms?.filter((p: any) => p.success).length ?? 0;
      console.log(`[MCP] 全平台采集完成: 成功 ${successCount}/${result.platforms?.length ?? 0}`);
    } catch (error: any) {
      console.error(`[MCP] 全平台采集失败: ${error?.message}`);
    }
  })();

  // 立即返回
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        message: '全平台热搜采集已启动，正在后台执行。',
        platforms: platformKeys || Object.keys(PLATFORM_CONFIGS),
        tip: '采集约需 1-2 分钟',
      }, null, 2),
    }],
  };
}

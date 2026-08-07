/**
 * MCP Tool: hotsearch_collect_platform
 * 为每个平台生成独立的采集工具
 */

// import { z } from 'zod';

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

/**
 * 执行单平台采集（同步返回结果）
 */
export async function executePlatformCollect(
  platformKey: string,
  _reportToServer: boolean = true
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const { hotSearchService } = await import('../../hotsearch/hotsearch.service');
    const result = await hotSearchService.fetchAndReport([platformKey]);

    const platformResult = result.platforms?.[0];
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: platformResult?.success ?? false,
          platform: platformKey,
          name: PLATFORM_CONFIGS[platformKey]?.name || platformKey,
          itemCount: platformResult?.items?.length ?? 0,
          items: platformResult?.items?.slice(0, 10) ?? [],
          duration: platformResult?.duration,
          error: platformResult?.error,
          fetchedAt: result.fetchedAt,
          reportResult: result.reportResult,
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
  _reportToServer: boolean = true
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  // 后台异步执行采集，不阻塞 MCP 响应
  (async () => {
    try {
      const { hotSearchService } = await import('../../hotsearch/hotsearch.service');
      const result = await hotSearchService.fetchAndReport(platformKeys);
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
        message: '全平台热搜采集已启动，正在后台执行。采集完成后数据会自动上报到服务端，可在 Admin 热搜页面查看结果。',
        platforms: platformKeys || Object.keys(PLATFORM_CONFIGS),
        tip: '采集约需 1-2 分钟，请稍后在 Admin 页面刷新查看。',
      }, null, 2),
    }],
  };
}

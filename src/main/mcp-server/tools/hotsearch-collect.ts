/**
 * MCP Tool: hotsearch_collect
 * 调用客户端已有的热搜采集能力
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

// 懒加载热搜服务模块
let hotSearchServiceModulePromise: Promise<typeof import('../../hotsearch/hotsearch.service')> | null = null;

async function getHotSearchService() {
  if (!hotSearchServiceModulePromise) {
    hotSearchServiceModulePromise = import('../../hotsearch/hotsearch.service');
  }
  const mod = await hotSearchServiceModulePromise;
  return mod.hotSearchService;
}

// 远程 API 地址
const REMOTE_API_BASE =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:1520/api'
    : 'https://1s.design:1520/api';

export const hotsearchCollectTool = {
  definition: {
    name: 'hotsearch_collect',
    description: '采集热搜数据。支持采集指定平台（如 weibo、douyin 等）或所有启用平台的热搜数据，并自动上报到服务端。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: '要采集的平台 key 列表（如 ["weibo", "douyin"]）。留空则采集所有启用平台。',
        },
        reportToServer: {
          type: 'boolean' as const,
          description: '是否自动上报到服务端，默认 true',
          default: true,
        },
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const platforms = args.platforms as string[] | undefined;
    const reportToServer = (args.reportToServer as boolean) ?? true;

    try {
      const service = await getHotSearchService();

      let result: any;
      if (reportToServer) {
        result = await service.fetchAndReport(platforms);
      } else {
        result = await service.fetchAll(platforms);
      }

      const successCount = result.platforms?.filter((p: any) => p.success).length ?? 0;
      const totalCount = result.platforms?.length ?? 0;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              snapshotId: result.snapshotId,
              fetchedAt: result.fetchedAt,
              summary: {
                total: totalCount,
                success: successCount,
                failed: totalCount - successCount,
                duration: result.summary?.duration,
              },
              platforms: result.platforms?.map((p: any) => ({
                platform: p.platform,
                name: p.name,
                success: p.success,
                itemCount: p.items?.length ?? 0,
                duration: p.duration,
                error: p.error,
              })),
              reportResult: result.reportResult,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error?.message || String(error),
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
};

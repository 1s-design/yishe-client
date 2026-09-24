/**
 * MCP Tool: direct_publish
 * 直发内容到社交媒体平台（不经过任务队列）
 *
 * 支持平台：weibo, douyin, xiaohongshu, kuaishou, tiktok, youtube,
 *            xianyu, doudian, taobao, pdd, temu
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

// 懒加载直发模块
let directPublishModulePromise: Promise<typeof import('../../auto-browser/legacy/api/directPublish')> | null = null;

async function getDirectPublishModule() {
  if (!directPublishModulePromise) {
    directPublishModulePromise = import('../../auto-browser/legacy/api/directPublish');
  }
  return directPublishModulePromise;
}

export const directPublishTool = {
  definition: {
    name: 'direct_publish',
    description: '直发内容到社交媒体平台，不经过任务队列，立即执行。支持微博、抖音、小红书、快手、TikTok、YouTube等平台。',
    inputSchema: {
      type: 'object' as const,
      required: ['platform', 'images', 'content'],
      properties: {
        platform: {
          type: 'string' as const,
          description: '目标平台ID。可选：weibo(微博)、douyin(抖音)、xiaohongshu(小红书)、kuaishou(快手)、tiktok、youtube、xianyu(咸鱼)、doudian(抖店)、taobao(淘宝)、pdd(拼多多)、temu',
        },
        images: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: '图片URL数组，至少1张',
        },
        content: {
          type: 'string' as const,
          description: '正文内容',
        },
        title: {
          type: 'string' as const,
          description: '标题（可选，部分平台需要）',
        },
        tags: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: '标签/话题数组（可选）',
        },
        video: {
          type: 'string' as const,
          description: '视频URL（可选，支持视频的平台会使用）',
        },
        profileId: {
          type: 'string' as const,
          description: '浏览器Profile ID（可选，指定用哪个登录态发布）',
        },
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const { platform, images, content, title, tags, video, profileId } = args;

    try {
      const mod = await getDirectPublishModule();
      const result = await mod.directPublish({
        platform: platform as string,
        images: images as string[],
        content: content as string,
        ...(title ? { title: title as string } : {}),
        ...(tags ? { tags: tags as string[] } : {}),
        ...(video ? { video: video as string } : {}),
        ...(profileId ? { profileId: profileId as string } : {}),
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              platform: result.platform,
              message: result.message,
              timestamp: result.timestamp,
              ...(result.data ? { data: result.data } : {}),
              ...(result.error ? { error: result.error } : {}),
            }, null, 2),
          },
        ],
        isError: !result.success,
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

export const directPublishMultiTool = {
  definition: {
    name: 'direct_publish_multi',
    description: '批量直发内容到多个社交媒体平台，顺序执行（平台间自动间隔2秒）。',
    inputSchema: {
      type: 'object' as const,
      required: ['platforms', 'images', 'content'],
      properties: {
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: '目标平台ID数组，如 ["weibo", "xiaohongshu"]',
        },
        images: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: '图片URL数组，至少1张',
        },
        content: {
          type: 'string' as const,
          description: '正文内容',
        },
        title: {
          type: 'string' as const,
          description: '标题（可选）',
        },
        tags: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: '标签/话题数组（可选）',
        },
        video: {
          type: 'string' as const,
          description: '视频URL（可选）',
        },
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const { platforms, images, content, title, tags, video } = args;
    const platformList = Array.isArray(platforms) ? platforms.map(String) : [];

    try {
      const mod = await getDirectPublishModule();
      const results = await mod.directPublishMulti({
        platforms: platformList,
        images: images as string[],
        content: content as string,
        ...(title ? { title: title as string } : {}),
        ...(tags ? { tags: tags as string[] } : {}),
        ...(video ? { video: video as string } : {}),
      });

      const successCount = results.filter((r) => r.success).length;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: successCount === platformList.length,
              total: platformList.length,
              successCount,
              failedCount: platformList.length - successCount,
              results: results.map((r) => ({
                platform: r.platform,
                success: r.success,
                message: r.message,
              })),
            }, null, 2),
          },
        ],
        isError: successCount === 0,
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

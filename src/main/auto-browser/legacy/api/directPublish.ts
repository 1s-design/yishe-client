/**
 * 直发模块 — 不依赖任务队列，直接调用平台发布器
 *
 * 设计目标：
 * 1. 独立于 HTTP 服务器，可被 AI Agent、工作流节点、外部脚本直接调用
 * 2. 统一接口，屏蔽底层平台差异
 * 3. 未来可封装为工作流节点
 *
 * 调用方式：
 *   import { directPublish } from './directPublish';
 *   const result = await directPublish({ platform: 'weibo', images: [...], content: '...' });
 */

import publishService from './publishService.js';
import { logger } from '../utils/logger.js';

// ─── 类型定义 ──────────────────────────────────────────────

export interface DirectPublishOptions {
  /** 平台ID: weibo/douyin/xiaohongshu/kuaishou/tiktok/youtube/xianyu/doudian/taobao/pdd/temu */
  platform: string;
  /** 图片 URL 数组 */
  images: string[];
  /** 视频 URL（可选） */
  video?: string;
  /** 标题 */
  title?: string;
  /** 正文内容 */
  content: string;
  /** 标签/话题数组 */
  tags?: string[];
  /** 浏览器 Profile ID（可选，指定用哪个浏览器Profile登录） */
  profileId?: string;
  /** 平台特定选项 */
  options?: Record<string, any>;
}

export interface DirectPublishResult {
  success: boolean;
  platform: string;
  message: string;
  data?: any;
  error?: string;
  timestamp: string;
}

// ─── 核心方法 ──────────────────────────────────────────────

/**
 * 直发单平台
 *
 * @example
 * const result = await directPublish({
 *   platform: 'weibo',
 *   images: ['https://cdn.xxx.com/img1.jpg'],
 *   title: '今日热搜',
 *   content: '这是正文...',
 *   tags: ['科技', 'AI']
 * });
 */
export async function directPublish(opts: DirectPublishOptions): Promise<DirectPublishResult> {
  const { platform, images, video, title, content, tags, profileId, options = {} } = opts;

  logger.info(`[directPublish] 开始直发: ${platform}`, {
    imageCount: images?.length || 0,
    hasVideo: !!video,
    hasTags: !!tags?.length,
  });

  try {
    const payload = {
      action: 'publish',
      images: images || [],
      ...(video ? { video, videoUrl: video } : {}),
      ...(title ? { title } : {}),
      content: content || '',
      ...(tags?.length ? { tags, keywords: tags } : {}),
      ...(profileId ? { profileId } : {}),
      ...options,
    };

    const result = await publishService.executePlatformAction(platform, payload);

    logger.info(`[directPublish] 直发完成: ${platform}`, {
      success: result.success,
      message: result.message,
    });

    return {
      success: result.success,
      platform,
      message: result.message || (result.success ? '发布成功' : '发布失败'),
      data: result,
      timestamp: result.timestamp || new Date().toISOString(),
    };
  } catch (error: any) {
    logger.error(`[directPublish] 直发异常: ${platform}`, error);
    return {
      success: false,
      platform,
      message: error?.message || '发布异常',
      error: error?.stack || String(error),
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 直发多平台（顺序执行）
 *
 * @example
 * const results = await directPublishMulti({
 *   platforms: ['weibo', 'xiaohongshu'],
 *   images: ['https://cdn.xxx.com/img1.jpg'],
 *   content: '同一内容多发',
 *   tags: ['科技']
 * });
 */
export async function directPublishMulti(
  opts: Omit<DirectPublishOptions, 'platform'> & { platforms: string[] }
): Promise<DirectPublishResult[]> {
  const { platforms, ...baseOpts } = opts;
  const results: DirectPublishResult[] = [];

  for (const platform of platforms) {
    const result = await directPublish({ ...baseOpts, platform });
    results.push(result);
    // 平台间间隔 2 秒，避免风控
    if (platforms.indexOf(platform) < platforms.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return results;
}

/**
 * 获取支持直发的平台列表
 */
export function getSupportedPlatforms(): Array<{ id: string; name: string; category: string }> {
  try {
    const { getPlatformCatalog } = require('../config/platformRegistry.js');
    const catalog = getPlatformCatalog();
    return catalog.map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category,
    }));
  } catch {
    return [
      { id: 'weibo', name: '微博', category: 'content' },
      { id: 'douyin', name: '抖音', category: 'content' },
      { id: 'xiaohongshu', name: '小红书', category: 'content' },
      { id: 'kuaishou', name: '快手', category: 'content' },
      { id: 'tiktok', name: 'TikTok', category: 'content' },
      { id: 'youtube', name: 'YouTube', category: 'content' },
      { id: 'xianyu', name: '咸鱼', category: 'commerce' },
      { id: 'doudian', name: '抖店', category: 'commerce' },
      { id: 'taobao', name: '淘宝', category: 'commerce' },
      { id: 'pdd', name: '拼多多', category: 'commerce' },
      { id: 'temu', name: 'Temu', category: 'commerce' },
    ];
  }
}

export default { directPublish, directPublishMulti, getSupportedPlatforms };

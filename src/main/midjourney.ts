/**
 * Midjourney 开放社区作品采集 (Explore Showcase)
 * 官网: https://www.midjourney.com/explore
 *
 * 支持能力：
 * 1. 热门精选图片 (feed=top)，提取最高画质 Master JPEG (如 1648x2944)
 * 2. 热门精选视频 (feed=video_top)，提取无水印原生 MP4 原片
 * 3. 完整元数据：Prompt 提示词、生成参数、作者名、画面比例与模型版本
 * 4. 自动处理 Cloudflare Turnstile 防护与会话管理
 */

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';
import { getDefaultChromeExecutableInfo } from './auto-browser/legacy/utils/playwrightRuntime.js';

export type MidjourneyFeed = 'top' | 'video_top';

export interface MidjourneyPrompt {
  decodedPrompt?: Array<{ content: string; weight: number }>;
  ar?: { w: number; h: number };
  version?: string;
  hd?: boolean;
  stylize?: number;
  seed?: string | number;
  [key: string]: any;
}

export interface MidjourneyRawItem {
  id: string;
  type: 'image' | 'video';
  job_type: string;
  event_type: string;
  enqueue_time: number;
  width: number;
  height: number;
  username_v2?: string;
  display_name?: string;
  user_id?: string;
  prompt?: MidjourneyPrompt | any;
  parent_grid?: number | null;
  items?: Array<{ server_filtered?: boolean; filtered?: boolean }>;
  video_segments?: any;
}

export interface MidjourneyItem {
  id: string;
  source: 'midjourney';
  title: string;
  description: string;
  mediaType: 'image' | 'video';
  mimeType: string;
  thumbnailUrl: string;
  previewUrl: string;
  fileUrl: string;
  fileSize?: number;
  width: number;
  height: number;
  license: string;
  creator: string;
  tags: string[];
  rawMeta: MidjourneyRawItem;
}

export interface MidjourneySearchResult {
  success: boolean;
  total: number;
  page: number;
  pageSize: number;
  items: MidjourneyItem[];
  hasMore: boolean;
  error?: string;
}

/** 启动隐身 Chrome 上下文以绕过 Cloudflare 验证 */
async function createStealthSession() {
  const chromeInfo = getDefaultChromeExecutableInfo();
  const executablePath =
    chromeInfo?.executablePath ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-size=1440,900',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  return { browser, context, page };
}

/** 从 items 列表中获取非 filtered 的子图序号 (0_0, 0_1, 0_2, 0_3) */
function getSelectedSubIndex(item: MidjourneyRawItem): string {
  if (Array.isArray(item.items) && item.items.length > 0) {
    const activeIdx = item.items.findIndex(
      (sub) => sub.server_filtered === false || sub.filtered === false
    );
    if (activeIdx >= 0) {
      return `0_${activeIdx}`;
    }
  }
  return '0_0';
}

/** 提取提示词文本摘要 */
function extractPromptSummary(prompt: any): { title: string; fullPrompt: string } {
  if (!prompt) return { title: 'Midjourney Creation', fullPrompt: '' };

  let text = '';
  if (Array.isArray(prompt.decodedPrompt) && prompt.decodedPrompt.length > 0) {
    text = prompt.decodedPrompt
      .map((p: any) => p.content)
      .filter(Boolean)
      .join(' ')
      .trim();
  } else if (typeof prompt === 'string') {
    text = prompt.trim();
  }

  const title = text
    ? text.length > 60
      ? text.slice(0, 57) + '...'
      : text
    : 'Midjourney Creation';
  return { title, fullPrompt: text };
}

/**
 * 搜索 / 浏览 Midjourney Explore
 *
 * @param options.feed 'top' (图片) 或 'video_top' (视频)
 * @param options.page 页码，从 1 开始
 * @param options.query 可选关键词过滤（本地针对 Prompt 和作者名过滤）
 * @param options.mediaType 'image' 或 'video'（默认按 feed 自动决定）
 */
export async function searchMidjourney(options: {
  feed?: MidjourneyFeed | string;
  page?: number;
  query?: string;
  mediaType?: 'image' | 'video';
  pageSize?: number;
}): Promise<MidjourneySearchResult> {
  const isVideo =
    options.mediaType === 'video' ||
    options.feed === 'video_top' ||
    options.feed === 'video';

  const feed: MidjourneyFeed = isVideo ? 'video_top' : 'top';
  const pageIdx = Math.max(0, (options.page || 1) - 1);
  const query = (options.query || '').trim().toLowerCase();

  console.log(
    `[Midjourney] 搜索开始: feed=${feed}, page=${pageIdx}, query="${query}"`
  );

  let session;
  try {
    session = await createStealthSession();
    const { page, browser } = session;

    let capturedItems: MidjourneyRawItem[] = [];

    // 监听网络响应：捕获由页面本身触发的 /api/explore 请求
    const explorePromise = new Promise<MidjourneyRawItem[]>((resolve) => {
      page.on('response', async (res) => {
        const url = res.url();
        if (
          url.includes('/api/explore') &&
          res.status() === 200 &&
          (isVideo ? url.includes('video_top') : !url.includes('video_top'))
        ) {
          try {
            const json = await res.json();
            if (Array.isArray(json) && json.length > 0) {
              capturedItems = json;
              resolve(json);
            }
          } catch {
            // ignore
          }
        }
      });
    });

    await page.goto('https://www.midjourney.com/explore?tab=top', {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });

    // 如果目标是视频流，点击页面的 "Videos" 按钮触发官方加载
    if (isVideo) {
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find((b) => b.innerText.trim() === 'Videos');
        if (btn) btn.click();
      });
    }

    // 等待被动网络流返回（最多等待 6 秒）
    await Promise.race([
      explorePromise,
      new Promise((r) => setTimeout(r, 6000)),
    ]);

    // 如果被动拦截未获取到，或请求的是下一页 (pageIdx > 0)，通过页面内 fetch 主动请求
    if (capturedItems.length === 0 || pageIdx > 0) {
      // 间隔 1.5s 避免触发频控
      await page.waitForTimeout(1500);

      const fetchResult = await page.evaluate(
        async ({ feedName, targetPage }) => {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const resp = await fetch(
                `/api/explore?page=${targetPage}&feed=${feedName}&_ql=explore`,
                {
                  headers: {
                    'x-csrf-protection': '1',
                    referer: 'https://www.midjourney.com/explore',
                  },
                }
              );
              if (resp.status === 429) {
                if (attempt === 0) {
                  await new Promise((r) => setTimeout(r, 2500));
                  continue;
                }
                return { error429: true };
              }
              if (!resp.ok) {
                return { error: `HTTP ${resp.status}` };
              }
              const data = await resp.json();
              return { items: data };
            } catch (e: any) {
              return { error: e.message };
            }
          }
          return { error429: true };
        },
        { feedName: feed, targetPage: pageIdx }
      );

      if ((fetchResult as any)?.error429) {
        // 若频控且已有被动捕获数据，则容错使用被动数据
        if (capturedItems.length === 0) {
          throw new Error('Midjourney 访问频次受限 (429)，请稍候片刻再试');
        }
      } else if (Array.isArray((fetchResult as any)?.items)) {
        capturedItems = (fetchResult as any).items;
      }
    }

    await browser.close();

    if (!Array.isArray(capturedItems) || capturedItems.length === 0) {
      return {
        success: true,
        total: 0,
        page: pageIdx + 1,
        pageSize: 50,
        items: [],
        hasMore: false,
      };
    }

    // 格式化为标准 MediaAsset
    let formatted: MidjourneyItem[] = capturedItems.map((raw) => {
      const isItemVideo = raw.type === 'video' || isVideo;
      const subIdx = getSelectedSubIndex(raw);
      const { title, fullPrompt } = extractPromptSummary(raw.prompt);

      let thumbnailUrl = '';
      let previewUrl = '';
      let fileUrl = '';

      if (isItemVideo) {
        thumbnailUrl = `https://cdn.midjourney.com/video/${raw.id}/0_640_N.webp`;
        previewUrl = `https://cdn.midjourney.com/video/${raw.id}/0_640_N.webp`;
        fileUrl = `https://cdn.midjourney.com/video/${raw.id}/0.mp4`;
      } else {
        thumbnailUrl = `https://cdn.midjourney.com/${raw.id}/${subIdx}_384_N.webp?method=shortest`;
        previewUrl = `https://cdn.midjourney.com/${raw.id}/${subIdx}_640_N.webp?method=shortest`;
        fileUrl = `https://cdn.midjourney.com/${raw.id}/${subIdx}.jpeg`;
      }

      const tags: string[] = ['midjourney', isItemVideo ? 'ai-video' : 'ai-image'];
      if (raw.job_type) tags.push(raw.job_type);
      if (raw.prompt?.version) tags.push(`v${raw.prompt.version}`);
      if (raw.prompt?.hd) tags.push('hd');

      return {
        id: raw.id,
        source: 'midjourney' as const,
        title,
        description: fullPrompt || title,
        mediaType: isItemVideo ? ('video' as const) : ('image' as const),
        mimeType: isItemVideo ? 'video/mp4' : 'image/jpeg',
        thumbnailUrl,
        previewUrl,
        fileUrl,
        width: raw.width,
        height: raw.height,
        license: 'Midjourney Community',
        creator: raw.username_v2 || raw.display_name || 'Midjourney Artist',
        tags,
        rawMeta: raw,
      };
    });

    // 若有搜索关键词，则在客户端针对 prompt 与作者进行过滤
    if (query) {
      formatted = formatted.filter((item) => {
        const promptText = (item.description || '').toLowerCase();
        const creatorText = (item.creator || '').toLowerCase();
        return promptText.includes(query) || creatorText.includes(query);
      });
    }

    return {
      success: true,
      total: formatted.length,
      page: pageIdx + 1,
      pageSize: 50,
      items: formatted,
      hasMore: capturedItems.length >= 50,
    };
  } catch (error: any) {
    if (session?.browser) {
      await session.browser.close().catch(() => {});
    }
    console.error('[Midjourney] 搜索失败:', error?.message || error);
    return {
      success: false,
      total: 0,
      page: pageIdx + 1,
      pageSize: 50,
      items: [],
      hasMore: false,
      error: error?.message || 'Midjourney 搜索失败',
    };
  }
}

/**
 * 下载 Midjourney 媒体文件（无水印 MP4 或 Master JPEG 原图）
 *
 * 通过启动隐身 Chrome 会话访问 CDN，避开 Cloudflare 反跨域拦截。
 */
export async function downloadMidjourneyMedia(
  item: { fileUrl?: string; mediaType?: string; id?: string },
  destDir: string,
  filename: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const targetUrl = item.fileUrl;
  if (!targetUrl) {
    return { success: false, error: '缺少目标文件 URL' };
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const outputPath = path.join(destDir, filename);

  console.log(`[Midjourney] 开始下载: url=${targetUrl}, target=${outputPath}`);

  let session;
  try {
    session = await createStealthSession();
    const { page, browser } = session;

    // 先让页面访问 explore 建立合法的 CDN 引用会话
    await page.goto('https://www.midjourney.com/explore', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(2000);

    const isVideo = item.mediaType === 'video' || targetUrl.endsWith('.mp4');

    if (isVideo) {
      // 视频下载：通过页面中的 <video> 标签流式触发加载并捕获 response buffer
      let videoBuffer: Buffer | null = null;

      page.on('response', async (res) => {
        if (
          res.url().includes('0.mp4') &&
          (res.status() === 200 || res.status() === 206)
        ) {
          try {
            const buf = await res.body();
            if (buf && buf.length > 0) {
              videoBuffer = buf;
            }
          } catch {
            // ignore partial read
          }
        }
      });

      const videoLoaded = await page.evaluate(async (url) => {
        return new Promise<boolean>((resolve) => {
          const v = document.createElement('video');
          v.autoplay = true;
          v.muted = true;
          v.onloadeddata = () => resolve(true);
          v.onerror = () => resolve(false);
          v.src = url;
          document.body.appendChild(v);
        });
      }, targetUrl);

      if (!videoLoaded) {
        throw new Error('视频媒体加载失败');
      }

      await page.waitForTimeout(3000);

      if (!videoBuffer || (videoBuffer as Buffer).length === 0) {
        throw new Error('未截获到有效视频数据流');
      }

      fs.writeFileSync(outputPath, videoBuffer);
    } else {
      // 图片下载：通过页面创建 Image 元素加载并从 network response 或 evaluate 提取
      let imgBuffer: Buffer | null = null;

      page.on('response', async (res) => {
        if (res.url().includes('.jpeg') && res.status() === 200) {
          try {
            const buf = await res.body();
            if (buf && buf.length > 0) {
              imgBuffer = buf;
            }
          } catch {
            // ignore
          }
        }
      });

      const imgLoaded = await page.evaluate(async (url) => {
        return new Promise<boolean>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        });
      }, targetUrl);

      if (!imgLoaded) {
        throw new Error('超清 JPEG 图片加载失败');
      }

      await page.waitForTimeout(2000);

      if (!imgBuffer || (imgBuffer as Buffer).length === 0) {
        throw new Error('未截获到有效图片数据流');
      }

      fs.writeFileSync(outputPath, imgBuffer);
    }

    await browser.close();

    const stats = fs.statSync(outputPath);
    console.log(`[Midjourney] 下载完成: ${outputPath} (${stats.size} 字节)`);
    return { success: true, filePath: outputPath };
  } catch (error: any) {
    if (session?.browser) {
      await session.browser.close().catch(() => {});
    }
    console.error(
      `[Midjourney] 下载异常 [${targetUrl}]:`,
      error?.message || error
    );
    return { success: false, error: error?.message || '下载失败' };
  }
}

/**
 * 抖音精选数据采集能力
 * 官方网站: https://www.douyin.com/jingxuan
 * 特点: 抖音精选视频内容，包含时长、播放量、作者、标签等信息
 * 架构: 客户端浏览器环境 (BrowserProfileService) + byted_acrawler 签名自动过盾 + DOM 解析
 */

import fs from "fs";
import { join } from "path";
import { app } from "electron";

const DOUYIN_SITE_URL = "https://www.douyin.com/";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─── 类型定义 ──────────────────────────────────────────

export interface DouyinVideo {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  cover: string;
  duration: string;
  playCount: string;
  author: string;
  authorId: string;
  date: string;
  tags: string[];
}

export interface DouyinSearchResult {
  success: boolean;
  query: string;
  category: string;
  count: number;
  total: number;
  items: DouyinVideo[];
  page: number;
  nextPage: number | null;
  error?: string;
}

export interface DouyinSearchOptions {
  page?: number;
  limit?: number;
  maxCount?: number;
  category?: string;
  keyword?: string;
}

export interface DouyinStatus {
  key: string;
  pluginKey: string;
  label: string;
  connected: boolean;
  available: boolean;
  status: string;
  state: string;
  message: string;
  lastCheckedAt: string;
  supportedCommands: string[];
}

// ─── 浏览器环境管理 ────────────────────────────────────

type ManagedProfile = {
  id: string;
  name?: string;
  userDataDir?: string;
};

/**
 * macOS 上通过 AppleScript 激活 Chrome 窗口到前台
 */
async function activateChromeWindowOnMac(profileId: string): Promise<void> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // 使用 AppleScript 激活 Chrome（或 Chromium）窗口
    const script = `
      tell application "System Events"
        set chromeProcesses to (name of every process whose name contains "Chrome" or name contains "Chromium")
        if chromeProcesses is not {} then
          repeat with procName in chromeProcesses
            tell process procName
              set frontmost to true
            end tell
          end repeat
        end if
      end tell
    `;
    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    console.log("[DouyinJingxuan] 已尝试通过 AppleScript 激活 Chrome 窗口");
  } catch (err: any) {
    console.warn("[DouyinJingxuan] AppleScript 激活窗口失败（可忽略）:", err?.message || err);
  }
}

async function ensureDouyinManagedProfile(): Promise<ManagedProfile | null> {
  try {
    const profileService = await import(
      "../auto-browser/legacy/services/BrowserProfileService.js"
    );
    const profiles = profileService.listBrowserProfiles();
    let profile = (profiles?.items || []).find((item: any) => {
      const platforms = Array.isArray(item?.platforms) ? item.platforms : [];
      return (
        platforms.some(
          (platform: unknown) =>
            String(platform).toLowerCase() === "douyin_jingxuan",
        ) ||
        String(item?.name || "").includes("抖音精选") ||
        String(item?.remark || "").includes("抖音精选")
      );
    });

    if (!profile) {
      profile = profileService.createBrowserProfile({
        name: "【素材采集】抖音精选",
        remark: "抖音精选视频采集专属环境（系统自动创建）",
        platforms: ["douyin_jingxuan"],
        headless: false,
      });
      console.log("[DouyinJingxuan] 🌟 已创建并注册浏览器自动化专属环境:", {
        id: profile?.id,
        name: profile?.name,
        userDataDir: profile?.userDataDir,
      });
    } else {
      const platforms = Array.from(
        new Set([
          ...(Array.isArray(profile.platforms) ? profile.platforms : []),
          "douyin_jingxuan",
        ]),
      );
      profile =
        profileService.markBrowserProfileUsed(profile.id, { platforms }) ||
        profile;
      console.log("[DouyinJingxuan] ♻️ 复用浏览器自动化专属环境:", {
        id: profile?.id,
        name: profile?.name,
        userDataDir: profile?.userDataDir,
      });
    }

    return profile?.id ? profile : null;
  } catch (error: any) {
    const message = error?.message || String(error);
    if (/\b(?:EACCES|EPERM)\b/i.test(message)) {
      console.error(
        "[DouyinJingxuan] 浏览器自动化工作目录无写权限，无法注册抖音精选环境。请修复工作目录所有权后重试",
      );
    } else {
      console.warn(
        "[DouyinJingxuan] 注册/复用受管浏览器环境失败:",
        message,
      );
    }
    return null;
  }
}

// ─── 数据提取 ──────────────────────────────────────────

function parseVideoCard(card: Element): DouyinVideo | null {
  try {
    // 视频链接
    const linkEl = card.querySelector('a[href*="/video/"]');
    const href = linkEl?.getAttribute("href") || "";

    // 封面图
    const imgEl = card.querySelector("img");
    const cover =
      imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || "";

    // 完整文本
    const fullText = card.textContent?.trim() || "";

    // 时长 (格式: 02:03 或 36:05)
    const durationMatch = fullText.match(/(\d{2}:\d{2})/);
    const duration = durationMatch ? durationMatch[1] : "";

    // 播放量 (格式: 16.6万 或 120.3万)
    const playCountMatch = fullText.match(/(\d+\.?\d*万)/);
    const playCount = playCountMatch ? playCountMatch[1] : "";

    // 作者 (@用户名)
    const authorMatch = fullText.match(/@([^·\s]+)/);
    const author = authorMatch ? "@" + authorMatch[1] : "";

    // 日期 (· 后面的内容)
    const dateMatch = fullText.match(/·\s*([^\s#@]+)$/);
    const date = dateMatch ? dateMatch[1] : "";

    // 话题标签
    const tags = Array.from(fullText.matchAll(/#([^#\s]+)/g)).map(
      (m) => "#" + m[1],
    );

    // 标题（去掉时长、播放量、作者、标签后的内容）
    let title = fullText
      .replace(/\d{2}:\d{2}/, "")
      .replace(/\d+\.?\d*万/, "")
      .replace(/@[^·\s]+/, "")
      .replace(/·\s*[^\s#@]+$/, "")
      .replace(/#[^#\s]+/g, "")
      .trim();

    // 清理标题中的特殊字符
    title = title.replace(/^[\s·]+|[\s·]+$/g, "");

    // ID
    const idMatch = href.match(/\/video\/(\d+)/);
    const id = idMatch ? idMatch[1] : Math.random().toString(36).slice(2, 10);

    return {
      id,
      title,
      description: fullText,
      videoUrl: href
        ? href.startsWith("http")
          ? href
          : `https://www.douyin.com${href}`
        : "",
      cover: cover
        ? cover.startsWith("http")
          ? cover
          : `https:${cover}`
        : "",
      duration,
      playCount,
      hot: playCount, // 用于前端热度显示
      author,
      authorId: author,
      date,
      tags,
    };
  } catch {
    return null;
  }
}

// ─── 核心采集逻辑 ──────────────────────────────────────

async function searchInBrowserContext(
  category: string,
  page: number,
  scrollTimes: number = 3,
): Promise<{ items: DouyinVideo[]; total: number }> {
  const managedProfile = await ensureDouyinManagedProfile();
  if (!managedProfile?.id) {
    throw new Error("无法初始化抖音精选专属受管环境，请检查本地环境权限");
  }

  const {
    createProfileBrowserPage,
    focusManagedProfileBrowser,
    updateManagedProfileBrowserActivity,
    closeManagedProfileBrowser,
  } = await import(
    "../auto-browser/legacy/services/ManagedProfileBrowserPool.js"
  );

  // 构建目标 URL
  let targetUrl = "https://www.douyin.com/jingxuan";
  if (category && category !== "全部") {
    targetUrl = `https://www.douyin.com/jingxuan?category=${encodeURIComponent(category)}`;
  }

  console.log(`[DouyinJingxuan] 🚀 打开专属受管环境窗口 [${managedProfile.name || managedProfile.id}]:`, {
    targetUrl,
  });

  let managedPage: any = null;

  try {
    // activate: true 确保页面在前台显示，而不是在后台创建
    managedPage = await createProfileBrowserPage(managedProfile.id, { activate: true });
    updateManagedProfileBrowserActivity(managedProfile.id);
    await focusManagedProfileBrowser(managedProfile.id).catch(() => undefined);

    // macOS 上额外激活 Chrome 窗口（确保窗口在操作系统层级获得焦点）
    await activateChromeWindowOnMac(managedProfile.id);

    console.log(`[DouyinJingxuan] [Step 1] 专属窗口导航至目标页面: ${targetUrl}`);
    await managedPage.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    console.log(`[DouyinJingxuan] [Step 2] 等待 byted_acrawler 签名验证与页面数据加载...`);

    // 轮询等待签名验证通过并获取数据（最多 30 秒）
    for (let i = 0; i < 30; i++) {
      await managedPage.waitForTimeout(1000);
      try {
        const title = await managedPage.title();
        const isVerifying =
          title.includes("Just a moment") ||
          title.includes("请稍候") ||
          title.includes("Cloudflare") ||
          title.includes("Security Checkpoint") ||
          title.includes("Attention Required");

        if (isVerifying) {
          console.log(
            `[DouyinJingxuan] [Step 2] 等待安全验证 (第 ${i + 1}/30 秒, 状态: "${title}")...`,
          );
          continue;
        }

        // 检查页面是否有视频卡片
        const hasVideos = await managedPage.evaluate(() => {
          const cards = document.querySelectorAll('[class*="jingxuanVideoCard"]');
          return cards.length >= 3;
        });

        if (hasVideos) {
          console.log(`[DouyinJingxuan] [Step 3] 页面视频卡片渲染完成`);
          break;
        }
      } catch (loopErr: any) {
        // 忽略页面跳转过程中的临时上下文重置
      }
    }

    // 滚动加载更多内容
    console.log(`[DouyinJingxuan] [Step 4] 滚动加载更多内容 (${scrollTimes} 次)...`);
    for (let i = 0; i < scrollTimes; i++) {
      await managedPage.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });
      await managedPage.waitForTimeout(1500);
    }

    // 提取视频数据
    console.log(`[DouyinJingxuan] [Step 5] 提取视频数据...`);

    // 提取视频数据 - 使用通用稳定的提取逻辑
    const rawItems = await managedPage.evaluate(() => {
      /**
       * 通用版：提取单个视频卡片的所有数据
       */
      function extractCard(root: Element) {
        const text = root.textContent || '';
        const data: Record<string, any> = {
          video_id: null,
          video_url: null,
          title: null,
          cover_url: null,
          duration: null,
          like_count: null,
          author_name: null,
          author_url: null,
          publish_time: null,
          tags: []
        };

        // 1. 视频 ID / 链接 - 从 href 属性获取
        const hrefEl = root.querySelector('[href*="/video/"]') ||
                       (root.getAttribute?.('href')?.includes('/video/') ? root : null);
        if (hrefEl) {
          const m = (hrefEl.getAttribute('href') || '').match(/\/video\/(\d+)/);
          if (m) {
            data.video_id = m[1];
            data.video_url = `https://www.douyin.com/video/${m[1]}`;
          }
        }

        // 2. 封面图 - 优先找抖音图片域名的 img，否则取第一个 img
        const img = root.querySelector('img[src*="douyinpic"], img[src*="bytedance"]') || root.querySelector('img');
        if (img) {
          data.cover_url = img.getAttribute('src') || img.getAttribute('data-src') || null;
          // img.alt 可能包含完整标题
          if ((img.getAttribute('alt') || '').trim().length > 5) {
            data.title = img.getAttribute('alt')!.trim();
          }
        }

        // 3. 标题兜底 - 用 data-feed-ad-click-refer="title"
        if (!data.title) {
          const titleEl = root.querySelector('[data-feed-ad-click-refer="title"]');
          if (titleEl) data.title = titleEl.textContent?.trim() || null;
        }

        // 4. 时长（加强：先全局匹配，再精确扫节点）
        let durationMatch = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
        if (durationMatch) {
          data.duration = durationMatch[1];
        } else {
          // 精确扫描只包含时间的节点（防止被其他文字干扰）
          const allEls = root.querySelectorAll('div, span');
          for (const el of allEls) {
            const t = el.textContent?.trim() || '';
            if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) {
              data.duration = t;
              break;
            }
          }
        }

        // 5. 点赞数（取最大数字，支持万）
        const nums = [...text.matchAll(/(\d+\.?\d*)\s*([万wW])?/g)]
          .map((m: RegExpMatchArray) => ({
            raw: m[0].replace(/\s/g, ''),
            value: parseFloat(m[1]) * (m[2] ? 10000 : 1)
          }))
          .filter((n: any) => n.value >= 10 && n.raw.length < 10);

        if (nums.length) {
          const best = nums.reduce((a: any, b: any) => a.value > b.value ? a : b);
          data.like_count = best.raw;
        }

        // 6. 作者
        const authorMatch = text.match(/@([^\s·@]{1,20})/);
        if (authorMatch) data.author_name = authorMatch[1];

        const authorLink = root.querySelector('a[href*="/user/"]');
        if (authorLink) {
          const href = authorLink.getAttribute('href') || '';
          data.author_url = href.startsWith('//') ? 'https:' + href : href;
        }

        // 7. 发布时间
        const timeMatch = text.match(/(\d+\s*[分钟小时天周月年]前|刚刚|昨天|前天)/);
        if (timeMatch) data.publish_time = timeMatch[0].replace(/\s+/g, '');

        // 8. 标签
        if (data.title) {
          data.tags = [...data.title.matchAll(/#([^\s#]+)/g)].map((m: RegExpMatchArray) => m[1]);
        }

        return data;
      }

      /**
       * 通用版：查找所有视频卡片并提取
       */
      function extractAllJingxuanVideoCards() {
        const cards = document.querySelectorAll('[class*="jingxuanVideoCard"]');
        return Array.from(cards).map(extractCard);
      }

      return extractAllJingxuanVideoCards();
    });

    // 将提取结果映射到 DouyinVideo 类型
    const videos: DouyinVideo[] = rawItems
      .filter((v: any) => v && v.video_id)
      .map((v: any) => ({
        id: v.video_id || '',
        title: v.title || '',
        description: v.title || '',
        videoUrl: v.video_url || '',
        cover: v.cover_url || '',
        duration: v.duration || '',
        playCount: v.like_count || '',
        hot: v.like_count || '',
        author: v.author_name ? '@' + v.author_name : '',
        authorId: v.author_name || '',
        date: v.publish_time || '',
        tags: Array.isArray(v.tags) ? v.tags.map((t: string) => '#' + t) : [],
      }));

    console.log(`[DouyinJingxuan] ✅ 成功提取 ${videos.length} 个视频`);

    return {
      items: videos,
      total: videos.length,
    };
  } finally {
    await managedPage?.close().catch(() => {});
    try {
      await closeManagedProfileBrowser(managedProfile.id);
      console.log(`[DouyinJingxuan] 已释放本次采集使用的专属受管环境: ${managedProfile.id}`);
    } catch {}
  }
}

// ─── 公开 API ──────────────────────────────────────────

/**
 * 检查抖音精选服务状态
 */
export async function getDouyinJingxuanStatus(): Promise<DouyinStatus> {
  const profile = await ensureDouyinManagedProfile();
  return {
    key: "douyin_jingxuan",
    pluginKey: "douyin_jingxuan",
    label: "抖音精选视频采集",
    connected: !!profile?.id,
    available: !!profile?.id,
    status: profile?.id ? "connected" : "error",
    state: "idle",
    message: profile?.id
      ? `抖音精选专属受管环境已就绪（${profile.name}）`
      : "抖音精选专属受管环境初始化失败",
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ["search", "status"],
  };
}

/**
 * 搜索抖音精选视频
 */
export async function searchDouyinJingxuan(
  query: string = "",
  options: DouyinSearchOptions = {},
): Promise<DouyinSearchResult> {
  const category = options.category || "全部";
  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(
    Math.max(Number(options.limit || options.maxCount) || 20, 1),
    100,
  );

  console.log(`[DouyinJingxuan] 🔍 开始采集抖音精选: category="${category}", limit=${limit}`);

  try {
    // 根据 limit 计算需要滚动的次数（每次滚动大约加载 10-15 个视频）
    const scrollTimes = Math.max(Math.ceil(limit / 12), 2);

    const { items: allItems, total } = await searchInBrowserContext(
      category,
      page,
      scrollTimes,
    );

    const finalVideos = allItems.slice(0, limit);

    return {
      success: true,
      query: query || category,
      category,
      count: finalVideos.length,
      total: total || allItems.length,
      items: finalVideos,
      page,
      nextPage: finalVideos.length >= limit ? page + 1 : null,
    };
  } catch (error: any) {
    console.error("[DouyinJingxuan] 采集失败:", error);
    return {
      success: false,
      query: query || category,
      category,
      count: 0,
      total: 0,
      items: [],
      page,
      nextPage: null,
      error: error?.message || String(error) || "采集失败",
    };
  }
}

// ─── 兼容旧接口 ────────────────────────────────────────

export const getRawpixelStatus = getDouyinJingxuanStatus;

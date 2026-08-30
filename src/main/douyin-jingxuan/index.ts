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
    managedPage = await createProfileBrowserPage(managedProfile.id);
    updateManagedProfileBrowserActivity(managedProfile.id);
    await focusManagedProfileBrowser(managedProfile.id).catch(() => undefined);

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
          const cards = document.querySelectorAll(
            ".OeaWf2h.discover-video-card-item",
          );
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
    const rawItems = await managedPage.evaluate(() => {
      const cards = document.querySelectorAll(
        ".OeaWf2h.discover-video-card-item",
      );
      const parsed: any[] = [];

      for (const card of cards) {
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

          // 时长
          const durationMatch = fullText.match(/(\d{2}:\d{2})/);
          const duration = durationMatch ? durationMatch[1] : "";

          // 播放量
          const playCountMatch = fullText.match(/(\d+\.?\d*万)/);
          const playCount = playCountMatch ? playCountMatch[1] : "";

          // 作者
          const authorMatch = fullText.match(/@([^·\s]+)/);
          const author = authorMatch ? "@" + authorMatch[1] : "";

          // 日期
          const dateMatch = fullText.match(/·\s*([^\s#@]+)$/);
          const date = dateMatch ? dateMatch[1] : "";

          // 标签
          const tags = Array.from(fullText.matchAll(/#([^#\s]+)/g)).map(
            (m) => "#" + m[1],
          );

          // 标题
          let title = fullText
            .replace(/\d{2}:\d{2}/, "")
            .replace(/\d+\.?\d*万/, "")
            .replace(/@[^·\s]+/, "")
            .replace(/·\s*[^\s#@]+$/, "")
            .replace(/#[^#\s]+/g, "")
            .trim();
          title = title.replace(/^[\s·]+|[\s·]+$/g, "");

          // ID
          const idMatch = href.match(/\/video\/(\d+)/);
          const id = idMatch
            ? idMatch[1]
            : Math.random().toString(36).slice(2, 10);

          parsed.push({
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
          });
        } catch {
          // skip
        }
      }

      return parsed;
    });

    const videos: DouyinVideo[] = rawItems.filter(
      (v): v is DouyinVideo => v !== null,
    );

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

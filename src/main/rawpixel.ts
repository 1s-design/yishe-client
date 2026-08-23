import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from "./materialLibrary";
/**
 * Rawpixel 免费与公共领域艺术图库采集能力
 * 官方网站: https://www.rawpixel.com/
 * 特点: 海量高质量免版税摄影、CC0/公共领域经典名画、免抠 PNG 与矢量素材
 * 架构: 纯粹专属受管浏览器环境 (BrowserProfileService) + Cloudflare 智能过盾 + 1300px 高清图解析
 */
import fs from "fs";
import { join } from "path";
import { app } from "electron";

const RAWPIXEL_SITE_URL = "https://www.rawpixel.com/";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type RawpixelManagedProfile = {
  id: string;
  name?: string;
  userDataDir?: string;
};

function formatRawpixelError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "未知错误");
}

/**
 * Rawpixel 专属受管环境：
 * 自动创建与复用 BrowserProfileService 注册的【素材采集】Rawpixel 环境。
 */
async function ensureRawpixelManagedProfile(): Promise<RawpixelManagedProfile | null> {
  try {
    const profileService = await import(
      "./auto-browser/legacy/services/BrowserProfileService.js"
    );
    const profiles = profileService.listBrowserProfiles();
    let profile = (profiles?.items || []).find((item: any) => {
      const platforms = Array.isArray(item?.platforms) ? item.platforms : [];
      return (
        platforms.some(
          (platform: unknown) =>
            String(platform).toLowerCase() === "rawpixel",
        ) ||
        String(item?.name || "").includes("Rawpixel") ||
        String(item?.remark || "").includes("Rawpixel")
      );
    });

    if (!profile) {
      profile = profileService.createBrowserProfile({
        name: "【素材采集】Rawpixel",
        remark: "Rawpixel 艺术与摄影图库采集专属环境（系统自动创建）",
        platforms: ["rawpixel"],
        headless: false,
      });
      console.log("[Rawpixel] 🌟 已创建并注册浏览器自动化专属环境:", {
        id: profile?.id,
        name: profile?.name,
        userDataDir: profile?.userDataDir,
      });
    } else {
      const platforms = Array.from(
        new Set([
          ...(Array.isArray(profile.platforms) ? profile.platforms : []),
          "rawpixel",
        ]),
      );
      profile =
        profileService.markBrowserProfileUsed(profile.id, { platforms }) ||
        profile;
      console.log("[Rawpixel] ♻️ 复用浏览器自动化专属环境:", {
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
        "[Rawpixel] 浏览器自动化工作目录无写权限，无法注册 Rawpixel 环境。请修复工作目录所有权后重试：" +
          'sudo chown -R "$(whoami)":staff ~/yisheworkspace',
      );
    } else {
      console.warn(
        "[Rawpixel] 注册/复用受管浏览器环境失败:",
        message,
      );
    }
    return null;
  }
}

export interface RawpixelPhoto {
  id: string;
  title: string;
  description: string;
  image: string;
  thumbnail: string;
  downloadUrl?: string;
  link: string;
  url: string;
  width?: number;
  height?: number;
  author?: string;
  license?: string;
  isFree?: boolean;
  tags?: string;
}

export interface RawpixelSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  totalPages?: number;
  items: RawpixelPhoto[];
  links: string[];
  page: number;
  nextPage: number | null;
  error?: string;
}

export interface RawpixelSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  sort?: string;
}

function sanitizeName(str: string): string {
  return (str || "")
    .replace(/[\\/:\*\?"<>\|]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
}

/**
 * 规格化 Rawpixel 素材对象并自动升级 1300px 高清图
 */
function normalizeRawpixelPhoto(item: any): RawpixelPhoto | null {
  if (!item || typeof item !== "object") return null;
  const id = String(
    item.entity_id ||
      item.id ||
      item.imageId ||
      item.uid ||
      Math.random().toString(36).slice(2, 10),
  );

  let image =
    item.image_1300 ||
    item.image_png_1300 ||
    item.image_800 ||
    item.image_cover_420 ||
    item.image_cover_uri ||
    item.image_opengraph ||
    item.image ||
    item.imageUrl ||
    item.url ||
    item.src ||
    "";
  let thumbnail =
    item.image_cover_420 ||
    item.image_cover_uri ||
    item.thumbnail ||
    item.thumb ||
    item.preview ||
    image;

  if (typeof image === "string" && image.startsWith("//")) {
    image = `https:${image}`;
  }
  if (typeof thumbnail === "string" && thumbnail.startsWith("//")) {
    thumbnail = `https:${thumbnail}`;
  }

  // 自动将缩略图地址升级为 1300px 超清大图
  if (typeof image === "string" && image.includes("images.rawpixel.com")) {
    image = image.replace(/\/image_(?:cover_)?\d+\//, "/image_1300/");
  }
  if (thumbnail && !image) {
    image = String(thumbnail).replace(/\/image_(?:cover_)?\d+\//, "/image_1300/");
  }

  if (!image) return null;

  const title =
    item.title ||
    item.short_title ||
    item.image_alt ||
    item.name ||
    item.alt ||
    `Rawpixel #${id}`;
  const description =
    item.description || item.image_alt || item.caption || item.tags || "";
  let link =
    item.url ||
    item.url_relative ||
    item.link ||
    item.pageUrl ||
    `https://www.rawpixel.com/image/${id}`;
  if (typeof link === "string" && link.startsWith("/")) {
    link = `https://www.rawpixel.com${link}`;
  }

  return {
    id,
    title: String(title).replace(/[\r\n]+/g, " ").trim(),
    description: String(description).replace(/[\r\n]+/g, " ").trim(),
    image,
    thumbnail: thumbnail || image,
    downloadUrl: image,
    link,
    url: link,
    width: item.width || item.imageWidth,
    height: item.height || item.imageHeight,
    author: item.author || item.artist || item.credit || "Rawpixel Contributor",
    license:
      item.license ||
      (item.free !== false ? "Public Domain / CC0 / Free" : "Rawpixel Premium"),
    isFree: item.free !== false,
    tags: Array.isArray(item.tags)
      ? item.tags.join(", ")
      : typeof item.tags === "string"
        ? item.tags
        : "",
  };
}

/**
 * 检查 Rawpixel 服务状态
 */
export async function getRawpixelStatus() {
  const profile = await ensureRawpixelManagedProfile();
  return {
    key: "rawpixel",
    pluginKey: "rawpixel",
    label: "Rawpixel 艺术图库采集",
    connected: !!profile?.id,
    available: !!profile?.id,
    status: profile?.id ? "connected" : "error",
    state: "idle",
    message: profile?.id
      ? `Rawpixel 专属受管环境已就绪（${profile.name}）`
      : "Rawpixel 专属受管环境初始化失败",
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: [
      "search",
      "download",
      "sync",
      "collect",
      "refreshRuntime",
    ],
  };
}

/**
 * 严格通过专属受管环境窗口打开 Rawpixel，
 * 绝不降级或打开无环境窗口；若失败直接报错。
 */
async function searchInBrowserContext(
  cleanKeyword: string,
  page: number,
  sort = "curated",
): Promise<{
  items: RawpixelPhoto[];
  total: number;
  totalPages: number;
}> {
  const managedProfile = await ensureRawpixelManagedProfile();
  if (!managedProfile?.id) {
    throw new Error("无法初始化 Rawpixel 专属受管环境，请检查本地环境权限");
  }

  const {
    createProfileBrowserPage,
    focusManagedProfileBrowser,
    updateManagedProfileBrowserActivity,
    closeManagedProfileBrowser,
  } = await import(
    "./auto-browser/legacy/services/ManagedProfileBrowserPool.js"
  );

  const targetUrl = `https://www.rawpixel.com/search/${encodeURIComponent(cleanKeyword)}?page=${page}&sort=${encodeURIComponent(sort || "curated")}`;
  console.log(`[Rawpixel] 🚀 打开专属受管环境窗口 [${managedProfile.name || managedProfile.id}]:`, {
    targetUrl,
  });

  let managedPage: any = null;

  try {
    managedPage = await createProfileBrowserPage(managedProfile.id);
    updateManagedProfileBrowserActivity(managedProfile.id);
    await focusManagedProfileBrowser(managedProfile.id).catch(() => undefined);

    // 引擎 1：监听并拦截 Rawpixel 内部 XHR/Fetch API 请求
    let interceptedList: any[] = [];
    let interceptedTotal = 0;
    managedPage.on("response", async (res: any) => {
      try {
        const u = res.url();
        if (
          u.includes("/api/v1/search") ||
          u.includes("/api/v1/feed") ||
          u.includes("/api/v2/")
        ) {
          const text = await res.text();
          const json = JSON.parse(text);
          const list =
            json?.results || json?.data || json?.items || (Array.isArray(json) ? json : []);
          if (Array.isArray(list) && list.length > 0) {
            console.log(
              `[Rawpixel] 🎯 成功拦截到内部检索 API 响应: ${u}, 素材条数: ${list.length}`,
            );
            interceptedList = list;
            interceptedTotal = Number(json?.total || json?.count || list.length);
          }
        }
      } catch {}
    });

    console.log(`[Rawpixel] [Step 1] 专属窗口导航至目标搜索页: ${targetUrl}`);
    await managedPage.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    console.log(
      `[Rawpixel] [Step 2] 等待 Cloudflare 验证通过与页面数据加载...`,
    );

    // 轮询等待 Cloudflare 浏览器验证通过并获取数据（最多 30 秒）
    for (let i = 0; i < 30; i++) {
      await managedPage.waitForTimeout(1000);
      try {
        const title = await managedPage.title();
        const isCloudflare =
          title.includes("Just a moment") ||
          title.includes("请稍候") ||
          title.includes("Cloudflare") ||
          title.includes("Security Checkpoint") ||
          title.includes("Attention Required");

        if (isCloudflare) {
          console.log(
            `[Rawpixel] [Step 2] 等待 Cloudflare 安全验证 (第 ${i + 1}/30 秒, 状态: "${title}")...`,
          );
          continue;
        }

        // 如果已经通过拦截捕获到 API 数据，等待 1 秒稳定后直接提取
        if (interceptedList.length > 0) {
          console.log(
            `[Rawpixel] [Step 3] 使用拦截到的 API 数据，共 ${interceptedList.length} 条`,
          );
          break;
        }

        // 尝试从页面 DOM 中提取卡片
        const domHasCards = await managedPage.evaluate(() => {
          const cards = document.querySelectorAll(
            'a[href*="/image/"], [data-testid*="image-card"], article img',
          );
          return cards.length >= 3;
        });

        if (domHasCards) {
          console.log(`[Rawpixel] [Step 3] 页面 DOM 素材卡片渲染完成`);
          break;
        }
      } catch (loopErr: any) {
        // 忽略页面跳转过程中的临时上下文重置
      }
    }

    // 提取结果优先级：拦截 API > SSR __NEXT_DATA__ > DOM 渲染卡片
    let rawItems: any[] = interceptedList;

    if (!rawItems.length) {
      // 引擎 2：从 SSR window.__NEXT_DATA__ 提取
      try {
        const nextData = await managedPage.evaluate(() => {
          const p = (window as any).__NEXT_DATA__?.props?.pageProps;
          if (p) {
            const queries =
              p?.initialState?.dehydratedState?.queries || [];
            for (const q of queries) {
              const qdata = q?.state?.data;
              const list =
                qdata?.results || qdata?.data || qdata?.items;
              if (Array.isArray(list) && list.length > 0) {
                return {
                  list,
                  total: qdata?.total || list.length,
                };
              }
            }
            if (Array.isArray(p.results || p.items || p.feed)) {
              return {
                list: p.results || p.items || p.feed,
                total: p.total || 0,
              };
            }
          }
          return null;
        });
        if (nextData && Array.isArray(nextData.list) && nextData.list.length > 0) {
          console.log(
            `[Rawpixel] [Step 3] 从 __NEXT_DATA__ 成功提取 ${nextData.list.length} 条素材`,
          );
          rawItems = nextData.list;
          interceptedTotal = nextData.total || rawItems.length;
        }
      } catch {}
    }

    if (!rawItems.length) {
      // 引擎 3：DOM 深度解析
      try {
        const domResult = await managedPage.evaluate(() => {
          const cards = Array.from(
            document.querySelectorAll('a[href*="/image/"]'),
          );
          const parsed: any[] = [];
          const seen = new Set<string>();

          for (const card of cards) {
            const href = card.getAttribute("href") || "";
            const idMatch = href.match(/\/image\/(\d+)/);
            const id = idMatch ? idMatch[1] : href;
            if (!id || seen.has(id)) continue;
            seen.add(id);

            const img = card.querySelector("img");
            const src =
              img?.getAttribute("src") ||
              img?.getAttribute("data-src") ||
              img?.src ||
              "";
            if (!src || (!src.includes("rawpixel") && !src.includes("image_"))) {
              continue;
            }

            const title =
              card.getAttribute("title") ||
              img?.getAttribute("alt") ||
              `Rawpixel ${id}`;
            parsed.push({
              id,
              title,
              image_cover_420: src,
              image_1300: src.replace(/\/image_(?:cover_)?\d+\//, "/image_1300/"),
              url: href.startsWith("http")
                ? href
                : `https://www.rawpixel.com${href}`,
            });
          }
          return parsed;
        });

        if (Array.isArray(domResult) && domResult.length > 0) {
          console.log(
            `[Rawpixel] [Step 3] 从 DOM 成功提取 ${domResult.length} 条素材`,
          );
          rawItems = domResult;
          interceptedTotal = domResult.length;
        }
      } catch {}
    }

    const normalizedPhotos: RawpixelPhoto[] = rawItems
      .map((item) => normalizeRawpixelPhoto(item))
      .filter((p): p is RawpixelPhoto => p !== null);

    if (normalizedPhotos.length > 0) {
      const total = interceptedTotal || normalizedPhotos.length;
      return {
        items: normalizedPhotos,
        total,
        totalPages: Math.max(Math.ceil(total / 24), 1),
      };
    }

    throw new Error(
      `未能从 Rawpixel 页面中提取到有效素材，请检查关键词 "${cleanKeyword}"`,
    );
  } finally {
    await managedPage?.close().catch(() => {});
    try {
      await closeManagedProfileBrowser(managedProfile.id);
      console.log(`[Rawpixel] 已释放本次采集使用的专属受管环境: ${managedProfile.id}`);
    } catch {}
  }
}

/**
 * 搜索 Rawpixel 图库
 */
export async function searchRawpixel(
  query: string,
  options: RawpixelSearchOptions = {},
): Promise<RawpixelSearchResult> {
  const keyword = (query || "").trim();
  console.log(`[Rawpixel] 🔍 开始检索关键词: "${keyword}", options:`, options);

  if (!keyword) {
    return {
      success: false,
      query: "",
      count: 0,
      items: [],
      links: [],
      page: 1,
      nextPage: null,
      error: "请输入搜索关键词",
    };
  }

  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(
    Math.max(Number(options.limit || options.pageSize) || 20, 1),
    100,
  );
  const sort = options.sort || "curated";

  try {
    const { items: allItems, total, totalPages } = await searchInBrowserContext(
      keyword,
      page,
      sort,
    );

    const finalPhotos = allItems.slice(0, limit);
    return {
      success: true,
      query: keyword,
      count: finalPhotos.length,
      total: total || allItems.length,
      totalPages: totalPages || Math.ceil((total || allItems.length) / limit) || 1,
      items: finalPhotos,
      links: finalPhotos.map((p) => p.image).filter(Boolean),
      page,
      nextPage: finalPhotos.length >= limit ? page + 1 : null,
    };
  } catch (error: any) {
    console.error("[Rawpixel] 搜索失败:", error);
    return {
      success: false,
      query: keyword,
      count: 0,
      items: [],
      links: [],
      page,
      nextPage: null,
      error: formatRawpixelError(error),
    };
  }
}

function getRawpixelWorkspaceDir(): string {
  try {
    const globalState = (global as any).__YISHE_WORKSPACE_DIR__;
    if (
      globalState &&
      typeof globalState === "string" &&
      fs.existsSync(globalState)
    ) {
      return globalState;
    }
  } catch {}

  const homeDir =
    typeof app !== "undefined" && app?.getPath
      ? app.getPath("home")
      : process.env.HOME || "/tmp";
  const defaultDir = join(homeDir, "yisheworkspace");
  try {
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    return defaultDir;
  } catch {
    const tmpDir = join("/tmp", "yisheworkspace");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    return tmpDir;
  }
}

async function fetchRawpixelBinary(imageUrl: string): Promise<Buffer> {
  const axios = (await import("axios")).default;
  const response = await axios.get<ArrayBuffer>(imageUrl, {
    timeout: 30_000,
    headers: {
      "User-Agent": USER_AGENT,
      Referer: RAWPIXEL_SITE_URL,
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    responseType: "arraybuffer",
  });
  return Buffer.from(response.data);
}

/**
 * 下载单张图片
 */
export async function downloadRawpixelImage(
  imageUrl: string,
  options: { filename?: string } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
    return { success: false, error: "无效的图片 URL" };
  }

  console.log(`[Rawpixel] 📥 开始下载高清素材: ${imageUrl}`);
  try {
    const buffer = await fetchRawpixelBinary(imageUrl);

    const outputDir = join(getRawpixelWorkspaceDir(), "rawpixel");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeName = options.filename
      ? sanitizeName(options.filename)
      : `rawpixel-${Date.now()}`;
    const fileName =
      safeName.endsWith(".jpg") ||
      safeName.endsWith(".png") ||
      safeName.endsWith(".webp")
        ? safeName
        : `${safeName}.jpg`;
    const filePath = join(outputDir, fileName);

    fs.writeFileSync(filePath, buffer);
    console.log(`[Rawpixel] 💾 图片已保存至本地: ${filePath}`);
    return { success: true, filePath, filename: fileName };
  } catch (err: any) {
    console.error(`[Rawpixel] 下载失败:`, err);
    return { success: false, error: formatRawpixelError(err) };
  }
}

/**
 * 同步单张图片到 COS 与全局素材库
 */
export async function syncRawpixelToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>,
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) {
    return { success: false, message: "缺少图片 URL" };
  }

  try {
    const downloadRes = await downloadRawpixelImage(imageUrl, {
      filename: metadata?.title || metadata?.name || `rawpixel-${Date.now()}`,
    });
    if (!downloadRes.success || !downloadRes.filePath) {
      return {
        success: false,
        message: downloadRes.error || "下载 Rawpixel 图片失败",
      };
    }

    const localFilePath = downloadRes.filePath;
    const fileName = downloadRes.filename || `rawpixel-${Date.now()}.jpg`;
    const title = metadata?.title || `Rawpixel #${metadata?.id || Date.now()}`;

    const materialResult = await uploadToMaterialLibraryShared(
      localFilePath,
      fileName,
      {
        category: "rawpixel",
        group: "rawpixel",
        source: "Rawpixel",
        originUrl: imageUrl,
        suffix: "jpg",
        name: title,
        nameEn: title,
        keywords: metadata?.keywords || metadata?.tags || "",
        meta: {
          ...metadata,
          source: "rawpixel",
          uploadedAt: new Date().toISOString(),
        },
      },
    );

    if (!materialResult.ok) {
      return {
        success: false,
        message: materialResult.msg || "素材库保存失败",
      };
    }

    return {
      success: true,
      message: "已成功同步至素材库",
      data: {
        materialId: materialResult.materialId,
        cosUrl: materialResult.materialUrl,
        localFilePath,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || String(err),
    };
  }
}

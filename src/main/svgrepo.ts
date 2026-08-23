import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from "./materialLibrary";
/**
 * SVGRepo 50万+ 开源矢量图标与插画采集能力
 * 官方网站: https://www.svgrepo.com/
 * 特点: 海量开源 SVG 矢量图、单色/多色/填充/线性图标，CC0/MIT 开源商用免版税
 */
import fs from "fs";
import { join } from "path";
import { app } from "electron";
import { connect } from "node:net";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type SvgrepoProxyRoute = {
  /** Playwright / axios 均使用的代理地址；为空代表强制直连。 */
  server?: string;
  label: string;
};

type SvgrepoManagedProfile = {
  id: string;
  name?: string;
  userDataDir?: string;
};

const SVGREPO_LOCAL_PROXY_PORTS = [7890, 7891, 1080];
const SVGREPO_STYLE_VALUES = [
  "monocolor",
  "multicolor",
  "duotone",
  "outlined",
  "filled",
  "icon",
  "glyph",
  "rounded",
  "sharp",
] as const;
const SVGREPO_STYLE_ALIASES: Record<string, (typeof SVGREPO_STYLE_VALUES)[number] | undefined> = {
  all: undefined,
  "all styles": undefined,
  allstyles: undefined,
  monotone: "monocolor", // 兼容旧工作流配置中的历史值
  monochrome: "monocolor",
  monocolor: "monocolor",
  multicolor: "multicolor",
  duotone: "duotone",
  outlined: "outlined",
  filled: "filled",
  icon: "icon",
  glyph: "glyph",
  rounded: "rounded",
  sharp: "sharp",
};
const SVGREPO_NETWORK_ERROR_PATTERN =
  /ERR_(?:CONNECTION_(?:CLOSED|RESET|REFUSED|TIMED_OUT)|PROXY_CONNECTION_FAILED|NAME_NOT_RESOLVED|TUNNEL_CONNECTION_FAILED|SOCKS_CONNECTION_FAILED)|(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up)|(?:Timeout|timed out).*?(?:exceeded|navigation)/i;

function isNetworkError(error: unknown): boolean {
  return SVGREPO_NETWORK_ERROR_PATTERN.test(
    error instanceof Error ? error.message : String(error || ""),
  );
}

function formatSvgrepoError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error || "未知错误");
  if (!isNetworkError(error)) return message;
  return `网络连接失败：${message}。已自动尝试已配置代理、直连及可用本地代理；请检查网络或设置 YISHE_SVGREPO_PROXY。`;
}

function normalizeProxyUrl(value: unknown): string | undefined {
  const candidate = String(value || "").trim();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return ["http:", "https:", "socks4:", "socks5:"].includes(url.protocol)
      ? candidate
      : undefined;
  } catch {
    console.warn(`[SVGRepo] 忽略格式不正确的代理地址: ${candidate}`);
    return undefined;
  }
}

/** 将 UI 标签、历史 monotone 值及官网路由值统一为 SVGRepo 实际风格路径。 */
function normalizeSvgrepoStyle(style?: string): (typeof SVGREPO_STYLE_VALUES)[number] | undefined {
  const normalized = String(style || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  if (!normalized) return undefined;
  return SVGREPO_STYLE_ALIASES[normalized] ?? SVGREPO_STYLE_ALIASES[normalized.replace(/\s/g, "")];
}

async function isLocalTcpPortOpen(
  port: number,
  timeoutMs = 250,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/**
 * 代理是可选增强而不是硬依赖：
 * 1. 显式配置的代理优先；2. 强制直连作为可靠降级；3. 仅在本地端口确实监听时才尝试常见代理端口。
 * 这避免了未启动 Clash 时把所有 SVGRepo 任务送到 127.0.0.1:7890 并立即失败。
 */
async function resolveSvgrepoProxyRoutes(): Promise<SvgrepoProxyRoute[]> {
  const configuredProxy = normalizeProxyUrl(
    process.env.YISHE_SVGREPO_PROXY ||
      process.env.ALL_PROXY ||
      process.env.all_proxy ||
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy,
  );
  const routes: SvgrepoProxyRoute[] = [];
  if (configuredProxy)
    routes.push({ server: configuredProxy, label: "已配置代理" });
  routes.push({ label: "直连" });

  const configuredPorts = String(process.env.YISHE_SVGREPO_PROXY_PORTS || "")
    .split(",")
    .map((port) => Number(port.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
  const ports = [
    ...new Set(
      configuredPorts.length ? configuredPorts : SVGREPO_LOCAL_PROXY_PORTS,
    ),
  ];
  const availablePorts = await Promise.all(
    ports.map(async (port) => ((await isLocalTcpPortOpen(port)) ? port : null)),
  );
  for (const port of availablePorts) {
    if (!port) continue;
    const server = `socks5://127.0.0.1:${port}`;
    if (!routes.some((route) => route.server === server)) {
      routes.push({ server, label: `本地 SOCKS5 :${port}` });
    }
  }
  return routes;
}

/**
 * SVGRepo 必须通过浏览器自动化的“受管环境”运行：控制台的环境列表读取的正是
 * BrowserProfileService 的 registry。此前只定义了创建函数、却从未调用，因此控制台
 * 不会出现 SVGRepo 环境，实际采集也没有复用该环境。
 */
async function ensureSvgrepoManagedProfile(): Promise<SvgrepoManagedProfile | null> {
  try {
    const profileService = await import(
      "./auto-browser/legacy/services/BrowserProfileService.js"
    );
    const profiles = profileService.listBrowserProfiles();
    let profile = (profiles?.items || []).find((item: any) => {
      const platforms = Array.isArray(item?.platforms) ? item.platforms : [];
      return (
        platforms.some((platform: unknown) => String(platform).toLowerCase() === "svgrepo") ||
        String(item?.name || "").includes("SVGRepo") ||
        String(item?.remark || "").includes("SVGRepo")
      );
    });

    if (!profile) {
      profile = profileService.createBrowserProfile({
        name: "【素材采集】SVGRepo",
        remark: "SVGRepo 矢量图库采集专属环境（系统自动创建）",
        platforms: ["svgrepo"],
        headless: false,
      });
      console.log("[SVGRepo] 🌟 已创建并注册浏览器自动化专属环境:", {
        id: profile?.id,
        name: profile?.name,
        userDataDir: profile?.userDataDir,
      });
    } else {
      const platforms = Array.from(
        new Set([...(Array.isArray(profile.platforms) ? profile.platforms : []), "svgrepo"]),
      );
      profile = profileService.markBrowserProfileUsed(profile.id, { platforms }) || profile;
      console.log("[SVGRepo] ♻️ 复用浏览器自动化专属环境:", {
        id: profile?.id,
        name: profile?.name,
        userDataDir: profile?.userDataDir,
      });
    }

    return profile?.id ? profile : null;
  } catch (error: any) {
    // 控制台环境不可用时不应阻塞采集；后续仍会走独立浏览器 + 网络降级链路。
    const message = error?.message || String(error);
    if (/\b(?:EACCES|EPERM)\b/i.test(message)) {
      console.error(
        "[SVGRepo] 浏览器自动化工作目录无写权限，无法注册 SVGRepo 环境。请修复工作目录所有权后重试：" +
          "sudo chown -R \"$(whoami)\":staff ~/yisheworkspace",
      );
    } else {
      console.warn("[SVGRepo] 注册/复用受管浏览器环境失败，将使用隔离浏览器:", message);
    }
    return null;
  }
}

export interface SvgrepoItem {
  id: string; // id
  name: string;
  title: string;
  description: string;
  image: string; // SVG 预览直链 (show CDN)
  svgUrl: string; // SVG 原图直链
  thumbnail: string; // 缩略图
  downloadUrl: string; // 下载直链
  link: string; // 详情页链接
  url: string;
  style?: string; // monotone, multicolor, outlined, filled, etc.
  author?: string;
  license?: string;
  isFree?: boolean;
  tags?: string[];
  width?: number | null;
  height?: number | null;
}

export interface SvgrepoSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: SvgrepoItem[];
  links: string[];
  page: number;
  totalPages?: number;
  nextPage: number | null;
  error?: string;
}

export interface SvgrepoSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  style?:
    | "all"
    | "monocolor"
    | "multicolor"
    | "duotone"
    | "outlined"
    | "filled"
    | "icon"
    | "glyph"
    | "rounded"
    | "sharp"
    | string;
}

function sanitizeName(str: string): string {
  return (str || "")
    .replace(/[\\/:\*\?"<>\|]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
}

/**
 * 检查 SVGRepo 服务状态
 */
export async function getSvgrepoStatus() {
  const routes = await resolveSvgrepoProxyRoutes();
  const routeLabels = routes.map((route) => route.label).join(" → ");
  return {
    key: "svgrepo",
    pluginKey: "svgrepo",
    label: "SVGRepo 50万+开源矢量",
    connected: true,
    available: true,
    status: "connected",
    state: "idle",
    message: `SVGRepo 浏览器采集就绪（网络路由：${routeLabels}）`,
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
 * 解析 SVGRepo 搜索 HTML 页面
 */
function parseSvgrepoHtml(html: string): {
  items: SvgrepoItem[];
  total?: number;
  totalPages?: number;
} {
  const items: SvgrepoItem[] = [];
  const usedIds = new Set<string>();
  let total = 0;
  let totalPages = 1;

  try {
    // 方式 1: __NEXT_DATA__ 解析
    const nextDataMatch = html.match(
      /<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    );
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const pageProps = nextData?.props?.pageProps || {};
        const rawItems =
          pageProps?.vectors || pageProps?.items || pageProps?.data || [];
        if (Array.isArray(rawItems) && rawItems.length > 0) {
          for (const raw of rawItems) {
            const id = String(raw.id || raw.vectorId || raw.slug || "");
            if (!id || usedIds.has(id)) continue;
            usedIds.add(id);

            const slug = raw.slug || raw.name || `vector-${id}`;
            const title = raw.title || raw.name || slug.replace(/-/g, " ");
            const svgUrl =
              raw.svgUrl || `https://www.svgrepo.com/show/${id}/${slug}.svg`;
            const detailUrl = `https://www.svgrepo.com/svg/${id}/${slug}`;

            items.push({
              id,
              name: sanitizeName(slug) || `svgrepo_${id}`,
              title,
              description: `SVGRepo Vector Icon — ${title}`,
              image: svgUrl,
              svgUrl,
              thumbnail: svgUrl,
              downloadUrl: `https://www.svgrepo.com/download/${id}/${slug}.svg`,
              link: detailUrl,
              url: detailUrl,
              style: raw.style || "monotone",
              author: raw.author || raw.collection || "SVGRepo Contributor",
              license: raw.license || "CC0 / MIT Open Source",
              isFree: true,
              tags: Array.isArray(raw.tags) ? raw.tags : [title],
            });
          }
        }
      } catch (err) {
        console.warn("[SVGRepo Parser] __NEXT_DATA__ parse error:", err);
      }
    }

    // 方式 2: DOM/HTML 正则解析 (匹配 <a href="/svg/{id}/{slug}">...<img src="...show/{id}/{slug}.svg" ...>)
    if (items.length === 0) {
      const linkRegex =
        /<a[^>]+href="\/svg\/(\d+)\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        const id = match[1];
        const slug = match[2];
        const innerContent = match[3];

        if (!id || usedIds.has(id)) continue;
        usedIds.add(id);

        const imgMatch =
          innerContent.match(/src="([^"]+)"/i) ||
          innerContent.match(/data-src="([^"]+)"/i);
        const altMatch = innerContent.match(/alt="([^"]*)"/i);
        const titleMatch = innerContent.match(/title="([^"]*)"/i);

        const title =
          altMatch?.[1] ||
          titleMatch?.[1] ||
          slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const svgUrl = imgMatch?.[1]?.startsWith("http")
          ? imgMatch[1]
          : `https://www.svgrepo.com/show/${id}/${slug}.svg`;
        const detailUrl = `https://www.svgrepo.com/svg/${id}/${slug}`;

        items.push({
          id,
          name: sanitizeName(slug) || `svgrepo_${id}`,
          title: title.replace(/SVG Vector/i, "").trim(),
          description: `SVGRepo Open Source Vector — ${title}`,
          image: svgUrl,
          svgUrl,
          thumbnail: svgUrl,
          downloadUrl: `https://www.svgrepo.com/download/${id}/${slug}.svg`,
          link: detailUrl,
          url: detailUrl,
          author: "SVGRepo Community",
          license: "CC0 / Open Source (Free for commercial use)",
          isFree: true,
          tags: [title],
        });
      }
    }

    // 方式 3: 提取 show/xxx CDN 格式的图片
    if (items.length === 0) {
      const imgRegex =
        /https:\/\/www\.svgrepo\.com\/show\/(\d+)\/([^"'\s]+?)\.svg/gi;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(html)) !== null) {
        const id = imgMatch[1];
        const slug = imgMatch[2];
        if (!id || usedIds.has(id)) continue;
        usedIds.add(id);

        const title = slug
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        const svgUrl = `https://www.svgrepo.com/show/${id}/${slug}.svg`;
        const detailUrl = `https://www.svgrepo.com/svg/${id}/${slug}`;

        items.push({
          id,
          name: sanitizeName(slug) || `svgrepo_${id}`,
          title,
          description: `SVGRepo Vector Icon — ${title}`,
          image: svgUrl,
          svgUrl,
          thumbnail: svgUrl,
          downloadUrl: `https://www.svgrepo.com/download/${id}/${slug}.svg`,
          link: detailUrl,
          url: detailUrl,
          author: "SVGRepo",
          license: "Free Open Source License",
          isFree: true,
          tags: [title],
        });
      }
    }

    // 提取总数与分页
    const totalMatch = html.match(/([\d,]+)\s*(?:Vectors|Icons|results)/i);
    if (totalMatch) {
      total = parseInt(totalMatch[1].replace(/,/g, ""), 10) || items.length;
    } else {
      total = items.length;
    }
    totalPages = Math.max(Math.ceil(total / 24), 1);
  } catch (err) {
    console.error("[SVGRepo Parser Error]", err);
  }

  return {
    items,
    total: total || items.length,
    totalPages,
  };
}

/**
 * 构造 SVGRepo 搜索路由 URL
 * 路由规则: /vectors/${keyword}/${style}/${page}/
 */
function buildSvgrepoTargetUrl(
  keyword: string,
  style?: string,
  page: number = 1,
): string {
  const cleanKeyword = encodeURIComponent(
    keyword
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .trim() || "icon",
  );

  const cleanStyle = normalizeSvgrepoStyle(style);

  if (cleanStyle) {
    return page > 1
      ? `https://www.svgrepo.com/vectors/${cleanKeyword}/${cleanStyle}/${page}/`
      : `https://www.svgrepo.com/vectors/${cleanKeyword}/${cleanStyle}/`;
  }

  return page > 1
    ? `https://www.svgrepo.com/vectors/${cleanKeyword}/${page}/`
    : `https://www.svgrepo.com/vectors/${cleanKeyword}/`;
}

/**
 * 使用 Playwright 启动真实 Chrome 浏览器环境抓取 SVGRepo 矢量素材，
 * 支持独立 Profile 缓存与 Cloudflare 智能穿透，直接提取页面 itemprop="contentUrl" DOM 元素
 */
async function searchInBrowserContext(
  cleanKeyword: string,
  page: number,
  style?: string,
): Promise<{
  vectors: any[];
  total: number;
  totalPages: number;
}> {
  const managedProfile = await ensureSvgrepoManagedProfile();
  const routes = await resolveSvgrepoProxyRoutes();
  let lastError: unknown;

  // 首选真正受浏览器自动化控制台管理的环境；可见、可复用 Cookie，且不会绕过环境列表。
  if (managedProfile?.id) {
    try {
      return await searchInBrowserContextAttempt(
        cleanKeyword,
        page,
        style,
        { label: `受管环境 ${managedProfile.name || managedProfile.id}` },
        managedProfile.id,
      );
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error)) throw error;
      console.warn(
        `[SVGRepo] 受管环境访问失败，将继续尝试独立浏览器网络降级链路: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    try {
      return await searchInBrowserContextAttempt(
        cleanKeyword,
        page,
        style,
        route,
      );
    } catch (error) {
      lastError = error;
      const shouldRetry = isNetworkError(error) && index < routes.length - 1;
      if (!shouldRetry) throw error;
      console.warn(
        `[SVGRepo] ${route.label} 访问失败，将自动切换至 ${routes[index + 1].label}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || "SVGRepo 搜索失败"));
}

async function searchInBrowserContextAttempt(
  cleanKeyword: string,
  page: number,
  style: string | undefined,
  route: SvgrepoProxyRoute,
  managedProfileId?: string,
): Promise<{
  vectors: any[];
  total: number;
  totalPages: number;
}> {
  const { chromium } = managedProfileId ? { chromium: null } : await import("playwright-core");
  const runtime = managedProfileId
    ? null
    : await import("./auto-browser/legacy/utils/playwrightRuntime.js");
  const chromeInfo = runtime?.getDefaultChromeExecutableInfo();
  const executablePath = chromeInfo?.executablePath || undefined;

  const cookieFile = join(getSvgrepoWorkspaceDir(), "svgrepo-cookies.json");

  const proxyConfig = route.server
    ? {
        server: route.server,
        bypass: "localhost,127.0.0.1,1520,1519,1521,1522,api.1s.design",
      }
    : undefined;

  const targetUrl = buildSvgrepoTargetUrl(cleanKeyword, style, page);
  console.log(`[SVGRepo] 🚀 [Playwright] 启动本地 Chrome 浏览器环境:`, {
    executablePath: executablePath || "内置 Chromium",
    targetUrl,
    route: route.label,
    proxy: route.server || "DIRECT",
  });

  const browser = managedProfileId
    ? null
    : await chromium!.launch({
        headless: false,
        executablePath,
        proxy: proxyConfig,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
        ],
      });
  let managedPage: any = null;

  try {
    let context: any = null;
    let pageInstance: any;
    if (managedProfileId) {
      const {
        createProfileBrowserPage,
        focusManagedProfileBrowser,
        updateManagedProfileBrowserActivity,
      } = await import(
        "./auto-browser/legacy/services/ManagedProfileBrowserPool.js"
      );
      pageInstance = await createProfileBrowserPage(managedProfileId);
      managedPage = pageInstance;
      updateManagedProfileBrowserActivity(managedProfileId);
      // 受管环境必须给操作者明确的可见反馈，避免任务已进入客户端却看起来“毫无反应”。
      await focusManagedProfileBrowser(managedProfileId).catch(() => undefined);
    } else {
      const contextOptions: any = {
        viewport: { width: 1280, height: 800 },
        userAgent: USER_AGENT,
      };
      if (fs.existsSync(cookieFile)) {
        try {
          contextOptions.storageState = cookieFile;
        } catch {}
      }
      context = await browser!.newContext(contextOptions);
      pageInstance = await context.newPage();
    }

    console.log(`[SVGRepo] [Step 1] 导航至目标搜索页: ${targetUrl}`);
    await pageInstance.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      // 首次启动受管 Chrome/代理建立连接可能较慢；超时后由外层自动切换下一条网络路由。
      timeout: 30_000,
    });

    console.log(
      `[SVGRepo] [Step 2] 等待页面 DOM 渲染 (itemprop="contentUrl")...`,
    );

    let extractedData: {
      ok: boolean;
      vectors: any[];
      total: number;
      totalPages: number;
    } | null = null;

    // 轮询等待 Vercel / Cloudflare 浏览器验证通过并提取 DOM 数据（最多 25 秒）
    for (let i = 0; i < 25; i++) {
      await pageInstance.waitForTimeout(1000);
      try {
        const title = await pageInstance.title();
        if (
          title.includes("Security Checkpoint") ||
          title.includes("Just a moment") ||
          title.includes("Cloudflare")
        ) {
          console.log(
            `[SVGRepo] [Step 2] 等待安全检查点通过 (第 ${i + 1}/25 秒, 状态: "${title}")...`,
          );
          continue;
        }

        const result = await pageInstance.evaluate(() => {
          const vectors: any[] = [];
          const seenUrls = new Set<string>();

          const contentImgs = Array.from(
            document.querySelectorAll(
              'img[itemprop="contentUrl"], [itemprop="contentUrl"] img, img[src*="/show/"]',
            ),
          ) as HTMLImageElement[];

          for (const img of contentImgs) {
            let src = img.getAttribute("src") || img.src || "";
            if (!src) continue;
            if (src.startsWith("//")) src = "https:" + src;
            else if (src.startsWith("/")) src = "https://www.svgrepo.com" + src;

            if (
              !seenUrls.has(src) &&
              (src.includes("/show/") || src.endsWith(".svg"))
            ) {
              seenUrls.add(src);

              const parentLink = img.closest("a");
              const parentCard =
                img.closest("[itemscope]") || parentLink?.parentElement;
              const pageUrl =
                parentLink?.href ||
                (parentLink?.getAttribute("href")
                  ? "https://www.svgrepo.com" + parentLink.getAttribute("href")
                  : "");

              const nameEl = parentCard?.querySelector('[itemprop="name"]');
              const title = (
                nameEl?.textContent ||
                img.getAttribute("alt") ||
                parentLink?.getAttribute("title") ||
                "svgrepo-vector"
              ).trim();

              const match =
                src.match(/\/show\/(\d+)\/(.*?)\.svg/i) ||
                src.match(/\/show\/(\d+)/i);
              const id = match ? match[1] : "svg_" + seenUrls.size;
              const slug =
                match && match[2]
                  ? match[2]
                  : title.toLowerCase().replace(/[^a-z0-9]+/g, "-") ||
                    "vector-" + id;

              vectors.push({
                id,
                name: slug,
                slug,
                title:
                  title
                    .replace(/\s+/g, " ")
                    .replace(/SVG Vector/i, "")
                    .trim() || slug,
                svgUrl: src,
                downloadUrl:
                  "https://www.svgrepo.com/download/" +
                  id +
                  "/" +
                  slug +
                  ".svg",
                thumbnail: src,
                image: src,
                link: pageUrl,
                url: pageUrl,
              });
            }
          }

          // 兜底提取：SSR window.__NEXT_DATA__
          if (
            vectors.length === 0 &&
            (window as any).__NEXT_DATA__?.props?.pageProps
          ) {
            const p = (window as any).__NEXT_DATA__.props.pageProps;
            const rawVectors = p.vectors || p.items || p.data || [];
            if (Array.isArray(rawVectors) && rawVectors.length > 0) {
              for (const raw of rawVectors) {
                const id = String(raw.id || raw.vectorId || raw.slug || "");
                const slug = raw.slug || raw.name || "vector-" + id;
                const title = raw.title || raw.name || slug.replace(/-/g, " ");
                const svgUrl =
                  raw.svgUrl ||
                  "https://www.svgrepo.com/show/" + id + "/" + slug + ".svg";
                vectors.push({
                  id,
                  name: slug,
                  slug,
                  title,
                  svgUrl,
                  downloadUrl:
                    "https://www.svgrepo.com/download/" +
                    id +
                    "/" +
                    slug +
                    ".svg",
                  thumbnail: svgUrl,
                  image: svgUrl,
                  link: "https://www.svgrepo.com/svg/" + id + "/" + slug,
                  url: "https://www.svgrepo.com/svg/" + id + "/" + slug,
                });
              }
            }
          }

          return {
            ok: vectors.length > 0,
            vectors,
            total: vectors.length,
            totalPages: 1,
          };
        });

        if (
          result &&
          result.ok &&
          Array.isArray(result.vectors) &&
          result.vectors.length > 0
        ) {
          extractedData = result;
          console.log(
            `[SVGRepo] ✅ [Playwright] 成功从真实页面 DOM 提取 ${result.vectors.length} 个矢量素材 (itemprop="contentUrl")`,
          );
          // 异步持久化 Cookie 缓存
          if (context) {
            try {
              await context.storageState({ path: cookieFile });
            } catch {}
          }
          break;
        }
      } catch (loopErr: any) {
        // 忽略页面跳转重载过程中的临时上下文销毁异常
      }
    }

    if (
      extractedData &&
      extractedData.ok &&
      Array.isArray(extractedData.vectors) &&
      extractedData.vectors.length > 0
    ) {
      return extractedData;
    }

    throw new Error("未能在页面中检测到矢量素材元素，请检查关键词或网络连接");
  } finally {
    if (managedProfileId) {
      // 专属 SVGRepo 环境的 Cookie/登录态保存在 userDataDir；采集结束后不需要常驻 Chrome。
      // 关闭页面与受管浏览器实例，避免后台空窗口及 Chromium 进程持续占用内存/CPU。
      await managedPage?.close().catch(() => {});
      try {
        const { closeManagedProfileBrowser } = await import(
          "./auto-browser/legacy/services/ManagedProfileBrowserPool.js"
        );
        await closeManagedProfileBrowser(managedProfileId);
        console.log(`[SVGRepo] 已关闭本次采集使用的浏览器环境: ${managedProfileId}`);
      } catch (closeError: any) {
        console.warn(
          `[SVGRepo] 关闭受管浏览器环境失败（不影响采集结果）: ${closeError?.message || closeError}`,
        );
      }
    } else {
      await browser?.close().catch(() => {});
    }
  }
}

/**
 * 搜索 SVGRepo 开源矢量图标
 */
export async function searchSvgrepo(
  query: string,
  options: SvgrepoSearchOptions = {},
): Promise<SvgrepoSearchResult> {
  const keyword = (query || "").trim();
  console.log(`[SVGRepo] 🔍 开始检索关键词: "${keyword}", options:`, options);

  if (!keyword) {
    return {
      success: false,
      query: "",
      count: 0,
      items: [],
      links: [],
      page: 1,
      nextPage: null,
      error: "缺少搜索关键词",
    };
  }

  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(
    Math.max(Number(options.limit || options.pageSize) || 24, 1),
    100,
  );

  try {
    const cleanKeyword = keyword
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-");

    // 启动 Playwright Chrome 环境抓取
    const {
      vectors: rawVectors,
      total,
      totalPages,
    } = await searchInBrowserContext(cleanKeyword, page, options.style);

    if (!Array.isArray(rawVectors) || rawVectors.length === 0) {
      return {
        success: false,
        query: keyword,
        count: 0,
        items: [],
        links: [],
        page,
        nextPage: null,
        error: `SVGRepo 未搜索到关键词 "${keyword}" 的矢量图标`,
      };
    }

    const items: SvgrepoItem[] = rawVectors.map((raw: any) => {
      const id = String(raw.id || raw.vectorId || raw.slug || "");
      const slug = raw.slug || raw.name || `vector-${id}`;
      const title = raw.title || raw.name || slug.replace(/-/g, " ");
      const svgUrl =
        raw.svgUrl || `https://www.svgrepo.com/show/${id}/${slug}.svg`;
      const detailUrl = raw.link || `https://www.svgrepo.com/svg/${id}/${slug}`;
      return {
        id,
        name: sanitizeName(slug) || `svgrepo_${id}`,
        title: title.replace(/SVG Vector/i, "").trim(),
        description: `SVGRepo Vector — ${title}`,
        image: svgUrl,
        svgUrl,
        thumbnail: svgUrl,
        downloadUrl:
          raw.downloadUrl ||
          `https://www.svgrepo.com/download/${id}/${slug}.svg`,
        link: detailUrl,
        url: detailUrl,
        style: normalizeSvgrepoStyle(options.style) || raw.style || "monocolor",
        author: raw.author || raw.collection || "SVGRepo Contributor",
        license: raw.license || "CC0 / MIT Open Source",
        isFree: true,
        tags: Array.isArray(raw.tags) ? raw.tags : [title],
      };
    });

    const pagedItems = items.slice(0, limit);

    return {
      success: true,
      query: keyword,
      count: pagedItems.length,
      total: total || items.length,
      totalPages: totalPages || Math.ceil((total || items.length) / limit) || 1,
      items: pagedItems,
      links: pagedItems.map((i) => i.svgUrl),
      page,
      nextPage: pagedItems.length >= limit ? page + 1 : null,
    };
  } catch (error: any) {
    console.error("[SVGRepo] 搜索失败:", error);
    return {
      success: false,
      query: keyword,
      count: 0,
      items: [],
      links: [],
      page,
      nextPage: null,
      error: formatSvgrepoError(error),
    };
  }
}

/**
 * 获取工作空间保存路径
 */
function getSvgrepoWorkspaceDir(): string {
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

async function fetchSvgrepoSvg(imageUrl: string): Promise<string> {
  const axios = (await import("axios")).default;
  const routes = await resolveSvgrepoProxyRoutes();
  let lastError: unknown;

  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    try {
      let agent: any;
      if (route.server?.startsWith("socks")) {
        const { SocksProxyAgent } = await import("socks-proxy-agent");
        agent = new SocksProxyAgent(route.server);
      } else if (route.server?.startsWith("http")) {
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        agent = new HttpsProxyAgent(route.server);
      }

      const response = await axios.get<string>(imageUrl, {
        // 显式关闭 axios 对 HTTP(S)_PROXY 的隐式处理，所有路由均由上面的候选列表掌控。
        proxy: false,
        httpsAgent: agent,
        httpAgent: agent,
        timeout: 20_000,
        headers: {
          "User-Agent": USER_AGENT,
          Referer: "https://www.svgrepo.com/",
          Accept: "image/svg+xml,*/*",
        },
        responseType: "text",
      });
      return response.data;
    } catch (error) {
      lastError = error;
      const shouldRetry = isNetworkError(error) && index < routes.length - 1;
      if (!shouldRetry) throw error;
      console.warn(
        `[SVGRepo] ${route.label} 下载失败，将自动切换至 ${routes[index + 1].label}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || "SVG 下载失败"));
}

/**
 * 下载 SVGRepo 矢量插画/图标到本地
 */
export async function downloadSvgrepoImage(
  imageUrl: string,
  options: { filename?: string } = {},
): Promise<{
  success: boolean;
  filePath?: string;
  filename?: string;
  error?: string;
}> {
  if (!imageUrl) {
    return { success: false, error: "缺少图片下载链接" };
  }

  console.log(`[SVGRepo] 📥 开始下载矢量文件: ${imageUrl}`);
  try {
    const text = await fetchSvgrepoSvg(imageUrl);
    if (
      typeof text !== "string" ||
      (!text.includes("<svg") && !text.includes("<?xml"))
    ) {
      console.error("[SVGRepo] 下载内容非标准 SVG");
      return {
        success: false,
        error: "SVGRepo 返回的内容不是有效的 SVG 矢量文件",
      };
    }

    const buffer = Buffer.from(text, "utf-8");
    const workspaceDir = getSvgrepoWorkspaceDir();
    let saveDir = join(workspaceDir, "svgrepo-downloads");
    try {
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
    } catch {
      saveDir = join("/tmp", "svgrepo-downloads");
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
    }

    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith(".svg") ? "" : ".svg"}`
      : `svgrepo_${Date.now()}.svg`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);
    console.log(`[SVGRepo] ✅ 矢量文件已保存至本地: ${filePath}`);

    return {
      success: true,
      filePath,
      filename,
    };
  } catch (error: any) {
    console.error("[SVGRepo] 下载过程发生异常:", error);
    return {
      success: false,
      error: formatSvgrepoError(error),
    };
  }
}

/**
 * 下载并上传至用户个人素材库并落地入库
 */
export async function syncSvgrepoToMaterialLibrary(
  workspaceDir: string,
  options: {
    imageUrl: string;
    metadata?: Record<string, any>;
  },
): Promise<{
  success: boolean;
  message?: string;
  localFilePath?: string;
  cosUrl?: string;
  materialId?: string;
  error?: string;
  data?: any;
}> {
  const { imageUrl, metadata } = options;

  if (!imageUrl) {
    return { success: false, error: "缺少图片 URL" };
  }

  const dlResult = await downloadSvgrepoImage(imageUrl, {
    filename: metadata?.title || metadata?.name,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || "下载素材失败" };
  }

  const localFilePath = dlResult.filePath;

  try {
    const fileName =
      localFilePath.split("/").pop() || `svgrepo_${Date.now()}.svg`;
    const title =
      metadata?.title || metadata?.name || fileName.replace(/\.svg$/i, "");
    const materialResult = await uploadToMaterialLibraryShared(
      localFilePath,
      fileName,
      {
        category: "svgrepo",
        group: "svgrepo",
        source: "SVGRepo",
        originUrl: imageUrl,
        suffix: "svg",
        name: title,
        nameEn: title,
        keywords: metadata?.keywords || "",
        meta: {
          ...metadata,
          source: "svgrepo",
          uploadedAt: new Date().toISOString(),
        },
      },
    );

    if (!materialResult.ok) {
      return { success: false, error: materialResult.msg || "素材库保存失败" };
    }

    return {
      success: true,
      message: "已成功下载 SVGRepo 矢量图并上传入库至素材库",
      localFilePath,
      cosUrl: materialResult.materialUrl,
      materialId: materialResult.materialId,
      data: {
        materialId: materialResult.materialId,
        cosUrl: materialResult.materialUrl,
        localFilePath,
        fileName,
        metadata: {
          ...metadata,
          source: "svgrepo",
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "上传素材至个人素材库失败",
    };
  }
}

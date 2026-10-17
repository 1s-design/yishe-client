/**
 * 客户端通用能力 — 自由网页采集 (Web Collect)
 *
 * 提供「自由采集」通用工具：不依赖预写采集源，agent 提供网址即可：
 *   webcollect_browse  — 打开网址（优先浏览器环境，可绕 CF 保护）并智能分析页面
 *                        返回标题、图片清单（URL+尺寸）、链接、文本摘要
 *   webcollect_download — 下载任意图片 URL 并入库素材库（提取宽高/大小/宽高比）
 *   webcollect_upload   — 上传本地文件并入库素材库
 *
 * 与 collect（预写源）互补：collect 稳定快速适合高频站；本工具灵活自由适合新站探索。
 * 注册后暴露为 MCP: webcollect_browse / webcollect_download / webcollect_upload
 */
import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CapabilityRegistry } from "./registry";
import type { CapabilityDefinition } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 图片条目 */
interface PageImage {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  /** 文件名（从 URL 推断） */
  filename?: string;
}

/** 从 HTML 提取图片清单（含 srcset 择优、相对路径补全） */
function extractImages(html: string, baseUrl: string, limit: number): PageImage[] {
  const results: PageImage[] = [];
  const seen = new Set<string>();

  const absolutize = (u: string): string => {
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("data:")) return "";
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return "";
    }
  };

  // <img> 标签：src / data-src / data-original + alt
  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) && results.length < limit * 2) {
    const tag = m[0];
    const attr = (name: string): string => {
      const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
      const am = tag.match(re);
      return am ? am[1] : "";
    };
    // src / data-src / data-original / data-lazy-src（懒加载）
    let url = attr("src") || attr("data-src") || attr("data-original") || attr("data-lazy-src");
    if (!url) continue;
    // srcset 里挑最大宽度的候选
    const srcset = attr("srcset");
    if (srcset) {
      const cands = srcset.split(",").map((s) => {
        const parts = s.trim().split(/\s+/);
        const u = parts[0];
        const w = parseInt((parts[1] || "").replace(/[^\d]/g, ""), 10) || 0;
        return { u, w };
      });
      cands.sort((a, b) => b.w - a.w);
      if (cands[0]?.u && cands[0].w > 0) url = cands[0].u;
    }
    const abs = absolutize(url);
    if (!abs || seen.has(abs)) continue;
    // 过滤明显的小图标
    if (/(favicon|logo|sprite|icon|avatar|spacer|blank)/i.test(abs)) continue;
    seen.add(abs);

    const alt = attr("alt");
    const w = parseInt(attr("width"), 10) || undefined;
    const h = parseInt(attr("height"), 10) || undefined;
    const filename = abs.split("?")[0].split("/").pop() || "";
    results.push({ url: abs, alt: alt || undefined, width: w, height: h, filename });
    if (results.length >= limit) break;
  }

  // 背景图兜底：url('...')
  if (!results.length) {
    const bgRe = /url\(["']?(https?:\/\/[^"')]+)["']?\)/gi;
    while ((m = bgRe.exec(html)) && results.length < limit) {
      const abs = absolutize(m[1]);
      if (!abs || seen.has(abs)) continue;
      if (!/\.(jpe?g|png|webp|gif)(\?|$)/i.test(abs)) continue;
      seen.add(abs);
      results.push({ url: abs, filename: abs.split("?")[0].split("/").pop() || "" });
    }
  }

  return results;
}

/** 提取链接清单 */
function extractLinks(html: string, baseUrl: string, limit: number): Array<{ text: string; url: string }> {
  const results: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && results.length < limit) {
    let href = m[1];
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
    try {
      href = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
    results.push({ text: text || href, url: href });
  }
  return results;
}

/** 提取文本摘要 */
function extractText(html: string, maxLen: number): string {
  let text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, maxLen);
}

/** 浏览器环境打开页面（可绕 CF）；返回 { html, title, finalUrl, mode } */
async function openPage(
  url: string,
  opts: { profileId?: string; waitMs?: number; timeoutMs?: number; preferBrowser?: boolean },
): Promise<{ html: string; title: string; finalUrl: string; mode: "browser" | "http"; note?: string }> {
  // 优先浏览器环境（真实浏览器，可过 Cloudflare）
  if (opts.preferBrowser !== false) {
    try {
      const autoBrowser = await import("../auto-browser/index.js");
      const mod = autoBrowser as any;
      let page = await mod.getBrowserPage?.(0, { profileId: opts.profileId });
      if (!page) page = await mod.createBrowserPage?.({ profileId: opts.profileId });
      if (page?.goto) {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: opts.timeoutMs || 45000,
        });
        // 等待 CF 挑战/动态渲染
        const waitMs = opts.waitMs ?? 3000;
        if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
        const html = await page.content();
        const title = await page.title().catch(() => "");
        const finalUrl = page.url?.() || url;
        return { html, title, finalUrl, mode: "browser" };
      }
    } catch (e: any) {
      // 浏览器不可用时降级 HTTP
      const note = `浏览器环境不可用，已降级 HTTP: ${e?.message || e}`;
      const res = await httpFetch(url, opts.timeoutMs || 30000);
      return { ...res, mode: "http", note };
    }
  }
  const res = await httpFetch(url, opts.timeoutMs || 30000);
  return { ...res, mode: "http" };
}

/** HTTP 抓取（降级路径） */
async function httpFetch(
  url: string,
  timeoutMs: number,
): Promise<{ html: string; title: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const titleM = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return {
      html,
      title: titleM ? titleM[1].trim() : "",
      finalUrl: res.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 图片 magic bytes 校验 */
function isImageBuffer(buf: Buffer): boolean {
  return (
    (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
    (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
    (buf.length > 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) ||
    (buf.length > 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[8] === 0x57) ||
    (buf.length > 4 && buf[0] === 0x42 && buf[1] === 0x4d)
  );
}

/** 下载图片到临时文件（fetch → curl 双通道，与 collectEngine 一致） */
async function downloadToFile(url: string, referer?: string): Promise<string> {
  let buf: Buffer;
  const headers: Record<string, string> = {
    "User-Agent": UA,
    ...(referer ? { Referer: referer } : {}),
  };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    // TLS 指纹拦截时降级 curl（-f: HTTP 错误即失败）
    buf = await new Promise<Buffer>((resolve, reject) => {
      const { execFile } = require("child_process");
      const args = ["-sSLf", "--max-time", "120"];
      for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
      args.push(url);
      execFile("curl", args, { encoding: "buffer", maxBuffer: 200 * 1024 * 1024 }, (err: any, stdout: Buffer) => {
        if (err) reject(new Error(`下载失败(curl): ${err.message}`));
        else if (!stdout?.length) reject(new Error(`下载失败(curl): 空响应 ${url}`));
        else resolve(stdout);
      });
    });
  }
  if (!isImageBuffer(buf)) {
    throw new Error(`下载内容不是有效图片（可能为错误页面）: ${url}`);
  }
  const extM = url.split("?")[0].split(".").pop()?.toLowerCase() || "";
  const ext = /^(jpe?g|png|gif|webp|bmp)$/.test(extM) ? extM : "jpg";
  const tmpPath = path.join(
    os.tmpdir(),
    `webcollect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
  );
  fs.writeFileSync(tmpPath, buf);
  return tmpPath;
}

// ─────────────────────────────────────────────────────────────
// 1. webcollect.browse — 打开网址并智能分析页面
// ─────────────────────────────────────────────────────────────
const browseDef: CapabilityDefinition = {
  name: "browse",
  namespace: "webcollect",
  description:
    "打开任意网址并智能分析页面结构：返回标题、图片清单（URL+尺寸声明）、相关链接、文本摘要。" +
    "优先使用客户端浏览器环境（真实浏览器，可绕过 Cloudflare 等防护），不可用时降级 HTTP。" +
    "适合探索新网站、发现可采集的图片/内容，配合 webcollect_download 入库。",
  riskLevel: "write",
  argsSchema: z.object({
    url: z.string().describe("要打开的网页 URL"),
    profileId: z.string().optional().describe("浏览器配置文件 ID（用于指定登录环境，可绕 CF）"),
    waitMs: z
      .number()
      .optional()
      .describe("页面加载后等待毫秒数（等待 JS 渲染/CF 挑战，默认 3000）"),
    timeoutMs: z.number().optional().describe("加载超时毫秒数（默认 45000）"),
    maxImages: z.number().optional().describe("返回图片数量上限（默认 30）"),
    maxLinks: z.number().optional().describe("返回链接数量上限（默认 20）"),
    includeHtml: z.boolean().optional().describe("是否返回原始 HTML（默认否）"),
    textLength: z.number().optional().describe("文本摘要长度（默认 1500）"),
  }),
  handler: async (args: {
    url: string;
    profileId?: string;
    waitMs?: number;
    timeoutMs?: number;
    maxImages?: number;
    maxLinks?: number;
    includeHtml?: boolean;
    textLength?: number;
  }) => {
    try {
      const maxImages = Math.min(Math.max(args.maxImages ?? 30, 1), 100);
      const maxLinks = Math.min(Math.max(args.maxLinks ?? 20, 1), 100);

      const opened = await openPage(args.url, {
        profileId: args.profileId,
        waitMs: args.waitMs,
        timeoutMs: args.timeoutMs,
      });

      const images = extractImages(opened.html, opened.finalUrl, maxImages);
      const links = extractLinks(opened.html, opened.finalUrl, maxLinks);
      const text = extractText(opened.html, args.textLength ?? 1500);

      return {
        success: true,
        data: {
          url: opened.finalUrl,
          title: opened.title,
          accessMode: opened.mode,
          note: opened.note,
          imageCount: images.length,
          images,
          linkCount: links.length,
          links,
          textPreview: text,
          html: args.includeHtml ? opened.html.slice(0, 200000) : undefined,
          hint:
            "选定图片后调用 webcollect_download（url 参数）即可入库；" +
            "如需精确结构化提取，可用 browser_scrape_list；" +
            "如遇 CF 挑战，可传 profileId 指定已登录浏览器环境。",
        },
      };
    } catch (e: any) {
      return { success: false, error: `打开页面失败: ${e?.message || e}` };
    }
  },
};

// ─────────────────────────────────────────────────────────────
// 2. webcollect.download — 下载图片 URL 入库
// ─────────────────────────────────────────────────────────────
const downloadDef: CapabilityDefinition = {
  name: "download",
  namespace: "webcollect",
  description:
    "下载任意图片 URL 并入库素材库：自动提取宽高/文件大小/宽高比，上传 COS，写入素材库。" +
    "支持 fetch 与 curl 双通道（可绕 TLS 指纹拦截），下载后校验图片有效性。" +
    "可与 webcollect_browse 配合：browse 发现图片 → download 入库。",
  riskLevel: "write",
  argsSchema: z.object({
    url: z.string().describe("图片 URL（http/https）"),
    title: z.string().optional().describe("素材名称"),
    source: z.string().optional().describe("来源标识（如网站名）"),
    originUrl: z.string().optional().describe("原始页面链接（溯源）"),
    referer: z.string().optional().describe("下载时的 Referer（防盗链需要）"),
    materialTarget: z
      .string()
      .optional()
      .describe("入库目标：crawler_material（默认）或 collect_file"),
    keywords: z.string().optional().describe("关键词（逗号分隔）"),
    meta: z
      .record(z.any())
      .optional()
      .describe("附加元数据（如 harvestBatchId、auditStatus 等，合并进素材 meta）"),
  }),
  handler: async (args: {
    url: string;
    title?: string;
    source?: string;
    originUrl?: string;
    referer?: string;
    materialTarget?: string;
    keywords?: string;
    meta?: Record<string, unknown>;
  }) => {
    let tmpPath = "";
    try {
      const referer =
        args.referer ||
        (() => {
          try {
            return new URL(args.url).origin + "/";
          } catch {
            return "";
          }
        })();

      tmpPath = await downloadToFile(args.url, referer);

      const { uploadToMaterialLibrary } = await import("../materialLibrary");
      const filename = args.url.split("?")[0].split("/").pop() || `webcollect-${Date.now()}.jpg`;
      const matRes: any = await uploadToMaterialLibrary(tmpPath, filename, {
        name: args.title || filename,
        category: "uncategorized",
        source: args.source || "webcollect",
        originUrl: args.originUrl || args.url,
        keywords: args.keywords || "",
        materialTarget: args.materialTarget === "collect_file" ? "collect_file" : "crawler_material",
        meta: {
          sourceImageUrl: args.url,
          importedFrom: "webcollect",
          collectMethod: "webcollect",
          collectMethodLabel: "网页采集",
          ...(args.meta || {}),
        },
      } as any);

      if (matRes?.ok === false) {
        return { success: false, error: matRes?.msg || "入库失败" };
      }

      // 返回素材信息（含 sharp 提取的元数据）
      return {
        success: true,
        data: {
          materialOk: matRes?.ok !== false,
          materialId: matRes?.data?.id,
          url: args.url,
          name: args.title || filename,
          width: matRes?.data?.width,
          height: matRes?.data?.height,
          fileSize: matRes?.data?.fileSize,
          aspectRatio: matRes?.data?.aspectRatio,
          cosUrl: matRes?.data?.url,
          source: args.source || "webcollect",
        },
      };
    } catch (e: any) {
      return { success: false, error: `下载入库失败: ${e?.message || e}` };
    } finally {
      try {
        if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        /* 忽略清理失败 */
      }
    }
  },
};

// ─────────────────────────────────────────────────────────────
// 3. webcollect.upload — 上传本地文件入库
// ─────────────────────────────────────────────────────────────
const uploadDef: CapabilityDefinition = {
  name: "upload",
  namespace: "webcollect",
  description:
    "上传本地图片文件并入库素材库：自动提取宽高/文件大小/宽高比，上传 COS，写入素材库。" +
    "适合导入用户提供的本地图片、下载到本地的文件等。",
  riskLevel: "write",
  argsSchema: z.object({
    filePath: z.string().describe("本地图片文件路径（绝对路径）"),
    title: z.string().optional().describe("素材名称"),
    source: z.string().optional().describe("来源标识"),
    originUrl: z.string().optional().describe("原始页面链接（溯源）"),
    materialTarget: z
      .string()
      .optional()
      .describe("入库目标：crawler_material（默认）或 collect_file"),
    keywords: z.string().optional().describe("关键词（逗号分隔）"),
  }),
  handler: async (args: {
    filePath: string;
    title?: string;
    source?: string;
    originUrl?: string;
    materialTarget?: string;
    keywords?: string;
  }) => {
    try {
      const filePath = args.filePath;
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: `文件不存在: ${filePath}` };
      }
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return { success: false, error: `不是文件: ${filePath}` };
      }
      if (stat.size > 200 * 1024 * 1024) {
        return { success: false, error: "文件超过 200MB 限制" };
      }

      const filename = path.basename(filePath);
      const { uploadToMaterialLibrary } = await import("../materialLibrary");
      const matRes: any = await uploadToMaterialLibrary(filePath, filename, {
        name: args.title || filename,
        category: "uncategorized",
        source: args.source || "webcollect-upload",
        originUrl: args.originUrl || "",
        keywords: args.keywords || "",
        materialTarget: args.materialTarget === "collect_file" ? "collect_file" : "crawler_material",
        meta: { importedFrom: "webcollect-upload", localPath: filePath },
      } as any);

      if (matRes?.ok === false) {
        return { success: false, error: matRes?.msg || "入库失败" };
      }

      return {
        success: true,
        data: {
          materialOk: matRes?.ok !== false,
          materialId: matRes?.data?.id,
          name: args.title || filename,
          width: matRes?.data?.width,
          height: matRes?.data?.height,
          fileSize: matRes?.data?.fileSize,
          aspectRatio: matRes?.data?.aspectRatio,
          cosUrl: matRes?.data?.url,
          source: args.source || "webcollect-upload",
        },
      };
    } catch (e: any) {
      return { success: false, error: `上传入库失败: ${e?.message || e}` };
    }
  },
};

export function registerWebCollectCapabilities(): void {
  CapabilityRegistry.registerAll([browseDef, downloadDef, uploadDef]);
}

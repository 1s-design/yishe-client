/**
 * 通用采集引擎（Collect Engine）
 *
 * 客户端侧一次实现的执行内核：拉取/执行服务端下发的采集源代码。
 * 源代码在 vm 沙箱中运行，只暴露 ctx 原语（http/parse/download/report/secret）。
 * 新增采集源无需更新客户端 —— 服务端定义好代码即可。
 */
import vm from "vm";
import fs from "fs";
import os from "os";
import path from "path";
import { uploadFileToCos } from "./cos";
import { sniffImageFormat } from "./imageFormat";

export const COLLECT_ENGINE_VERSION = 1;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface CollectEngineRunArgs {
  sourceId: string;
  sourceVersion?: string;
  /** 源代码全文（CJS 形态，客户端由接口拉取后传入） */
  code: string;
  /** 方法 key，取自源 meta.methods[].key（引擎按同名导出 hook 调用） */
  action: string;
  params?: Record<string, any>;
  /** 源 meta（用于域名白名单 / 超时 / 限速） */
  meta?: {
    domains?: string[];
    timeoutMs?: number;
    ratelimit?: { qps?: number; concurrent?: number };
    [key: string]: any;
  };
  /** 任务临时密钥（服务端下发，不落盘） */
  secrets?: Record<string, string>;
}

export interface CollectEngineRunResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
  progress?: Array<{ percent: number; message?: string }>;
  engineVersion: number;
}

function assertDomainAllowed(url: string, domains?: string[]) {
  if (!domains || domains.length === 0) return;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`非法 URL: ${url}`);
  }
  const ok = domains.some(
    (d) => host === d || host.endsWith(`.${d}`) || host === `www.${d}`,
  );
  if (!ok) {
    throw new Error(`目标域名不在白名单内: ${host}`);
  }
}

function decodeEntities(text: string): string {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 30000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * curl 兜底请求（系统 TLS 栈）：fetch/undici 被 TLS 指纹或代理拦截时用。
 * 返回 { status, text }；用 -w 追加状态码标记再切分，避免 -f 丢 4xx 响应体。
 */
async function curlRequest(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  body?: string,
): Promise<{ status: number; text: string }> {
  const { execFile } = require("child_process");
  const args = ["-sSL", "--max-time", String(Math.max(5, Math.ceil(timeoutMs / 1000))), "-X", method];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (body) args.push("--data-binary", body);
  args.push("-w", "\n__CURL_STATUS__:%{http_code}", url);
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      args,
      { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 },
      (err: any, stdout: Buffer) => {
        const raw = stdout ? stdout.toString("utf8") : "";
        const marker = raw.lastIndexOf("\n__CURL_STATUS__:");
        if (marker < 0) return reject(err || new Error(`curl 无状态码输出: ${String(err?.message || "")}`));
        const text = raw.slice(0, marker);
        const status = Number(raw.slice(marker + "\n__CURL_STATUS__:".length).trim()) || 0;
        resolve({ status, text });
      },
    );
  });
}

/** 浏览器任务串行锁：同一时刻只跑一个真浏览器渲染，避免资源风暴 */
let browserChain: Promise<any> = Promise.resolve();

/**
 * 浏览器内下载（应对 Cloudflare 等站点 fetch/curl 均 403）。
 * 复用系统已连接的浏览器（auto-browser），页面上下文带 CF cookie，
 * 在页面内 fetch 图片 URL 取字节，再 base64 返回。
 */
async function downloadViaBrowser(url: string): Promise<Buffer> {
  // ── 优先：直接连接系统真实 Chrome CDP（带所有会话与 CF cookie）──
  try {
    const { chromium } = await import("playwright-core");
    for (const port of [9333, 9222]) {
      try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const context = browser.contexts()[0];
        if (context) {
          const origin = new URL(url).origin;
          let page = context.pages().find((p: any) => p.url().startsWith(origin));
          let created = false;
          if (!page) {
            page = await context.newPage();
            created = true;
            await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          }
          const b64 = await page.evaluate(async (target: string) => {
            const r = await fetch(target);
            if (!r.ok) return null;
            const buf = new Uint8Array(await r.arrayBuffer());
            let bin = "";
            const chunk = 0x8000;
            for (let i = 0; i < buf.length; i += chunk) {
              bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as any);
            }
            return btoa(bin);
          }, url);
          if (created) await page.close().catch(() => {});
          await browser.close().catch(() => {});
          if (b64) return Buffer.from(b64, "base64");
        }
      } catch {}
    }
  } catch {}

  // ── 次选：auto-browser 模块（managed profile）──
  try {
    const autoBrowser = await import("./auto-browser/index.js");
    const mod = autoBrowser as any;
    // 自动发现已连接的 managed profile
    let profileId = "";
    try {
      const pool = await import("./auto-browser/legacy/services/ManagedProfileBrowserPool.js");
      const status = await (pool as any).getManagedProfileBrowserStatus?.({});
      const connected = (status?.instances || []).find((x: any) => x?.isConnected || x?.browserStatus?.isConnected);
      if (connected?.profileId) profileId = String(connected.profileId);
    } catch {
      /* legacy 路径 */
    }
    let page = await mod.getBrowserPage?.(0, profileId ? { profileId } : {});
    if (!page) page = await mod.createBrowserPage?.(profileId ? { profileId } : {});
    if (page?.goto) {
      console.log(`[CollectEngine] browser.download(system${profileId ? ` profile=${profileId}` : ""}): ${url}`);
      // 先导航到同源页面建立 CF cookie（若已有会话则快速跳过）
      try {
        const origin = new URL(url).origin;
        await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 });
        // CF 挑战等待
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const t = (await page.title?.().catch(() => "")) || "";
          if (/Security Checkpoint|Just a moment|请稍候|Cloudflare/i.test(t)) continue;
          break;
        }
      } catch {
        /* 同源导航失败仍尝试直接 fetch */
      }
      // 页面内 fetch 取字节（带 cookie），大图分块 base64
      const b64 = await page.evaluate(async (target: string) => {
        const r = await fetch(target);
        if (!r.ok) return null;
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as any);
        }
        return btoa(bin);
      }, url);
      if (b64) return Buffer.from(b64, "base64");
      throw new Error(`系统浏览器 fetch 失败（可能仍被拦截）: ${url}`);
    }
  } catch (e: any) {
    console.warn(`[CollectEngine] 系统浏览器下载不可用，降级 headless: ${e?.message || e}`);
  }

  // ── 降级：独立 headless Chromium（对齐 renderWithBrowser 的降级链）──
  // 部分站点 CF/防盗链对 fetch/curl 直接 403，但真浏览器先访问同源建立会话后可过
  const runHeadless = async (): Promise<Buffer> => {
    let chromium: any;
    let executablePath: string | undefined;
    try {
      ({ chromium } = await import("playwright-core"));
      const runtime = await import("./auto-browser/legacy/utils/playwrightRuntime.js");
      const chromeInfo = (runtime as any).getDefaultChromeExecutableInfo?.();
      executablePath = chromeInfo?.executablePath || undefined;
    } catch {
      ({ chromium } = await import("playwright-core"));
    }
    const browser = await chromium.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    try {
      const origin = new URL(url).origin;
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: UA,
        // 防盗链/CF 校验 Referer，页面内 fetch 会继承 context headers
        extraHTTPHeaders: { Referer: origin + "/" },
      });
      const page = await context.newPage();
      console.log(`[CollectEngine] browser.download(headless): ${url}`);
      try {
        await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 });
        // CF 挑战等待
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(1000);
          const t = (await page.title().catch(() => "")) || "";
          if (/Security Checkpoint|Just a moment|请稍候|Cloudflare/i.test(t)) continue;
          break;
        }
      } catch {
        /* 同源导航失败仍尝试直接 fetch */
      }
      const b64 = await page.evaluate(async (target: string) => {
        const r = await fetch(target);
        if (!r.ok) return null;
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as any);
        }
        return btoa(bin);
      }, url);
      if (!b64) throw new Error(`headless 浏览器 fetch 失败（可能仍被拦截）: ${url}`);
      return Buffer.from(b64, "base64");
    } finally {
      await browser.close().catch(() => undefined);
    }
  };
  const headlessResult = browserChain.then(runHeadless, runHeadless);
  browserChain = headlessResult.catch(() => undefined);
  return headlessResult;
}

async function renderWithBrowser(
  url: string,
  options: {
    waitFor?: string;
    waitMs?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
    profileId?: string;
  } = {},
): Promise<{ html: string; finalUrl: string; title: string }> {
  const run = async () => {
    // ── 优先：直接连接系统真实 Chrome CDP（带所有环境与 CF cookie）──
    try {
      const { chromium } = await import("playwright-core");
      for (const port of [9333, 9222]) {
        try {
          const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
          const context = browser.contexts()[0] || (await browser.newContext());
          const page = await context.newPage();
          console.log(`[CollectEngine] browser.render(CDP port=${port}): ${url}`);
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: Math.min(options.timeoutMs || 60000, 180000),
          });
          // Cloudflare / 安全检查点轮询（最多 35 秒）
          for (let i = 0; i < 35; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            const t = (await page.title().catch(() => "")) || "";
            if (/Security Checkpoint|Just a moment|请稍候|Cloudflare/i.test(t)) continue;
            break;
          }
          if (options.waitFor) {
            try {
              await page.waitForSelector(options.waitFor, { timeout: 20000 });
            } catch {
              /* 选择器超时继续取 HTML */
            }
          }
          if (options.waitMs) {
            await new Promise((r) => setTimeout(r, Math.min(options.waitMs, 15000)));
          }
          const html = await page.content();
          const finalUrl = page.url() || url;
          const title = (await page.title().catch(() => "")) || "";
          await page.close().catch(() => {});
          await browser.close().catch(() => {});
          return { html, finalUrl, title };
        } catch (cdpErr) {
          // CDP 连接失败或端口未开放，尝试下一个
        }
      }
    } catch {}

    // ── 次选：auto-browser 模块 ──
    try {
      const autoBrowser = await import("./auto-browser/index.js");
      const mod = autoBrowser as any;
      // 先按显式 profileId 取；未传时自动发现已连接的 managed profile
      let profileId = options.profileId || "";
      if (!profileId) {
        try {
          const pool = await import("./auto-browser/legacy/services/ManagedProfileBrowserPool.js");
          const status = await (pool as any).getManagedProfileBrowserStatus?.({});
          const connected = (status?.instances || []).find((x: any) => x?.isConnected || x?.browserStatus?.isConnected);
          if (connected?.profileId) profileId = String(connected.profileId);
        } catch {
          /* 无 managed pool 时走 legacy */
        }
      }
      let page = await mod.getBrowserPage?.(0, profileId ? { profileId } : {});
      if (!page) page = await mod.createBrowserPage?.(profileId ? { profileId } : {});
      if (page?.goto) {
        console.log(`[CollectEngine] browser.render(system${profileId ? ` profile=${profileId}` : ""}): ${url}`);
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(options.timeoutMs || 60000, 180000),
        });
        // Cloudflare / 安全检查点轮询（最多 25 秒）
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const t = (await page.title?.().catch(() => "")) || "";
          if (/Security Checkpoint|Just a moment|请稍候|Cloudflare/i.test(t)) continue;
          break;
        }
        if (options.waitFor) {
          try {
            await page.waitForSelector?.(options.waitFor, { timeout: 20000 });
          } catch {
            /* 选择器超时继续取 HTML */
          }
        }
        if (options.waitMs) {
          await new Promise((r) => setTimeout(r, Math.min(options.waitMs, 15000)));
        }
        const html = await page.content();
        const finalUrl = page.url?.() || url;
        const title = (await page.title?.().catch(() => "")) || "";
        return { html, finalUrl, title };
      }
    } catch (e: any) {
      console.warn(`[CollectEngine] 系统浏览器不可用，降级 headless: ${e?.message || e}`);
    }

    // ── 降级：独立 headless Chromium（部分站点 CF 挑战过不去）──
    const timeoutMs = Math.min(options.timeoutMs || 60000, 180000);
    let chromium: any;
    let executablePath: string | undefined;
    try {
      ({ chromium } = await import("playwright-core"));
      const runtime = await import("./auto-browser/legacy/utils/playwrightRuntime.js");
      const chromeInfo = (runtime as any).getDefaultChromeExecutableInfo?.();
      executablePath = chromeInfo?.executablePath || undefined;
    } catch {
      ({ chromium } = await import("playwright-core"));
    }
    const browser = await chromium.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        // 自定义请求头注入（如 Referer），部分 API 校验来源头
        extraHTTPHeaders: options.headers,
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

      // Cloudflare / 安全检查点轮询（最多 25 秒）
      for (let i = 0; i < 25; i++) {
        await page.waitForTimeout(1000);
        const title = await page.title();
        if (
          title.includes("Security Checkpoint") ||
          title.includes("Just a moment") ||
          title.includes("Cloudflare")
        ) {
          continue;
        }
        break;
      }

      if (options.waitFor) {
        try {
          await page.waitForSelector(options.waitFor, { timeout: Math.min(timeoutMs, 20000) });
        } catch {
          /* 选择器超时继续取 HTML */
        }
      }
      if (options.waitMs) {
        await page.waitForTimeout(Math.min(options.waitMs, 10000));
      }

      const html = await page.content();
      const finalUrl = page.url();
      const title = await page.title();
      return { html, finalUrl, title };
    } finally {
      await browser.close().catch(() => undefined);
    }
  };
  const result = browserChain.then(run, run);
  browserChain = result.catch(() => undefined);
  return result;
}

function buildCtx(
  args: CollectEngineRunArgs,
  progress: Array<{ percent: number; message?: string }>,
  /** 记录本次运行落库的素材 ID，供 runCollectSource 回填到结果里 */
  sink: { materialIds: string[]; materialOk: boolean } = { materialIds: [], materialOk: false },
) {
  const domains = args.meta?.domains;
  const defaultTimeout = args.meta?.timeoutMs || 120000;

  return {
    http: {
      async get(
        url: string,
        options: {
          query?: Record<string, string | number>;
          headers?: Record<string, string>;
          timeoutMs?: number;
        } = {},
      ) {
        assertDomainAllowed(url, domains);
        let target = url;
        if (options.query && Object.keys(options.query).length > 0) {
          const u = new URL(url);
          for (const [k, v] of Object.entries(options.query)) {
            if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
          }
          target = u.toString();
        }
        const mergedHeaders = {
          "User-Agent": UA,
          Accept: "text/html,application/json,*/*",
          ...(options.headers || {}),
        };
        const timeoutMs = Math.min(options.timeoutMs || 30000, defaultTimeout);
        let text: string;
        let status: number;
        try {
          const res = await fetchWithTimeout(target, {
            method: "GET",
            headers: mergedHeaders,
            timeoutMs,
          });
          status = res.status;
          text = await res.text();
        } catch (e1: any) {
          // fetch/undici 被 TLS 指纹或代理拦截时，降级 curl（系统 TLS 栈）
          try {
            const r = await curlRequest("GET", target, mergedHeaders, timeoutMs);
            status = r.status;
            text = r.text;
          } catch (e2: any) {
            throw new Error(`HTTP GET 请求失败 (${target}): fetch(${e1?.message}) / curl(${e2?.message})`);
          }
        }
        return {
          status,
          text,
          json() {
            if (!text || !text.trim()) {
              throw new Error(`响应内容为空 (HTTP ${status})`);
            }
            try {
              return JSON.parse(text);
            } catch (err: any) {
              const snippet = text.slice(0, 120).replace(/\s+/g, " ");
              throw new Error(`JSON 解析失败 (HTTP ${status}): ${err?.message}，响应内容: ${snippet}`);
            }
          },
        };
      },
      async post(
        url: string,
        options: {
          body?: any;
          headers?: Record<string, string>;
          timeoutMs?: number;
        } = {},
      ) {
        assertDomainAllowed(url, domains);
        const isJson =
          options.body && typeof options.body === "object" && !(options.body instanceof FormData);
        const mergedHeaders = {
          "User-Agent": UA,
          ...(isJson ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        };
        const timeoutMs = Math.min(options.timeoutMs || 30000, defaultTimeout);
        const bodyStr = isJson ? JSON.stringify(options.body) : (options.body as any);
        let text: string;
        let status: number;
        try {
          const res = await fetchWithTimeout(url, {
            method: "POST",
            headers: mergedHeaders,
            body: bodyStr,
            timeoutMs,
          });
          status = res.status;
          text = await res.text();
        } catch (e1: any) {
          try {
            const r = await curlRequest("POST", url, mergedHeaders, timeoutMs, String(bodyStr ?? ""));
            status = r.status;
            text = r.text;
          } catch (e2: any) {
            throw new Error(`HTTP POST 请求失败 (${url}): fetch(${e1?.message}) / curl(${e2?.message})`);
          }
        }
        return {
          status,
          text,
          json() {
            return JSON.parse(text);
          },
        };
      },
    },
    parse: {
      regexAll(text: string, pattern: string, flags = "g"): string[][] {
        const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
        const out: string[][] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(String(text || ""))) !== null) {
          out.push([...m]);
          if (m.index === re.lastIndex) re.lastIndex++;
        }
        return out;
      },
      regexOne(text: string, pattern: string, flags = ""): string[] | null {
        const m = new RegExp(pattern, flags).exec(String(text || ""));
        return m ? [...m] : null;
      },
      attr(tag: string, name: string): string | null {
        const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i");
        const m = re.exec(String(tag || ""));
        return m ? decodeEntities(m[1]) : null;
      },
      decodeEntities,
      nextData(html: string): any {
        const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(
          String(html || ""),
        );
        if (!m) return null;
        try {
          return JSON.parse(m[1]);
        } catch {
          return null;
        }
      },
      rsc(html: string): string {
        const out: string[] = [];
        const re = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(String(html || ""))) !== null) {
          try {
            out.push(JSON.parse(`"${m[1]}"`));
          } catch {
            out.push(m[1]);
          }
        }
        return out.join("");
      },
      xssiStrip(text: string): any {
        const cleaned = String(text || "").replace(/^\)\]\}',?\s*/, "");
        return JSON.parse(cleaned);
      },
    },
    browser: {
      /**
       * 真浏览器渲染取 HTML（应对 Cloudflare/JS 渲染/反爬页）。
       * 串行执行，内置 Cloudflare 检查点等待。
       */
      async render(
        url: string,
        options: {
          waitFor?: string;
          waitMs?: number;
          timeoutMs?: number;
          headers?: Record<string, string>;
          profileId?: string;
        } = {},
      ): Promise<{ html: string; finalUrl: string; title: string }> {
        assertDomainAllowed(url, domains);
        console.log(`[CollectEngine] browser.render: ${url}`);
        const result = await renderWithBrowser(url, {
          ...options,
          timeoutMs: Math.min(options.timeoutMs || 60000, defaultTimeout),
        });
        return result;
      },
    },
    download: {
      async toCos(
        url: string,
        options: {
          referer?: string;
          filename?: string;
          /** 同步写入素材库（crawler_material 或 collect_file） */
          toMaterial?: boolean;
          /** 入库目标：crawler_material（默认）| collect_file（媒体采集→采集文件） */
          materialTarget?: string;
          title?: string;
          /** 图文说明：源抓到的作品介绍文案，写入素材库 description 字段 */
          description?: string;
          /** 关键词（逗号分隔）：写入素材库 keywords 字段 */
          keywords?: string;
          source?: string;
          originUrl?: string;
          meta?: Record<string, unknown>;
          /** 自定义请求头（如 Accept、Accept-Language 等，部分站点防盗链需要） */
          headers?: Record<string, string>;
        } = {},
      ): Promise<{ cosUrl: string; size: number; materialOk?: boolean; materialId?: string }> {
        // 统一规范：domains 白名单只约束 search/list 的抓取请求；
        // download 的 URL 来自搜索结果（如聚合源的第三方 CDN），不再限域
        const mergedHeaders: Record<string, string> = {
          "User-Agent": UA,
          ...(options.referer ? { Referer: options.referer } : {}),
          ...(options.headers || {}),
        };
        let buf: Buffer;
        let fetchErr: any = null;
        let curlErr: any = null;
        try {
          const res = await fetchWithTimeout(url, { headers: mergedHeaders, timeoutMs: 120000 });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buf = Buffer.from(await res.arrayBuffer());
        } catch (e1: any) {
          fetchErr = e1;
          // fetch(undici) 和 https.get 都被 TLS 指纹拦截时，降级用 curl（系统级 TLS 栈）
          try {
            buf = await new Promise<Buffer>((resolve, reject) => {
              const { execFile } = require("child_process");
              // -f: HTTP 错误（404/500 等）时返回失败，避免把错误页面当图片保存
              const args = ["-sSLf", "--max-time", "120"];
              for (const [k, v] of Object.entries(mergedHeaders)) {
                args.push("-H", `${k}: ${v}`);
              }
              args.push(url);
              execFile("curl", args, { encoding: "buffer", maxBuffer: 200 * 1024 * 1024 }, (err: any, stdout: Buffer) => {
                if (err) reject(new Error(`下载失败(curl): ${err.message}`));
                else if (!stdout || !stdout.length) reject(new Error(`下载失败(curl): 空响应 ${url}`));
                else resolve(stdout);
              });
            });
          } catch (e2: any) {
            curlErr = e2;
            // 第三级：仅当疑似被反爬拦截（403/挑战页）时才走系统浏览器内 fetch（带 CF cookie）；
            // 404 等「资源不存在」不重试浏览器，直接抛原始错误，避免误报为「被拦截」
            const bothFailed = `${fetchErr?.message || ""} ${curlErr?.message || ""}`;
            const looksBlocked = /403|401|429|blocked|forbidden|challenge|cloudflare/i.test(bothFailed);
            if (looksBlocked) {
              buf = await downloadViaBrowser(url).catch((bErr: any) => {
                throw new Error(
                  `下载失败: fetch(${fetchErr?.message}) / curl(${curlErr?.message}) / 浏览器(${bErr?.message})`,
                );
              });
            } else {
              // 非拦截类错误（如 404）：保留原始错误
              throw new Error(`下载失败: ${fetchErr?.message || curlErr?.message} (${url})`);
            }
          }
        }
        // 校验下载内容确实是图片（magic bytes），防止 HTML 错误页/空文件混入素材库
        const imageFormat = sniffImageFormat(buf);
        if (!imageFormat) {
          throw new Error(`下载内容不是有效图片（可能为错误页面）: ${url}`);
        }
        // 文件名只保留 ASCII 安全字符，避免中文/特殊字符导致 ENOENT
        const rawName = String(options.filename || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
        // 后缀一律以真实内容为准：URL 后缀常与实际返回格式不一致（如 .jpg 实为 PNG）
        const ext = imageFormat;
        // 强制把文件名后缀对齐真实格式，避免 URL 后缀污染 COS key 与素材库 suffix
        const baseName = (rawName || `collect-${Date.now()}`).replace(/\.[a-z0-9]{1,8}$/i, "");
        const safeName = `${baseName}.${ext}`;
        // 确保 tmp 目录存在（沙箱/清理后可能被删），文件名加随机后缀防并发碰撞
        const tmpDir = os.tmpdir();
        fs.mkdirSync(tmpDir, { recursive: true });
        const tmpPath = path.join(
          tmpDir,
          `collect-engine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`,
        );
        fs.writeFileSync(tmpPath, buf);
        try {
          let materialOk = false;
          let materialId: string | undefined;
          if (options.toMaterial) {
            try {
              const { uploadToMaterialLibrary } = await import("./materialLibrary");
              // 入库目标优先级：调用方显式指定 > 任务/源 meta 注入 > 默认 crawler_material
              const materialTarget =
                options.materialTarget ||
                (args.params as any)?.materialTarget ||
                (args.meta as any)?.materialTarget ||
                "crawler_material";
              // 溯源信息自动注入：download hook 的 params.item 携带详情链/标题时默认记录，
              // 便于素材库/采集文件回溯原页面；显式传 options.originUrl / options.meta 优先
              const itemParams = (args.params as any)?.item || {};
              const originUrl =
                options.originUrl ||
                itemParams.link ||
                itemParams.url ||
                itemParams.detailUrl ||
                "";
              // 采集方式/平台标注：报告与素材库可直接展示「哪个平台·哪种方式」
              // 方法标签来自源自己声明的 meta.methods，不再写死 search/list/download
              const declaredMethods: any[] = Array.isArray((args.meta as any)?.methods)
                ? (args.meta as any).methods
                : [];
              const methodLabel = (key: string) =>
                declaredMethods.find((d) => d?.key === key)?.label;
              const action = String(args.action || "download");
              // download 是落地步骤；真正的方式看 params.via（search|list）或 meta.collectMethodLabel
              const via = String((args.params as any)?.via || "");
              const labelKey = action === "download" && via ? via : action;
              const meta = {
                sourceName: (args.meta as any)?.name || args.sourceId,
                collectAction: action,
                collectActionLabel:
                  methodLabel(labelKey) ||
                  (args.meta as any)?.modeLabels?.[labelKey] ||
                  labelKey,
                ...(options.meta || {}),
                // 调用方附加元数据（如 harvest 批次标记），经 collect_run params.meta 传入
                ...((args.params as any)?.meta || {}),
                sourceImageUrl: options.meta?.sourceImageUrl || url,
                ...(itemParams.title
                  ? { sourceTitle: String(itemParams.title).slice(0, 300) }
                  : {}),
              };
              const matRes: any = await uploadToMaterialLibrary(tmpPath, safeName, {
                name: options.title || safeName,
                category: "uncategorized",
                source: options.source || args.sourceId,
                originUrl,
                // 图文说明/关键词：优先调用方显式传入，其次复用 item 里源抓到的文本
                description: String(
                  options.description ??
                    itemParams.description ??
                    itemParams.desc ??
                    itemParams.summary ??
                    "",
                ).slice(0, 990),
                keywords: String(
                  options.keywords ??
                    (Array.isArray(itemParams.keywords)
                      ? itemParams.keywords.join(",")
                      : itemParams.keywords ?? ""),
                ).slice(0, 990),
                meta,
                materialTarget,
              } as any);
              materialOk = !!matRes?.ok;
              materialId = matRes?.materialId;
            } catch (matErr: any) {
              console.warn("[CollectEngine] 素材库入库失败:", matErr?.message || matErr);
            }
          }
          const result: any = await uploadFileToCos(tmpPath);
          if (!result?.ok || !result?.url) {
            throw new Error(`上传 COS 失败: ${result?.msg || JSON.stringify(result)?.slice(0, 200)}`);
          }
          // 记录落库结果：让调用方（agent/前端）能定位到「素材库里的最终文件」
          if (materialId) sink.materialIds.push(materialId);
          if (materialOk) sink.materialOk = true;
          return { cosUrl: result.url, size: buf.length, materialOk, materialId };
        } finally {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
        }
      },
    },
    report: {
      progress(percent: number, message?: string) {
        progress.push({ percent: Math.max(0, Math.min(100, Number(percent) || 0)), message });
      },
    },
    secret(name: string) {
      return args.secrets?.[name] ?? null;
    },
    log(...logArgs: any[]) {
      console.log("[CollectEngine]", ...logArgs);
    },
  };
}

/** 在 vm 沙箱中执行源代码，取出 hooks */
function loadSourceHooks(code: string): any {
  // 超大脚本在 V8 编译阶段会耗尽原生 Zone 内存，直接 abort 进程（不是可捕获的 JS 异常）。
  // 正常采集源只有几十 KB，超过阈值基本是数据异常，提前拒绝而不是让主进程闪退。
  const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
  if (Buffer.byteLength(code, "utf8") > MAX_SOURCE_BYTES) {
    throw new Error(`采集源脚本过大（${Math.round(Buffer.byteLength(code, "utf8") / 1024)}KB），已拒绝编译`);
  }
  const module = { exports: {} as any };
  const sandbox: any = {
    module,
    exports: module.exports,
    console: { log: () => undefined, warn: () => undefined, error: () => undefined },
    // URL 是纯解析工具（无网络/文件能力），源码拼查询串常用，注入避免 "URL is not defined"；
    // 其余 Node 能力（require/process/fs/fetch）一律不给，网络必须走 ctx
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, {
    timeout: 15000,
    filename: "collect-source.js",
  });
  return module.exports;
}

export async function runCollectSource(
  args: CollectEngineRunArgs,
): Promise<CollectEngineRunResult> {
  const progress: Array<{ percent: number; message?: string }> = [];
  try {
    if (!args?.code) {
      return { success: false, error: "缺少源代码 code", engineVersion: COLLECT_ENGINE_VERSION };
    }
    const hooks = loadSourceHooks(args.code);
    const action = args.action || "search";
    const hook = hooks?.[action];
    if (typeof hook !== "function") {
      return {
        success: false,
        error: `源未实现动作: ${action}`,
        engineVersion: COLLECT_ENGINE_VERSION,
      };
    }

    const sink = { materialIds: [] as string[], materialOk: false };
    const ctx = buildCtx(args, progress, sink);
    const timeoutMs = args.meta?.timeoutMs || 120000;
    const run = Promise.resolve(hook(ctx, args.params || {}));

    let timer: NodeJS.Timeout | undefined;
    const timeoutRace = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`采集执行超时 (${timeoutMs}ms)`)), timeoutMs);
    });

    try {
      const data = (await Promise.race([run, timeoutRace])) as any;
      // 回填落库信息：判据是「素材库里的最终文件」，调用方要能直接定位到它，
      // 不必依赖各源 hook 是否记得把 materialId 传出来。
      const payload = data && typeof data === "object" ? data : {};
      const enriched =
        sink.materialIds.length > 0
          ? {
              ...payload,
              materialId: payload.materialId ?? sink.materialIds[0],
              materialIds: sink.materialIds,
              materialOk: payload.materialOk ?? sink.materialOk,
            }
          : payload;
      return {
        success: true,
        data: enriched,
        message:
          action === "download"
            ? sink.materialIds.length
              ? `下载完成，已入库 ${sink.materialIds.length} 个素材`
              : "下载完成"
            : `采集完成: ${Array.isArray(data?.items) ? data.items.length : 0} 条`,
        progress,
        engineVersion: COLLECT_ENGINE_VERSION,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error: any) {
    return {
      success: false,
      error: String(error?.message || error),
      progress,
      engineVersion: COLLECT_ENGINE_VERSION,
    };
  }
}

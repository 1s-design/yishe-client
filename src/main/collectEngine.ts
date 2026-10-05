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

export const COLLECT_ENGINE_VERSION = 1;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface CollectEngineRunArgs {
  sourceId: string;
  sourceVersion?: string;
  /** 源代码全文（CJS 形态，客户端由接口拉取后传入） */
  code: string;
  /** search | list | download */
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

/** 浏览器任务串行锁：同一时刻只跑一个真浏览器渲染，避免资源风暴 */
let browserChain: Promise<any> = Promise.resolve();

async function renderWithBrowser(
  url: string,
  options: {
    waitFor?: string;
    waitMs?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<{ html: string; finalUrl: string; title: string }> {
  const run = async () => {
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

function buildCtx(args: CollectEngineRunArgs, progress: Array<{ percent: number; message?: string }>) {
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
        const res = await fetchWithTimeout(target, {
          method: "GET",
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/json,*/*",
            ...(options.headers || {}),
          },
          timeoutMs: Math.min(options.timeoutMs || 30000, defaultTimeout),
        });
        const text = await res.text();
        return {
          status: res.status,
          text,
          json() {
            return JSON.parse(text);
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
        const res = await fetchWithTimeout(url, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            ...(isJson ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {}),
          },
          body: isJson ? JSON.stringify(options.body) : (options.body as any),
          timeoutMs: Math.min(options.timeoutMs || 30000, defaultTimeout),
        });
        const text = await res.text();
        return {
          status: res.status,
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
        options: { waitFor?: string; waitMs?: number; timeoutMs?: number; headers?: Record<string, string> } = {},
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
          source?: string;
          originUrl?: string;
          meta?: Record<string, unknown>;
        } = {},
      ): Promise<{ cosUrl: string; size: number; materialOk?: boolean }> {
        assertDomainAllowed(url, domains);
        const res = await fetchWithTimeout(url, {
          headers: {
            "User-Agent": UA,
            ...(options.referer ? { Referer: options.referer } : {}),
          },
          timeoutMs: Math.min(120000, defaultTimeout),
        });
        if (!res.ok) {
          throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const safeName =
          options.filename ||
          `collect-${Date.now()}.${(url.split("?")[0].split(".").pop() || "bin").slice(0, 8)}`;
        const tmpPath = path.join(os.tmpdir(), `collect-engine-${Date.now()}-${safeName}`);
        fs.writeFileSync(tmpPath, buf);
        try {
          let materialOk = false;
          if (options.toMaterial) {
            try {
              const { uploadToMaterialLibrary } = await import("./materialLibrary");
              // 入库目标优先级：调用方显式指定 > 任务/源 meta 注入 > 默认 crawler_material
              const materialTarget =
                options.materialTarget ||
                (args.params as any)?.materialTarget ||
                (args.meta as any)?.materialTarget ||
                "crawler_material";
              const matRes: any = await uploadToMaterialLibrary(tmpPath, safeName, {
                name: options.title || safeName,
                category: "uncategorized",
                source: options.source || args.sourceId,
                originUrl: options.originUrl,
                meta: options.meta,
                materialTarget,
              } as any);
              materialOk = !!matRes?.ok;
            } catch (matErr: any) {
              console.warn("[CollectEngine] 素材库入库失败:", matErr?.message || matErr);
            }
          }
          const result: any = await uploadFileToCos(tmpPath);
          if (!result?.ok || !result?.url) {
            throw new Error(`上传 COS 失败: ${result?.msg || JSON.stringify(result)?.slice(0, 200)}`);
          }
          return { cosUrl: result.url, size: buf.length, materialOk };
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
  const module = { exports: {} as any };
  const sandbox: any = {
    module,
    exports: module.exports,
    console: { log: () => undefined, warn: () => undefined, error: () => undefined },
    // 源代码只应使用 ctx；这里不提供 require/process/fs 等 Node 能力
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

    const ctx = buildCtx(args, progress);
    const timeoutMs = args.meta?.timeoutMs || 120000;
    const run = Promise.resolve(hook(ctx, args.params || {}));

    let timer: NodeJS.Timeout | undefined;
    const timeoutRace = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`采集执行超时 (${timeoutMs}ms)`)), timeoutMs);
    });

    try {
      const data = (await Promise.race([run, timeoutRace])) as any;
      return {
        success: true,
        data: data ?? {},
        message:
          action === "download"
            ? "下载完成"
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

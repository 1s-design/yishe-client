/**
 * 客户端通用能力 — 通用采集引擎 (Collect Engine)
 *
 * 执行服务端下发的采集源代码（Source-as-Code）。
 * 新增采集源无需更新客户端：服务端定义代码 → 客户端拉取 → 沙箱执行。
 *
 * 注册后暴露为:
 *   REST  POST /api/capabilities/collect/run|status
 *   MCP   collect_run / collect_status
 */
import { z } from "zod";
import { CapabilityRegistry } from "./registry";
import type { CapabilityDefinition } from "./types";
import {
  COLLECT_ENGINE_VERSION,
  runCollectSource,
  type CollectEngineRunArgs,
} from "../collectEngine";
import { fetchSourceCode } from "./source-bridge";
import { getCachedSourceMetas } from "./dynamic-tool-surface";

const runDef: CapabilityDefinition = {
  name: "run",
  namespace: "collect",
  description:
    "执行服务端定义的采集源代码（sourceId 关联的 search/list/download 动作），在沙箱中运行并返回结构化采集结果。code 可省略：缺省时自动从服务端拉取源定义。",
  riskLevel: "write",
  argsSchema: z.object({
    sourceId: z.string().describe("采集源 ID，如 4kwallpapers"),
    sourceVersion: z.string().optional().describe("源代码版本 hash"),
    code: z
      .string()
      .optional()
      .describe("源代码全文（可省略：缺省时自动从服务端 /collect/sources/:id/code 拉取）"),
    action: z
      .enum(["search", "list", "download"])
      .default("search")
      .describe("执行动作"),
    params: z.record(z.string(), z.any()).optional().describe("动作参数（query/page/item/resolution 等）"),
    meta: z.record(z.string(), z.any()).optional().describe("源 meta（域名白名单/超时/限速）"),
    secrets: z.record(z.string(), z.string()).optional().describe("任务临时密钥"),
  }),
  handler: async (args: {
    sourceId: string;
    sourceVersion?: string;
    code?: string;
    action?: "search" | "list" | "download";
    params?: Record<string, any>;
    meta?: CollectEngineRunArgs["meta"];
    secrets?: Record<string, string>;
  }) => {
    let code = args.code;
    let meta = args.meta;
    let sourceVersion = args.sourceVersion;
    let warning: string | undefined;

    // code 可选：缺省自动拉取源定义（带缓存与错误诊断）
    if (!code) {
      const fetched = await fetchSourceCode(args.sourceId);
      if (!fetched?.code) {
        return {
          success: false,
          error:
            fetched?.error ||
            `缺少源代码 code，且自动拉取失败（sourceId=${args.sourceId}）`,
        };
      }
      code = fetched.code;
      sourceVersion = sourceVersion || fetched.version;
      meta = meta || (fetched.meta as CollectEngineRunArgs["meta"]);
      if (fetched.error) warning = fetched.error;
    }

    const result = await runCollectSource({
      sourceId: args.sourceId,
      sourceVersion,
      code,
      action: args.action || "search",
      params: args.params || {},
      meta,
      secrets: args.secrets,
    });
    return {
      success: result.success,
      data: result.data,
      error: result.error,
      ...(warning ? { warning } : {}),
    };
  },
};

const discoverDef: CapabilityDefinition = {
  name: "discover",
  namespace: "collect",
  description:
    "检索可用采集源（工具检索入口）。query 为主题/内容词（如 壁纸、猫、新闻），" +
    "用于把相关源排前面，而不是过滤——图片类源都能搜任意内容；" +
    "选中源后用 collect_run({sourceId, action, params}) 执行搜索或采集入库。",
  riskLevel: "read",
  argsSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("主题/内容关键词（如 壁纸、猫、摄影、新闻），相关源优先排序"),
    module: z
      .enum(["image-collect", "media-collect", "news", "hotsearch", "data-tools"])
      .optional()
      .describe("模块过滤：image-collect=图片采集、media-collect=媒体采集、news=新闻、hotsearch=热搜、data-tools=数据工具"),
    needsDownload: z
      .boolean()
      .optional()
      .describe("仅返回支持「采集入库(download)」的源"),
    limit: z.number().optional().describe("最大返回数量，默认 30"),
  }),
  handler: async (args: {
    query?: string;
    module?: string;
    needsDownload?: boolean;
    limit?: number;
  }) => {
    const metas = getCachedSourceMetas();
    if (!metas.length) {
      return {
        success: false,
        error: "采集源清单尚未同步（可能未登录或服务端不可达），请稍后重试",
      };
    }

    const query = String(args?.query || "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(args?.limit) || 30, 1), 200);

    // 无 module 时按内容词粗推模块，减少噪音
    let moduleFilter = args?.module || "";
    if (!moduleFilter && query) {
      if (/新闻|资讯|news|早报|热点新闻/.test(query)) moduleFilter = "news";
      else if (/热搜|热榜|trending|榜单/.test(query)) moduleFilter = "hotsearch";
    }

    const scored = metas
      .map((meta: any) => {
        const modules: string[] = Array.isArray(meta.module) ? meta.module : meta.module ? [meta.module] : [];
        const actions: string[] = meta.actions || ["download", "openPage"];
        const paramLabels = (meta.searchParams || []).map((p: any) => `${p.key} ${p.label}`).join(" ");
        const haystack = `${meta.id} ${meta.name || ""} ${modules.join(" ")} ${paramLabels}`.toLowerCase();

        // 模块/能力是硬过滤
        if (moduleFilter && !modules.some((m) => m === moduleFilter || modules.includes(moduleFilter))) return null;
        if (args?.needsDownload && !actions.includes("download")) return null;

        // query 只做相关度打分（专家源靠前），不淘汰通用源：
        // 任意图库源都能搜「壁纸」等内容词
        let score = 0;
        if (query) {
          if (haystack.includes(query)) score += 10;
          for (const term of query.split(/\s+/).filter(Boolean)) {
            if (haystack.includes(term)) score += 3;
          }
          if (modules.includes("image-collect") || modules.includes("media-collect")) score += 1;
        }

        return {
          sourceId: meta.id,
          name: meta.name || meta.id,
          module: modules.join("/") || "unknown",
          supportsDownload: actions.includes("download"),
          available: meta.available !== false,
          unavailableReason: meta.available === false ? meta.unavailableReason || "站点限制" : undefined,
          searchParams: (meta.searchParams || []).map((p: any) => ({
            key: p.key,
            label: p.label,
            type: p.type,
            required: !!p.required,
            options: p.options || undefined,
          })),
          _score: score,
        };
      })
      .filter(Boolean) as any[];

    scored.sort((a, b) => b._score - a._score || (a.available === b.available ? 0 : a.available ? -1 : 1));
    const sources = scored.slice(0, limit).map(({ _score, ...rest }: any) => rest);

    return {
      success: true,
      data: {
        count: sources.length,
        totalMatched: scored.length,
        hint:
          "选定 sourceId 后调用 collect_run：action=search 带 searchParams 中的参数（通用 query/page/pageSize）；" +
          "action=download 带 item=search 结果条目。query 只影响排序，试试换 module 或换源。",
        sources,
      },
    };
  },
};

const statusDef: CapabilityDefinition = {
  name: "status",
  namespace: "collect",
  description: "查看通用采集引擎状态与版本。",
  riskLevel: "read",
  argsSchema: z.object({}),
  handler: async () => ({
    success: true,
    data: {
      label: "通用采集引擎",
      engineVersion: COLLECT_ENGINE_VERSION,
      available: true,
      supportedCommands: ["discover", "run", "status"],
    },
  }),
};

export function registerCollectCapabilities(): void {
  CapabilityRegistry.registerAll([discoverDef, runDef, statusDef]);
}

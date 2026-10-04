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

const runDef: CapabilityDefinition = {
  name: "run",
  namespace: "collect",
  description:
    "执行服务端定义的采集源代码（sourceId 关联的 search/list/download 动作），在沙箱中运行并返回结构化采集结果。",
  riskLevel: "write",
  argsSchema: z.object({
    sourceId: z.string().describe("采集源 ID，如 4kwallpapers"),
    sourceVersion: z.string().optional().describe("源代码版本 hash"),
    code: z.string().optional().describe("源代码全文（由服务端接口下发）"),
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
    if (!args?.code) {
      return { success: false, error: "缺少源代码 code（请先从服务端 /collect/sources/:id/code 拉取）" };
    }
    const result = await runCollectSource({
      sourceId: args.sourceId,
      sourceVersion: args.sourceVersion,
      code: args.code,
      action: args.action || "search",
      params: args.params || {},
      meta: args.meta,
      secrets: args.secrets,
    });
    return {
      success: result.success,
      data: result.data,
      error: result.error,
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
      supportedCommands: ["run", "status"],
    },
  }),
};

export function registerCollectCapabilities(): void {
  CapabilityRegistry.registerAll([runDef, statusDef]);
}

/**
 * 动态工具面（Dynamic Tool Surface）
 *
 * 扩展规范：**源定义即工具面** —— 新增采集平台只需在服务端写一个源文件，
 * 客户端 AI/MCP 工具自动从 `GET /collect/sources` 清单生成：
 *   - 工具名：collect_<源id> 系（+ 旧命名别名保持兼容）
 *   - 工具描述：由 meta.name / module / searchParams 标签自动拼装
 *   - 参数 schema：由 meta.searchParams 动态派生（text/select/number/color）
 * 无需改动任何 AI / MCP 代码。
 *
 * 注册时机：registerAllCapabilities 启动同步 + 周期刷新（新源热接入）。
 */
import { z } from "zod";
import { CapabilityRegistry } from "./registry";
import type { CapabilityDefinition } from "./types";
import { sourceBridgeCall } from "./source-bridge";
import { getCurrentAccessToken, getBackendApiBase } from "../cos";

const MODULE_LABELS: Record<string, string> = {
  "image-collect": "图片采集",
  "media-collect": "媒体采集",
  news: "新闻",
  hotsearch: "热搜",
  "data-tools": "数据工具",
};

/** 旧工具命名别名特例（id → 旧 namespace 前缀） */
const LEGACY_ALIAS: Record<string, string> = {
  googleicons: "google-icons",
  "hotsearch-douyin-jingxuan": "douyin_jingxuan",
};

interface SourceMetaLike {
  id: string;
  module?: string | string[];
  name?: string;
  searchParams?: Array<{
    key: string;
    label: string;
    type: string;
    options?: Array<{ label: string; value: string | number }>;
    required?: boolean;
  }>;
  actions?: string[];
  available?: boolean;
  unavailableReason?: string;
}

/** meta.searchParams → zod 参数 schema（AI 可见的强类型参数） */
function buildArgsSchema(meta: SourceMetaLike, withQuery: boolean): z.ZodType<any> {
  const shape: Record<string, z.ZodType<any>> = {};
  if (withQuery) {
    // 统一带 query/keyword 兼容口 + 分页
    shape.query = z.string().optional().describe("搜索关键词");
    shape.keyword = z.string().optional().describe("搜索关键词（别名）");
  }
  shape.page = z.number().optional().describe("页码，从 1 开始");
  shape.pageSize = z.number().optional().describe("每页数量");
  shape.limit = z.number().optional().describe("每页数量（别名）");
  for (const p of meta.searchParams || []) {
    if (!p?.key || shape[p.key]) continue;
    let f: z.ZodType<any>;
    if (p.type === "select" && Array.isArray(p.options) && p.options.length) {
      const vals = p.options.map((o) => String(o.value));
      f = z
        .string()
        .optional()
        .describe(
          `${p.label}：可选值 ${vals.join(" / ")}（${p.options.map((o) => `${o.value}=${o.label}`).join("，")}）`,
        );
    } else if (p.type === "number") {
      f = z.number().optional().describe(p.label);
    } else {
      f = z.string().optional().describe(p.label + (p.required ? "（必填）" : ""));
    }
    shape[p.key] = f;
  }
  return z.object(shape).loose?.() ?? z.record(z.string(), z.any());
}

function buildDescription(meta: SourceMetaLike): string {
  const mods = Array.isArray(meta.module) ? meta.module.join("/") : meta.module || "";
  const modLabel = MODULE_LABELS[mods] || mods;
  const params = (meta.searchParams || [])
    .filter((p) => p.key !== "query" && p.key !== "pageSize")
    .map((p) => `${p.label}${p.type === "select" ? "（下拉）" : ""}`)
    .join("、");
  const parts = [`采集 ${meta.name || meta.id}（${modLabel}）`];
  if (params) parts.push(`支持筛选：${params}`);
  if (meta.available === false) {
    parts.push(`⚠ 当前不可用：${meta.unavailableReason || "站点限制"}`);
  }
  return parts.join("；") + "。";
}

let synced = false;
let refreshing: Promise<void> | null = null;

async function fetchSourceMetas(): Promise<SourceMetaLike[]> {
  const base = (await getBackendApiBase()).replace(/\/+$/, "");
  const prefix = /\/api$/i.test(base) ? base : `${base}/api`;
  const token = await getCurrentAccessToken();
  const res = await fetch(`${prefix}/collect/sources`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`拉取源清单失败 HTTP ${res.status}`);
  const body = await res.json();
  const list = (body && (body as any).data) || body;
  return Array.isArray(list) ? list : [];
}

function registerMetaTools(meta: SourceMetaLike) {
  const id = String(meta.id || "").trim();
  if (!id) return;
  const actions = meta.actions || ["download", "openPage"];
  const description = buildDescription(meta);

  const entries: Array<{ namespace: string; name: string; desc: string; action: "search" | "download" | "status"; withQuery: boolean }> = [
    {
      namespace: `collect_${id.replace(/-/g, "_")}`,
      name: "search",
      desc: `${description} 搜索并返回结果列表。`,
      action: "search",
      withQuery: true,
    },
    {
      namespace: `collect_${id.replace(/-/g, "_")}`,
      name: "status",
      desc: `查询 ${meta.name || id} 采集源状态（可用性/版本）。`,
      action: "status",
      withQuery: false,
    },
  ];
  if (actions.includes("download")) {
    entries.push({
      namespace: `collect_${id.replace(/-/g, "_")}`,
      name: "download",
      desc: `${meta.name || id} 采集入库：下载素材并保存到素材库。`,
      action: "download",
      withQuery: false,
    });
  }

  // 旧命名别名（保持既有 AI 工作流兼容）：baidu.search / hotsearch_weibo.search 等
  const legacyNs = LEGACY_ALIAS[id] || id.replace(/-/g, "_");
  if (legacyNs && legacyNs !== `collect_${id.replace(/-/g, "_")}`) {
    for (const e of [...entries]) {
      entries.push({ ...e, namespace: legacyNs, desc: e.desc });
    }
  }

  for (const e of entries) {
    const definition: CapabilityDefinition = {
      namespace: e.namespace,
      name: e.name,
      description: e.desc,
      riskLevel: e.action === "download" ? "write" : "read",
      argsSchema: buildArgsSchema(meta, e.withQuery),
      handler: async (args: any) => {
        const bridged = await sourceBridgeCall(e.namespace, e.name, args || {});
        if (bridged.handled) return bridged.result;
        return {
          success: false,
          error: `采集源暂不可用: ${id}`,
        };
      },
    };
    CapabilityRegistry.register(definition);
  }
}

/**
 * 从服务端同步源清单并注册工具面。新平台自动进入 AI/MCP 工具列表。
 */
export async function syncCollectToolsFromServer(force = false): Promise<void> {
  if (refreshing) return refreshing;
  if (synced && !force) return;
  refreshing = (async () => {
    try {
      const metas = await fetchSourceMetas();
      for (const meta of metas) registerMetaTools(meta);
      synced = true;
      console.log(
        `[DynamicToolSurface] 已同步采集工具面：${metas.length} 个源（AI/MCP 自动可用）`,
      );
    } catch (err: any) {
      console.warn("[DynamicToolSurface] 同步采集工具面失败:", err?.message || err);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** 启动周期刷新（新源热接入，无需重启客户端） */
export function startCollectToolSyncLoop(intervalMs = 10 * 60 * 1000): void {
  void syncCollectToolsFromServer();
  setInterval(() => {
    void syncCollectToolsFromServer(true);
  }, intervalMs).unref?.();
}

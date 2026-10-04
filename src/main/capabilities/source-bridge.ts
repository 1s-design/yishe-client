/**
 * 能力 → 采集引擎桥（Source Bridge）
 *
 * 让 MCP 工具 / 工作流 client 模式 / 本地能力 REST 统一改调
 * 「服务端维护的源定义 + 客户端采集引擎」，消除多份采集实现。
 *
 * 规则：
 * 1. 聚合类（media-collect / hotsearch）按 args 里的 source/platform 定位源
 * 2. 个别命名空间与源 id 不同名的走特例映射
 * 3. 数据工具类（openmeteo 等）→ 源 data-tools，工具名注入 params.tool
 * 4. 其余按 namespace 推导源 id（hotsearch_xxx → hotsearch-xxx）
 * 5. 找不到源定义 → 返回 null，由旧 handler 兜底（googleArt/pinterest 等定制能力）
 */
import { runCollectSource, COLLECT_ENGINE_VERSION } from "../collectEngine";
import { getCurrentAccessToken, getBackendApiBase } from "../cos";

/** 命名空间 → 源 id 的特例映射 */
const SOURCE_ALIAS: Record<string, string> = {
  "google-icons": "googleicons",
  douyin_jingxuan: "hotsearch-douyin-jingxuan",
};

/** 不桥接的命名空间（定制能力 / 非采集）——保留旧实现 */
const KEEP_LEGACY = new Set([
  "googleArt",
  "shopify",
  "materialLibrary",
  "filesystem",
  "clipboard",
  "system",
  "screen",
  "network",
  "print",
]);

/** 数据工具命名空间（→ 源 data-tools，params.tool = 命名空间） */
const DATA_TOOL_NAMESPACES = new Set([
  "openmeteo",
  "wttr",
  "coingecko",
  "frankfurter",
  "dictionary",
  "joke",
  "ipify",
  "sunrisesunset",
  "timeapi",
  "zippopotam",
  "countryis",
  "erapi",
  "fawazahmed",
  "colorapi",
]);

/** 动作映射：能力动作 → 源 hook */
function mapAction(name: string): "search" | "list" | "download" | "status" | null {
  if (name === "search" || name === "list" || name === "download") return name;
  if (name === "collect") return "download"; // collect = 采集入库 ≈ download(toMaterial)
  if (name === "status") return "status";
  return null;
}

/** 聚合类：按 args 定位源 */
function resolveAggregatedSourceId(namespace: string, args: any): string | null {
  if (namespace === "media-collect") {
    const src = String(args?.source || "").trim();
    if (!src) return null;
    if (src === "internet-archive") return "internet-archive";
    return src; // wikimedia/openverse/pexels/magnific/nappy/midjourney 与源 id 同名
  }
  if (namespace === "hotsearch") {
    const p = String(args?.platform || args?.source || "").trim();
    return p ? `hotsearch-${p.replace(/_/g, "-")}` : null;
  }
  return null;
}

function resolveSourceId(namespace: string, args: any): string | null {
  if (KEEP_LEGACY.has(namespace)) return null;
  const aggregated = resolveAggregatedSourceId(namespace, args);
  if (aggregated) return aggregated;
  if (DATA_TOOL_NAMESPACES.has(namespace)) return "data-tools";
  // 动态工具面的规范命名：collect_<源id 去横线>
  if (namespace.startsWith("collect_")) {
    return namespace.slice("collect_".length).replace(/_/g, "-");
  }
  if (SOURCE_ALIAS[namespace]) return SOURCE_ALIAS[namespace];
  if (namespace.startsWith("hotsearch_")) {
    return `hotsearch-${namespace.slice("hotsearch_".length).replace(/_/g, "-")}`;
  }
  return namespace;
}

/** 旧能力参数 → 源 hook params */
function mapParams(
  namespace: string,
  action: string,
  args: any,
): Record<string, any> {
  const a = args || {};
  const params: Record<string, any> = {};
  // 关键词：老能力有 keyword / query 两种写法
  const query = a.query ?? a.keyword ?? a.search ?? a.term;
  if (query !== undefined && query !== null && query !== "") params.query = query;
  // 分页
  const page = a.page ?? a.pageIndex;
  if (page !== undefined && page !== null) params.page = Number(page) || 1;
  const pageSize = a.pageSize ?? a.limit ?? a.perPage;
  if (pageSize !== undefined && pageSize !== null) params.pageSize = Number(pageSize) || 20;
  // 其余字段透传（style/prefix/mediaType/type/category/sort/resolution…）
  for (const [k, v] of Object.entries(a)) {
    if (
      ["query", "keyword", "search", "term", "page", "pageIndex", "pageSize", "limit", "perPage", "source", "platform"].includes(k)
    ) continue;
    if (v !== undefined && v !== null && v !== "") params[k] = v;
  }
  // 数据工具：工具名注入
  if (DATA_TOOL_NAMESPACES.has(namespace)) params.tool = namespace;
  return params;
}

/** 源结果 → 老能力信封（兼容 ImageEngine / MCP 既有消费方） */
function toLegacyEnvelope(
  namespace: string,
  action: string,
  args: any,
  data: any,
): any {
  if (action === "download") {
    return {
      query: String(args?.query ?? args?.keyword ?? ""),
      count: 1,
      items: [],
      links: [],
      page: 1,
      nextPage: null,
      ...(data || {}),
    };
  }
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  return {
    query: String(args?.query ?? args?.keyword ?? ""),
    count: items.length,
    total: data?.total ?? items.length,
    items,
    links: items.map((i: any) => i?.image || i?.url || i?.link || "").filter(Boolean),
    page: Number(args?.page ?? 1),
    nextPage: data?.next?.page ?? null,
  };
}

/** 从服务端拉源代码（带鉴权；内容 hash 即版本） */
async function fetchSourceCode(
  sourceId: string,
): Promise<{ code: string; version: string; meta: any } | null> {
  try {
    const base = (await getBackendApiBase()).replace(/\/+$/, "");
    // base 可能已含 /api（本地 DEV_REMOTE_API_BASE），也可能只有域名（远程）
    const prefix = /\/api$/i.test(base) ? base : `${base}/api`;
    const token = await getCurrentAccessToken();
    const url = `${prefix}/collect/sources/${encodeURIComponent(sourceId)}/code`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      console.warn(`[SourceBridge] 拉取源代码失败 ${sourceId}: HTTP ${res.status} (${url})`);
      return null;
    }
    const body = await res.json();
    const payload = (body && (body as any).data) || body;
    if (!payload?.code) {
      console.warn(`[SourceBridge] 源代码响应为空: ${sourceId}`);
      return null;
    }
    return { code: payload.code, version: payload.version, meta: payload.meta };
  } catch (err: any) {
    console.warn(`[SourceBridge] 拉取源代码异常 ${sourceId}:`, err?.message || err);
    return null;
  }
}

export interface SourceBridgeResult {
  handled: boolean;
  result?: any;
}

/**
 * 能力调用桥接入口。未命中源定义时 handled=false（走旧 handler）。
 */
export async function sourceBridgeCall(
  namespace: string,
  name: string,
  args: any,
): Promise<SourceBridgeResult> {
  const action = mapAction(name);
  if (!action) return { handled: false };

  const sourceId = resolveSourceId(namespace, args);
  if (!sourceId) return { handled: false };

  // status：直接由源 meta 应答，不跑任务
  if (action === "status") {
    const fetched = await fetchSourceCode(sourceId);
    if (!fetched?.meta) return { handled: false };
    return {
      handled: true,
      result: {
        success: true,
        data: {
          key: namespace,
          pluginKey: namespace,
          label: fetched.meta.name || namespace,
          connected: true,
          available: fetched.meta.available !== false,
          status: fetched.meta.available === false ? "error" : "connected",
          state: fetched.meta.available === false ? "offline" : "idle",
          busy: false,
          message:
            fetched.meta.available === false
              ? fetched.meta.unavailableReason || "当前不可用"
              : "采集引擎就绪（源定义来自服务端）",
          lastCheckedAt: new Date().toISOString(),
          lastError: null,
          supportedCommands: ["search", "download", "collect", "status"],
          details: {
            runtime: "collect-engine",
            sourceId,
            sourceVersion: fetched.version,
            engineVersion: COLLECT_ENGINE_VERSION,
          },
        },
      },
    };
  }

  const fetched = await fetchSourceCode(sourceId);
  if (!fetched?.code) return { handled: false };

  const params = mapParams(namespace, action, args);
  const runAction = action === "list" ? "list" : action;
  const result = await runCollectSource({
    sourceId,
    sourceVersion: fetched.version,
    code: fetched.code,
    action: runAction as any,
    params,
    meta: fetched.meta,
    secrets: {},
  });

  if (!result.success) {
    return {
      handled: true,
      result: { success: false, error: result.error || "采集执行失败" },
    };
  }
  return {
    handled: true,
    result: {
      success: true,
      data: toLegacyEnvelope(namespace, action, args, result.data),
    },
  };
}

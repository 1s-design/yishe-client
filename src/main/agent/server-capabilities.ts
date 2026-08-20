/**
 * 服务端能力目录客户端适配层。
 *
 * design-server 的 ai-assistant/client-agent/capabilities 是云端能力的单一事实来源。
 * 客户端 Agent 运行前拉取目录并缓存，选中服务端工具时调用
 * capabilities/execute 执行；需要确认的工具走两段式确认
 * （先 requires_confirmation，用户批准后带 confirmed=true 重发）。
 *
 * 客户端不复制任何云端工具实现，只消费目录 schema 与确认策略，因此新工具
 * 只需在服务端登记，客户端即可自动使用，无需改动客户端代码。
 */

import { requestDesignServer } from "./agent-config";
import type OpenAI from "openai";

export interface ServerCapabilityTool {
  id: string;
  name: string;
  label: string;
  description: string;
  category?: string;
  runtime: "server";
  readOnly: boolean;
  executionMode: "read_only" | "safe_write" | "confirm_required";
  riskLevel: "low" | "medium" | "high";
  confirmRequired: boolean;
  inputSchema: Record<string, unknown>;
  tags?: string[];
  available: boolean;
}

export interface ServerCapabilityCatalog {
  revision: string;
  total: number;
  generatedAt: string;
  tools: ServerCapabilityTool[];
}

export type ServerExecuteResult =
  | { status: "completed"; success: boolean; data?: unknown }
  | { status: "failed"; success: boolean; error?: string }
  | {
      status: "requires_confirmation";
      tool: string;
      label: string;
      riskLevel: string;
      question: string;
      input?: Record<string, unknown>;
    };

/** 服务端工具统一前缀，避免与本地能力命名空间冲突。 */
export const SERVER_TOOL_PREFIX = "server";

/** OpenAI function name 不允许 `.`，统一替换为下划线。 */
export function serverToolOpenAiName(toolName: string): string {
  return `${SERVER_TOOL_PREFIX}_${(toolName || "").replace(/\./g, "_")}`;
}

/** 将服务端原名转换为与本地 Capability 函数名可比较的身份。 */
export function capabilityIdentity(name: string): string {
  return String(name || "")
    .trim()
    .replace(/\./g, "_")
    .replace(/-/g, "_")
    .toLowerCase();
}

/**
 * 客户端本地能力优先：服务端目录中与本地能力同身份的定义不再挂给模型。
 * 这只是目录去重，不会删除或修改服务端真实工具。
 */
export function filterMissingServerCapabilities(
  catalog: ServerCapabilityCatalog,
  localToolNames: Iterable<string>,
): ServerCapabilityCatalog {
  const local = new Set(Array.from(localToolNames).map(capabilityIdentity));
  return {
    ...catalog,
    tools: (catalog.tools || []).filter(
      (tool) => !local.has(capabilityIdentity(tool.name)),
    ),
  };
}

interface ServerEndpointState {
  serverBase: string;
  token: string;
}

let endpointState: ServerEndpointState | null = null;
let cachedCatalog: ServerCapabilityCatalog | null = null;
let catalogFetchedAt = 0;

/** 目录拉取节流：两次拉取至少间隔该毫秒数（目录变更后由 sync 主动重置）。 */
const CATALOG_TTL_MS = 30_000;

/**
 * 更新服务端地址与认证信息。Renderer 同步云端配置时调用，保证能力目录
 * 使用与模型配置同一套登录态，用户切换账号后自动失效重建。
 */
export function setServerEndpoint(serverBase: string, token: string): void {
  const nextBase = String(serverBase || "").trim();
  const nextToken = String(token || "").trim();
  if (nextBase && nextToken) {
    endpointState = { serverBase: nextBase, token: nextToken };
    return;
  }
  if (!nextBase || !nextToken) {
    endpointState = null;
    cachedCatalog = null;
  }
}

export function getServerEndpoint(): ServerEndpointState | null {
  return endpointState;
}

/** 清除服务端登录态（用户登出时调用），避免残留目录被下一账号使用。 */
export function clearServerEndpoint(): void {
  endpointState = null;
  cachedCatalog = null;
  catalogFetchedAt = 0;
}

function getApiBase(): string {
  return (endpointState?.serverBase || "").replace(/\/+$/, "");
}

function isReady(): boolean {
  return Boolean(endpointState?.serverBase && endpointState?.token);
}

/**
 * 拉取云端能力目录。结果缓存 TTL 内复用；服务端绑定变更后由
 * invalidateServerCatalog 强制刷新。
 */
export async function fetchServerCapabilities(
  force = false,
): Promise<ServerCapabilityCatalog> {
  if (!isReady()) {
    return { revision: "", total: 0, generatedAt: "", tools: [] };
  }
  const now = Date.now();
  if (!force && cachedCatalog && now - catalogFetchedAt < CATALOG_TTL_MS) {
    return cachedCatalog;
  }

  const apiBase = getApiBase();
  const res = await requestDesignServer<unknown>(
    "GET",
    `${apiBase}/ai-assistant/client-agent/capabilities`,
    endpointState!.token,
  );
  const body = (res.data as any) || {};
  const catalog: ServerCapabilityCatalog | undefined =
    body.data || body.catalog || (Array.isArray(body.tools) ? body : undefined);
  if (!catalog || !Array.isArray(catalog.tools)) {
    throw new Error("服务端能力目录响应格式异常");
  }
  cachedCatalog = catalog;
  catalogFetchedAt = now;
  return catalog;
}

/** 目录有缓存时返回缓存的目录；无缓存或已过期时返回 null（由调用方决定是否强制拉取）。 */
export function peekServerCapabilities(): ServerCapabilityCatalog | null {
  if (!cachedCatalog) return null;
  if (Date.now() - catalogFetchedAt >= CATALOG_TTL_MS) return null;
  return cachedCatalog;
}

/** 服务端绑定/用户变更后强制下一次拉取全新目录。 */
export function invalidateServerCatalog(): void {
  cachedCatalog = null;
  catalogFetchedAt = 0;
}

/**
 * 执行服务端能力。read 工具直接执行；confirm_required 工具首次调用
 * 返回 requires_confirmation，由调用方确认后带 confirmed=true 重发。
 */
export async function executeServerCapability(
  toolName: string,
  input: Record<string, unknown>,
  confirmed = false,
): Promise<ServerExecuteResult> {
  if (!isReady()) {
    throw new Error("服务端连接未就绪，无法执行云端能力");
  }
  const apiBase = getApiBase();
  const res = await requestDesignServer<unknown>(
    "POST",
    `${apiBase}/ai-assistant/client-agent/capabilities/execute`,
    endpointState!.token,
    { tool: toolName, input, ...(confirmed ? { confirmed: true } : {}) },
  );
  const body = (res.data as any) || {};
  return (body.data || body) as ServerExecuteResult;
}

/** 将服务端能力目录转换为 OpenAI tools schema。 */
export function serverCapabilitiesToOpenAiTools(
  catalog: ServerCapabilityCatalog,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return (catalog.tools || [])
    .filter((tool) => tool && tool.name)
    .map((tool) => ({
      type: "function",
      function: {
        name: serverToolOpenAiName(tool.name),
        description: tool.description || `执行云端能力 ${tool.label}`,
        parameters: (tool.inputSchema || {
          type: "object",
          properties: {},
        }) as Record<string, unknown>,
      },
    }));
}

/** 判断某个 OpenAI 工具名是否由本模块托管（服务端能力）。 */
export function isServerToolName(name: string): boolean {
  return name.startsWith(`${SERVER_TOOL_PREFIX}_`);
}

/** 从 server 前缀名还原原始服务端工具名（目录名可能含下划线，不能简单取反，由目录索引解析）。 */
export function toOriginalToolName(name: string): string {
  return name.startsWith(`${SERVER_TOOL_PREFIX}_`)
    ? name.slice(SERVER_TOOL_PREFIX.length + 1)
    : name;
}

/** 按 OpenAI 工具名建立目录索引，精确还原原始工具定义。 */
export function buildServerToolIndex(
  catalog: ServerCapabilityCatalog | null,
): Map<string, ServerCapabilityTool> {
  const index = new Map<string, ServerCapabilityTool>();
  for (const tool of catalog?.tools || []) {
    if (tool && tool.name) {
      index.set(serverToolOpenAiName(tool.name), tool);
    }
  }
  return index;
}

/**
 * 服务端能力关键词表（用于 selectRelevantTools 从目录中挑选相关工具）。
 * 新工具若未命中关键词，在通用对话（相关工具 < 3）时仍会随 allTools 挂载。
 */
export const SERVER_TOOL_KEYWORDS: Record<string, string[]> = {
  // 服务端的只读账号、任务和健康检查能力属于 system 类别。若不在
  // 这里声明，selectRelevantTools 会把它们从 Agent 的工具集中过滤掉，
  // 导致客户端明明已经拉到了云端能力目录，却仍然回复“没有这个工具”。
  system: [
    "账号",
    "登录信息",
    "用户信息",
    "我的资料",
    "我的账户",
    "当前用户",
    "运行中任务",
    "任务队列",
    "服务状态",
    "健康状态",
    "system",
  ],
  workflow: ["工作流", "workflow", "节点", "执行流程", "流程图"],
  material: ["素材库", "素材记录", "贴纸", "图片素材", "material"],
  browser: [
    "浏览器",
    "打开网页",
    "打开网站",
    "访问网页",
    "采集",
    "抓取",
    "网页",
    "浏览器自动化",
    "browser",
  ],
  mcp: [
    "mcp",
    "客户端工具",
    "在线客户端",
    "连接 id",
    "热搜",
    "素材采集",
    "图片处理",
    "视频渲染",
    "hotsearch",
  ],
};

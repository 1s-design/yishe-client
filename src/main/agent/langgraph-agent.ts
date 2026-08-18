/**
 * 衣设客户端 LangGraph Agent Runtime。
 *
 * 这里把 Agent 明确拆成 LangGraph 风格的 agent -> tools -> agent 状态图：
 * - agent 节点负责模型流式输出与决定是否调用工具
 * - tools 节点负责调用本机 CapabilityRegistry
 * - 条件边在存在 tool_calls 时回到 agent，否则 END
 *
 * 运行在 Electron 主进程，Renderer 永远不会直接接触 API Key 或本机工具。
 */
import OpenAI from "openai";
import { CapabilityRegistry } from "../capabilities/registry";
import type { CapabilityCallContext } from "../capabilities/types";
import { hasTrustedGoogleArtZoom } from "../capabilities/googleArt";
import { zodToJsonSchema } from "../mcp-server/server";
import { getActiveAgentConfig, type ClientAgentConfig } from "./agent-config";
import {
  fetchServerCapabilities,
  executeServerCapability,
  isServerToolName,
  toOriginalToolName,
  serverCapabilitiesToOpenAiTools,
  buildServerToolIndex,
  SERVER_TOOL_KEYWORDS,
  type ServerCapabilityCatalog,
  type ServerCapabilityTool,
} from "./server-capabilities";

export interface AgentAttachment {
  id?: string;
  name?: string;
  filename?: string;
  mediaType?: string;
  url?: string;
  dataUrl?: string;
}

export interface AgentChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
  attachments?: AgentAttachment[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
  tool_calls?: any[];
}

export interface AgentStreamEvents {
  onReasoning?: (delta: string) => void;
  onContent?: (delta: string) => void;
  onToolApproval?: (toolCall: {
    id: string;
    name: string;
    args: any;
    riskLevel: "write" | "system";
    description?: string;
  }) => void;
  onToolStart?: (toolCall: { id: string; name: string; args: any }) => void;
  onToolEnd?: (toolResult: {
    id: string;
    name: string;
    result: any;
    durationMs: number;
    error?: string;
  }) => void;
  onComplete?: (fullText: string, fullReasoning: string) => void;
  onError?: (error: string) => void;
}

export function getCapabilityOpenAiTools(
  namespaces?: string[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const capabilities = CapabilityRegistry.list();
  const filtered = namespaces?.length
    ? capabilities.filter((item) => namespaces.includes(item.namespace))
    : capabilities;
  return filtered.map((capability) => {
    const definition = CapabilityRegistry.getDefinition(
      capability.namespace,
      capability.name,
    );
    return {
      type: "function",
      function: {
        name: `${capability.namespace}_${capability.name}`,
        description:
          capability.description ||
          `执行 ${capability.namespace} 的 ${capability.name} 操作`,
        parameters: definition
          ? zodToJsonSchema(definition.argsSchema)
          : { type: "object", properties: {} },
      },
    };
  });
}

/** 只向模型挂载与当前任务相关的工具，避免 178+ 工具撑爆上下文。 */
export function selectRelevantTools(
  prompt: string,
  allTools: OpenAI.Chat.Completions.ChatCompletionTool[],
  serverToolIndex?: Map<string, ServerCapabilityTool> | null,
) {
  const text = prompt.toLowerCase();
  const namespaces: Record<string, string[]> = {
    openmeteo: ["天气", "气温", "下雨", "温度", "weather"],
    coingecko: ["币价", "比特币", "btc", "eth", "crypto"],
    frankfurter: ["汇率", "货币", "usd", "cny", "eur"],
    dictionary: ["查词", "词典", "单词", "释义", "dictionary"],
    timeapi: ["时间", "时区", "几点", "time"],
    shopify: ["shopify", "独立站", "商品", "店铺"],
    arxiv: ["论文", "arxiv", "学术"],
    github: ["github", "开源", "仓库", "代码"],
    hackernews: ["hackernews", "科技新闻", "热帖", "hn"],
    svgrepo: ["svg", "矢量图", "图标", "icon", "剪贴画"],
    pexels: ["pexels", "摄影", "摄影图", "摄影照片", "photo"],
    pixabay: ["pixabay", "素材", "免费图片", "免版权图片"],
    wikimedia: [
      "wikimedia",
      "维基",
      "梵高",
      "名画",
      "画作",
      "绘画",
      "艺术作品",
      "公共领域",
    ],
    openverse: ["openverse", "开源素材", "艺术", "艺术品", "画作", "名画"],
    "google-icons": [
      "材料图标",
      "material icon",
      "google图标",
      "google icon",
      "material design",
    ],
    googleArt: [
      "googleart",
      "google art",
      "谷歌艺术",
      "名画",
      "画作",
      "绘画",
      "博物馆",
      "艺术品",
      "蒙娜丽莎",
      "梵高",
      "莫奈",
    ],
    iconify: ["iconify", "图标库", "图标集合"],
    nounproject: ["noun project", "nounproject", "名词图标", "图标"],
    emojipedia: ["emoji", "表情", "颜文字"],
    openmoji: ["openmoji", "开源表情"],
    openclipart: ["openclipart", "剪贴画", "clipart", "公共素材"],
    undraw: ["undraw", "插画", "illlustration", "占位图"],
    vecteezy: ["vecteezy", "矢量插画", "插画"],
    rawpixel: ["rawpixel", "rawpixel", "复古素材"],
    kaboompics: ["kaboompics", "素材", "免费图"],
    stocksnap: ["stocksnap", "免费摄影", "cc0图"],
    pinterest: ["pinterest", "pinterest图搜", "灵感图", "视觉搜索"],
    googlenews: ["googlenews", "google新闻", "国际新闻", "google news"],
    gdelt: ["gdelt", "全球新闻", "新闻事件"],
    reddit: ["reddit", "reddit热帖", "社区"],
    producthunt: ["producthunt", "产品发布", "新品"],
    theguardian: ["theguardian", "卫报", "英国新闻"],
    bbcnews: ["bbc", "bbc新闻", "英国广播"],
    npr: ["npr", "美国新闻", "公共广播"],
    techcrunch: ["techcrunch", "科技创业", "创投"],
    theverge: ["theverge", "科技媒体", "verge"],
    arstechnica: ["arstechnica", "科技评测"],
    mittechreview: ["mit", "麻省理工科技"],
    reuters: ["reuters", "路透社", "路透"],
    chinadaily: ["chinadaily", "中国日报", "china daily"],
    govcn: ["govcn", "中国政府", "gov.cn", "政务"],
    xinhuanet: ["新华网", "xinhua", "新华社"],
    thepaper: ["澎湃", "thepaper", "澎湃新闻"],
    "36kr": ["36kr", "36氪", "科技资讯"],
    huxiu: ["虎嗅", "huxiu", "深度商业"],
    wttr: ["wttr", "天气命令行", "weather"],
    joke: ["笑话", "段子", "joke"],
    ipify: ["ip", "ip地址", "公网ip"],
    sunrisesunset: ["日出日落", "sunrise", "sunset", "昼夜"],
    zippopotam: ["邮编", "zip", "邮政编码", "postal"],
    countryis: ["国家", "国旗", "country"],
    colorapi: ["颜色", "色值", "color", "hex"],
    erapi: ["erapi", "灵感", "句子"],
    fawazahmed: ["宗教经文", "bible", "quran"],
    filesystem: ["打开文件", "文件", "文件夹", "路径", "读文件", "写文件"],
    clipboard: ["剪贴板", "复制", "粘贴", "clipboard"],
    materialLibrary: [
      "上传素材库",
      "保存到素材库",
      "入库",
      "上传素材",
      "存到素材库",
      "素材库",
      "上传文件",
    ],
  };
  const selected = new Set(
    Object.entries(namespaces)
      .filter(([, words]) => words.some((word) => text.includes(word)))
      .map(([name]) => name),
  );
  // 常用且量小的工具常驻挂载，避免关键词不命中时被过滤。
  [
    "openmeteo",
    "svgrepo",
    "hackernews",
    "github",
    "googleArt",
    "wikimedia",
    "openverse",
    "pexels",
    "pixabay",
    "iconify",
    "google-icons",
    "pinterest",
    "materialLibrary",
  ].forEach((name) => selected.add(name));
  // 服务端能力：按目录里的 category 字段匹配关键词（客户端不复制工具实现）。
  // browser / mcp 是客户端最常用且数量有限的云端能力，始终挂载，
  // 避免「打开游览器」等拼写变体因关键词不命中而被排除。
  const ALWAYS_SERVER_CATEGORIES = ["browser", "mcp"];
  const selectedServerCategories = new Set(
    Object.entries(SERVER_TOOL_KEYWORDS)
      .filter(([, words]) => words.some((word) => text.includes(word)))
      .map(([category]) => category),
  );
  const relevant = allTools.filter((tool) => {
    const name = String((tool as any).function?.name || "");
    if (isServerToolName(name)) {
      const serverTool = serverToolIndex?.get(name);
      const category = serverTool?.category || name.split("_")[1] || "";
      return (
        selectedServerCategories.has(category) ||
        ALWAYS_SERVER_CATEGORIES.includes(category)
      );
    }
    return selected.has(name.split("_")[0]);
  });
  // 服务端工具排在末尾，slice(0,48) 时可能被本地工具挤掉；确保命中的服务端工具优先。
  if (
    relevant.some((tool) =>
      isServerToolName(String((tool as any).function?.name || "")),
    )
  ) {
    const ordered = allTools.filter(
      (tool) => !isServerToolName(String((tool as any).function?.name || "")),
    );
    const matchedServer = relevant.filter((tool) =>
      isServerToolName(String((tool as any).function?.name || "")),
    );
    const restServer = allTools.filter(
      (tool) =>
        isServerToolName(String((tool as any).function?.name || "")) &&
        !matchedServer.includes(tool),
    );
    return [...matchedServer, ...ordered, ...restServer].slice(0, 48);
  }
  // Google Arts 采集工作流（search → zoom → collect）与素材库上传必须始终可用：
  // 用户消息如「0」「1」等档位选择不命中任何关键词，会回退到全量截断，
  // googleArt 若排在第 48 位之后就会被挤出工具列表，模型将无法真正调用 collect。
  const prioritize = (tool: any) =>
    /^(googleArt|materialLibrary)_/.test(String(tool?.function?.name || ""));
  const prioritized = relevant.filter(prioritize);
  const rest = relevant.filter((tool) => !prioritize(tool));
  const result = [...prioritized, ...rest];
  if (result.length >= 3) return result.slice(0, 48);
  const fallback = allTools.filter(prioritize).concat(
    allTools.filter((tool) => !prioritize(tool)),
  );
  return fallback.slice(0, 48);
}

interface GraphState {
  messages: AgentChatMessage[];
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  iteration: number;
  finalText: string;
  finalReasoning: string;
  pendingToolCalls: Array<{ id: string; name: string; arguments: string }>;
  /** Google Arts 写工具的真实结果；用于替换模型自由发挥的最终成功/失败总结。 */
  googleArtCollectResults: Array<Record<string, any>>;
}

type GraphNode = (state: GraphState) => Promise<void>;

const MODEL_REQUEST_TIMEOUT_MS = 90_000;
const TOOL_CALL_TIMEOUT_MS = 60_000;
// 高清拼图 + COS 上传可能明显超过普通工具的 60 秒。
const GOOGLE_ART_COLLECT_TIMEOUT_MS = 10 * 60_000;

function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} 超时，请重试`)),
      timeoutMs,
    );
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 轻量的本地 StateGraph，API 形状对应 LangGraph 的节点/边/END 模式。 */
class ClientStateGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, (state: GraphState) => string>();

  addNode(name: string, node: GraphNode) {
    this.nodes.set(name, node);
    return this;
  }
  addConditionalEdges(name: string, resolver: (state: GraphState) => string) {
    this.edges.set(name, resolver);
    return this;
  }

  async invoke(initial: GraphState, start: string, signal: AbortSignal) {
    // The dependency is optional in the development image used by the legacy
    // client. When it is installed (package.json includes it), use the real
    // LangGraph StateGraph; the local runner below keeps older installations
    // bootable while dependencies are being installed.
    const official = this.loadOfficialGraph();
    if (official) {
      return official.invoke(initial, { signal });
    }

    const state = initial;
    let current = start;
    while (current !== "END" && !signal.aborted) {
      const node = this.nodes.get(current);
      if (!node) throw new Error(`LangGraph 节点不存在: ${current}`);
      await node(state);
      current = this.edges.get(current)?.(state) || "END";
    }
    return state;
  }

  private loadOfficialGraph() {
    try {
      // Keep the package name dynamic so electron-vite can still build the
      // legacy client before npm install has populated node_modules.
      const packageName = ["@langchain", "langgraph"].join("/");
      const { StateGraph } = require(packageName) as { StateGraph: any };
      const value = (_left: unknown, right: unknown) => right;
      const stateGraph = new StateGraph({
        channels: {
          messages: { value, default: () => [] },
          tools: { value, default: () => [] },
          iteration: { value, default: () => 0 },
          finalText: { value, default: () => "" },
          finalReasoning: { value, default: () => "" },
          pendingToolCalls: { value, default: () => [] },
          googleArtCollectResults: { value, default: () => [] },
        },
      });
      for (const [name, node] of this.nodes) {
        stateGraph.addNode(name, async (state: GraphState) => {
          await node(state);
          return state;
        });
      }
      stateGraph
        .addEdge("__start__", "agent")
        .addConditionalEdges("agent", (state: GraphState) =>
          state.pendingToolCalls.length && state.iteration < 8
            ? "tools"
            : "__end__",
        )
        .addEdge("tools", "agent");
      return stateGraph.compile();
    } catch {
      return null;
    }
  }
}

function openAiContent(message: AgentChatMessage) {
  if (message.role !== "user" || !message.attachments?.length)
    return message.content;
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];
  if (typeof message.content === "string" && message.content)
    content.push({ type: "text", text: message.content });
  for (const attachment of message.attachments) {
    if (
      attachment.mediaType?.startsWith("image/") &&
      (attachment.dataUrl || attachment.url)
    ) {
      content.push({
        type: "image_url",
        image_url: { url: attachment.dataUrl || attachment.url! },
      });
    } else {
      content.push({
        type: "text",
        text: `[附件: ${attachment.name || attachment.filename || "未命名文件"}]`,
      });
    }
  }
  return content.length ? content : message.content;
}

function openAiMessages(messages: AgentChatMessage[]) {
  return messages.map((message) => {
    const normalized: Record<string, unknown> = {
      role: message.role,
      content: openAiContent(message),
      name: message.name,
      tool_call_id: message.tool_call_id,
      tool_calls: message.tool_calls,
    };

    // DeepSeek / Qwen 等带思考过程的兼容模型在工具调用后要求把
    // reasoning_content 原样带回。漏传会让下一轮工具结果请求变成笼统的
    // “Unknown error”。普通模型没有该字段时不会额外发送。
    if (message.role === "assistant" && message.reasoning_content) {
      normalized.reasoning_content = message.reasoning_content;
    }

    return normalized;
  }) as any;
}

/**
 * UI 保留完整工具结果；发回模型时仅保留下载/下一步所需的前几项，
 * 避免图片搜索工具的大量 URL、描述和元数据撑爆下一轮上下文。
 */
function serializeToolResultForModel(result: unknown) {
  const value = result as any;
  if (!value || typeof value !== "object") return JSON.stringify(result);

  const data = value.data;
  const hasDataEnvelope = !!data && typeof data === "object";
  // 本地能力既有 { success, data }，也有 { success, items } 两种返回形状。
  // 两者都必须压缩，否则 Google Arts 搜索的 20+ 条 URL 会整包回灌模型。
  const source = hasDataEnvelope ? data : value;
  const compact = { ...source } as Record<string, unknown>;
  if (Array.isArray(compact.items)) {
    compact.items = compact.items.slice(0, 8).map((item: any) => ({
      resultIndex: item?.resultIndex,
      id: item?.id,
      title: item?.title,
      image: item?.image || item?.downloadUrl,
      thumbnail: item?.thumbnail,
      url: item?.url || item?.link,
      author: item?.author || item?.photographer,
      artist: item?.artist,
      institution: item?.institution,
      license: item?.license,
    }));
  }
  if (Array.isArray(compact.links)) compact.links = compact.links.slice(0, 8);
  if (Array.isArray(compact.images))
    compact.images = compact.images.slice(0, 8);

  const payload = hasDataEnvelope ? { ...value, data: compact } : compact;
  const serialized = JSON.stringify(payload);
  if (serialized.length <= 16_000) return serialized;

  return JSON.stringify({
    success: value.success !== false,
    error: value.error,
    data: {
      query: compact.query,
      count: compact.count,
      items: Array.isArray(compact.items) ? compact.items.slice(0, 4) : [],
    },
    truncated: true,
  });
}

function toolResultError(
  result: unknown,
  outerError?: string,
): string | undefined {
  if (outerError) return outerError;
  if (!result || typeof result !== "object") return undefined;
  const value = result as Record<string, any>;
  if (value.success === false || value.ok === false) {
    return String(value.error || value.msg || "工具执行失败");
  }
  return undefined;
}

/**
 * collect 之后不让模型自由生成“成功/路径”等事实，直接用工具结果生成最终结论。
 * 这是展示层的最后一道防线：即使模型无视 system prompt，也无法谎报入库成功。
 */
function formatGoogleArtCollectResult(result: Record<string, any>): string {
  const success =
    result.success === true &&
    result.ok === true &&
    result.materialLibraryOk === true;
  const title = result.title ? `《${String(result.title)}》` : "该作品";
  if (!success) {
    const detail = String(result.error || result.msg || "未知错误");
    const prefix = result.cancelled
      ? "已取消 Google Arts 采集"
      : result.downloaded
        ? "Google Arts 图片已下载，但素材库入库失败"
        : "Google Arts 采集失败";
    return `${prefix}：${detail}`;
  }

  const lines = [`已成功采集 ${title} 并写入素材库。`];
  if (result.materialId != null) {
    lines.push(`素材记录 ID：${String(result.materialId)}`);
  }
  if (result.filePath) {
    const safePath = String(result.filePath).replace(/`/g, "\\`");
    lines.push(`本地文件：\`${safePath}\``);
  }
  return lines.join("\n");
}

/** 会话中是否存在尚未被消费的有效 Google Arts zoom 结果。 */
function hasTrustedGoogleArtZoomForAgent(
  context?: CapabilityCallContext | string,
): boolean {
  return hasTrustedGoogleArtZoom(context);
}

/** 模型最终文本里是否声称“采集/入库成功”（含假路径、假尺寸）。 */
function textClaimsGoogleArtCollectSuccess(text: string): boolean {
  if (!text) return false;
  const successClaims =
    /(已入库|入库成功|已成功采集|采集成功|下载成功|已保存到素材库|写入素材库|成功保存|已入库到|已添加到素材库|已上传至素材库|成功上传到素材库)/;
  const pathOrLibrary =
    /(\/[^\s]+\/[^\s]+\.(jpg|jpeg|png|webp))|(素材库|materialLibrary)/i;
  const fakeSize =
    /(文件大小|fileSize|KB|MB).*(文件路径|path|本地文件)/;
  return (
    successClaims.test(text) &&
    (pathOrLibrary.test(text) || fakeSize.test(text))
  );
}

/**
 * 会话里已有可信 zoom（用户明确选了作品与档位），但本轮模型没有真正调用 collect
 * 却声称采集成功。此时不能用任何模型编造的事实，必须给出确定性说明。
 */
function formatCollectNotExecutedMessage(
  executionContext: CapabilityCallContext | undefined,
  collectResults: Array<Record<string, any>>,
): string {
  const hasZoom = !!(
    executionContext && hasTrustedGoogleArtZoomForAgent(executionContext)
  );
  const failedBefore = collectResults.some((r) => r?.success === false);
  if (!hasZoom) {
    return "当前会话没有有效的作品分辨率（zoom）结果。请先用 googleArt.search 选择作品、用 googleArt.zoom 获取分辨率档位，再调用 googleArt.collect 才能真正下载入库。";
  }
  if (failedBefore) {
    return "googleArt.collect 刚才执行失败，尚未生成素材库记录；我没有编造文件路径或入库成功。如需重试，请再确认一次要采集的作品与档位。";
  }
  return "检测到你提到的“已入库/采集成功”，但本轮并没有真正执行 googleArt.collect，也没有生成素材库记录，因此不会报告文件路径或入库成功。请确认要采集的作品与分辨率档位，我再真正执行 collect。";
}

/**
 * 前置拦截：当用户消息只是一个数字（选择 zoom 档位），且会话中存在
 * 已验证的 zoom 结果时，直接执行 googleArt.collect，跳过模型调用。
 *
 * 背景：模型经常不调用 collect 工具，而是直接输出"已成功入库..."的
 * 编造文本，事后 guard 只能替换文字、无法真正下载。
 */
async function tryAutoCollectZoomLevel(
  current: GraphState,
  events: AgentStreamEvents,
  executionContext?: CapabilityCallContext,
): Promise<boolean> {
  try {
    // 1. 检查是否是纯数字消息（允许空白）
    const lastUser = [...current.messages].reverse().find((m) => m.role === "user");
    const userText = typeof lastUser?.content === "string" ? lastUser.content.trim() : "";
    if (!/^-?\d+$/.test(userText)) return false;

    // 2. 检查是否有可信 zoom
    const { prepareGoogleArtCollect, hasTrustedGoogleArtZoom } = await import(
      "../capabilities/googleArt"
    );
    if (!hasTrustedGoogleArtZoom(executionContext)) return false;

    // 3. 校验数字是否匹配可用档位
    const zoomLevel = Number(userText);
    const preview = prepareGoogleArtCollect(executionContext, zoomLevel);
    if (!preview.ok) return false;

    // 4. 直接执行 collect
    const callId = `auto_collect_${Date.now()}`;
    events.onToolStart?.({
      id: callId,
      name: "googleArt.collect",
      args: { zoomLevel },
    });
    const startedAt = Date.now();
    const result = await withTimeout(
      CapabilityRegistry.call("googleArt", "collect", { zoomLevel }, executionContext),
      GOOGLE_ART_COLLECT_TIMEOUT_MS,
      "googleArt.collect (auto)",
    );
    current.googleArtCollectResults.push(result as Record<string, any>);
    const reportedError = toolResultError(result, undefined);
    events.onToolEnd?.({
      id: callId,
      name: "googleArt.collect",
      result,
      durationMs: Date.now() - startedAt,
      error: reportedError,
    });
    current.messages.push({
      role: "assistant",
      content: "",
      tool_calls: [{
        id: callId,
        type: "function" as const,
        function: { name: "googleArt.collect", arguments: JSON.stringify({ zoomLevel }) },
      }],
    });
    current.messages.push({
      role: "tool",
      tool_call_id: callId,
      name: "googleArt.collect",
      content: serializeToolResultForModel(result),
    });
    return true;
  } catch {
    return false;
  }
}

export class ClientLangGraphAgent {
  private abortController: AbortController | null = null;
  private readonly pendingApprovals = new Map<
    string,
    (approved: boolean) => void
  >();
  private readonly maxIterations = 8;
  /** HTTP API 调用时自动批准所有写操作，无需人工确认 */
  autoApproveWrite = false;

  abort() {
    this.abortController?.abort();
    this.abortController = null;
    for (const resolve of this.pendingApprovals.values()) resolve(false);
    this.pendingApprovals.clear();
  }

  resolveToolApproval(callId: string, approved: boolean) {
    const resolve = this.pendingApprovals.get(callId);
    if (!resolve) return false;
    this.pendingApprovals.delete(callId);
    resolve(approved);
    return true;
  }

  private waitForToolApproval(callId: string, signal: AbortSignal) {
    return new Promise<boolean>((resolve) => {
      const finish = (approved: boolean) => {
        signal.removeEventListener("abort", onAbort);
        this.pendingApprovals.delete(callId);
        resolve(approved);
      };
      const onAbort = () => finish(false);
      this.pendingApprovals.set(callId, finish);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * 执行服务端能力工具。需要确认的 read/write 之外工具先弹确认卡，
   * 用户批准后带 confirmed=true 重发；服务端仍返回 requires_confirmation
   * 时（目录与运行时策略不一致）以服务端返回为准，二次确认。
   */
  private async runServerTool(
    call: { id: string; name: string; arguments: string },
    args: Record<string, unknown>,
    current: GraphState,
    events: AgentStreamEvents,
    signal: AbortSignal,
    serverToolIndex: Map<string, ServerCapabilityTool> | null,
  ): Promise<void> {
    const catalogTool = serverToolIndex?.get(call.name) || null;
    const toolName = catalogTool
      ? catalogTool.name
      : toOriginalToolName(call.name);
    const needsApproval =
      catalogTool?.confirmRequired === true ||
      catalogTool?.riskLevel === "high";

    if (needsApproval) {
      events.onToolApproval?.({
        id: call.id,
        name: call.name,
        args,
        riskLevel: catalogTool?.riskLevel === "high" ? "system" : "write",
        description: catalogTool?.description || `执行云端能力 ${toolName}`,
      });
      const approved = await this.waitForToolApproval(call.id, signal);
      if (!approved) {
        const result = {
          success: false,
          error: "用户取消了本次工具执行",
          cancelled: true,
        };
        events.onToolEnd?.({
          id: call.id,
          name: call.name,
          result,
          durationMs: 0,
          error: result.error,
        });
        current.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: serializeToolResultForModel(result),
        });
        return;
      }
    }

    events.onToolStart?.({ id: call.id, name: call.name, args });
    const startedAt = Date.now();
    let result: unknown;
    let error: string | undefined;
    try {
      result = await withTimeout(
        executeServerCapability(toolName, args, needsApproval),
        TOOL_CALL_TIMEOUT_MS,
        `云端能力 ${call.name}`,
      );
      // 服务端仍要求确认（目录与运行时策略不一致），以服务端 question 二次弹卡。
      if (
        result &&
        typeof result === "object" &&
        (result as any).status === "requires_confirmation"
      ) {
        const pending = result as {
          tool: string;
          label: string;
          question: string;
        };
        events.onToolApproval?.({
          id: call.id,
          name: call.name,
          args,
          riskLevel: "write",
          description: pending.question || `执行云端能力 ${pending.label}`,
        });
        const approved = await this.waitForToolApproval(call.id, signal);
        if (!approved) {
          result = {
            success: false,
            error: "用户取消了本次工具执行",
            cancelled: true,
          };
        } else {
          result = await withTimeout(
            executeServerCapability(toolName, args, true),
            TOOL_CALL_TIMEOUT_MS,
            `云端能力 ${call.name}`,
          );
        }
      }
    } catch (cause: any) {
      error = cause?.message || "云端能力执行发生异常";
      result = { success: false, error };
    }
    events.onToolEnd?.({
      id: call.id,
      name: call.name,
      result,
      durationMs: Date.now() - startedAt,
      error,
    });
    current.messages.push({
      role: "tool",
      tool_call_id: call.id,
      name: call.name,
      content: serializeToolResultForModel(result),
    });
  }

  async run(
    historyMessages: AgentChatMessage[],
    events: AgentStreamEvents,
    customConfig?: Partial<ClientAgentConfig>,
    executionContext?: CapabilityCallContext,
  ) {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const config = { ...getActiveAgentConfig(), ...(customConfig || {}) };
    if (!config.enabled) {
      const error =
        "未绑定客户端 Agent 模型。请在服务端的「已绑定 · 客户端 Agent」中完成配置。";
      events.onError?.(error);
      throw new Error(error);
    }
    if (!config.apiKey && !/localhost|127\.0\.0\.1/.test(config.baseUrl)) {
      const error =
        "客户端 Agent 未获取到模型密钥，请重新登录后同步服务端配置。";
      events.onError?.(error);
      throw new Error(error);
    }

    const client = new OpenAI({
      apiKey: config.apiKey || "ollama",
      baseURL: config.baseUrl,
      dangerouslyAllowBrowser: true,
      timeout: MODEL_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });
    const allTools = getCapabilityOpenAiTools();
    // 合并服务端能力目录（只读消费，不复制实现）。目录拉取失败时降级为仅本地能力。
    let serverCatalog: ServerCapabilityCatalog | null = null;
    let serverToolIndex: Map<string, ServerCapabilityTool> | null = null;
    try {
      serverCatalog = await fetchServerCapabilities();
      if (serverCatalog?.tools?.length) {
        // Google Arts 必须走本地的会话级可信工作流。旧服务端/MCP 目录可能仍
        // 暴露接收任意 URL 的同名工具，不能同时挂给模型形成绕过路径。
        const safeServerCatalog = {
          ...serverCatalog,
          tools: serverCatalog.tools.filter((tool) => {
            const identity = [
              tool.name,
              tool.label,
              tool.description,
              ...(tool.tags || []),
            ]
              .join(" ")
              .toLowerCase();
            return !/google[\s._-]*art|谷歌艺术/.test(identity);
          }),
        };
        allTools.push(...serverCapabilitiesToOpenAiTools(safeServerCatalog));
        serverToolIndex = buildServerToolIndex(safeServerCatalog);
      }
    } catch (error: any) {
      console.warn(
        "[Agent] 拉取服务端能力目录失败，本次仅使用本地能力:",
        error?.message || error,
      );
    }
    const lastUser = [...historyMessages]
      .reverse()
      .find((message) => message.role === "user");
    const state: GraphState = {
      messages: [
        { role: "system", content: config.systemPrompt },
        ...historyMessages,
      ],
      tools: selectRelevantTools(
        typeof lastUser?.content === "string" ? lastUser.content : "",
        allTools,
        serverToolIndex,
      ),
      iteration: 0,
      finalText: "",
      finalReasoning: "",
      pendingToolCalls: [],
      googleArtCollectResults: [],
    };

    const graph = new ClientStateGraph()
      .addNode("agent", async (current) => {
        current.iteration += 1;
        current.pendingToolCalls = [];

        // ── 前置检查：用户选了档位数字时直接执行 collect，跳过模型 ──
        // 模型常在应当调用 googleArt.collect 时改为输出"已成功"的文字，
        // 触发事后纠偏也无法真正下载。这里拦截数字回复并代为执行。
        if (current.iteration === 1 || current.googleArtCollectResults.length === 0) {
          const autoCollected = await tryAutoCollectZoomLevel(current, events, executionContext);
          if (autoCollected) {
            current.finalText = formatGoogleArtCollectResult(
              current.googleArtCollectResults[current.googleArtCollectResults.length - 1],
            );
            current.messages.push({
              role: "assistant",
              content: current.finalText,
            });
            return;
          }
        }

        const mustGroundGoogleArtCollect =
          current.googleArtCollectResults.length > 0;
        // 会话中有已验证的 zoom（用户已选作品）但本回合从未真正执行过 collect，
        // 模型若在最终输出里声称“已入库/采集成功”，视为编造，需要兜底纠偏。
        const hasTrustedZoom = (() => {
          try {
            return (
              hasTrustedGoogleArtZoomForAgent(executionContext) === true
            );
          } catch {
            return false;
          }
        })();
        const mustGuardCollectClaim =
          !mustGroundGoogleArtCollect &&
          hasTrustedZoom &&
          !current.googleArtCollectResults.some(
            (result) => result?.success === true,
          );
        const bufferOutput =
          mustGroundGoogleArtCollect || mustGuardCollectClaim;
        const stream = await client.chat.completions.create(
          {
            model: config.model || "deepseek-chat",
            messages: openAiMessages(current.messages),
            tools: current.tools.length ? current.tools : undefined,
            temperature: config.temperature ?? 0.7,
            max_tokens: config.maxTokens ?? 4096,
            stream: true,
          },
          { signal },
        );
        let text = "";
        let reasoning = "";
        const calls: Record<
          number,
          { id: string; name: string; arguments: string }
        > = {};
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta as any;
          if (!delta) continue;
          const reasoningDelta =
            delta.reasoning_content || delta.reasoning || "";
          if (reasoningDelta) {
            reasoning += reasoningDelta;
            if (!bufferOutput) {
              current.finalReasoning += reasoningDelta;
              events.onReasoning?.(reasoningDelta);
            }
          }
          if (delta.content) {
            text += delta.content;
            if (!bufferOutput) {
              current.finalText += delta.content;
              events.onContent?.(delta.content);
            }
          }
          for (const toolCall of delta.tool_calls || []) {
            const index = toolCall.index ?? 0;
            calls[index] ||= {
              id: toolCall.id || `call_${Date.now()}_${index}`,
              name: "",
              arguments: "",
            };
            if (toolCall.id) calls[index].id = toolCall.id;
            if (toolCall.function?.name)
              calls[index].name = toolCall.function.name;
            if (toolCall.function?.arguments)
              calls[index].arguments += toolCall.function.arguments;
          }
        }
        current.pendingToolCalls = Object.values(calls).filter(
          (call) => call.name,
        );
        const isFinalTurn = current.pendingToolCalls.length === 0;
        if (mustGroundGoogleArtCollect && isFinalTurn) {
          text = formatGoogleArtCollectResult(
            current.googleArtCollectResults[
              current.googleArtCollectResults.length - 1
            ],
          );
          current.finalText += text;
          events.onContent?.(text);
        } else if (mustGuardCollectClaim && isFinalTurn) {
          // 模型没调 collect 却声称采集成功——这是编造，用确定性提示覆盖。
          if (textClaimsGoogleArtCollectSuccess(text)) {
            text = formatCollectNotExecutedMessage(
              executionContext,
              current.googleArtCollectResults,
            );
          }
          current.finalText += text;
          events.onContent?.(text);
        } else if (bufferOutput && !isFinalTurn) {
          // 缓冲期间若模型仍发起工具调用（如重新 zoom/search），把过渡文本补发。
          if (text) {
            current.finalText += text;
            events.onContent?.(text);
          }
        }
        current.messages.push({
          role: "assistant",
          content: text,
          reasoning_content: reasoning || undefined,
          tool_calls: current.pendingToolCalls.length
            ? current.pendingToolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              }))
            : undefined,
        });
      })
      .addNode("tools", async (current) => {
        for (const call of current.pendingToolCalls) {
          if (signal.aborted) return;
          let args: Record<string, unknown> = {};
          try {
            args = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            /* model can emit partial JSON */
          }

          if (isServerToolName(call.name)) {
            await this.runServerTool(
              call,
              args,
              current,
              events,
              signal,
              serverToolIndex,
            );
            continue;
          }

          const separator = call.name.indexOf("_");
          const namespace = separator > 0 ? call.name.slice(0, separator) : "";
          const capabilityName =
            separator > 0 ? call.name.slice(separator + 1) : "";
          const definition = namespace
            ? CapabilityRegistry.getDefinition(namespace, capabilityName)
            : undefined;
          const isGoogleArtCollect =
            namespace === "googleArt" && capabilityName === "collect";
          // collect 不再信任模型传入 URL。确认前按 sessionId 读取最后一次成功 zoom
          // 的主进程可信状态，并校验用户选择的档位。
          if (isGoogleArtCollect) {
            const { prepareGoogleArtCollect } = await import(
              "../capabilities/googleArt"
            );
            const preview = prepareGoogleArtCollect(
              executionContext,
              args?.zoomLevel,
            );
            if (!preview.ok) {
              const result = {
                success: false,
                ok: false,
                materialLibraryOk: false,
                downloaded: false,
                filePath: null,
                error: preview.error,
                msg: preview.error,
              };
              current.googleArtCollectResults.push(result);
              events.onToolEnd?.({
                id: call.id,
                name: call.name,
                result,
                durationMs: 0,
                error: preview.error,
              });
              current.messages.push({
                role: "tool",
                tool_call_id: call.id,
                name: call.name,
                content: serializeToolResultForModel(result),
              });
              continue;
            }
            // 确认卡展示的作品信息来自可信状态，不来自模型参数。
            args = {
              zoomLevel: preview.zoomLevel,
              artwork: {
                title: preview.title,
                artist: preview.artist,
                originUrl: preview.url,
                width: preview.width,
                height: preview.height,
                tiles: preview.tiles,
              },
            };
          }
          if (
            definition &&
            (definition.riskLevel === "write" ||
              definition.riskLevel === "system")
          ) {
            events.onToolApproval?.({
              id: call.id,
              name: call.name,
              args,
              riskLevel: definition.riskLevel,
              description: definition.description,
            });
            // 自动审批模式（HTTP API）直接放行
            if (this.autoApproveWrite) {
              // 继续执行，approved = true
            } else {
              const approved = await this.waitForToolApproval(call.id, signal);
              if (!approved) {
              const result = {
                success: false,
                ok: false,
                materialLibraryOk: false,
                downloaded: false,
                filePath: null,
                error: "用户取消了本次工具执行",
                cancelled: true,
              };
              if (isGoogleArtCollect) {
                current.googleArtCollectResults.push(result);
              }
              events.onToolEnd?.({
                id: call.id,
                name: call.name,
                result,
                durationMs: 0,
                error: result.error,
              });
              current.messages.push({
                role: "tool",
                tool_call_id: call.id,
                name: call.name,
                content: serializeToolResultForModel(result),
              });
              continue;
            }
          }
          }

          events.onToolStart?.({ id: call.id, name: call.name, args });
          const startedAt = Date.now();
          let result: unknown;
          let error: string | undefined;
          try {
            if (separator < 1)
              throw new Error(`未知工具名称格式: ${call.name}`);
            result = await withTimeout(
              CapabilityRegistry.call(
                namespace,
                capabilityName,
                args,
                executionContext,
              ),
              isGoogleArtCollect
                ? GOOGLE_ART_COLLECT_TIMEOUT_MS
                : TOOL_CALL_TIMEOUT_MS,
              `工具 ${call.name}`,
            );
          } catch (cause: any) {
            error = cause?.message || "工具执行发生异常";
            result = { success: false, error };
          }
          if (isGoogleArtCollect && result && typeof result === "object") {
            current.googleArtCollectResults.push(result as Record<string, any>);
          }
          const reportedError = toolResultError(result, error);
          events.onToolEnd?.({
            id: call.id,
            name: call.name,
            result,
            durationMs: Date.now() - startedAt,
            error: reportedError,
          });
          current.messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: serializeToolResultForModel(result),
          });
        }
      })
      .addConditionalEdges("agent", (current) =>
        current.pendingToolCalls.length &&
        current.iteration < this.maxIterations
          ? "tools"
          : "END",
      )
      .addConditionalEdges("tools", () => "agent");

    try {
      const result = await graph.invoke(state, "agent", signal);
      events.onComplete?.(result.finalText, result.finalReasoning);
      return {
        text: result.finalText,
        reasoning: result.finalReasoning,
        messages: result.messages,
      };
    } catch (error: any) {
      if (error?.name === "AbortError" || signal.aborted) {
        events.onComplete?.(state.finalText, state.finalReasoning);
        return {
          text: state.finalText,
          reasoning: state.finalReasoning,
          messages: state.messages,
        };
      }
      events.onError?.(error?.message || "Agent 执行过程发生错误");
      throw error;
    }
  }
}

export const clientLangGraphAgent = new ClientLangGraphAgent();

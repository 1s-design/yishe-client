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
import { registerAllCapabilities } from "../capabilities";
import type { CapabilityCallContext } from "../capabilities/types";
import { hasTrustedGoogleArtZoom } from "../capabilities/googleArt";
import { zodToJsonSchema } from "../mcp-server/server";
import { getActiveAgentConfig, type ClientAgentConfig } from "./agent-config";
import {
  fetchServerCapabilities,
  executeServerCapability,
  isServerToolName,
  serverToolOpenAiName,
  toOriginalToolName,
  serverCapabilitiesToOpenAiTools,
  buildServerToolIndex,
  filterMissingServerCapabilities,
  SERVER_TOOL_KEYWORDS,
  type ServerCapabilityCatalog,
  type ServerCapabilityTool,
} from "./server-capabilities";

export interface AgentSelectedTool {
  /** 工具的原始能力名，例如 material.sticker.search。 */
  name: string;
  /** 选择时看到的运行位置，仅用于诊断与兼容旧会话。 */
  source?: "client" | "server";
  label?: string;
}

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
  /** 能力库“添加到对话”时显式绑定的工具。该信息持久化在会话中，不能只依赖模型记忆。 */
  selectedTools?: AgentSelectedTool[];
  /** true 表示这条消息只是选择工具，尚未提交业务参数。 */
  toolSelectionOnly?: boolean;
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
  // Agent 可能在 app.whenReady 的异步注册完成前收到第一条消息，
  // 这里幂等补注册，避免 googleArt 等工具只出现在 MCP 目录而不在 Agent 工具集中。
  registerAllCapabilities();
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
  explicitToolNames: string[] = [],
) {
  const text = prompt.toLowerCase();
  const explicitOpenAiNames = new Set(
    explicitToolNames
      .map((name) => String(name || "").trim())
      .filter(Boolean)
      .flatMap((name) => [
        name.replace(/\./g, "_"),
        `server_${name.replace(/\./g, "_")}`,
      ]),
  );
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
  // 服务端全部工具只有 20~30 个，且是衣设平台最核心的业务功能，始终挂载保证模型随时可调用。
  const ALWAYS_SERVER_CATEGORIES = [
    "material",
    "product",
    "publish",
    "workflow",
    "system",
    "browser",
    "mcp",
  ];
  const selectedServerCategories = new Set(
    Object.entries(SERVER_TOOL_KEYWORDS)
      .filter(([, words]) => words.some((word) => text.includes(word)))
      .map(([category]) => category),
  );
  const relevant = allTools.filter((tool) => {
    const name = String((tool as any).function?.name || "");
    if (explicitOpenAiNames.has(name)) return true;
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
  const matchedServer = relevant.filter((tool) =>
    isServerToolName(String((tool as any).function?.name || "")),
  );
  const matchedLocal = relevant.filter(
    (tool) => !isServerToolName(String((tool as any).function?.name || "")),
  );

  // 命中的服务端业务能力和本地能力优先
  const prioritized = [...matchedServer, ...matchedLocal];
  if (prioritized.length >= 3) {
    return prioritized.slice(0, 48);
  }

  const restServer = allTools.filter(
    (tool) =>
      isServerToolName(String((tool as any).function?.name || "")) &&
      !prioritized.includes(tool),
  );
  const restLocal = allTools.filter(
    (tool) =>
      !isServerToolName(String((tool as any).function?.name || "")) &&
      !prioritized.includes(tool),
  );
  return [...prioritized, ...restServer, ...restLocal].slice(0, 48);
}

/**
 * 从持久化会话恢复能力库中“添加到对话”的显式工具选择。
 * 旧版本的选择消息没有结构化字段，仍兼容其文本格式，避免升级后丢失上下文。
 */
function getSelectedToolsForTurn(
  messages: AgentChatMessage[],
): AgentSelectedTool[] {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    if (Array.isArray(message.selectedTools) && message.selectedTools.length) {
      return message.selectedTools.filter((item) => item?.name);
    }
    if (typeof message.content !== "string") continue;
    const legacy = message.content.match(
      /请使用以下工具帮我完成任务：([^。\n]+)[。！!]*/,
    );
    if (legacy?.[1]) {
      return legacy[1]
        .split(/[、,，]/)
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name }));
    }
  }
  return [];
}

function isToolSelectionOnlyMessage(message?: AgentChatMessage): boolean {
  if (!message || message.role !== "user") return false;
  if (message.toolSelectionOnly) return true;
  return (
    typeof message.content === "string" &&
    /请使用以下工具帮我完成任务：/.test(message.content)
  );
}

/**
 * 对显式选中的“搜索”工具做确定性参数映射。用户第二句仅输入“猫咪”也应真正搜索，
 * 不能把工具名丢给模型猜，更不能退化为本地不存在的同名能力。
 */
function buildExplicitSearchToolCall(
  current: GraphState,
  selectedTools: AgentSelectedTool[],
  allTools: OpenAI.Chat.Completions.ChatCompletionTool[],
): { id: string; name: string; arguments: string } | null {
  const last = current.messages[current.messages.length - 1];
  if (
    !last ||
    isToolSelectionOnlyMessage(last) ||
    typeof last.content !== "string"
  )
    return null;
  const text = last.content.trim();
  if (!text || selectedTools.length !== 1) return null;
  const selectedName = String(selectedTools[0]?.name || "").trim();
  if (!/(?:^|[._])search(?:$|[._])|搜索/i.test(selectedName)) return null;

  const tool = findExplicitOpenAiTool(selectedTools[0], allTools);
  if (!tool) return null;
  const functionTool = tool as any;
  const properties = ((functionTool.function?.parameters as any)?.properties ||
    {}) as Record<string, unknown>;
  // 某些 zod-to-json-schema 版本会把能力参数放进 $ref/definitions，
  // 使顶层没有 properties。显式选择不能因此退化成“云端工具不可用”，
  // 对常见搜索能力提供稳定的参数键兜底。
  const fallbackKeys: Record<string, string> = {
    openmeteo: "city",
    dictionary: "word",
    timeapi: "timezone",
    zippopotam: "postcode",
    countryis: "ip",
    colorapi: "hex",
  };
  const keywordKey =
    [
      "keyword",
      "query",
      "q",
      "search",
      "location",
      "city",
      "name",
      "text",
    ].find((key) => key in properties) ||
    fallbackKeys[selectedName.split(/[._]/)[0]] ||
    "query";

  const keyword = text
    .replace(
      /^(?:请|帮我|帮忙)?(?:搜索|搜一下|搜|查找|查一下|查|找一下|找)\s*/i,
      "",
    )
    .replace(/[。！？!?]+$/, "")
    .trim();
  if (!keyword) return null;
  const args: Record<string, unknown> = { [keywordKey]: keyword };
  const count = keyword.match(/(?:前|共|要)?\s*(\d{1,2})\s*(?:个|条|张)/)?.[1];
  if (count) {
    const sizeKey = ["pageSize", "limit", "maxCount", "count"].find(
      (key) => key in properties,
    );
    if (sizeKey) args[sizeKey] = Number(count);
  }
  return {
    id: `explicit_${functionTool.function.name}_${Date.now()}`,
    name: functionTool.function.name,
    arguments: JSON.stringify(args),
  };
}

function findExplicitOpenAiTool(
  selectedTool: AgentSelectedTool,
  allTools: OpenAI.Chat.Completions.ChatCompletionTool[],
): OpenAI.Chat.Completions.ChatCompletionTool | null {
  const selectedName = String(selectedTool?.name || "").trim();
  if (!selectedName) return null;
  const candidates = [
    selectedName.replace(/\./g, "_"),
    serverToolOpenAiName(selectedName),
  ];
  const listed = allTools.find(
    (item: any) =>
      item?.type === "function" && candidates.includes(item?.function?.name),
  );
  if (listed) return listed;

  // 本地能力是客户端的事实来源，不应因为模型工具列表被截断或服务端目录
  // 拉取失败而被判定为“未同步”。为本地已注册能力生成最小函数描述，
  // 执行时仍通过 CapabilityRegistry，业务实现不会被复制。
  if (selectedTool.source === "client") {
    const dotIndex = selectedName.indexOf(".");
    if (dotIndex > 0) {
      const namespace = selectedName.slice(0, dotIndex);
      const name = selectedName.slice(dotIndex + 1);
      if (CapabilityRegistry.getDefinition(namespace, name)) {
        return {
          type: "function",
          function: {
            name: selectedName.replace(/\./g, "_"),
            description: selectedTool.label || selectedName,
            parameters: { type: "object", properties: {} },
          },
        } as OpenAI.Chat.Completions.ChatCompletionTool;
      }
    }
  }
  return null;
}

function buildExplicitToolSelectionResponse(
  current: GraphState,
): string | null {
  const last = current.messages[current.messages.length - 1];
  if (
    !isToolSelectionOnlyMessage(last) ||
    !current.explicitSelectedTools.length
  ) {
    return null;
  }
  const labels = current.explicitSelectedTools.map(
    (item) => item.label || item.name,
  );
  const names = current.explicitSelectedTools.map((item) => item.name);
  const unavailable = current.explicitSelectedTools.filter(
    (item) =>
      item.source !== "client" && !findExplicitOpenAiTool(item, current.tools),
  );
  if (unavailable.length) {
    return `已记录您选择的工具：${names.join("、")}。当前客户端还没有同步到该工具的连接信息，请重新登录并同步能力后再执行。`;
  }
  const needs = names.some((name) => /openmeteo|weather|天气/i.test(name))
    ? "请告诉我城市或地区，例如“北京今天的天气”。"
    : names.some((name) => /search|搜索/i.test(name))
      ? "请告诉我搜索关键词，例如“猫咪”或“春季花朵”。"
      : "请告诉我具体任务和参数。";
  return `已选择${labels.join("、")}。${needs}`;
}

function explicitToolsSystemInstruction(
  selectedTools: AgentSelectedTool[],
): string | null {
  if (!selectedTools.length) return null;
  const names = selectedTools.map((item) => item.name).join("、");
  return `【强制工具约束】用户已通过能力库明确选择：${names}。这是本会话的绑定工具，不得改用同名或相似的本地工具。当前用户消息只要已包含该工具所需参数，就必须先调用这个工具再回答；仅在参数缺失时，才简洁询问缺少的参数。若云端工具目录尚未同步，不得声称“能力不存在”，应明确提示“所选云端工具暂不可连接，请重新登录并同步客户端能力”。`;
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
  /** zoom 成功后必须结束本回合，等待下一条用户消息明确选择分辨率。 */
  awaitingGoogleArtZoomSelection: boolean;
  explicitSelectedTools: AgentSelectedTool[];
}

function getLatestUserText(messages: AgentChatMessage[]): string {
  const last = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  return typeof last?.content === "string" ? last.content.trim() : "";
}

function userExplicitlySelectedGoogleArtZoom(
  messages: AgentChatMessage[],
  zoomLevel: unknown,
): boolean {
  const text = getLatestUserText(messages);
  const level = Number(zoomLevel);
  if (!Number.isInteger(level)) return false;
  if (text === String(level)) return true;
  const escaped = String(level).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:选择|选|档位|分辨率|zoom)\\s*(?:为|是|第)?\\s*${escaped}\\b`,
    "i",
  ).test(text);
}

function formatGoogleArtZoomSelection(result: unknown): string | null {
  const value = result as any;
  if (!value || value.success === false) return null;
  const zooms = Array.isArray(value.zooms)
    ? value.zooms
    : Array.isArray(value?.data?.zooms)
      ? value.data.zooms
      : [];
  if (!zooms.length) return null;
  const selected = value.selected || value?.data?.selected || {};
  const title = selected.title ? `《${String(selected.title)}》` : "该作品";
  const lines = zooms.map(
    (zoom: any) =>
      `档位 ${zoom.idx}：${zoom.width} × ${zoom.height}（${zoom.tiles} 个切片）`,
  );
  return [
    `${title} 可选择以下分辨率：`,
    ...lines,
    "\n请回复要下载的档位编号（例如“1”）。收到你的明确选择后才会下载并写入素材库。",
  ].join("\n");
}

function buildDirectGoogleArtSearchCall(current: GraphState) {
  const last = current.messages[current.messages.length - 1];
  if (last?.role !== "user" || typeof last.content !== "string") return null;
  const text = last.content.trim();
  if (
    !/(google\s*art|google arts|谷歌艺术|蒙娜丽莎|名画|艺术作品)/i.test(text)
  ) {
    return null;
  }
  if (!/(搜|查|找|搜索|search|找到)/i.test(text)) return null;

  const tool = current.tools.find(
    (item) =>
      item.type === "function" && item.function.name === "googleArt_search",
  );
  if (!tool) return null;

  const keyword = resolveGoogleArtKeyword(text);

  return {
    id: `direct_google_art_search_${Date.now()}`,
    name: "googleArt_search",
    arguments: JSON.stringify({ keyword, maxCount: 8 }),
  };
}

function resolveGoogleArtKeyword(text: string): string {
  if (/梵高|向日葵/i.test(text)) return "Van Gogh Sunflowers";
  if (/莫奈/i.test(text)) return "Claude Monet";
  if (/蒙娜丽莎|mona\s*lisa/i.test(text)) return "Mona Lisa";
  return "Mona Lisa";
}

/**
 * 客户端重启后，历史消息仍在磁盘中，但 Google Arts 的可信状态会被清空。
 * 只在本会话历史明确存在 Google Arts 搜索请求时恢复搜索，不接受模型或
 * 助手文本中的 URL/元数据作为可信输入。
 */
function findPreviousGoogleArtSearchKeyword(
  messages: AgentChatMessage[],
): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user" || typeof message.content !== "string")
      continue;
    const text = message.content.trim();
    if (
      /(google\s*art|google arts|谷歌艺术|蒙娜丽莎|名画|艺术作品)/i.test(
        text,
      ) &&
      /(搜|查|找|搜索|search|找到|下载|采集)/i.test(text)
    ) {
      return resolveGoogleArtKeyword(text);
    }
  }
  return null;
}

/**
 * Google Arts 搜索是受约束的本地能力，不需要让模型先决定“是否存在工具”。
 * 对明确的首轮搜索请求直接调用 CapabilityRegistry，保证用户总能看到真实
 * search 结果与 resultIndex；下载仍必须在后续 zoom + 用户选档后进行。
 */
async function tryDirectGoogleArtSearch(
  current: GraphState,
  events: AgentStreamEvents,
  executionContext?: CapabilityCallContext,
): Promise<string | null> {
  const last = current.messages[current.messages.length - 1];
  if (last?.role !== "user" || typeof last.content !== "string") return null;
  const text = last.content.trim();
  if (
    !/(google\s*art|google arts|谷歌艺术|蒙娜丽莎|名画|艺术作品)/i.test(text) ||
    !/(搜|查|找|搜索|search|找到|下载|采集)/i.test(text)
  ) {
    return null;
  }

  let keyword = "Mona Lisa";
  if (/梵高|向日葵/i.test(text)) keyword = "Van Gogh Sunflowers";
  else if (/莫奈/i.test(text)) keyword = "Claude Monet";
  else if (/蒙娜丽莎|mona\s*lisa/i.test(text)) keyword = "Mona Lisa";

  const callId = `direct_google_art_search_${Date.now()}`;
  const args = { keyword, maxCount: 8 };
  events.onToolStart?.({ id: callId, name: "googleArt_search", args });
  const startedAt = Date.now();
  const result = await withTimeout(
    CapabilityRegistry.call("googleArt", "search", args, executionContext),
    TOOL_CALL_TIMEOUT_MS,
    "googleArt.search",
  );
  const error = toolResultError(result, undefined);
  events.onToolEnd?.({
    id: callId,
    name: "googleArt_search",
    result,
    durationMs: Date.now() - startedAt,
    error,
  });

  const data = result as any;
  if (!data?.success) {
    return `Google Arts 搜索失败：${String(data?.error || "未知错误")}`;
  }
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    return `没有找到与“${keyword}”匹配的 Google Arts 作品。请换一个关键词后重试。`;
  }
  const lines = items.slice(0, 8).map((item: any) => {
    const title = String(item?.title || "未命名作品");
    const artist = item?.artist ? ` — ${String(item.artist)}` : "";
    return `${item?.resultIndex}. 《${title}》${artist}`;
  });
  return [
    `已在 Google Arts 找到“${keyword}”相关作品：`,
    ...lines,
    "\n请回复要下载的作品编号（例如“1”）。我会先获取可选分辨率，等待你选择档位后再下载入库。",
  ].join("\n");
}

/**
 * 搜索结果后的“作品编号”也不能交给模型猜工具是否存在。
 * 若当前会话尚未取得可信 zoom，纯数字输入直接按 resultIndex 调用 zoom，
 * 成功后展示档位并结束本轮；已存在可信 zoom 时由 tryAutoCollectZoomLevel
 * 处理为用户明确选择档位。
 */
async function tryDirectGoogleArtZoomSelection(
  current: GraphState,
  events: AgentStreamEvents,
  executionContext?: CapabilityCallContext,
): Promise<string | null> {
  const userText = getLatestUserText(current.messages);
  if (!/^\d+$/.test(userText)) return null;

  try {
    const { hasTrustedGoogleArtZoom } = await import(
      "../capabilities/googleArt"
    );
    if (hasTrustedGoogleArtZoom(executionContext)) return null;
  } catch {
    return null;
  }

  const resultIndex = Number(userText);
  const callId = `direct_google_art_zoom_${Date.now()}`;
  const args = { resultIndex };
  events.onToolStart?.({ id: callId, name: "googleArt_zoom", args });
  const startedAt = Date.now();
  const result = await withTimeout(
    CapabilityRegistry.call("googleArt", "zoom", args, executionContext),
    TOOL_CALL_TIMEOUT_MS,
    "googleArt.zoom",
  );
  const error = toolResultError(result, undefined);
  events.onToolEnd?.({
    id: callId,
    name: "googleArt_zoom",
    result,
    durationMs: Date.now() - startedAt,
    error,
  });

  // 客户端重启会清空内存中的可信 search 状态。若本会话历史明确存在
  // 搜索请求，则重新执行一次真实 search，再用同一个 resultIndex zoom；
  // 不从助手文本恢复 URL/元数据，避免绕过可信状态校验。
  if (
    (result as any)?.success === false &&
    /resultIndex.*最近一次搜索结果|搜索结果中/.test(
      String((result as any)?.error || ""),
    )
  ) {
    const keyword = findPreviousGoogleArtSearchKeyword(current.messages);
    if (keyword) {
      const searchCallId = `direct_google_art_search_recover_${Date.now()}`;
      const searchArgs = { keyword, maxCount: 8 };
      events.onToolStart?.({
        id: searchCallId,
        name: "googleArt_search",
        args: searchArgs,
      });
      const searchStartedAt = Date.now();
      const searchResult = await withTimeout(
        CapabilityRegistry.call(
          "googleArt",
          "search",
          searchArgs,
          executionContext,
        ),
        TOOL_CALL_TIMEOUT_MS,
        "googleArt.search (恢复会话状态)",
      );
      events.onToolEnd?.({
        id: searchCallId,
        name: "googleArt_search",
        result: searchResult,
        durationMs: Date.now() - searchStartedAt,
        error: toolResultError(searchResult, undefined),
      });
      if ((searchResult as any)?.success) {
        const retryCallId = `direct_google_art_zoom_recover_${Date.now()}`;
        events.onToolStart?.({ id: retryCallId, name: "googleArt_zoom", args });
        const retryStartedAt = Date.now();
        const retryResult = await withTimeout(
          CapabilityRegistry.call("googleArt", "zoom", args, executionContext),
          TOOL_CALL_TIMEOUT_MS,
          "googleArt.zoom (恢复会话状态)",
        );
        events.onToolEnd?.({
          id: retryCallId,
          name: "googleArt_zoom",
          result: retryResult,
          durationMs: Date.now() - retryStartedAt,
          error: toolResultError(retryResult, undefined),
        });
        const recoveredSelection = formatGoogleArtZoomSelection(retryResult);
        if (recoveredSelection) return recoveredSelection;
      }
    }
  }

  const selection = !error ? formatGoogleArtZoomSelection(result) : null;
  if (selection) return selection;
  // 没有可信 search 状态时让普通 Agent 正常处理数字输入，避免吞掉其他对话。
  return null;
}

/** 对明确的本地文件读取请求走真实只读能力，避免模型复述用户给出的内容。 */
async function tryDirectFilesystemRead(
  current: GraphState,
  events: AgentStreamEvents,
  executionContext?: CapabilityCallContext,
): Promise<string | null> {
  const text = getLatestUserText(current.messages);
  if (!/(读取|读一下|查看|打开).*(文件|内容)/i.test(text)) return null;
  const match = text.match(/(?:\/|[A-Za-z]:[\\/])[^\s`"'，。！？]+/);
  if (!match) return null;
  const filePath = match[0].replace(/[，。！？]+$/, "");
  const callId = `direct_filesystem_read_${Date.now()}`;
  const args = { path: filePath, encoding: "utf8" };
  events.onToolStart?.({ id: callId, name: "filesystem_file_read", args });
  const startedAt = Date.now();
  const result = await withTimeout(
    CapabilityRegistry.call("filesystem", "file_read", args, executionContext),
    TOOL_CALL_TIMEOUT_MS,
    "filesystem.file_read",
  );
  events.onToolEnd?.({
    id: callId,
    name: "filesystem_file_read",
    result,
    durationMs: Date.now() - startedAt,
    error: toolResultError(result, undefined),
  });
  const data = result as any;
  if (!data?.success)
    return `读取文件失败：${String(data?.error || "未知错误")}`;
  if (typeof data?.data?.content !== "string") {
    return `文件已读取，但工具未返回文本内容：${filePath}`;
  }
  return `文件内容为：\n\n\`\`\`\n${data.data.content}\n\`\`\``;
}

async function tryDirectFilesystemDelete(
  current: GraphState,
  events: AgentStreamEvents,
  executionContext?: CapabilityCallContext,
): Promise<string | null> {
  const text = getLatestUserText(current.messages);
  if (!/(删除|移除|清理).*(文件|测试文件)/i.test(text)) return null;
  const match = text.match(/(?:\/|[A-Za-z]:[\\/])[^\s`"'，。！？]+/);
  if (!match) return null;
  const filePath = match[0].replace(/[，。！？]+$/, "");
  const callId = `direct_filesystem_delete_${Date.now()}`;
  const args = { path: filePath };
  events.onToolStart?.({ id: callId, name: "filesystem_file_delete", args });
  const startedAt = Date.now();
  const result = await withTimeout(
    CapabilityRegistry.call(
      "filesystem",
      "file_delete",
      args,
      executionContext,
    ),
    TOOL_CALL_TIMEOUT_MS,
    "filesystem.file_delete",
  );
  events.onToolEnd?.({
    id: callId,
    name: "filesystem_file_delete",
    result,
    durationMs: Date.now() - startedAt,
    error: toolResultError(result, undefined),
  });
  const data = result as any;
  return data?.success
    ? `已删除文件：${String(data?.data?.path || filePath)}`
    : `删除文件失败：${String(data?.error || "未知错误")}`;
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
          awaitingGoogleArtZoomSelection: { value, default: () => false },
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
        .addConditionalEdges("tools", (state: GraphState) =>
          state.awaitingGoogleArtZoomSelection ? "__end__" : "agent",
        );
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
  const fakeSize = /(文件大小|fileSize|KB|MB).*(文件路径|path|本地文件)/;
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
    const lastUser = [...current.messages]
      .reverse()
      .find((m) => m.role === "user");
    const userText =
      typeof lastUser?.content === "string" ? lastUser.content.trim() : "";
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
      CapabilityRegistry.call(
        "googleArt",
        "collect",
        { zoomLevel },
        executionContext,
      ),
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
      tool_calls: [
        {
          id: callId,
          type: "function" as const,
          function: {
            name: "googleArt.collect",
            arguments: JSON.stringify({ zoomLevel }),
          },
        },
      ],
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
        const localToolNames = CapabilityRegistry.list().map(
          (capability) => `${capability.namespace}_${capability.name}`,
        );
        const safeServerCatalog = filterMissingServerCapabilities(
          {
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
          },
          localToolNames,
        );
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
    const explicitSelectedTools = getSelectedToolsForTurn(historyMessages);
    const explicitInstruction = explicitToolsSystemInstruction(
      explicitSelectedTools,
    );
    const businessRulePrompt = `【衣设平台业务能力调用规范】
1. 当用户询问或操作衣设平台的业务数据（如素材库/素材图/贴纸、组图/图片组、PSD模板、PS套图任务、独立站商品生成模板、跨境平台发布配置等）时，必须直接调用对应的服务端能力（如 server_material_*、server_product_*、server_publish_* 开头），禁止反问用户“指哪个平台”，严禁使用本地 filesystem_* 磁盘扫描替代。
2. 只有用户明确指定本地电脑磁盘路径（如 /Users/xxx 或 D:\\xxx）或说明读取本机文件时，才使用 filesystem_* 工具。
3. 只要存在可用的 server_ 工具，直接调用完成任务，不要回复“没有工具”。`;

    const state: GraphState = {
      messages: [
        { role: "system", content: config.systemPrompt || "" },
        { role: "system", content: businessRulePrompt },
        ...(explicitInstruction
          ? [{ role: "system" as const, content: explicitInstruction }]
          : []),
        ...historyMessages,
      ],
      tools: selectRelevantTools(
        typeof lastUser?.content === "string" ? lastUser.content : "",
        allTools,
        serverToolIndex,
        explicitSelectedTools.map((item) => item.name),
      ),
      iteration: 0,
      finalText: "",
      finalReasoning: "",
      pendingToolCalls: [],
      googleArtCollectResults: [],
      awaitingGoogleArtZoomSelection: false,
      explicitSelectedTools,
    };

    // 强约束入口：搜索阶段直接使用本地可信能力，避免模型因上下文/工具截断
    // 误报“没有 Google Arts 工具”。后续选作品和选档仍使用相同 sessionId 状态。
    const directGoogleArtResult = await tryDirectGoogleArtSearch(
      state,
      events,
      executionContext,
    );
    if (directGoogleArtResult !== null) {
      state.finalText = directGoogleArtResult;
      state.messages.push({
        role: "assistant",
        content: directGoogleArtResult,
      });
      events.onContent?.(directGoogleArtResult);
      events.onComplete?.(directGoogleArtResult, "");
      return {
        text: directGoogleArtResult,
        reasoning: "",
        messages: state.messages,
      };
    }

    const directGoogleArtZoomResult = await tryDirectGoogleArtZoomSelection(
      state,
      events,
      executionContext,
    );
    if (directGoogleArtZoomResult !== null) {
      state.finalText = directGoogleArtZoomResult;
      state.messages.push({
        role: "assistant",
        content: directGoogleArtZoomResult,
      });
      events.onContent?.(directGoogleArtZoomResult);
      events.onComplete?.(directGoogleArtZoomResult, "");
      return {
        text: directGoogleArtZoomResult,
        reasoning: "",
        messages: state.messages,
      };
    }

    const directFilesystemReadResult = await tryDirectFilesystemRead(
      state,
      events,
      executionContext,
    );
    if (directFilesystemReadResult !== null) {
      state.finalText = directFilesystemReadResult;
      state.messages.push({
        role: "assistant",
        content: directFilesystemReadResult,
      });
      events.onContent?.(directFilesystemReadResult);
      events.onComplete?.(directFilesystemReadResult, "");
      return {
        text: directFilesystemReadResult,
        reasoning: "",
        messages: state.messages,
      };
    }

    const directFilesystemDeleteResult = await tryDirectFilesystemDelete(
      state,
      events,
      executionContext,
    );
    if (directFilesystemDeleteResult !== null) {
      state.finalText = directFilesystemDeleteResult;
      state.messages.push({
        role: "assistant",
        content: directFilesystemDeleteResult,
      });
      events.onContent?.(directFilesystemDeleteResult);
      events.onComplete?.(directFilesystemDeleteResult, "");
      return {
        text: directFilesystemDeleteResult,
        reasoning: "",
        messages: state.messages,
      };
    }

    const directToolSelectionResult = buildExplicitToolSelectionResponse(state);
    if (directToolSelectionResult !== null) {
      state.finalText = directToolSelectionResult;
      state.messages.push({
        role: "assistant",
        content: directToolSelectionResult,
      });
      events.onContent?.(directToolSelectionResult);
      events.onComplete?.(directToolSelectionResult, "");
      return {
        text: directToolSelectionResult,
        reasoning: "",
        messages: state.messages,
      };
    }

    const graph = new ClientStateGraph()
      .addNode("agent", async (current) => {
        current.iteration += 1;
        current.pendingToolCalls = [];

        // ── 前置检查：用户选了档位数字时直接执行 collect，跳过模型 ──
        // 模型常在应当调用 googleArt.collect 时改为输出"已成功"的文字，
        // 触发事后纠偏也无法真正下载。这里拦截数字回复并代为执行。
        if (
          current.iteration === 1 ||
          current.googleArtCollectResults.length === 0
        ) {
          const autoCollected = await tryAutoCollectZoomLevel(
            current,
            events,
            executionContext,
          );
          if (autoCollected) {
            current.finalText = formatGoogleArtCollectResult(
              current.googleArtCollectResults[
                current.googleArtCollectResults.length - 1
              ],
            );
            current.messages.push({
              role: "assistant",
              content: current.finalText,
            });
            return;
          }
        }

        // 能力库中显式选择的搜索工具：第二句只输入“猫咪”也必须实际调用。
        // 这条确定性路径绕过模型对工具名的猜测，避免 server 工具被误当成本地能力。
        if (current.iteration === 1) {
          const explicitSearchCall = buildExplicitSearchToolCall(
            current,
            current.explicitSelectedTools,
            current.tools,
          );
          if (explicitSearchCall) {
            current.pendingToolCalls = [explicitSearchCall];
            current.messages.push({
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: explicitSearchCall.id,
                  type: "function",
                  function: {
                    name: explicitSearchCall.name,
                    arguments: explicitSearchCall.arguments,
                  },
                },
              ],
            });
            return;
          }
        }

        // 明确的 Google Arts 搜索请求不交给模型猜工具名称，直接进入
        // 客户端唯一可信 Capability 流程，避免模型误报“没有 googleArt”。
        if (current.iteration === 1) {
          const directGoogleArtCall = buildDirectGoogleArtSearchCall(current);
          if (directGoogleArtCall) {
            current.pendingToolCalls = [directGoogleArtCall];
            current.messages.push({
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: directGoogleArtCall.id,
                  type: "function",
                  function: {
                    name: directGoogleArtCall.name,
                    arguments: directGoogleArtCall.arguments,
                  },
                },
              ],
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
            return hasTrustedGoogleArtZoomForAgent(executionContext) === true;
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

          // OpenAI 规范要求 function name 不含点号，但部分兼容模型会把
          // 能力原名 material.sticker.search / openmeteo.search 原样返回。
          // 统一接受两种格式，避免“工具已选中却被判定为未知工具名称”。
          const dotSeparator = call.name.indexOf(".");
          const underscoreSeparator = call.name.indexOf("_");
          const separator =
            dotSeparator > 0 ? dotSeparator : underscoreSeparator;
          const namespace = separator > 0 ? call.name.slice(0, separator) : "";
          const capabilityName =
            separator > 0 ? call.name.slice(separator + 1) : "";
          const definition = namespace
            ? CapabilityRegistry.getDefinition(namespace, capabilityName)
            : undefined;
          const isGoogleArtCollect =
            namespace === "googleArt" && capabilityName === "collect";
          const isGoogleArtZoom =
            namespace === "googleArt" && capabilityName === "zoom";
          // collect 不再信任模型传入 URL。确认前按 sessionId 读取最后一次成功 zoom
          // 的主进程可信状态，并校验用户选择的档位。
          if (isGoogleArtCollect) {
            if (
              !userExplicitlySelectedGoogleArtZoom(
                current.messages,
                args?.zoomLevel,
              )
            ) {
              const result = {
                success: false,
                ok: false,
                materialLibraryOk: false,
                downloaded: false,
                filePath: null,
                error:
                  "请先查看分辨率，并在下一条消息中明确选择要下载的档位编号。",
              };
              current.googleArtCollectResults.push(result);
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
            if (!this.autoApproveWrite) {
              events.onToolApproval?.({
                id: call.id,
                name: call.name,
                args,
                riskLevel: definition.riskLevel,
                description: definition.description,
              });
            }
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
          if (isGoogleArtZoom && !reportedError) {
            const selection = formatGoogleArtZoomSelection(result);
            if (selection) {
              current.awaitingGoogleArtZoomSelection = true;
              current.finalText += selection;
              events.onContent?.(selection);
              // 当前模型即使同批返回 collect，也不能执行；必须等待下一轮用户选择。
              break;
            }
          }
        }
      })
      .addConditionalEdges("agent", (current) =>
        current.pendingToolCalls.length &&
        current.iteration < this.maxIterations
          ? "tools"
          : "END",
      )
      .addConditionalEdges("tools", (current) =>
        current.awaitingGoogleArtZoomSelection ? "END" : "agent",
      );

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

/**
 * 客户端 Agent 场景 Profile 与稳定工具选择。
 *
 * 设计目标（服务端 AI 能力全对齐 + 省 Token + 吃满 Prompt Cache）：
 * 1. 客户端与服务端 AI 共享同一套云端能力目录（design-server AiAssistantToolRegistryService），
 *    再加上本机原生能力（collect / filesystem / googleArt / clipboard 等）。
 * 2. 按场景划分独立 Profile（default / media_ops / google_art），并通过「相关性优先 + 分类轮询配额」
 *    防止单个超大分类（如 70+ 工具的 material）挤占 publish / hotsearch / video / system 等分类额度。
 * 3. 最终输出严格按 tool name 字典序排序，最大化命中 DeepSeek / OpenAI 前缀缓存。
 */
import type OpenAI from "openai";
import type {
  AgentChatMessage,
  AgentProfile,
  AgentProfileId,
} from "./types";
import {
  isServerToolName,
  SERVER_TOOL_KEYWORDS,
  type ServerCapabilityTool,
} from "./server-capabilities";

const GOOGLE_ART_PROMPT_APPENDIX = `
Google Arts 艺术采集协作规则：
1. Google Arts 采集必须严格按 googleArt.search → googleArt.zoom → googleArt.collect 执行；search 返回的 items[].url 和元数据仅用于展示，【禁止】把 items[].thumbnail、作品 URL、图片直链或作品 ID 传给 zoom/collect，只传 items[].resultIndex。
2. googleArt.zoom 成功后必须停下来展示 zooms 档位并等待用户明确选择。用户回复档位后，调用 googleArt.collect 时只传 zoomLevel。
3. 【禁止】用浏览器自动化、截图、通用素材上传或其他工具代替 googleArt.collect。只有 collect 返回 success=true 且 materialLibraryOk=true 才表示真实入库成功；失败时如实转达 error，禁止编造路径或链接。
4. 如果 googleArt.zoom 失败（返回空 zooms），最多重试一次；仍失败则如实告知用户无法获取分辨率，禁止无限重试。`.trim();

const MEDIA_OPS_PROMPT_APPENDIX = `
媒体运营自动化协作规范：
1. 你运行在用户本机客户端，拥有与服务端 AI 一致的云端业务能力以及本机采集能力，负责独立完成热点研判、选题策划、文案撰写、素材/视频生产调度与发布准备。
2. 查询媒体账号请优先调用 server_publish_media_account_list，查看热搜/趋势调用 server_hotsearch_overview / server_hotsearch_keywords，查询媒体发布规范与提交直投调用 server_publish_media_describe_schema / server_publish_media_submit_task / server_publish_media_query_status，素材与视频调用 server_material_collect_file_search / server_material_sentence_search / server_video_* / collect_*。
3. 禁止编造未查询过的热点、账号 ID 或发布结果；生成内容前先对齐目标平台账号的运营定位（operationStrategy）与禁忌，输出简洁可直接落地。`.trim();

/** 各 Profile 优先保留的高频服务端工具前缀（保证核心闭环工具永不被截断）。 */
const PROFILE_PRIORITY_SERVER_PREFIXES: Record<AgentProfileId, string[]> = {
  default: [
    "publish.media_account.",
    "publish.media.",
    "hotsearch.overview",
    "hotsearch.keywords",
    "system.client.",
    "system.task.",
    "system.user.",
    "system.get_current_time",
    "material.sticker.search",
    "material.collect_file.",
    "material.sentence.search",
    "video.template.list",
    "video.generate",
    "product.search",
    "publish.config.search",
    "publish.task.search",
    "task.list",
    "task.create",
    "workflow.status",
    "workflow.run",
  ],
  media_ops: [
    "publish.media_account.",
    "publish.media.",
    "hotsearch.",
    "material.collect_file.",
    "material.sentence.",
    "video.template.list",
    "video.template.get",
    "video.generate",
    "video.ai_generate",
    "video.list",
    "video.get",
    "ai.tts.create",
    "ai.tts.content",
    "material.sticker.search",
    "publish.config.search",
    "publish.task.search",
    "task.list",
    "task.create",
  ],
  google_art: ["material.crawler_material.", "material.sticker.search"],
};

export const AGENT_PROFILES: Record<AgentProfileId, AgentProfile> = {
  default: {
    id: "default",
    label: "通用副驾",
    description: "日常对话、本地能力与衣设云端全量业务协同（与服务端 AI 工具对齐）",
    systemPromptAppendix: "",
    localNamespaces: [
      "collect",
      "materialLibrary",
      "filesystem",
      "clipboard",
    ],
    serverCategories: [
      "publish",
      "hotsearch",
      "video",
      "material",
      "product",
      "workflow",
      "system",
      "ai",
      "task",
      "browser",
      "collect",
      "client",
      "shop",
      "partner",
      "insight",
      "prompt",
    ],
    maxTools: 40,
    maxIterations: 10,
  },
  media_ops: {
    id: "media_ops",
    label: "媒体运营自动化",
    description: "热点分析、账号对齐、选题文案、素材/视频生产与多平台直投发布",
    systemPromptAppendix: MEDIA_OPS_PROMPT_APPENDIX,
    localNamespaces: ["collect", "materialLibrary"],
    serverCategories: [
      "publish",
      "hotsearch",
      "video",
      "material",
      "ai",
      "workflow",
      "task",
      "collect",
    ],
    maxTools: 28,
    maxIterations: 10,
  },
  google_art: {
    id: "google_art",
    label: "Google Arts 高清采集",
    description: "Google Arts & Culture 作品检索、分辨率选档与高清拼图入库",
    systemPromptAppendix: GOOGLE_ART_PROMPT_APPENDIX,
    localNamespaces: ["googleArt", "materialLibrary"],
    serverCategories: ["material"],
    maxTools: 10,
    maxIterations: 6,
  },
};

export function listAgentProfiles(): Array<
  Pick<AgentProfile, "id" | "label" | "description" | "maxTools" | "maxIterations">
> {
  return Object.values(AGENT_PROFILES).map(
    ({ id, label, description, maxTools, maxIterations }) => ({
      id,
      label,
      description,
      maxTools,
      maxIterations,
    }),
  );
}

/** 根据显式指定或会话文本自动识别最合适的 Profile。 */
export function resolveAgentProfile(
  requestedProfile: AgentProfileId | undefined,
  messages: AgentChatMessage[],
): AgentProfile {
  if (requestedProfile && AGENT_PROFILES[requestedProfile]) {
    return AGENT_PROFILES[requestedProfile];
  }
  const combinedUserText = messages
    .filter((m) => m.role === "user")
    .slice(-4)
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");

  if (
    /(google\s*arts?|谷歌艺术|蒙娜丽莎|googleArt)/i.test(combinedUserText)
  ) {
    return AGENT_PROFILES.google_art;
  }
  return AGENT_PROFILES.default;
}

/** 额外按需扩展的本地命名空间关键词（仅在 default profile 命中时按需补充）。 */
const EXTRA_LOCAL_NAMESPACE_KEYWORDS: Record<string, string[]> = {
  coingecko: ["币价", "比特币", "btc", "eth", "crypto"],
  frankfurter: ["汇率", "货币", "usd", "cny", "eur"],
  dictionary: ["查词", "词典", "单词", "释义", "dictionary"],
  timeapi: ["时间", "时区", "几点", "time"],
  shopify: ["shopify", "独立站", "商品", "店铺"],
  arxiv: ["论文", "arxiv", "学术"],
  wikimedia: ["wikimedia", "维基", "梵高", "名画", "画作", "公共领域"],
  openverse: ["openverse", "开源素材", "艺术品"],
  "google-icons": ["材料图标", "material icon", "google图标", "google icon"],
  googleArt: ["googleart", "google art", "谷歌艺术", "名画", "博物馆", "蒙娜丽莎"],
  iconify: ["iconify", "图标库", "图标集合"],
  nounproject: ["noun project", "nounproject", "名词图标"],
  emojipedia: ["emoji", "表情", "颜文字"],
  openmoji: ["openmoji", "开源表情"],
  openclipart: ["openclipart", "剪贴画", "clipart"],
  undraw: ["undraw", "插画", "illustration"],
  vecteezy: ["vecteezy", "矢量插画"],
  rawpixel: ["rawpixel", "复古素材"],
  stocksnap: ["stocksnap", "免费摄影", "cc0图"],
  colorapi: ["颜色", "色值", "color", "hex"],
  pexels: ["pexels", "摄影图"],
  pixabay: ["pixabay"],
  pinterest: ["pinterest", "灵感图"],
  svgrepo: ["svgrepo", "svg图标"],
  openmeteo: ["天气", "气温", "下雨", "weather"],
  hackernews: ["hackernews", "hn"],
  github: ["github", "开源项目"],
};

function getToolName(tool: OpenAI.Chat.Completions.ChatCompletionTool): string {
  return String((tool as any).function?.name || "");
}

function scoreServerTool(
  tool: OpenAI.Chat.Completions.ChatCompletionTool,
  serverTool: ServerCapabilityTool | undefined,
  promptLower: string,
  priorityPrefixes: string[],
  matchedCategories: Set<string>,
): number {
  const originalName = serverTool?.name || getToolName(tool).replace(/^server_/, "");
  const category = serverTool?.category || originalName.split(/[._]/)[0] || "";
  let score = 0;

  if (priorityPrefixes.some((p) => originalName.startsWith(p))) {
    score += 50;
  }
  if (matchedCategories.has(category)) {
    score += 30;
  }

  if (promptLower) {
    const label = String(serverTool?.label || "").toLowerCase();
    const tags = (serverTool?.tags || []).map((t) => String(t).toLowerCase());
    if (label && promptLower.includes(label)) score += 40;
    for (const tag of tags) {
      if (tag.length >= 2 && promptLower.includes(tag)) {
        score += 18;
      }
    }
    // 拆分中文/英文词做轻量匹配
    const tokens = promptLower
      .split(/[\s,，。！？、；：""''（）()[\]【】/\\]+/)
      .filter((t) => t.length >= 2);
    const haystack = `${originalName} ${label} ${String(serverTool?.description || "").slice(0, 120)}`.toLowerCase();
    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 12;
      }
    }
  }

  return score;
}

/**
 * 构建与服务端 AI 对齐且防单分类饿死的精简工具集：
 * 1. 显式绑定工具（最高优先）
 * 2. 本机核心工具（受 localNamespaces + 关键词控制）
 * 3. 服务端工具：优先命中当前 Prompt 相关工具 + Profile 高频核心工具，再按允许分类轮询补齐，
 *    彻底避免 70+ 工具的 material 分类把 publish / hotsearch / video / system 挤掉。
 * 4. 最终严格按 tool name 字典序排序，最大化 Prompt Cache 命中率。
 */
export function selectToolsForProfile(
  profile: AgentProfile,
  prompt: string,
  allTools: OpenAI.Chat.Completions.ChatCompletionTool[],
  serverToolIndex?: Map<string, ServerCapabilityTool> | null,
  explicitToolNames: string[] = [],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const text = (prompt || "").toLowerCase();
  const explicitOpenAiNames = new Set(
    explicitToolNames
      .map((name) => String(name || "").trim())
      .filter(Boolean)
      .flatMap((name) => [
        name.replace(/\./g, "_"),
        `server_${name.replace(/\./g, "_")}`,
      ]),
  );

  const allowedLocal = new Set<string>(profile.localNamespaces);
  const allowedServerCategories = new Set<string>(profile.serverCategories);
  const promptMatchedServerCategories = new Set<string>();

  if (text) {
    for (const [cat, words] of Object.entries(SERVER_TOOL_KEYWORDS)) {
      if (words.some((w) => text.includes(w))) {
        promptMatchedServerCategories.add(cat);
        if (profile.id === "default") {
          allowedServerCategories.add(cat);
        }
      }
    }
    if (profile.id === "default") {
      for (const [ns, words] of Object.entries(EXTRA_LOCAL_NAMESPACE_KEYWORDS)) {
        if (words.some((w) => text.includes(w))) {
          allowedLocal.add(ns);
        }
      }
    }
  }

  const explicitMatched: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  const localMatched: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  const serverCandidates: Array<{
    tool: OpenAI.Chat.Completions.ChatCompletionTool;
    category: string;
    score: number;
  }> = [];

  const priorityPrefixes = PROFILE_PRIORITY_SERVER_PREFIXES[profile.id] || [];

  for (const tool of allTools) {
    const name = getToolName(tool);
    if (!name) continue;
    if (explicitOpenAiNames.has(name)) {
      explicitMatched.push(tool);
      continue;
    }
    if (isServerToolName(name)) {
      const serverTool = serverToolIndex?.get(name);
      const category = serverTool?.category || name.split("_")[1] || "";
      if (allowedServerCategories.has(category)) {
        serverCandidates.push({
          tool,
          category,
          score: scoreServerTool(
            tool,
            serverTool,
            text,
            priorityPrefixes,
            promptMatchedServerCategories,
          ),
        });
      }
      continue;
    }
    const ns = name.split("_")[0];
    if (allowedLocal.has(ns)) {
      localMatched.push(tool);
    }
  }

  // 服务端工具排序：先按分类分组，每组内按 score 降序，再先取高分核心项，剩余名额按分类轮询填充
  const byCategory = new Map<
    string,
    Array<{ tool: OpenAI.Chat.Completions.ChatCompletionTool; score: number }>
  >();
  for (const item of serverCandidates) {
    const arr = byCategory.get(item.category) || [];
    arr.push({ tool: item.tool, score: item.score });
    byCategory.set(item.category, arr);
  }
  for (const arr of byCategory.values()) {
    arr.sort(
      (a, b) =>
        b.score - a.score || getToolName(a.tool).localeCompare(getToolName(b.tool)),
    );
  }

  const orderedServer: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  const highScored = serverCandidates
    .filter((c) => c.score >= 30)
    .sort(
      (a, b) =>
        b.score - a.score || getToolName(a.tool).localeCompare(getToolName(b.tool)),
    );
  for (const c of highScored) {
    orderedServer.push(c.tool);
  }

  // 轮询各允许分类，确保每个分类都有基础代表工具
  const categoryOrder = Array.from(byCategory.keys());
  let round = 0;
  while (orderedServer.length < profile.maxTools * 2) {
    let addedInRound = false;
    for (const cat of categoryOrder) {
      const list = byCategory.get(cat);
      if (list && round < list.length) {
        orderedServer.push(list[round].tool);
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    round++;
  }

  const combined = [...explicitMatched, ...localMatched, ...orderedServer];
  const deduped: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  const seen = new Set<string>();
  for (const tool of combined) {
    const name = getToolName(tool);
    if (seen.has(name)) continue;
    seen.add(name);
    deduped.push(tool);
    if (deduped.length >= profile.maxTools) break;
  }

  // 稳定字典序排列，最大化 KV / Prompt Cache 命中率
  return deduped.sort((a, b) => getToolName(a).localeCompare(getToolName(b)));
}

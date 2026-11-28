/**
 * 上下文瘦身与工具结果压缩模块（LangGraph `prepareContext` 节点核心）。
 *
 * 解决两个核心 Token 浪费问题：
 * 1. 工具返回的巨型 JSON 在后续轮次反复重传 -> 旧轮次 tool 消息自动折叠为 1 行摘要，仅保留最近 2 轮完整工具输出。
 * 2. 超长多轮对话无限膨胀 -> 在保持 assistant(tool_calls) 与 tool 消息成对完整的前提下做安全滑动裁剪。
 */
import type { AgentChatMessage } from "./types";

const MAX_TOOL_SERIALIZED_CHARS = 8_000;
const KEEP_FULL_RECENT_TOOL_MESSAGES = 4;
const MAX_NON_SYSTEM_MESSAGES = 28;
const MAX_TOTAL_CONTEXT_CHARS = 48_000;

/**
 * UI 保留完整工具结果；发回模型时仅保留下一步决策所需的关键字段，
 * 避免图片/热搜列表的大量冗余字段撑爆上下文。
 */
export function serializeToolResultForModel(result: unknown): string {
  const value = result as any;
  if (!value || typeof value !== "object") return JSON.stringify(result);

  // 先尝试直接序列化：常规业务接口（媒体账号、热搜概览、客户端节点等）未超预算时完整保留全部字段，
  // 避免把 name / platform / operationStrategy / machineCode 等关键业务字段裁掉。
  const rawSerialized = JSON.stringify(value);
  if (rawSerialized.length <= MAX_TOOL_SERIALIZED_CHARS) {
    return rawSerialized;
  }

  const data = value.data;
  const hasDataEnvelope = !!data && typeof data === "object";
  const source = hasDataEnvelope ? data : value;
  const compact = { ...source } as Record<string, unknown>;

  if (Array.isArray(compact.items)) {
    const looksLikeImageItems = compact.items.some(
      (item: any) =>
        item &&
        typeof item === "object" &&
        ("resultIndex" in item || "thumbnail" in item || "downloadUrl" in item),
    );
    compact.items = looksLikeImageItems
      ? compact.items.slice(0, 10).map((item: any) => ({
          resultIndex: item?.resultIndex,
          id: item?.id,
          name: item?.name,
          title: item?.title,
          image: item?.image || item?.downloadUrl,
          thumbnail: item?.thumbnail,
          url: item?.url || item?.link,
          author: item?.author || item?.photographer,
          artist: item?.artist,
          institution: item?.institution,
          license: item?.license,
        }))
      : compact.items.slice(0, 12);
  }
  if (Array.isArray(compact.links)) compact.links = compact.links.slice(0, 8);
  if (Array.isArray(compact.images))
    compact.images = compact.images.slice(0, 8);

  const payload = hasDataEnvelope ? { ...value, data: compact } : compact;
  const serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_TOOL_SERIALIZED_CHARS) return serialized;

  return JSON.stringify({
    success: value.success !== false,
    error: value.error,
    data: {
      query: compact.query,
      count: compact.count,
      total: compact.total,
      items: Array.isArray(compact.items) ? compact.items.slice(0, 5) : [],
    },
    truncated: true,
  });
}

/** 将历史轮次中体积较大的 tool 返回折叠为极简摘要，省去重复传输几千字符 JSON 的开销。 */
function foldOldToolContent(
  toolName: string | undefined,
  content: AgentChatMessage["content"],
): string {
  if (typeof content !== "string") return "[历史工具结果已折叠]";
  if (content.length <= 280) return content;

  try {
    const parsed = JSON.parse(content);
    const ok =
      parsed?.success === false || parsed?.ok === false ? "失败" : "成功";
    const err = parsed?.error || parsed?.msg;
    const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
    const count = Array.isArray(data?.items)
      ? `返回 ${data.items.length} 条`
      : typeof data?.total === "number"
        ? `共 ${data.total} 条`
        : typeof data?.count === "number"
          ? `共 ${data.count} 条`
          : "";
    const parts = [
      `[历史工具结果已折叠] ${toolName || "tool"} 执行${ok}`,
      count,
      err ? `原因: ${String(err).slice(0, 120)}` : "",
    ].filter(Boolean);
    return parts.join("；");
  } catch {
    return `${content.slice(0, 220)}… [历史工具结果已折叠，原长 ${content.length} 字符]`;
  }
}

function estimateMessageChars(msg: AgentChatMessage): number {
  let len = 0;
  if (typeof msg.content === "string") {
    len += msg.content.length;
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === "text") len += part.text.length;
      else len += 512; // image_url 粗估
    }
  }
  if (msg.reasoning_content) len += msg.reasoning_content.length;
  if (msg.tool_calls) len += JSON.stringify(msg.tool_calls).length;
  return len;
}

/**
 * 为模型调用准备紧凑、合法的消息数组：
 * 1. 保留所有 system 消息在最前；
 * 2. 对较早的 tool 消息执行折叠压缩；
 * 3. 超出消息条数或字符预算时从最早的非 system 轮次安全裁切，绝不产生孤立的 role="tool" 消息。
 */
export function prepareMessagesForModel(
  messages: AgentChatMessage[],
): AgentChatMessage[] {
  const systemMessages: AgentChatMessage[] = [];
  const conversation: AgentChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") systemMessages.push(msg);
    else conversation.push(msg);
  }

  // 找出需要保留完整内容的最近 N 条 tool 消息索引
  const toolIndices: number[] = [];
  for (let i = 0; i < conversation.length; i += 1) {
    if (conversation[i].role === "tool") toolIndices.push(i);
  }
  const fullToolSet = new Set(
    toolIndices.slice(-KEEP_FULL_RECENT_TOOL_MESSAGES),
  );

  // 折叠早期 tool 消息，同时不修改原始 session 对象
  const folded: AgentChatMessage[] = conversation.map((msg, idx) => {
    if (msg.role === "tool" && !fullToolSet.has(idx)) {
      return {
        ...msg,
        content: foldOldToolContent(msg.name, msg.content),
      };
    }
    return msg;
  });

  // 按轮次安全裁剪：始终从 user 消息边界开始截断，保证不会留下孤立的 tool 或半截 assistant(tool_calls)
  let startIdx = 0;
  if (folded.length > MAX_NON_SYSTEM_MESSAGES) {
    startIdx = folded.length - MAX_NON_SYSTEM_MESSAGES;
  }

  // 再按总字符预算收缩
  let totalChars = folded
    .slice(startIdx)
    .reduce((sum, m) => sum + estimateMessageChars(m), 0);
  while (
    totalChars > MAX_TOTAL_CONTEXT_CHARS &&
    startIdx < folded.length - 4
  ) {
    totalChars -= estimateMessageChars(folded[startIdx]);
    startIdx += 1;
  }

  // 对齐到合法的起始消息（不能以 tool 开头，避免 OpenAI/DeepSeek 400 报错）
  while (startIdx < folded.length && folded[startIdx].role === "tool") {
    startIdx += 1;
  }

  return [...systemMessages, ...folded.slice(startIdx)];
}

/**
 * 确定性直通快捷键与显式绑定工具中间件。
 *
 * 处理：
 * 1. 能力库“添加到对话”的显式工具解析与搜索参数映射；
 * 2. 明确的本地文件路径读写/删除直通，避免模型复述或绕弯。
 */
import type OpenAI from "openai";
import { CapabilityRegistry } from "../../capabilities/registry";
import type { CapabilityCallContext } from "../../capabilities/types";
import { serverToolOpenAiName } from "../server-capabilities";
import type {
  AgentChatMessage,
  AgentSelectedTool,
  AgentStreamEvents,
  GraphState,
  PendingToolCall,
} from "../types";
import {
  getLatestUserText,
  TOOL_CALL_TIMEOUT_MS,
  toolResultError,
  withTimeout,
} from "./google-art.middleware";

export function getSelectedToolsForTurn(
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

export function isToolSelectionOnlyMessage(
  message?: AgentChatMessage,
): boolean {
  if (!message || message.role !== "user") return false;
  if (message.toolSelectionOnly) return true;
  return (
    typeof message.content === "string" &&
    /请使用以下工具帮我完成任务：/.test(message.content)
  );
}

export function findExplicitOpenAiTool(
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

export function buildExplicitSearchToolCall(
  current: GraphState,
  selectedTools: AgentSelectedTool[],
  allTools: OpenAI.Chat.Completions.ChatCompletionTool[],
): PendingToolCall | null {
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

export function buildExplicitToolSelectionResponse(
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

export function explicitToolsSystemInstruction(
  selectedTools: AgentSelectedTool[],
): string | null {
  if (!selectedTools.length) return null;
  const names = selectedTools.map((item) => item.name).join("、");
  return `【强制工具约束】用户已通过能力库明确选择：${names}。这是本会话的绑定工具，不得改用同名或相似的本地工具。当前用户消息只要已包含该工具所需参数，就必须先调用这个工具再回答；仅在参数缺失时，才简洁询问缺少的参数。若云端工具目录尚未同步，不得声称“能力不存在”，应明确提示“所选云端工具暂不可连接，请重新登录并同步客户端能力”。`;
}

export async function tryDirectFilesystemRead(
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

export async function tryDirectFilesystemDelete(
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

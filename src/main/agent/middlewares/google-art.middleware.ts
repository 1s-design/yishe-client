/**
 * Google Arts 专属中间件。
 *
 * 将所有 Google Arts 的可信状态机、直通搜索/选档/采集和防幻觉纠偏
 * 完整隔离在独立插件模块中，避免污染核心 LangGraph 循环和全局 systemPrompt。
 */
import { CapabilityRegistry } from "../../capabilities/registry";
import type { CapabilityCallContext } from "../../capabilities/types";
import { hasTrustedGoogleArtZoom } from "../../capabilities/googleArt";
import type {
  AgentChatMessage,
  AgentStreamEvents,
  GraphState,
  PendingToolCall,
} from "../types";
import { serializeToolResultForModel } from "../context-trimmer";

export const TOOL_CALL_TIMEOUT_MS = 60_000;
/** 高清拼图 + COS 上传可能明显超过普通工具的 60 秒。 */
export const GOOGLE_ART_COLLECT_TIMEOUT_MS = 10 * 60_000;

export function withTimeout<T>(
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

export function toolResultError(
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

export function getLatestUserText(messages: AgentChatMessage[]): string {
  const last = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  return typeof last?.content === "string" ? last.content.trim() : "";
}

function resolveGoogleArtKeyword(text: string): string {
  if (/梵高|向日葵/i.test(text)) return "Van Gogh Sunflowers";
  if (/莫奈/i.test(text)) return "Claude Monet";
  if (/蒙娜丽莎|mona\s*lisa/i.test(text)) return "Mona Lisa";
  return "Mona Lisa";
}

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

export function userExplicitlySelectedGoogleArtZoom(
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

export function formatGoogleArtZoomSelection(result: unknown): string | null {
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

export function buildDirectGoogleArtSearchCall(
  current: GraphState,
): PendingToolCall | null {
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

  return {
    id: `direct_google_art_search_${Date.now()}`,
    name: "googleArt_search",
    arguments: JSON.stringify({
      keyword: resolveGoogleArtKeyword(text),
      maxCount: 8,
    }),
  };
}

export async function tryDirectGoogleArtSearch(
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

  const keyword = resolveGoogleArtKeyword(text);
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

export async function tryDirectGoogleArtZoomSelection(
  current: GraphState,
  events: AgentStreamEvents,
  executionContext?: CapabilityCallContext,
): Promise<string | null> {
  const userText = getLatestUserText(current.messages);
  if (!/^\d+$/.test(userText)) return null;

  try {
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
  return selection || null;
}

export function formatGoogleArtCollectResult(
  result: Record<string, any>,
): string {
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

export function textClaimsGoogleArtCollectSuccess(text: string): boolean {
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

export function formatCollectNotExecutedMessage(
  executionContext: CapabilityCallContext | undefined,
  collectResults: Array<Record<string, any>>,
): string {
  const hasZoom = !!(
    executionContext && hasTrustedGoogleArtZoom(executionContext)
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

export async function tryAutoCollectZoomLevel(
  current: GraphState,
  events: AgentStreamEvents,
  executionContext?: CapabilityCallContext,
): Promise<boolean> {
  try {
    const lastUser = [...current.messages]
      .reverse()
      .find((m) => m.role === "user");
    const userText =
      typeof lastUser?.content === "string" ? lastUser.content.trim() : "";
    if (!/^-?\d+$/.test(userText)) return false;

    const { prepareGoogleArtCollect } = await import(
      "../../capabilities/googleArt"
    );
    if (!hasTrustedGoogleArtZoom(executionContext)) return false;

    const zoomLevel = Number(userText);
    const preview = prepareGoogleArtCollect(executionContext, zoomLevel);
    if (!preview.ok) return false;

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

export function hasTrustedGoogleArtZoomSafe(
  executionContext?: CapabilityCallContext,
): boolean {
  try {
    return hasTrustedGoogleArtZoom(executionContext) === true;
  } catch {
    return false;
  }
}

/**
 * 衣设客户端 LangGraph Agent Runtime（模块化重构版）。
 *
 * 状态图拓扑（基于 @langchain/langgraph StateGraph）：
 *   __start__ -> prepareContext -> agent -> (tools -> prepareContext | __end__)
 *
 * 核心优化：
 * 1. 省 Token & Prompt Cache：按场景 Profile（default / media_ops / google_art）锁定精简工具集并按字典序固化前缀；
 *    prepareContext 节点在每次模型调用前折叠旧轮次工具结果并安全裁剪窗口。
 * 2. 高性能 & 真并发：去掉全局单例互斥，按 runId 独立管理 AbortController 与审批策略，支持前台对话与后台运营并发；
 *    tools 节点内只读工具并发执行（Promise.all），写/高危工具串行审批。
 * 3. 好维护：Google Arts 与本地直通快捷键全部拆至 middlewares/，核心运行时保持精简可读。
 */
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { CapabilityRegistry } from "../capabilities/registry";
import { registerAllCapabilities } from "../capabilities";
import type { CapabilityCallContext } from "../capabilities/types";
import { zodToJsonSchema } from "../mcp-server/server";
import { getActiveAgentConfig, type ClientAgentConfig } from "./agent-config";
import {
  fetchServerCapabilities,
  executeServerCapability,
  isServerToolName,
  toOriginalToolName,
  serverCapabilitiesToOpenAiTools,
  buildServerToolIndex,
  filterMissingServerCapabilities,
  type ServerCapabilityCatalog,
  type ServerCapabilityTool,
} from "./server-capabilities";
import {
  AGENT_PROFILES,
  listAgentProfiles,
  resolveAgentProfile,
  selectToolsForProfile,
} from "./profiles";
import {
  prepareMessagesForModel,
  serializeToolResultForModel,
} from "./context-trimmer";
import {
  buildDirectGoogleArtSearchCall,
  formatCollectNotExecutedMessage,
  formatGoogleArtCollectResult,
  formatGoogleArtZoomSelection,
  GOOGLE_ART_COLLECT_TIMEOUT_MS,
  hasTrustedGoogleArtZoomSafe,
  textClaimsGoogleArtCollectSuccess,
  TOOL_CALL_TIMEOUT_MS,
  toolResultError,
  tryAutoCollectZoomLevel,
  tryDirectGoogleArtSearch,
  tryDirectGoogleArtZoomSelection,
  userExplicitlySelectedGoogleArtZoom,
  withTimeout,
} from "./middlewares/google-art.middleware";
import {
  buildExplicitSearchToolCall,
  buildExplicitToolSelectionResponse,
  explicitToolsSystemInstruction,
  getSelectedToolsForTurn,
  tryDirectFilesystemDelete,
  tryDirectFilesystemRead,
} from "./middlewares/direct-shortcuts.middleware";
import type {
  AgentAttachment,
  AgentChatMessage,
  AgentProfileId,
  AgentRunOptions,
  AgentRunSnapshot,
  AgentSelectedTool,
  AgentStreamEvents,
  AgentTokenUsage,
  ClientAgentRuntimeStatus,
  GraphState,
  PendingToolCall,
} from "./types";

export type {
  AgentAttachment,
  AgentChatMessage,
  AgentProfileId,
  AgentRunOptions,
  AgentRunSnapshot,
  AgentSelectedTool,
  AgentStreamEvents,
  AgentTokenUsage,
  ClientAgentRuntimeStatus,
};

type GraphNode = (state: GraphState) => Promise<void>;

const MODEL_REQUEST_TIMEOUT_MS = 90_000;

export function getCapabilityOpenAiTools(
  namespaces?: string[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  registerAllCapabilities();
  const capabilities = CapabilityRegistry.list().filter((item) => {
    const definition = CapabilityRegistry.getDefinition(
      item.namespace,
      item.name,
    );
    return !(definition as any)?.hidden;
  });
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

/** 兼容旧导出：默认委托给 default Profile 的稳定工具选择器。 */
export function selectRelevantTools(
  prompt: string,
  allTools: OpenAI.Chat.Completions.ChatCompletionTool[],
  serverToolIndex?: Map<string, ServerCapabilityTool> | null,
  explicitToolNames: string[] = [],
) {
  return selectToolsForProfile(
    AGENT_PROFILES.default,
    prompt,
    allTools,
    serverToolIndex,
    explicitToolNames,
  );
}

/** LangGraph StateGraph 封装（优先使用官方 @langchain/langgraph，缺失依赖时无缝回退本地 runner）。 */
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

  async invoke(
    initial: GraphState,
    start: string,
    signal: AbortSignal,
    maxIterations: number,
  ) {
    const official = this.loadOfficialGraph(maxIterations);
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

  private loadOfficialGraph(maxIterations: number) {
    try {
      const packageName = ["@langchain", "langgraph"].join("/");
      const { StateGraph } = require(packageName) as { StateGraph: any };
      const value = (_left: unknown, right: unknown) => right;
      const stateGraph = new StateGraph({
        channels: {
          messages: { value, default: () => [] },
          preparedMessages: { value, default: () => [] },
          tools: { value, default: () => [] },
          profileId: { value, default: () => "default" },
          iteration: { value, default: () => 0 },
          finalText: { value, default: () => "" },
          finalReasoning: { value, default: () => "" },
          pendingToolCalls: { value, default: () => [] },
          googleArtCollectResults: { value, default: () => [] },
          awaitingGoogleArtZoomSelection: { value, default: () => false },
          explicitSelectedTools: { value, default: () => [] },
          usage: {
            value,
            default: () => ({
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              cachedTokens: 0,
            }),
          },
        },
      });
      for (const [name, node] of this.nodes) {
        stateGraph.addNode(name, async (state: GraphState) => {
          await node(state);
          return state;
        });
      }
      stateGraph
        .addEdge("__start__", "prepareContext")
        .addEdge("prepareContext", "agent")
        .addConditionalEdges("agent", (state: GraphState) =>
          state.pendingToolCalls.length && state.iteration < maxIterations
            ? "executeTools"
            : "__end__",
        )
        .addConditionalEdges("executeTools", (state: GraphState) =>
          state.awaitingGoogleArtZoomSelection ? "__end__" : "prepareContext",
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
    if (message.role === "assistant" && message.reasoning_content) {
      normalized.reasoning_content = message.reasoning_content;
    }
    return normalized;
  }) as any;
}

function parseLocalToolName(toolName: string): {
  namespace: string;
  capabilityName: string;
  separator: number;
} {
  const dotSeparator = toolName.indexOf(".");
  const underscoreSeparator = toolName.indexOf("_");
  const separator = dotSeparator > 0 ? dotSeparator : underscoreSeparator;
  return {
    namespace: separator > 0 ? toolName.slice(0, separator) : "",
    capabilityName: separator > 0 ? toolName.slice(separator + 1) : "",
    separator,
  };
}

export class ClientLangGraphAgent {
  /** 按 runId 独立管理的运行控制器，彻底支持多任务并发（如前台对话 + 后台媒体运营）。 */
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly runSnapshots = new Map<string, AgentRunSnapshot>();
  private readonly recentRuns: AgentRunSnapshot[] = [];
  private readonly waitQueue: Array<() => void> = [];
  private runningSlotCount = 0;
  /** 单客户端默认最多同时并发执行 4 个 Agent，超出自动排队避免限流或资源打满。 */
  maxConcurrency = 4;
  private readonly pendingApprovals = new Map<
    string,
    (approved: boolean) => void
  >();
  /** 兼容旧调用方直接赋值的默认开关；推荐改用 runOptions.autoApproveWrite。 */
  autoApproveWrite = false;

  private acquireSlot(signal: AbortSignal): Promise<void> {
    if (this.runningSlotCount < this.maxConcurrency) {
      this.runningSlotCount += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.waitQueue.indexOf(grant);
        if (idx >= 0) this.waitQueue.splice(idx, 1);
        const err = new Error("任务排队期间已取消");
        err.name = "AbortError";
        reject(err);
      };
      const grant = () => {
        signal.removeEventListener("abort", onAbort);
        this.runningSlotCount += 1;
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waitQueue.push(grant);
    });
  }

  private releaseSlot(): void {
    this.runningSlotCount = Math.max(0, this.runningSlotCount - 1);
    const next = this.waitQueue.shift();
    if (next) next();
  }

  private archiveSnapshot(
    snapshot: AgentRunSnapshot,
    status: "completed" | "failed" | "aborted",
    error?: string,
  ): void {
    const finishedAt = Date.now();
    const finalized: AgentRunSnapshot = {
      ...snapshot,
      status,
      currentTool: null,
      finishedAt,
      durationMs: finishedAt - snapshot.startedAt,
      usage: { ...snapshot.usage },
      ...(error ? { error } : {}),
    };
    this.runSnapshots.delete(snapshot.runId);
    this.recentRuns.unshift(finalized);
    if (this.recentRuns.length > 12) this.recentRuns.length = 12;
  }

  /** 终止指定 runId 的任务；不传 runId 时终止所有运行中的任务（兼容旧 IPC stop）。 */
  abort(runId?: string) {
    if (runId) {
      const controller = this.activeRuns.get(runId);
      if (controller) {
        controller.abort();
        this.activeRuns.delete(runId);
      }
      return;
    }
    for (const controller of this.activeRuns.values()) {
      controller.abort();
    }
    this.activeRuns.clear();
    for (const resolve of this.pendingApprovals.values()) resolve(false);
    this.pendingApprovals.clear();
  }

  getActiveRunCount(): number {
    return this.activeRuns.size;
  }

  /** 供客户端心跳与 Admin 管理端展示的多 Agent 实时运行态快照。 */
  getRuntimeStatus(): ClientAgentRuntimeStatus {
    const config = getActiveAgentConfig();
    const liveRuns = Array.from(this.runSnapshots.values()).map((s) => ({
      ...s,
      durationMs: Date.now() - s.startedAt,
      usage: { ...s.usage },
    }));
    const activeRuns = liveRuns.filter((s) => s.status === "running");
    const queuedRuns = liveRuns.filter((s) => s.status === "queued");
    return {
      enabled: Boolean(config.enabled),
      model: config.model || "",
      baseUrl: config.baseUrl || "",
      maxConcurrency: this.maxConcurrency,
      activeCount: activeRuns.length,
      queuedCount: queuedRuns.length,
      activeRuns: [...activeRuns, ...queuedRuns],
      recentRuns: this.recentRuns.slice(0, 8),
      profiles: listAgentProfiles().map(({ id, label, description }) => ({
        id,
        label,
        description,
      })),
    };
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

  /** 判断单次工具调用是否属于纯只读（可安全与其他只读调用并发执行）。 */
  private isParallelSafeReadOnlyCall(
    call: PendingToolCall,
    serverToolIndex: Map<string, ServerCapabilityTool> | null,
  ): boolean {
    if (isServerToolName(call.name)) {
      const catalogTool = serverToolIndex?.get(call.name);
      return Boolean(
        catalogTool &&
          catalogTool.readOnly === true &&
          catalogTool.confirmRequired !== true &&
          catalogTool.riskLevel !== "high",
      );
    }
    const { namespace, capabilityName } = parseLocalToolName(call.name);
    if (
      namespace === "googleArt" &&
      (capabilityName === "collect" || capabilityName === "zoom")
    ) {
      return false;
    }
    const def = namespace
      ? CapabilityRegistry.getDefinition(namespace, capabilityName)
      : undefined;
    return Boolean(
      def && def.riskLevel !== "write" && def.riskLevel !== "system",
    );
  }

  private async executeServerToolCall(
    call: PendingToolCall,
    args: Record<string, unknown>,
    events: AgentStreamEvents,
    signal: AbortSignal,
    autoApproveWrite: boolean,
    serverToolIndex: Map<string, ServerCapabilityTool> | null,
  ): Promise<AgentChatMessage> {
    const catalogTool = serverToolIndex?.get(call.name) || null;
    const toolName = catalogTool
      ? catalogTool.name
      : toOriginalToolName(call.name);
    const needsApproval =
      catalogTool?.confirmRequired === true ||
      catalogTool?.riskLevel === "high";

    if (needsApproval && !autoApproveWrite) {
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
        return {
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: serializeToolResultForModel(result),
        };
      }
    }

    events.onToolStart?.({ id: call.id, name: call.name, args });
    const startedAt = Date.now();
    let result: unknown;
    let error: string | undefined;
    try {
      result = await withTimeout(
        executeServerCapability(toolName, args, needsApproval || autoApproveWrite),
        TOOL_CALL_TIMEOUT_MS,
        `云端能力 ${call.name}`,
      );
      if (
        result &&
        typeof result === "object" &&
        (result as any).status === "requires_confirmation"
      ) {
        if (autoApproveWrite) {
          result = await withTimeout(
            executeServerCapability(toolName, args, true),
            TOOL_CALL_TIMEOUT_MS,
            `云端能力 ${call.name}`,
          );
        } else {
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
    return {
      role: "tool",
      tool_call_id: call.id,
      name: call.name,
      content: serializeToolResultForModel(result),
    };
  }

  private async executeLocalToolCall(
    call: PendingToolCall,
    rawArgs: Record<string, unknown>,
    current: GraphState,
    events: AgentStreamEvents,
    signal: AbortSignal,
    autoApproveWrite: boolean,
    executionContext?: CapabilityCallContext,
  ): Promise<{ message: AgentChatMessage; stopAfterZoom?: string }> {
    let args = rawArgs;
    const { namespace, capabilityName, separator } = parseLocalToolName(
      call.name,
    );
    const definition = namespace
      ? CapabilityRegistry.getDefinition(namespace, capabilityName)
      : undefined;
    const isGoogleArtCollect =
      namespace === "googleArt" && capabilityName === "collect";
    const isGoogleArtZoom =
      namespace === "googleArt" && capabilityName === "zoom";

    if (isGoogleArtCollect) {
      if (
        !userExplicitlySelectedGoogleArtZoom(current.messages, args?.zoomLevel)
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
        return {
          message: {
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: serializeToolResultForModel(result),
          },
        };
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
        return {
          message: {
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: serializeToolResultForModel(result),
          },
        };
      }
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
      (definition.riskLevel === "write" || definition.riskLevel === "system") &&
      !autoApproveWrite
    ) {
      events.onToolApproval?.({
        id: call.id,
        name: call.name,
        args,
        riskLevel: definition.riskLevel,
        description: definition.description,
      });
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
        if (isGoogleArtCollect) current.googleArtCollectResults.push(result);
        events.onToolEnd?.({
          id: call.id,
          name: call.name,
          result,
          durationMs: 0,
          error: result.error,
        });
        return {
          message: {
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: serializeToolResultForModel(result),
          },
        };
      }
    }

    events.onToolStart?.({ id: call.id, name: call.name, args });
    const startedAt = Date.now();
    let result: unknown;
    let error: string | undefined;
    try {
      if (separator < 1) throw new Error(`未知工具名称格式: ${call.name}`);
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
    const message: AgentChatMessage = {
      role: "tool",
      tool_call_id: call.id,
      name: call.name,
      content: serializeToolResultForModel(result),
    };
    if (isGoogleArtZoom && !reportedError) {
      const selection = formatGoogleArtZoomSelection(result);
      if (selection) {
        return { message, stopAfterZoom: selection };
      }
    }
    return { message };
  }

  async run(
    historyMessages: AgentChatMessage[],
    rawEvents: AgentStreamEvents,
    customConfig?: Partial<ClientAgentConfig>,
    executionContext?: CapabilityCallContext,
    runOptions?: AgentRunOptions,
  ) {
    const runId = executionContext?.runId || randomUUID();
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);
    const signal = controller.signal;
    const autoApproveWrite =
      runOptions?.autoApproveWrite ?? this.autoApproveWrite;

    const lastUserMsg = [...historyMessages]
      .reverse()
      .find((m) => m.role === "user");
    const titleText =
      typeof lastUserMsg?.content === "string"
        ? lastUserMsg.content.trim().slice(0, 48)
        : "Agent 任务";
    const profile = resolveAgentProfile(runOptions?.profile, historyMessages);

    const snapshot: AgentRunSnapshot = {
      runId,
      sessionId: executionContext?.sessionId,
      profileId: profile.id,
      title: titleText || "Agent 任务",
      status: "queued",
      currentTool: null,
      iteration: 0,
      startedAt: Date.now(),
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
      },
    };
    this.runSnapshots.set(runId, snapshot);

    // 包装事件回调，实时同步工具执行与 Token 统计到运行态快照
    const events: AgentStreamEvents = {
      ...rawEvents,
      onToolStart: (toolCall) => {
        snapshot.currentTool = toolCall.name;
        rawEvents.onToolStart?.(toolCall);
      },
      onToolEnd: (toolResult) => {
        snapshot.currentTool = null;
        rawEvents.onToolEnd?.(toolResult);
      },
      onUsage: (usage) => {
        snapshot.usage = { ...usage };
        rawEvents.onUsage?.(usage);
      },
    };

    let slotAcquired = false;
    let settledStatus: "completed" | "failed" | "aborted" = "completed";
    let settledError: string | undefined;

    try {
      await this.acquireSlot(signal);
      slotAcquired = true;
      snapshot.status = "running";

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
      let serverCatalog: ServerCapabilityCatalog | null = null;
      let serverToolIndex: Map<string, ServerCapabilityTool> | null = null;
      try {
        serverCatalog = await fetchServerCapabilities();
        if (serverCatalog?.tools?.length) {
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
      const maxIterations = runOptions?.maxIterations ?? profile.maxIterations;

      const systemParts = [
        config.systemPrompt || "",
        profile.systemPromptAppendix,
        explicitInstruction || "",
      ].filter(Boolean);

      const state: GraphState = {
        messages: [
          { role: "system", content: systemParts.join("\n\n") },
          ...historyMessages,
        ],
        preparedMessages: [],
        tools: selectToolsForProfile(
          profile,
          typeof lastUser?.content === "string" ? lastUser.content : "",
          allTools,
          serverToolIndex,
          explicitSelectedTools.map((item) => item.name),
        ),
        profileId: profile.id,
        iteration: 0,
        finalText: "",
        finalReasoning: "",
        pendingToolCalls: [],
        googleArtCollectResults: [],
        awaitingGoogleArtZoomSelection: false,
        explicitSelectedTools,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cachedTokens: 0,
        },
      };

      // 确定性直通快捷键（仅在命中时绕过模型，节省 Token 且避免幻觉）
      const shortcutResponders: Array<() => Promise<string | null> | string | null> =
        [
          () => tryDirectGoogleArtSearch(state, events, executionContext),
          () => tryDirectGoogleArtZoomSelection(state, events, executionContext),
          () => tryDirectFilesystemRead(state, events, executionContext),
          () => tryDirectFilesystemDelete(state, events, executionContext),
          () => buildExplicitToolSelectionResponse(state),
        ];

      for (const responder of shortcutResponders) {
        const directText = await responder();
        if (directText !== null) {
          state.finalText = directText;
          state.messages.push({ role: "assistant", content: directText });
          events.onContent?.(directText);
          events.onComplete?.(directText, "", state.usage);
          return {
            text: directText,
            reasoning: "",
            messages: state.messages,
            usage: state.usage,
          };
        }
      }

      const graph = new ClientStateGraph()
        // 节点 1：上下文瘦身与旧工具结果折叠（每轮模型调用前自动执行）
        .addNode("prepareContext", async (current) => {
          current.preparedMessages = prepareMessagesForModel(current.messages);
        })
        // 节点 2：模型流式推理与工具意图决策
        .addNode("agent", async (current) => {
          current.iteration += 1;
          current.pendingToolCalls = [];

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
          const hasTrustedZoom = hasTrustedGoogleArtZoomSafe(executionContext);
          const mustGuardCollectClaim =
            !mustGroundGoogleArtCollect &&
            hasTrustedZoom &&
            !current.googleArtCollectResults.some(
              (result) => result?.success === true,
            );
          const bufferOutput =
            mustGroundGoogleArtCollect || mustGuardCollectClaim;

          const baseReq: any = {
            model: config.model || "deepseek-chat",
            messages: openAiMessages(
              current.preparedMessages.length
                ? current.preparedMessages
                : current.messages,
            ),
            tools: current.tools.length ? current.tools : undefined,
            temperature: config.temperature ?? 0.7,
            max_tokens: config.maxTokens ?? 4096,
            stream: true,
          };

          let stream: any;
          try {
            stream = await client.chat.completions.create(
              { ...baseReq, stream_options: { include_usage: true } },
              { signal },
            );
          } catch (err: any) {
            // 部分兼容网关不支持 stream_options 会返回 400/422，自动无感降级重试
            const status = Number(err?.status || err?.statusCode || 0);
            if (
              status === 400 ||
              status === 422 ||
              /stream_options|unknown|unrecognized|invalid/i.test(
                String(err?.message || ""),
              )
            ) {
              stream = await client.chat.completions.create(baseReq, { signal });
            } else {
              throw err;
            }
          }

          let text = "";
          let reasoning = "";
          const calls: Record<number, PendingToolCall> = {};
          for await (const chunk of stream) {
            const chunkUsage = (chunk as any)?.usage;
            if (chunkUsage) {
              current.usage.promptTokens += Number(
                chunkUsage.prompt_tokens || 0,
              );
              current.usage.completionTokens += Number(
                chunkUsage.completion_tokens || 0,
              );
              current.usage.totalTokens += Number(chunkUsage.total_tokens || 0);
              current.usage.cachedTokens += Number(
                chunkUsage.prompt_cache_hit_tokens ||
                  chunkUsage.prompt_tokens_details?.cached_tokens ||
                  0,
              );
              events.onUsage?.({ ...current.usage });
            }

            const delta = chunk.choices?.[0]?.delta as any;
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
            if (textClaimsGoogleArtCollectSuccess(text)) {
              text = formatCollectNotExecutedMessage(
                executionContext,
                current.googleArtCollectResults,
              );
            }
            current.finalText += text;
            events.onContent?.(text);
          } else if (bufferOutput && !isFinalTurn && text) {
            current.finalText += text;
            events.onContent?.(text);
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
        // 节点 3：工具执行（只读工具 Promise.all 并发，写/高危工具串行审批）
        .addNode("executeTools", async (current) => {
          const parsedCalls = current.pendingToolCalls.map((call, index) => {
            let args: Record<string, unknown> = {};
            try {
              args = call.arguments ? JSON.parse(call.arguments) : {};
            } catch {
              /* partial JSON */
            }
            return {
              index,
              call,
              args,
              parallelSafe: this.isParallelSafeReadOnlyCall(
                call,
                serverToolIndex,
              ),
            };
          });

          const resultsByIndex = new Map<number, AgentChatMessage>();
          const parallelBatch = parsedCalls.filter((item) => item.parallelSafe);
          const sequentialBatch = parsedCalls.filter(
            (item) => !item.parallelSafe,
          );

          // 1) 并发执行所有只读工具
          if (parallelBatch.length && !signal.aborted) {
            await Promise.all(
              parallelBatch.map(async (item) => {
                if (signal.aborted) return;
                if (isServerToolName(item.call.name)) {
                  const msg = await this.executeServerToolCall(
                    item.call,
                    item.args,
                    events,
                    signal,
                    autoApproveWrite,
                    serverToolIndex,
                  );
                  resultsByIndex.set(item.index, msg);
                } else {
                  const res = await this.executeLocalToolCall(
                    item.call,
                    item.args,
                    current,
                    events,
                    signal,
                    autoApproveWrite,
                    executionContext,
                  );
                  resultsByIndex.set(item.index, res.message);
                }
              }),
            );
          }

          // 2) 串行执行需要审批或有副作用的工具
          let stopAfterZoomText: string | null = null;
          for (const item of sequentialBatch) {
            if (signal.aborted) break;
            if (isServerToolName(item.call.name)) {
              const msg = await this.executeServerToolCall(
                item.call,
                item.args,
                events,
                signal,
                autoApproveWrite,
                serverToolIndex,
              );
              resultsByIndex.set(item.index, msg);
            } else {
              const res = await this.executeLocalToolCall(
                item.call,
                item.args,
                current,
                events,
                signal,
                autoApproveWrite,
                executionContext,
              );
              resultsByIndex.set(item.index, res.message);
              if (res.stopAfterZoom) {
                stopAfterZoomText = res.stopAfterZoom;
                break;
              }
            }
          }

          // 严格按原始 tool_calls 顺序写回消息历史
          for (const item of parsedCalls) {
            const msg = resultsByIndex.get(item.index);
            if (msg) current.messages.push(msg);
          }

          if (stopAfterZoomText) {
            current.awaitingGoogleArtZoomSelection = true;
            current.finalText += stopAfterZoomText;
            events.onContent?.(stopAfterZoomText);
          }
        })
        .addConditionalEdges("prepareContext", () => "agent")
        .addConditionalEdges("agent", (current) =>
          current.pendingToolCalls.length && current.iteration < maxIterations
            ? "executeTools"
            : "END",
        )
        .addConditionalEdges("executeTools", (current) =>
          current.awaitingGoogleArtZoomSelection ? "END" : "prepareContext",
        );

      const result = await graph.invoke(
        state,
        "prepareContext",
        signal,
        maxIterations,
      );
      snapshot.iteration = result.iteration || snapshot.iteration;
      if (result.usage) snapshot.usage = { ...result.usage };
      settledStatus = "completed";
      events.onComplete?.(result.finalText, result.finalReasoning, result.usage);
      return {
        text: result.finalText,
        reasoning: result.finalReasoning,
        messages: result.messages,
        usage: result.usage,
      };
    } catch (error: any) {
      if (error?.name === "AbortError" || signal.aborted) {
        settledStatus = "aborted";
        events.onComplete?.("", "");
        return {
          text: "",
          reasoning: "",
          messages: historyMessages,
        };
      }
      settledStatus = "failed";
      settledError = error?.message || "Agent 执行过程发生错误";
      events.onError?.(settledError);
      throw error;
    } finally {
      if (slotAcquired) this.releaseSlot();
      this.activeRuns.delete(runId);
      this.archiveSnapshot(snapshot, settledStatus, settledError);
    }
  }
}

export const clientLangGraphAgent = new ClientLangGraphAgent();

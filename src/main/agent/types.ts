/**
 * 客户端 LangGraph Agent 公共类型定义。
 */
import type OpenAI from "openai";
import type { CapabilityCallContext } from "../capabilities/types";

export type AgentProfileId = "default" | "media_ops" | "google_art";

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
  /** 前端回放工具调用卡片用的结构化记录（支持远程任务与历史会话回看）。 */
  toolCalls?: Array<{
    id: string;
    name: string;
    args: any;
    result?: any;
    durationMs?: number;
    error?: string;
    status: "running" | "success" | "error";
  }>;
}

export interface AgentTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
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
  onUsage?: (usage: AgentTokenUsage) => void;
  onComplete?: (
    fullText: string,
    fullReasoning: string,
    usage?: AgentTokenUsage,
  ) => void;
  onError?: (error: string) => void;
}

export interface AgentProfile {
  id: AgentProfileId;
  label: string;
  description: string;
  /** 附加在基础 systemPrompt 之后的场景规则（仅该场景加载，避免污染全局前缀）。 */
  systemPromptAppendix: string;
  /** 本场景固定挂载的本地能力命名空间，确保同会话内工具前缀稳定以命中 Prompt Cache。 */
  localNamespaces: string[];
  /** 本场景固定挂载的服务端能力大类。 */
  serverCategories: string[];
  /** 工具数量硬上限，防止过多 schema 消耗 Token。 */
  maxTools: number;
  /** 单次运行最大迭代轮数。 */
  maxIterations: number;
}

export interface AgentRunOptions {
  /** 指定场景 Profile（未指定时自动识别，默认 default）。 */
  profile?: AgentProfileId;
  /** 是否自动放行写操作（HTTP API / 后台定时工作流可开启，互不影响其他并发任务）。 */
  autoApproveWrite?: boolean;
  /** 自定义最大迭代轮数。 */
  maxIterations?: number;
}

export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface GraphState {
  messages: AgentChatMessage[];
  /** 经 prepareContext 折叠与裁剪后实际发给模型的消息视图（不破坏原始会话历史）。 */
  preparedMessages: AgentChatMessage[];
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  profileId: AgentProfileId;
  iteration: number;
  finalText: string;
  finalReasoning: string;
  pendingToolCalls: PendingToolCall[];
  /** Google Arts 写工具的真实结果；用于替换模型自由发挥的最终成功/失败总结。 */
  googleArtCollectResults: Array<Record<string, any>>;
  /** zoom 成功后必须结束本回合，等待下一条用户消息明确选择分辨率。 */
  awaitingGoogleArtZoomSelection: boolean;
  explicitSelectedTools: AgentSelectedTool[];
  usage: AgentTokenUsage;
}

export interface RunExecutionMeta {
  runId: string;
  sessionId?: string;
  executionContext?: CapabilityCallContext;
  signal: AbortSignal;
  autoApproveWrite: boolean;
}

export interface AgentRunSnapshot {
  runId: string;
  sessionId?: string;
  profileId: AgentProfileId;
  title: string;
  status: "queued" | "running" | "completed" | "failed" | "aborted";
  currentTool?: string | null;
  iteration: number;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  usage: AgentTokenUsage;
  error?: string;
}

export interface ClientAgentRuntimeStatus {
  enabled: boolean;
  model: string;
  baseUrl: string;
  maxConcurrency: number;
  activeCount: number;
  queuedCount: number;
  activeRuns: AgentRunSnapshot[];
  recentRuns: AgentRunSnapshot[];
  profiles: Array<{
    id: AgentProfileId;
    label: string;
    description: string;
  }>;
}

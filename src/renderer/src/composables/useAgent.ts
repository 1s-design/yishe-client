import { ref } from "vue";
import type {
  AttachmentData,
  AgentConfig,
  ChatMessage,
  ChatSession,
  ToolCallItem,
  ToolApprovalInteraction,
} from "../types/agent";

interface AgentApi {
  sendMessage(payload: {
    runId: string;
    sessionId: string;
    messages: unknown[];
    config?: Partial<AgentConfig>;
  }): void;
  stop(): Promise<{ success: boolean }>;
  resolveToolApproval(payload: {
    callId: string;
    approved: boolean;
  }): Promise<{ success: boolean }>;
  getConfig(): Promise<AgentConfig>;
  saveConfig(config: Partial<AgentConfig>): Promise<AgentConfig>;
  syncCloudConfig(payload: {
    serverBase: string;
    token: string;
  }): Promise<AgentConfig>;
  onReasoning(
    callback: (data: StreamPayload & { delta: string }) => void,
  ): () => void;
  onContent(
    callback: (data: StreamPayload & { delta: string }) => void,
  ): () => void;
  onToolApproval(
    callback: (
      data: StreamPayload & {
        id: string;
        name: string;
        args: Record<string, unknown>;
        riskLevel: ToolApprovalInteraction["riskLevel"];
        description?: string;
      },
    ) => void,
  ): () => void;
  onToolStart(
    callback: (data: StreamPayload & ToolCallItem) => void,
  ): () => void;
  onToolEnd(callback: (data: StreamPayload & ToolCallItem) => void): () => void;
  onComplete(
    callback: (
      data: StreamPayload & { fullText: string; fullReasoning: string },
    ) => void,
  ): () => void;
  onError(
    callback: (data: StreamPayload & { error: string }) => void,
  ): () => void;
}

interface StreamPayload {
  runId: string;
  sessionId: string;
}

const sessions = ref<ChatSession[]>([]);
const activeSessionId = ref<string | null>(null);
const isStreaming = ref(false);
const streamingContent = ref("");
const streamingReasoning = ref("");
const streamingToolCalls = ref<ToolCallItem[]>([]);
const currentAssistantMessageId = ref<string | null>(null);
const activeRunId = ref<string | null>(null);
let listenersReady = false;

function api(): AgentApi | null {
  return (
    (window as unknown as { api?: { agent?: AgentApi } }).api?.agent ?? null
  );
}

function id(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadSessions(): ChatSession[] {
  try {
    const value = JSON.parse(
      localStorage.getItem("yishe-agent-sessions") || "[]",
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(
      "yishe-agent-sessions",
      JSON.stringify(sessions.value),
    );
  } catch {
    /* storage is optional */
  }
}

function currentMessage(): ChatMessage | undefined {
  const session = sessions.value.find(
    (item) => item.id === activeSessionId.value,
  );
  return session?.messages.find(
    (item) => item.id === currentAssistantMessageId.value,
  );
}

function acceptsEvent(payload: StreamPayload) {
  return (
    payload.runId === activeRunId.value &&
    payload.sessionId === activeSessionId.value
  );
}

function ensureListeners() {
  if (listenersReady) return;
  const agent = api();
  if (!agent) return;
  listenersReady = true;

  agent.onReasoning((event) => {
    if (!acceptsEvent(event)) return;
    streamingReasoning.value += event.delta;
    const message = currentMessage();
    if (message) message.reasoning = streamingReasoning.value;
  });
  agent.onContent((event) => {
    if (!acceptsEvent(event)) return;
    streamingContent.value += event.delta;
    const message = currentMessage();
    if (message) message.content = streamingContent.value;
  });
  agent.onToolApproval((event) => {
    if (!acceptsEvent(event)) return;
    const message = currentMessage();
    if (!message) return;
    message.interaction = {
      id: event.id,
      type: "tool_approval",
      toolName: event.name,
      args: event.args || {},
      riskLevel: event.riskLevel,
      description: event.description,
      status: "pending",
    };
    persist();
  });
  agent.onToolStart((event) => {
    if (!acceptsEvent(event)) return;
    streamingToolCalls.value.push({
      id: event.id,
      name: event.name,
      args: event.args || {},
      status: "running",
    });
    const message = currentMessage();
    if (message) message.toolCalls = [...streamingToolCalls.value];
  });
  agent.onToolEnd((event) => {
    if (!acceptsEvent(event)) return;
    const item = streamingToolCalls.value.find((tool) => tool.id === event.id);
    if (item)
      Object.assign(item, {
        result: event.result,
        durationMs: event.durationMs,
        error: event.error,
        status: event.error ? "error" : "success",
      });
    const message = currentMessage();
    if (message) message.toolCalls = [...streamingToolCalls.value];
  });
  agent.onComplete((event) => {
    if (!acceptsEvent(event)) return;
    finish(event.fullText, event.fullReasoning);
  });
  agent.onError((event) => {
    if (!acceptsEvent(event)) return;
    const message = currentMessage();
    if (message) {
      message.error = event.error;
      message.isStreaming = false;
    }
    resetStream();
    persist();
  });
}

function resetStream() {
  isStreaming.value = false;
  streamingContent.value = "";
  streamingReasoning.value = "";
  streamingToolCalls.value = [];
  currentAssistantMessageId.value = null;
  activeRunId.value = null;
}

function finish(content: string, reasoning: string) {
  const message = currentMessage();
  if (message) {
    message.content = content || message.content;
    message.reasoning = reasoning || message.reasoning;
    message.isStreaming = false;
  }
  const session = sessions.value.find(
    (item) => item.id === activeSessionId.value,
  );
  if (session) session.updatedAt = Date.now();
  resetStream();
  persist();
}

function createSession(): ChatSession {
  const session: ChatSession = {
    id: id("session"),
    title: "新对话",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.value.unshift(session);
  activeSessionId.value = session.id;
  persist();
  return session;
}

function setActiveSession(sessionId: string) {
  if (isStreaming.value) return;
  if (sessions.value.some((item) => item.id === sessionId))
    activeSessionId.value = sessionId;
}

function deleteSession(sessionId: string) {
  if (isStreaming.value) return;
  sessions.value = sessions.value.filter((item) => item.id !== sessionId);
  if (activeSessionId.value === sessionId)
    activeSessionId.value = sessions.value[0]?.id ?? null;
  persist();
}

function toAgentMessage(message: ChatMessage) {
  // UI 的 toolCalls 是展示用结构（name / args / result / status），不是 OpenAI 的
  // tool_calls 协议。将它作为历史再次提交会让第二轮请求携带无效工具调用并卡在模型端。
  // 工具结果已由上一轮助手文本总结，后续上下文只需保留可读的消息内容与用户附件。
  return {
    role: message.role,
    content: message.content,
    ...(message.role === "user" && message.attachments?.length
      ? { attachments: message.attachments }
      : {}),
  };
}

async function sendMessage(
  content: string,
  attachments: AttachmentData[] = [],
) {
  if (isStreaming.value || (!content.trim() && attachments.length === 0))
    return;
  let session = sessions.value.find(
    (item) => item.id === activeSessionId.value,
  );
  if (!session) session = createSession();

  const userMessage: ChatMessage = {
    id: id("message"),
    role: "user",
    content: content.trim(),
    attachments: attachments.length ? [...attachments] : undefined,
    timestamp: Date.now(),
  };
  const assistantMessage: ChatMessage = {
    id: id("message"),
    role: "assistant",
    content: "",
    reasoning: "",
    toolCalls: [],
    timestamp: Date.now(),
    isStreaming: true,
  };
  session.messages.push(userMessage, assistantMessage);
  if (session.messages.filter((item) => item.role === "user").length === 1)
    session.title = (content.trim() || "图片附件分析").slice(0, 32);
  session.updatedAt = Date.now();

  const runId = id("run");
  activeRunId.value = runId;
  currentAssistantMessageId.value = assistantMessage.id;
  isStreaming.value = true;
  streamingContent.value = "";
  streamingReasoning.value = "";
  streamingToolCalls.value = [];
  persist();

  const agent = api();
  if (!agent) {
    const message = currentMessage();
    if (message) {
      message.error = "Agent IPC 不可用";
      message.isStreaming = false;
    }
    resetStream();
    return;
  }

  agent.sendMessage({
    runId,
    sessionId: session.id,
    messages: session.messages
      .filter((item) => !item.isStreaming)
      .map(toAgentMessage),
  });
}

async function resolveToolApproval(callId: string, approved: boolean) {
  const message = currentMessage();
  if (message?.interaction?.id === callId) {
    message.interaction.status = approved ? "approved" : "rejected";
    persist();
  }
  return api()?.resolveToolApproval({ callId, approved }) ?? { success: false };
}

async function stopGeneration() {
  if (!isStreaming.value) return;
  await api()?.stop();
  const message = currentMessage();
  if (message) message.isStreaming = false;
  resetStream();
  persist();
}

export function useAgent() {
  if (sessions.value.length === 0) {
    sessions.value = loadSessions();
    activeSessionId.value = sessions.value[0]?.id ?? null;
  }
  ensureListeners();

  return {
    sessions,
    activeSessionId,
    isStreaming,
    streamingContent,
    streamingReasoning,
    streamingToolCalls,
    createSession,
    setActiveSession,
    deleteSession,
    sendMessage,
    stopGeneration,
    resolveToolApproval,
    getConfig: () => api()?.getConfig() ?? Promise.resolve(null),
    saveConfig: (config: Partial<AgentConfig>) =>
      api()?.saveConfig(config) ?? Promise.resolve(config as AgentConfig),
    syncCloudConfig: (payload: { serverBase: string; token: string }) =>
      api()?.syncCloudConfig(payload) ?? Promise.resolve(null),
  };
}

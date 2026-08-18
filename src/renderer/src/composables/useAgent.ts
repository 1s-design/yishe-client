import { ref } from "vue";
import type {
  AttachmentData,
  AgentConfig,
  ChatMessage,
  ChatSession,
  ToolCallItem,
} from "../types/agent";

interface StreamPayload {
  runId: string;
  sessionId: string;
}

// 本地 Agent API 地址（与 server.ts 监听端口一致）
const AGENT_BASE = "http://localhost:1519/api/agent";

const sessions = ref<ChatSession[]>([]);
const activeSessionId = ref<string | null>(null);
const isStreaming = ref(false);
const streamingContent = ref("");
const streamingReasoning = ref("");
const streamingToolCalls = ref<ToolCallItem[]>([]);
const currentAssistantMessageId = ref<string | null>(null);
const activeRunId = ref<string | null>(null);
let abortController: AbortController | null = null;

function id(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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

/** 从任意嵌套对象中提取 http(s) 图片 URL 列表（缩略图/图片字段），去重并限量 */
function extractImageUrls(value: unknown, limit = 12): string[] {
  const urls = new Set<string>();
  const IMG = /(?:\.(?:jpe?g|png|webp|gif|avif|bmp|svg)|images|photos|cdn\.|gettr|notes)/i;
  const scan = (node: unknown, key?: string) => {
    if (urls.size >= limit) return;
    if (typeof node === "string") {
      const url = node.trim();
      if (/^https?:\/\//i.test(url) && (IMG.test(url) || /(thumbnail|image|photo|thumb|pic|img|preview)/i.test(key || ""))) {
        urls.add(url);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) scan(item);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        scan(v, k);
      }
    }
  };
  scan(value);
  return [...urls];
}

function toAttachment(url: string, index: number): AttachmentData {
  return {
    id: `img_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
    name: `图片 ${index + 1}`,
    filename: `image-${index + 1}`,
    mediaType: "image/jpeg",
    size: 0,
    url,
  };
}

function resetStream() {
  isStreaming.value = false;
  streamingContent.value = "";
  streamingReasoning.value = "";
  streamingToolCalls.value = [];
  currentAssistantMessageId.value = null;
  activeRunId.value = null;
  abortController = null;
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
}

// ── HTTP API 调用 ──────────────────────────────────────────

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${AGENT_BASE}${path}`);
  return res.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${AGENT_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── 服务端会话类型（列表接口返回） ────────────────────────

interface SessionListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

// ── 服务端消息类型 ────────────────────────────────────────

interface ServerChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
  attachments?: AttachmentData[];
  reasoning_content?: string;
  tool_call_id?: string;
  name?: string;
}

function serverMessageToChatMessage(msg: ServerChatMessage, idx: number): ChatMessage {
  let content = "";
  if (typeof msg.content === "string") {
    content = msg.content;
  } else if (Array.isArray(msg.content)) {
    content = msg.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
  }
  return {
    id: `srv_${idx}_${Date.now()}`,
    role: msg.role === "tool" ? "assistant" : msg.role,
    content,
    reasoning: msg.reasoning_content,
    timestamp: Date.now(),
    attachments: msg.attachments,
    isStreaming: false,
  };
}

// ── 从服务端加载会话 ──────────────────────────────────────

async function loadSessionsFromApi(): Promise<ChatSession[]> {
  try {
    const res = await apiGet<{ success: boolean; data: SessionListItem[] }>("/sessions");
    if (res.success && Array.isArray(res.data)) {
      return res.data.map(s => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messages: [],
      }));
    }
    return [];
  } catch {
    return [];
  }
}

async function loadSessionDetail(sessionId: string): Promise<ChatSession | null> {
  try {
    const res = await apiGet<{ success: boolean; data: { id: string; title: string; createdAt: number; updatedAt: number; messages: ServerChatMessage[] } }>(`/sessions/${sessionId}`);
    if (res.success && res.data) {
      const messages = res.data.messages.map((m, i) => serverMessageToChatMessage(m, i));
      return {
        id: res.data.id,
        title: res.data.title,
        createdAt: res.data.createdAt,
        updatedAt: res.data.updatedAt,
        messages,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── SSE 流式处理 ──────────────────────────────────────────

async function processSSEStream(
  response: Response,
  runId: string,
  sessionId: string,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("无法读取响应流");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const dataStr = line.slice(6);
        try {
          const data = JSON.parse(dataStr);
          handleSSEEvent(currentEvent, data, { runId, sessionId });
        } catch {
          // 忽略解析失败的行
        }
        currentEvent = "";
      }
    }
  }
}

function handleSSEEvent(
  event: string,
  data: any,
  payload: StreamPayload,
) {
  switch (event) {
    case "reasoning":
      if (!acceptsEvent(payload)) return;
      streamingReasoning.value += data.delta;
      const msg = currentMessage();
      if (msg) msg.reasoning = streamingReasoning.value;
      break;

    case "content":
      if (!acceptsEvent(payload)) return;
      streamingContent.value += data.delta;
      const msg2 = currentMessage();
      if (msg2) msg2.content = streamingContent.value;
      break;

    case "tool_approval":
      if (!acceptsEvent(payload)) return;
      const approvalMsg = currentMessage();
      if (!approvalMsg) return;
      approvalMsg.interaction = {
        id: data.id,
        type: "tool_approval",
        toolName: data.name,
        args: data.args || {},
        riskLevel: data.riskLevel,
        description: data.description,
        status: "pending",
      };
      break;

    case "tool_start":
      if (!acceptsEvent(payload)) return;
      streamingToolCalls.value.push({
        id: data.id,
        name: data.name,
        args: data.args || {},
        status: "running",
      });
      const startMsg = currentMessage();
      if (startMsg) startMsg.toolCalls = [...streamingToolCalls.value];
      break;

    case "tool_end":
      if (!acceptsEvent(payload)) return;
      const item = streamingToolCalls.value.find((tool) => tool.id === data.id);
      if (item)
        Object.assign(item, {
          result: data.result,
          durationMs: data.durationMs,
          error: data.error,
          status: data.error ? "error" : "success",
        });
      const endMsg = currentMessage();
      if (endMsg) endMsg.toolCalls = [...streamingToolCalls.value];

      if (!data.error && data.result) {
        const imageUrls = extractImageUrls(data.result, 12);
        if (imageUrls.length) {
          const next = [
            ...(endMsg?.attachments || []),
            ...imageUrls.map((url, i) => toAttachment(url, i)),
          ];
          if (endMsg) endMsg.attachments = next;
        }
      }
      break;

    case "complete":
      if (!acceptsEvent(payload)) return;
      finish(data.fullText, data.fullReasoning);
      refreshSessions();
      break;

    case "error":
      if (!acceptsEvent(payload)) return;
      const errMsg = currentMessage();
      if (errMsg) {
        errMsg.error = data.error;
        errMsg.isStreaming = false;
      }
      resetStream();
      break;
  }
}

async function refreshSessions() {
  try {
    const remote = await loadSessionsFromApi();
    if (remote.length > 0) {
      sessions.value = sessions.value.map(local => {
        const remoteSession = remote.find(r => r.id === local.id);
        if (remoteSession && local.messages.length > 0) {
          return { ...remoteSession, messages: local.messages };
        }
        return remoteSession || local;
      });
      for (const r of remote) {
        if (!sessions.value.some(s => s.id === r.id)) {
          sessions.value.push(r);
        }
      }
    }
  } catch {
    // 忽略刷新失败
  }
}

// ── 公开方法 ──────────────────────────────────────────────

async function initSessions() {
  sessions.value = await loadSessionsFromApi();
  activeSessionId.value = sessions.value[0]?.id ?? null;
  if (activeSessionId.value) {
    const detail = await loadSessionDetail(activeSessionId.value);
    if (detail) {
      const idx = sessions.value.findIndex(s => s.id === detail.id);
      if (idx >= 0) {
        sessions.value[idx] = { ...sessions.value[idx], messages: detail.messages };
      }
    }
  }
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
  apiPost("/sessions", { id: session.id, title: session.title }).catch(() => {});
  return session;
}

function setActiveSession(sessionId: string) {
  if (isStreaming.value) return;
  if (sessions.value.some((item) => item.id === sessionId)) {
    activeSessionId.value = sessionId;
    loadSessionDetail(sessionId).then((detail) => {
      if (detail) {
        const idx = sessions.value.findIndex(s => s.id === detail.id);
        if (idx >= 0) {
          sessions.value[idx] = { ...sessions.value[idx], messages: detail.messages };
        }
      }
    });
  }
}

function deleteSession(sessionId: string) {
  if (isStreaming.value) return;
  sessions.value = sessions.value.filter((item) => item.id !== sessionId);
  if (activeSessionId.value === sessionId)
    activeSessionId.value = sessions.value[0]?.id ?? null;
  fetch(`${AGENT_BASE}/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
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

  abortController = new AbortController();

  try {
    const response = await fetch(`${AGENT_BASE}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        text: content.trim(),
        attachments: attachments.length ? attachments : undefined,
        autoApprove: false,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    await processSSEStream(response, runId, session.id);
  } catch (err: any) {
    if (err.name === "AbortError") {
      // 用户主动停止
    } else {
      const message = currentMessage();
      if (message) {
        message.error = err?.message || "请求失败";
        message.isStreaming = false;
      }
    }
    resetStream();
  }
}

async function resolveToolApproval(callId: string, approved: boolean) {
  const message = currentMessage();
  if (message?.interaction?.id === callId) {
    message.interaction.status = approved ? "approved" : "rejected";
  }
  try {
    await apiPost("/approve", { callId, approved });
  } catch {
    // 忽略审批请求失败
  }
}

async function stopGeneration() {
  if (!isStreaming.value) return;
  abortController?.abort();
  try {
    await apiPost("/stop");
  } catch {
    // 忽略停止请求失败
  }
  const message = currentMessage();
  if (message) message.isStreaming = false;
  resetStream();
}

// ── 配置相关（保留 IPC 实现，需要从云端同步） ────────────

async function getConfig(): Promise<AgentConfig | null> {
  try {
    const agentApi = (window as any)?.api?.agent;
    if (agentApi?.getConfig) {
      return await agentApi.getConfig();
    }
    const res = await apiGet<{ success: boolean; data: AgentConfig }>("/config");
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

async function syncCloudConfig(payload: {
  serverBase: string;
  token: string;
}): Promise<AgentConfig | null> {
  try {
    const agentApi = (window as any)?.api?.agent;
    if (agentApi?.syncCloudConfig) {
      return await agentApi.syncCloudConfig(payload);
    }
    return null;
  } catch {
    return null;
  }
}

/** 手动刷新会话列表（从服务端重新加载） */
async function refreshSessionsManual() {
  await refreshSessions();
  if (activeSessionId.value) {
    const detail = await loadSessionDetail(activeSessionId.value);
    if (detail) {
      const idx = sessions.value.findIndex(s => s.id === detail.id);
      if (idx >= 0) {
        sessions.value[idx] = { ...sessions.value[idx], messages: detail.messages };
      }
    }
  }
}

export function useAgent() {
  if (sessions.value.length === 0) {
    initSessions();
  }

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
    getConfig,
    saveConfig: async (config: Partial<AgentConfig>) => {
      try {
        const agentApi = (window as any)?.api?.agent;
        if (agentApi?.saveConfig) {
          return await agentApi.saveConfig(config);
        }
        const res = await apiPost<{ data: AgentConfig }>("/config", config);
        return (res as any).data || config as AgentConfig;
      } catch {
        return config as AgentConfig;
      }
    },
    syncCloudConfig,
    refreshSessions: refreshSessionsManual,
  };
}

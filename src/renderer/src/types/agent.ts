/** Agent 对话领域模型。UI 组件只消费这些稳定的数据结构。 */

export interface AttachmentData {
  id: string
  name: string
  filename?: string
  mediaType: string
  size: number
  url: string
  /** 发送给主进程的持久化内容；UI 仍使用 url 展示。 */
  dataUrl?: string
}

export interface ToolCallItem {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  durationMs?: number
  error?: string
  status: 'running' | 'success' | 'error'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning?: string
  toolCalls?: ToolCallItem[]
  attachments?: AttachmentData[]
  timestamp: number
  isStreaming?: boolean
  error?: string
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface AgentConfig {
  keyId?: number | null
  provider?: string
  model: string
  baseUrl: string
  apiKey: string
  enabled?: boolean
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  isCustom?: boolean
}

export interface AgentStreamState {
  isStreaming: boolean
  currentMessageId: string | null
  streamingContent: string
  streamingReasoning: string
  streamingToolCalls: ToolCallItem[]
}

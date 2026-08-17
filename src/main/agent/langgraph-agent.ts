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
import { zodToJsonSchema } from "../mcp-server/server";
import { getActiveAgentConfig, type ClientAgentConfig } from "./agent-config";

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
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
  tool_calls?: any[];
}

export interface AgentStreamEvents {
  onReasoning?: (delta: string) => void;
  onContent?: (delta: string) => void;
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
) {
  const text = prompt.toLowerCase();
  const namespaces: Record<string, string[]> = {
    openmeteo: ["天气", "气温", "下雨", "温度", "weather"],
    coingecko: ["币价", "比特币", "btc", "eth", "crypto"],
    frankfurter: ["汇率", "货币", "usd", "cny", "eur"],
    dictionary: ["查词", "词典", "单词", "释义", "dictionary"],
    timeapi: ["时间", "时区", "几点", "time"],
    shopify: ["shopify", "独立站", "商品", "店铺"],
    arxiv: ["论文", "arxiv", "学术"],
    github: ["github", "开源", "仓库"],
    hackernews: ["hackernews", "科技新闻", "热帖"],
    svgrepo: ["svg", "矢量图", "图标", "icon"],
    pexels: ["pexels", "摄影", "摄影图", "摄影照片", "photo"],
    pixabay: ["pixabay", "素材", "免费图片"],
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
    googleicons: ["材料图标", "material icon"],
  };
  const selected = new Set(
    Object.entries(namespaces)
      .filter(([, words]) => words.some((word) => text.includes(word)))
      .map(([name]) => name),
  );
  ["openmeteo", "svgrepo", "hackernews", "github"].forEach((name) =>
    selected.add(name),
  );
  const relevant = allTools.filter((tool) =>
    selected.has(String((tool as any).function?.name || "").split("_")[0]),
  );
  return (relevant.length >= 3 ? relevant : allTools).slice(0, 32);
}

interface GraphState {
  messages: AgentChatMessage[];
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  iteration: number;
  finalText: string;
  finalReasoning: string;
  pendingToolCalls: Array<{ id: string; name: string; arguments: string }>;
}

type GraphNode = (state: GraphState) => Promise<void>;

const MODEL_REQUEST_TIMEOUT_MS = 90_000;
const TOOL_CALL_TIMEOUT_MS = 60_000;

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
        .addEdge("tools", "agent");
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
  if (!data || typeof data !== "object") return JSON.stringify(value);

  const compact = { ...data } as Record<string, unknown>;
  if (Array.isArray(compact.items)) {
    compact.items = compact.items.slice(0, 8).map((item: any) => ({
      id: item?.id,
      title: item?.title,
      image: item?.image || item?.downloadUrl,
      thumbnail: item?.thumbnail,
      url: item?.url || item?.link,
      author: item?.author || item?.photographer,
      license: item?.license,
    }));
  }
  if (Array.isArray(compact.links)) compact.links = compact.links.slice(0, 8);
  if (Array.isArray(compact.images))
    compact.images = compact.images.slice(0, 8);

  const payload = { ...value, data: compact };
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

export class ClientLangGraphAgent {
  private abortController: AbortController | null = null;
  private readonly maxIterations = 8;

  abort() {
    this.abortController?.abort();
    this.abortController = null;
  }

  async run(
    historyMessages: AgentChatMessage[],
    events: AgentStreamEvents,
    customConfig?: Partial<ClientAgentConfig>,
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
    const lastUser = [...historyMessages]
      .reverse()
      .find((message) => message.role === "user");
    const state: GraphState = {
      messages: [
        { role: "system", content: config.systemPrompt },
        ...historyMessages,
      ],
      tools: selectRelevantTools(
        typeof lastUser?.content === "string" ? lastUser.content : "",
        allTools,
      ),
      iteration: 0,
      finalText: "",
      finalReasoning: "",
      pendingToolCalls: [],
    };

    const graph = new ClientStateGraph()
      .addNode("agent", async (current) => {
        current.iteration += 1;
        current.pendingToolCalls = [];
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
            current.finalReasoning += reasoningDelta;
            events.onReasoning?.(reasoningDelta);
          }
          if (delta.content) {
            text += delta.content;
            current.finalText += delta.content;
            events.onContent?.(delta.content);
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
          events.onToolStart?.({ id: call.id, name: call.name, args });
          const startedAt = Date.now();
          let result: unknown;
          let error: string | undefined;
          try {
            const separator = call.name.indexOf("_");
            if (separator < 1)
              throw new Error(`未知工具名称格式: ${call.name}`);
            result = await withTimeout(
              CapabilityRegistry.call(
                call.name.slice(0, separator),
                call.name.slice(separator + 1),
                args,
              ),
              TOOL_CALL_TIMEOUT_MS,
              `工具 ${call.name}`,
            );
          } catch (cause: any) {
            error = cause?.message || "工具执行发生异常";
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
      })
      .addConditionalEdges("agent", (current) =>
        current.pendingToolCalls.length &&
        current.iteration < this.maxIterations
          ? "tools"
          : "END",
      )
      .addConditionalEdges("tools", () => "agent");

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

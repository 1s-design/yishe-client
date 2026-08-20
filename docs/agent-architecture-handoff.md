# Agent 架构完整交接文档

> **阅读入口（重要）**：本文是详细实现交接，先阅读 [`architecture-overview.md`](./architecture-overview.md) 了解三仓库边界、两个 Agent、三类工具注册表和两套 MCP 语境。本文中的固定工具数量、历史参数示例和旧实现说明可能随源码变化；排障时以运行时目录接口和源码为准。
>
> **当前已知差异**：客户端 `CapabilityRegistry`、服务端 `AiAssistantToolRegistryService` 和客户端 MCP `toolRegistry` 并非同一个注册表；本地 MCP 已改为自动适配客户端 CapabilityRegistry。Google Arts、素材、热搜和外部数据工作流已改为通过 MCP Bridge 调用规范能力；图片处理、视频渲染仍需接入同一通用适配器。

## 目录

1. [整体架构概览](#1-整体架构概览)
2. [统一工具系统](#2-统一工具系统)
3. [客户端 Agent（Electron）](#3-客户端-agentelectron)
4. [服务端 Agent（design-server）](#4-服务端-agentdesign-server)
5. [工作流引擎](#5-工作流引擎)
6. [前端 UI 架构](#6-前端-ui-架构)
7. [API 接口文档](#7-api-接口文档)
8. [工具详细清单](#8-工具详细清单)
9. [关键流程时序](#9-关键流程时序)
10. [测试指南](#10-测试指南)
11. [配置文件路径](#11-配置文件路径)
12. [常见问题排查](#12-常见问题排查)

---

## 1. 整体架构概览

### 1.1 架构图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              前端（Renderer Process）                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │ ChatSidebar   │  │  ChatView     │  │ Capability    │  │   Starfield     │  │
│  │ 会话列表      │  │  对话区域     │  │  Browser      │  │   星空背景      │  │
│  │               │  │               │  │  能力浏览器   │  │                 │  │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘  └─────────────────┘  │
│          │                  │                  │                                 │
│          └──────────────────┴──────────────────┘                                 │
│                             │                                                    │
│                             │ useAgent.ts (HTTP/SSE)                            │
└─────────────────────────────┼────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          主进程（Main Process）                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      LangGraph Agent Runtime                             │    │
│  │  ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐  │    │
│  │  │   Agent    │───▶│   Tool     │───▶│   Tool     │───▶│   Result   │  │    │
│  │  │   Node     │    │   Select   │    │   Execute  │    │   Return   │  │    │
│  │  └────────────┘    └────────────┘    └────────────┘    └────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │
│  │CapabilityRegistry │  │   MCP Server     │  │  Session Store   │              │
│  │  本地能力注册表   │  │  外部工具桥接    │  │  会话持久化      │              │
│  │  183 个工具      │  │  工具: 24 个     │  │  JSON 文件       │              │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘              │
│                                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │
│  │  googleArt.ts    │  │  filesystem.ts   │  │  hotsearch.ts    │              │
│  │  艺术采集工具    │  │  文件操作工具    │  │  热搜采集工具    │              │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket (mcp-call / service-command)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         服务端（design-server）                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                        AI Assistant Module                               │    │
│  │  ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐  │    │
│  │  │   Chat     │───▶│   Agent    │───▶│   MCP      │───▶│   Client   │  │    │
│  │  │   API      │    │   Node     │    │   Bridge   │    │   Tool     │  │    │
│  │  └────────────┘    └────────────┘    └────────────┘    └────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │
│  │ Workflow Engine  │  │ Tool Registry    │  │ Message Push     │              │
│  │  工作流引擎       │  │  工具注册表      │  │  消息推送        │              │
│  │  100+ 节点类型   │  │  153+ 工具       │  │  WebSocket       │              │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 核心概念

| 概念 | 说明 |
|------|------|
| **CapabilityRegistry** | 客户端能力注册表，管理所有本地工具 |
| **MCP Server** | Model Context Protocol 服务端，桥接外部工具 |
| **LangGraph Agent** | 基于状态图的 Agent 运行时 |
| **Session Store** | 会话持久化，存储在 userData 目录 |
| **Workflow Engine** | 服务端工作流引擎，支持 100+ 节点类型 |

---

## 2. 统一工具系统

### 2.1 工具定义格式

**客户端工具定义（CapabilityDefinition）：**

```typescript
// 文件：src/main/capabilities/types.ts
interface CapabilityDefinition {
  name: string;                    // 工具名称
  namespace: string;               // 命名空间
  description: string;             // 工具描述
  riskLevel: "read" | "write";     // 风险等级
  argsSchema: z.ZodObject<any>;    // 参数 schema
  handler: (args: any, context?: CapabilityCallContext) => Promise<any>;
}
```

**服务端工具定义（AiAssistantToolDefinition）：**

```typescript
// 文件：src/ai-assistant/ai-assistant.types.ts
interface AiAssistantToolDefinition {
  name: string;
  label: string;
  description: string;
  category: string;
  readOnly: boolean;
  runtime: "server";
  executionMode: "read_only" | "safe_write" | "confirm_required";
  riskLevel: "low" | "medium" | "high";
  inputSchema: JSONSchema;
  examples?: string[];
  tags?: string[];
}
```

### 2.2 工具命名规则

| 格式 | 示例 | 说明 |
|------|------|------|
| 客户端（下划线） | `googleArt_search` | namespace_name |
| 服务端（下划线） | `mcp_bridge_call` | namespace_name |
| API 调用 | `googleArt.search` | 点号分隔（显示用） |

### 2.3 工具共用机制

```
┌─────────────────────────────────────────────────────────────┐
│                      统一工具层                              │
│                                                             │
│  客户端工具 ◀──── CapabilityRegistry ────▶ 本地执行         │
│       │                                     ▲              │
│       │                                     │              │
│       └─────── MCP Server ──── WebSocket ────┘              │
│                       │                                     │
│                       ▼                                     │
│  服务端工具 ◀──── Tool Registry ───────▶ 调用客户端         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**服务端调用客户端工具的流程：**

1. 服务端 Agent 决定调用 `googleArt_search`
2. 通过 MCP Bridge 发送 WebSocket 消息到客户端
3. 客户端 WebSocket Handler 接收 `mcp-call` 消息
4. 调用 `nativeApi.callMcpTool("googleArt_search", args)`
5. MCP Server 查找并执行工具
6. 结果通过 WebSocket 返回给服务端

---

## 3. 客户端 Agent（Electron）

### 3.1 核心文件

| 文件路径 | 说明 | 行数 |
|---------|------|------|
| `src/main/agent/langgraph-agent.ts` | Agent 核心运行时 | ~900 |
| `src/main/agent/agent-config.ts` | Agent 配置管理 | ~150 |
| `src/main/agent/agent-ipc.ts` | Renderer 与 Main 进程通信 | ~200 |
| `src/main/agent/session-store.ts` | 会话持久化存储 | ~150 |
| `src/main/agent/server-capabilities.ts` | 服务端能力目录拉取 | ~250 |
| `src/main/agent/agent-api.ts` | HTTP API 路由 | ~200 |

### 3.2 Agent 初始化流程

**文件：`src/main/agent/langgraph-agent.ts`**

```typescript
export async function runAgent(
  historyMessages: AgentChatMessage[],
  events: AgentEvents,
  configOverride?: Partial<ClientAgentConfig>,
  executionContext?: { runId?: string; sessionId?: string },
) {
  // 1. 获取配置
  const config = getActiveAgentConfig();
  
  // 2. 创建 OpenAI 客户端
  const client = new OpenAI({
    apiKey: config.apiKey || "ollama",
    baseURL: config.baseUrl,
    dangerouslyAllowBrowser: true,
    timeout: MODEL_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });

  // 3. 加载本地工具（来自 CapabilityRegistry）
  const allTools = getCapabilityOpenAiTools();

  // 4. 拉取服务端能力目录
  let serverCatalog: ServerCapabilityCatalog | null = null;
  let serverToolIndex: Map<string, ServerCapabilityTool> | null = null;
  try {
    serverCatalog = await fetchServerCapabilities();
    if (serverCatalog?.tools?.length) {
      // 过滤掉 Google Arts 工具（必须走本地可信工作流）
      const safeServerCatalog = {
        ...serverCatalog,
        tools: serverCatalog.tools.filter((tool) => {
          const identity = [tool.name, tool.label, tool.description, ...(tool.tags || [])]
            .join(" ")
            .toLowerCase();
          return !/google[\s._-]*art|谷歌艺术/.test(identity);
        }),
      };
      allTools.push(...serverCapabilitiesToOpenAiTools(safeServerCatalog));
      serverToolIndex = buildServerToolIndex(safeServerCatalog);
    }
  } catch (error: any) {
    console.warn("[Agent] 拉取服务端能力目录失败:", error?.message || error);
  }

  // 5. 根据用户消息选择相关工具
  const lastUser = [...historyMessages].reverse().find((m) => m.role === "user");
  const selectedTools = selectRelevantTools(
    typeof lastUser?.content === "string" ? lastUser.content : "",
    allTools,
    serverToolIndex,
  );

  // 6. 创建 LangGraph 状态图并执行
  const graph = new ClientStateGraph().addNode("agent", agentNode).addNode("tools", toolNode);
  // ...
}
```

### 3.3 工具选择逻辑

**文件：`src/main/agent/langgraph-agent.ts` - `selectRelevantTools()`**

```typescript
export function selectRelevantTools(
  prompt: string,
  allTools: OpenAI.Chat.Completions.ChatCompletionTool[],
  serverToolIndex?: Map<string, ServerCapabilityTool> | null,
) {
  const text = prompt.toLowerCase();
  
  // 1. 关键词匹配
  const namespaces: Record<string, string[]> = {
    googleArt: ["googleart", "google art", "谷歌艺术", "名画", "画作", "绘画", "博物馆", "艺术品", "蒙娜丽莎", "梵高", "莫奈"],
    pexels: ["pexels", "摄影", "摄影图", "摄影照片", "photo"],
    pixabay: ["pixabay", "素材", "免费图片", "免版权图片"],
    wikimedia: ["wikimedia", "维基", "梵高", "名画", "画作", "绘画", "艺术作品", "公共领域"],
    // ... 更多命名空间
  };

  const selected = new Set(
    Object.entries(namespaces)
      .filter(([, words]) => words.some((word) => text.includes(word)))
      .map(([name]) => name),
  );

  // 2. 常驻工具（始终加载）
  const ALWAYS_LOADED = [
    "openmeteo", "svgrepo", "hackernews", "github",
    "googleArt", "wikimedia", "openverse", "pexels",
    "pixabay", "iconify", "google-icons", "pinterest", "materialLibrary",
  ];
  ALWAYS_LOADED.forEach((name) => selected.add(name));

  // 3. 过滤工具
  const relevant = allTools.filter((tool) => {
    const name = String(tool.function?.name || "");
    if (isServerToolName(name)) {
      const serverTool = serverToolIndex?.get(name);
      const category = serverTool?.category || name.split("_")[1] || "";
      return selectedServerCategories.has(category) || ALWAYS_SERVER_CATEGORIES.includes(category);
    }
    const namespace = name.split("_")[0];
    return selected.has(namespace);
  });

  // 4. 优先排序（googleArt 和 materialLibrary 排在前面）
  const prioritize = (tool: any) =>
    /^(googleArt|materialLibrary)_/.test(String(tool?.function?.name || ""));
  const prioritized = relevant.filter(prioritize);
  const rest = relevant.filter((tool) => !prioritize(tool));
  const result = [...prioritized, ...rest];
  
  // 5. 限制工具数量（最多 48 个）
  if (result.length >= 3) return result.slice(0, 48);
  const fallback = allTools.filter(prioritize).concat(allTools.filter((tool) => !prioritize(tool)));
  return fallback.slice(0, 48);
}
```

### 3.4 会话存储

**文件：`src/main/agent/session-store.ts`**

```typescript
// 存储位置
function getStoragePath(): string {
  const userData = app.getPath("userData");
  return path.join(userData, "agent-sessions.json");
  // macOS: ~/Library/Application Support/yishe-client/agent-sessions.json
}

// 会话数据结构
interface AgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AgentChatMessage[];
}

// 消息结构
interface AgentChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  attachments?: AgentAttachment[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}
```

---

## 4. 服务端 Agent（design-server）

### 4.1 核心文件

| 文件路径 | 说明 | 行数 |
|---------|------|------|
| `src/ai-assistant/ai-assistant.controller.ts` | AI Assistant HTTP API | ~300 |
| `src/ai-assistant/ai-assistant.service.ts` | Agent 核心服务 | ~800 |
| `src/ai-assistant/tools/mcp-bridge.service.ts` | MCP 桥接服务 | ~400 |
| `src/ai-assistant/tools/definitions/` | 工具定义目录 | 10+ 文件 |
| `src/workflow/workflow-execution-engine.ts` | 工作流执行引擎 | ~500 |
| `src/workflow/node-executors.ts` | 节点执行器注册 | ~800 |

### 4.2 MCP Bridge（服务端调用客户端工具）

**文件：`src/ai-assistant/tools/mcp-bridge.service.ts`**

```typescript
@Injectable()
export class AiAssistantMcpBridgeService {
  // 等待中的请求
  private static pendingRequests = Map<string, {
    connectionId: string;
    userId: string;
    toolName: string;
    startedAt: number;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  // 静态方法：处理客户端返回的结果
  static handleMcpResult(requestId: string, result: any, connectionId?: string, userId?: number | string | null): boolean {
    const pending = AiAssistantMcpBridgeService.pendingRequests.get(requestId);
    if (!pending) return false;
    
    // 验证来源
    if (pending.connectionId !== String(connectionId || "") || pending.userId !== String(userId || "")) {
      return false;
    }
    
    clearTimeout(pending.timer);
    AiAssistantMcpBridgeService.pendingRequests.delete(requestId);
    pending.resolve(result);
    return true;
  }

  // 调用客户端工具
  async callTool(input: Record<string, any>, currentUser?: Partial<User>) {
    const { connectionId, toolName, toolArgs } = input;
    
    // 1. 验证连接所有权
    await this.ensureOwnedConnection(userId, connectionId);
    
    // 2. 发送 WebSocket 消息
    const reqId = `mcp-${randomUUID()}`;
    const sent = this.websocketService.sendMessageToConnection(
      connectionId,
      "mcp-call",
      { requestId: reqId, payload: { toolName, toolArgs } }
    );
    
    // 3. 等待结果
    const result = await this.waitForResult({ requestId: reqId, connectionId, userId, toolName, timeoutMs: 60000 });
    
    return { success: true, connectionId, toolName, requestId: reqId, result };
  }
}
```

### 4.3 WebSocket 消息类型

| 消息类型 | 方向 | 说明 |
|---------|------|------|
| `mcp-call` | 服务端 → 客户端 | 请求执行工具 |
| `mcp-result` | 客户端 → 服务端 | 返回执行结果 |
| `service-command` | 服务端 → 客户端 | 工作流节点命令 |
| `service-command-result` | 客户端 → 服务端 | 命令执行结果 |
| `service-runtime` | 客户端 → 服务端 | 客户端运行时状态 |

---

## 5. 工作流引擎

### 5.1 核心文件

| 文件路径 | 说明 |
|---------|------|
| `src/workflow/workflow-execution-engine.ts` | 工作流执行引擎核心 |
| `src/workflow/node-executors.ts` | 所有节点执行器注册 |
| `src/workflow/workflow.service.ts` | 工作流服务层 |
| `src/workflow/workflow.controller.ts` | 工作流 HTTP API |
| `src/workflow/workflow-scheduler.service.ts` | 工作流调度器 |
| `src/workflow/workflow-trigger.service.ts` | 工作流触发器 |
| `src/workflow/workflow-template-evaluator.ts` | 模板表达式求值 |
| `src/workflow/entities/workflow.entity.ts` | 工作流实体 |
| `src/workflow/entities/workflow-node-execution.entity.ts` | 节点执行记录 |

### 5.2 节点类型完整清单

**文件：`src/workflow/node-executors.ts`**

```typescript
// 基础节点
workflowExecutionEngine.registerExecutor('http', httpExecutor);           // HTTP 请求
workflowExecutionEngine.registerExecutor('llm', llmExecutor);             // LLM 调用
workflowExecutionEngine.registerExecutor('condition', conditionExecutor); // 条件分支
workflowExecutionEngine.registerExecutor('message_push', messagePushExecutor); // 消息推送
workflowExecutionEngine.registerExecutor('js_code', jsCodeExecutor);     // JS 沙箱
workflowExecutionEngine.registerExecutor('ai_call', aiCallExecutor);     // AI 大模型调用
workflowExecutionEngine.registerExecutor('loop', loopExecutor);           // For Each 循环
workflowExecutionEngine.registerExecutor('while_loop', whileLoopExecutor); // While 循环
workflowExecutionEngine.registerExecutor('switch', switchExecutor);       // 多路切换

// 热搜采集节点（10 个平台）
['hotsearch_weibo', 'hotsearch_douyin', 'hotsearch_bilibili', 'hotsearch_zhihu',
 'hotsearch_toutiao', 'hotsearch_douban', 'hotsearch_kuaishou', 'hotsearch_v2ex',
 'hotsearch_36kr', 'hotsearch_ithome'].forEach((platform) => {
  workflowExecutionEngine.registerExecutor(platform, hotsearchExecutor);
});

// 素材采集节点
workflowExecutionEngine.registerExecutor('google_arts_culture', googleArtsCultureExecutor);
workflowExecutionEngine.registerExecutor('pinterest_culture', pinterestCultureExecutor);
workflowExecutionEngine.registerExecutor('wikimedia_culture', wikimediaCultureExecutor);
workflowExecutionEngine.registerExecutor('kaboompics_search', kaboompicsSearchExecutor);
workflowExecutionEngine.registerExecutor('pexels_search', pexelsSearchExecutor);
workflowExecutionEngine.registerExecutor('pixabay_search', pixabaySearchExecutor);
workflowExecutionEngine.registerExecutor('rawpixel_search', rawpixelSearchExecutor);
workflowExecutionEngine.registerExecutor('stocksnap_search', stocksnapSearchExecutor);
workflowExecutionEngine.registerExecutor('openverse_search', openverseSearchExecutor);
workflowExecutionEngine.registerExecutor('openclipart_search', openclipartSearchExecutor);
workflowExecutionEngine.registerExecutor('undraw_search', undrawSearchExecutor);
workflowExecutionEngine.registerExecutor('vecteezy_search', vecteezySearchExecutor);
workflowExecutionEngine.registerExecutor('nounproject_search', nounprojectSearchExecutor);
workflowExecutionEngine.registerExecutor('iconify_search', iconifySearchExecutor);
workflowExecutionEngine.registerExecutor('openmoji_search', openmojiSearchExecutor);
workflowExecutionEngine.registerExecutor('googleicons_search', googleiconsSearchExecutor);
workflowExecutionEngine.registerExecutor('emojipedia_search', emojipediaSearchExecutor);
workflowExecutionEngine.registerExecutor('svgrepo_search', svgrepoSearchExecutor);

// 新闻与资讯节点（21 个平台）
const newsPlatforms = [
  'hackernews_search', 'arxiv_search', 'github_search', 'producthunt_search',
  'gdelt_search', 'googlenews_search', 'reddit_search', 'theguardian_search',
  'bbcnews_search', 'npr_search', 'techcrunch_search', 'theverge_search',
  'arstechnica_search', 'mittechreview_search', 'reuters_search', 'chinadaily_search',
  'govcn_search', 'xinhuanet_search', 'thepaper_search', '36kr_search', 'huxiu_search',
];
newsPlatforms.forEach((type) => {
  workflowExecutionEngine.registerExecutor(type, createNewsDataExecutor(pluginKey, label));
});

// 工具节点（17 个）
const toolNodes = [
  'openmeteo_search', 'wttr_search', 'coingecko_search', 'frankfurter_search',
  'dictionary_search', 'joke_search', 'ipify_search', 'sunrisesunset_search',
  'timeapi_search', 'zippopotam_search', 'countryis_search', 'erapi_search',
  'fawazahmed_search', 'colorapi_search', 'shopify_search',
];
toolNodes.forEach((type) => {
  workflowExecutionEngine.registerExecutor(type, toolExecutor);
});
```

### 5.3 Google Arts 工作流节点详细实现

**文件：`src/workflow/node-executors.ts` - `googleArtsCultureExecutor()`**

```typescript
async function googleArtsCultureExecutor(
  node: any,
  context: WorkflowExecutionContext,
  mcpBridgeService?: AiAssistantMcpBridgeService,
  websocketService?: WebsocketService,
): Promise<NodeExecutionResult> {
  const config = node.data?.config || {};
  const userId = context.globalInputs?.userId;
  const keyword = (config.keyword || '').trim() || 'impressionism';
  const maxCount = config.maxCount || 10;
  const syncToMaterial = true;

  if (!userId) {
    return { success: false, error: '缺少 userId' };
  }

  if (!websocketService) {
    return { success: false, error: '依赖服务未注入' };
  }

  // 1. 获取用户在线客户端
  let connections: Array<{ id: string }> = [];
  try {
    const views = await websocketService.getRuntimeConnectionViewsForUser(Number(userId));
    connections = views.map((v: any) => ({ id: v.id }));
    if (!connections.length) {
      const allViews = await websocketService.getRuntimeConnectionViews();
      connections = allViews.map((v: any) => ({ id: v.id }));
    }
  } catch (err: any) {
    return { success: false, error: `获取在线设备失败: ${err?.message}` };
  }

  if (!connections.length) {
    return { success: false, error: '无在线客户端设备' };
  }

  // 2. 构建命令
  const commandId = `google-arts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const envelope = {
    commandId,
    target: { pluginKey: 'google-art' },
    command: { name: 'collect', action: 'collect', payload: { keyword, maxCount, syncToMaterial } },
    mode: 'production',
  };

  // 3. 逐个尝试执行
  let lastError: string | undefined;
  for (const conn of connections) {
    try {
      const resultPromise = websocketService.waitForServiceCommandResult(commandId, { timeoutMs: 120000 });
      const sent = websocketService.sendMessageToConnection(conn.id, 'service-command', envelope);
      if (!sent) {
        lastError = '命令发送失败';
        continue;
      }
      const result = await resultPromise;
      if (result?.success === false) {
        lastError = result?.message || '采集失败';
        continue;
      }

      return {
        success: true,
        outputs: {
          successCount: result?.data?.successCount ?? 0,
          failCount: result?.data?.failCount ?? 0,
          images: result?.data?.images ?? [],
          logs: result?.data?.logs ?? [],
          connectionId: conn.id,
          executedAt: new Date().toISOString(),
          raw: result?.data,
        },
      };
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  return { success: false, error: `所有设备执行失败: ${lastError}` };
}
```

---

## 6. 前端 UI 架构

### 6.1 核心文件

| 文件路径 | 说明 | 行数 |
|---------|------|------|
| `src/renderer/src/views/Agent.vue` | Agent 主页面 | ~170 |
| `src/renderer/src/components/agent/ChatView.vue` | 对话区域 | ~1000 |
| `src/renderer/src/components/agent/ChatSidebar.vue` | 侧边栏 | ~800 |
| `src/renderer/src/components/agent/CapabilityBrowser.vue` | 能力浏览器 | ~400 |
| `src/renderer/src/components/agent/Starfield.vue` | 星空背景 | ~600 |
| `src/renderer/src/composables/useAgent.ts` | Agent 交互逻辑 | ~600 |

### 6.2 useAgent Composable 完整 API

**文件：`src/renderer/src/composables/useAgent.ts`**

```typescript
// API 基础路径
const AGENT_BASE = "http://localhost:1519/api/agent";

export function useAgent() {
  // 状态
  const sessions = ref<ChatSession[]>([]);
  const activeSessionId = ref<string | null>(null);
  const isStreaming = ref(false);
  
  // 计算属性
  const activeMessages = computed(() => {
    const session = sessions.value.find((s) => s.id === activeSessionId.value);
    return session?.messages || [];
  });
  
  // 方法
  async function initSessions() { /* 加载会话列表 */ }
  function createSession(): ChatSession { /* 创建新会话 */ }
  function setActiveSession(sessionId: string) { /* 切换会话 */ }
  function deleteSession(sessionId: string) { /* 删除会话 */ }
  async function sendMessage(content: string, attachments?: AttachmentData[]) { /* 发送消息 */ }
  async function stopGeneration() { /* 停止生成 */ }
  async function resolveToolApproval(callId: string, approved: boolean) { /* 工具审批 */ }
  async function refreshSessions() { /* 刷新会话列表 */ }
  async function getConfig(): Promise<AgentConfig | null> { /* 获取配置 */ }
  async function syncCloudConfig(payload: { serverBase: string; token: string }) { /* 同步云端配置 */ }
  
  return {
    sessions, activeSessionId, isStreaming,
    createSession, setActiveSession, deleteSession,
    sendMessage, stopGeneration, resolveToolApproval,
    refreshSessions, getConfig, syncCloudConfig, ...
  };
}
```

### 6.3 SSE 流处理详细实现

**文件：`src/renderer/src/composables/useAgent.ts`**

```typescript
// SSE 事件类型
type SSEEvent = 
  | "reasoning"      // 模型思考过程
  | "content"        // 文本内容
  | "tool_approval"  // 工具审批请求
  | "tool_start"     // 工具开始执行
  | "tool_end"       // 工具执行完成
  | "complete"       // 整体完成
  | "error";         // 错误

// 处理 SSE 流
async function processSSEStream(response: Response, runId: string, sessionId: string) {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        handleSSEEvent(currentEvent, data, { runId, sessionId });
      }
    }
  }
}

// 处理各种事件
function handleSSEEvent(event: string, data: any, payload: StreamPayload) {
  switch (event) {
    case "reasoning":
      streamingReasoning.value += data.delta;
      updateCurrentMessage();
      break;
    case "content":
      streamingContent.value += data.delta;
      updateCurrentMessage();
      break;
    case "tool_approval":
      // 显示工具审批 UI
      currentMessage.value.interaction = { id: data.id, type: "tool_approval", ... };
      break;
    case "tool_start":
      streamingToolCalls.value.push({ id: data.id, name: data.name, status: "running" });
      break;
    case "tool_end":
      const item = streamingToolCalls.value.find((t) => t.id === data.id);
      if (item) Object.assign(item, { result: data.result, status: "success" });
      break;
    case "complete":
      finish(data.fullText, data.fullReasoning);
      break;
  }
}
```

---

## 7. API 接口文档

### 7.1 客户端 API（localhost:1519）

#### GET /api/agent/config

获取 Agent 配置状态。

**响应示例：**
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "model": "mymodel",
    "baseUrl": "http://49.232.186.238:3000/v1",
    "hasApiKey": true,
    "temperature": 0.7,
    "maxTokens": 4096
  }
}
```

#### GET /api/agent/sessions

获取会话列表。

**响应示例：**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "新对话",
      "createdAt": 1787010124773,
      "updatedAt": 1787011053704,
      "messageCount": 9
    }
  ]
}
```

#### POST /api/agent/sessions

创建新会话。

**请求体：**
```json
{
  "title": "测试会话"
}
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "测试会话",
    "createdAt": 1787010124773,
    "updatedAt": 1787010124773,
    "messages": []
  }
}
```

#### POST /api/agent/sessions/:id/messages

发送消息（SSE 流式响应）。

**请求体：**
```json
{
  "text": "帮我搜索梵高的向日葵",
  "autoApprove": false
}
```

**SSE 事件流：**
```
event: reasoning
data: {"delta": "用户想要搜索梵高的向日葵..."}

event: content
data: {"delta": "我来帮您搜索梵高的向日葵画作。"}

event: tool_start
data: {"id": "call_xxx", "name": "googleArt_search", "args": {"keyword": "Van Gogh Sunflowers"}}

event: tool_end
data: {"id": "call_xxx", "name": "googleArt_search", "result": {"success": true, "items": [...]}}

event: complete
data: {"fullText": "搜索成功！找到了 1121 件作品...", "fullReasoning": "..."}
```

#### POST /api/agent/approve

工具审批。

**请求体：**
```json
{
  "callId": "call_xxx",
  "approved": true
}
```

#### GET /api/capabilities

获取客户端能力列表。

**响应示例：**
```json
{
  "success": true,
  "total": 183,
  "capabilities": [
    {
      "name": "search",
      "namespace": "googleArt",
      "description": "在 Google Arts & Culture 搜索世界名画与艺术作品",
      "riskLevel": "read"
    }
  ]
}
```

#### GET /api/agent/google-art-health

检查 Google Arts 连通性。

**响应示例：**
```json
{
  "success": true,
  "data": {
    "reachable": true,
    "elapsedMs": 2178
  }
}
```

### 7.2 服务端 API（localhost:1520）

#### POST /api/ai-assistant/chat

发送消息（非流式）。

**请求头：**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**
```json
{
  "message": "帮我搜索梵高的向日葵",
  "conversationId": 545
}
```

**响应示例：**
```json
{
  "data": {
    "conversation": { "id": 545, "title": "...", "messageCount": 10 },
    "messages": [
      { "role": "user", "content": "帮我搜索梵高的向日葵" },
      { "role": "assistant", "content": "搜索成功！找到了 1121 件作品..." }
    ]
  }
}
```

#### POST /api/ai-assistant/chat-stream

发送消息（SSE 流式）。

**SSE 事件：**
```
event: run.started
data: {"conversationId": 545, "runId": "xxx", "time": "..."}

event: assistant.status
data: {"status": "thinking", "runId": "xxx"}

event: assistant.model.started
data: {"availableToolCount": 153}

event: assistant.decision
data: {"toolCallCount": 1, "toolCalls": [...]}

event: tool.pending
data: {"tool": "mcp_bridge.call", "input": {...}}

event: tool.completed
data: {"tool": "mcp_bridge.call", "success": true, "summary": "执行成功"}

event: assistant.answer.delta
data: {"delta": "搜索成功！", "content": "搜索成功！"}

event: run.completed
data: {"reply": "搜索成功！找到了 1121 件作品...", "toolResults": [...]}
```

#### GET /api/ai-assistant/messages

获取消息历史。

**查询参数：**
```
conversationId=545&limit=10
```

#### GET /api/ai-assistant/tool-catalog

获取服务端工具和当前用户在线客户端 MCP 工具的聚合目录。此接口需要服务端登录态；客户端工具部分会继续通过 WebSocket 向在线客户端发送 `mcp-list-tools`。

**响应字段：**
```json
{
  "total": 0,
  "serverTotal": 0,
  "clientTotal": 0,
  "generatedAt": "2026-08-18T00:00:00.000Z",
  "tools": [],
  "groups": [],
  "clients": []
}
```

> **接口修正**：源码中没有 `POST /api/ai-assistant/mcp/list-clients` 这个 REST 路由。`mcp_bridge.list_clients` 是服务端 Agent 的内部工具；若要从 HTTP 查询工具目录，使用 `GET /api/ai-assistant/tool-catalog`。若要实际调用客户端工具，仍需由 Agent 调用 `mcp_bridge.call`，不能用该目录接口代替执行。

---

## 8. 工具详细清单

### 8.1 客户端工具（CapabilityRegistry）

**文件：`src/main/capabilities/`**

| 命名空间 | 工具名称 | 说明 | 风险等级 |
|---------|---------|------|---------|
| googleArt | search | 搜索 Google Arts 作品 | read |
| googleArt | zoom | 获取作品分辨率档位 | read |
| googleArt | collect | 下载并写入素材库 | write |
| googleArt | status | 检查服务状态 | read |
| filesystem | file_read | 读取本地文件 | read |
| filesystem | file_write | 写入本地文件 | write |
| filesystem | file_delete | 删除本地文件 | write |
| filesystem | file_copy | 复制文件 | write |
| filesystem | file_move | 移动文件 | write |
| filesystem | dir_list | 列出目录 | read |
| filesystem | dir_create | 创建目录 | write |
| clipboard | read_text | 读取剪贴板文本 | read |
| clipboard | write_text | 写入剪贴板文本 | write |
| clipboard | read_image | 读取剪贴板图片 | read |
| clipboard | write_image | 写入剪贴板图片 | write |
| system | info | 获取系统信息 | read |
| system | screen_info | 获取屏幕信息 | read |
| system | local_ip | 获取本地 IP | read |
| network | http_check | HTTP 连通性检查 | read |
| network | port_check | 端口检测 | read |
| network | dns_resolve | DNS 解析 | read |
| screen | capture_screen | 屏幕截图 | read |
| screen | capture_window | 窗口截图 | read |
| screen | capture_area | 区域截图 | read |
| print | list | 列出打印机 | read |
| print | print_file | 打印文件 | write |
| hotsearch | weibo | 微博热搜 | read |
| hotsearch | douyin | 抖音热搜 | read |
| hotsearch | bilibili | B站热搜 | read |
| ... | ... | ... | ... |

### 8.2 服务端工具（design-server）

**文件：`src/ai-assistant/tools/definitions/`**

| 文件 | 工具名称 | 说明 |
|------|---------|------|
| mcp-bridge.tools.ts | mcp_bridge.call | 调用客户端工具 |
| mcp-bridge.tools.ts | mcp_bridge.list_clients | 列出在线客户端 |
| mcp-bridge.tools.ts | mcp_bridge.list_tools | 列出客户端工具 |
| client-agent.tools.ts | browser.status | 查看浏览器状态 |
| client-agent.tools.ts | browser.connect | 启动浏览器 |
| client-agent.tools.ts | browser.close | 关闭浏览器 |
| client-agent.tools.ts | client_agent.execute | 执行客户端 Agent 任务 |
| material.tools.ts | sticker.create | 创建素材 |
| material.tools.ts | sticker.search | 搜索素材 |
| material.tools.ts | sticker.stats | 素材统计 |
| external-data.tools.ts | 各种外部数据工具 | 天气、新闻、汇率等 |

---

## 9. 关键流程时序

### 9.1 客户端 Agent 对话流程

```
用户输入 "帮我搜索梵高的向日葵"
        │
        ▼
Renderer: sendMessage()
        │
        ▼
Main Process: runAgent()
        │
        ├── 1. selectRelevantTools() → 选择 googleArt 等工具
        ├── 2. 调用 OpenAI API（带工具定义）
        ├── 3. 模型返回 tool_calls: [{name: "googleArt_search", args: {keyword: "Van Gogh Sunflowers"}}]
        ├── 4. 执行 googleArt.search()
        │       │
        │       ▼
        │   CapabilityRegistry.get("googleArt", "search").handler(args)
        │       │
        │       ▼
        │   返回搜索结果 {success: true, items: [...]}
        │
        ├── 5. 结果返回给模型
        ├── 6. 模型生成最终回复
        │
        ▼
SSE 流式返回 Renderer
```

### 9.2 Google Arts 完整采集流程

```
用户："搜索梵高的向日葵"
        │
        ▼
Agent: googleArt.search({keyword: "Van Gogh Sunflowers"})
        │
        ▼
返回: {items: [{resultIndex: 1, title: "Sunflowers", artist: "Vincent van Gogh", ...}]}
        │
        ▼
Agent 展示结果给用户
        │
        ▼
用户："第1幅"
        │
        ▼
Agent: googleArt.zoom({resultIndex: 1})
        │
        ▼
返回: {zooms: [{idx: 0, width: 250}, {idx: 1, width: 500}, ...]}
        │
        ▼
Agent 展示档位并等待用户选择
        │
        ▼
用户："档位 2"
        │
        ▼
Agent: googleArt.collect({zoomLevel: 2})
        │
        ▼
主进程执行:
  1. 从可信状态获取 URL
  2. dezoomify-rs 下载高清图到本地
  3. 上传到 COS（对象存储）
  4. POST /api/sticker/create 写入素材库
        │
        ▼
返回: {success: true, materialLibraryOk: true, materialId: "xxx", materialUrl: "xxx"}
```

### 9.3 服务端调用客户端工具流程

```
服务端 Agent 决定调用 googleArt_search
        │
        ▼
mcp_bridge.call({connectionId: "xxx", toolName: "googleArt_search", toolArgs: {...}})
        │
        ▼
MCP Bridge Service
        │
        ▼
WebSocket: sendMessageToConnection(connectionId, "mcp-call", {requestId, payload})
        │
        ▼
客户端 WebSocket Handler 接收 mcp-call
        │
        ▼
nativeApi.callMcpTool("googleArt_search", args)
        │
        ▼
MCP Server → toolRegistry.get("googleArt_search").handler(args)
        │
        ▼
CapabilityRegistry → googleArt.search.handler(args)
        │
        ▼
执行结果 → WebSocket emit("mcp-result", {requestId, result})
        │
        ▼
服务端 MCP Bridge 接收结果 → 返回给 Agent
```

---

## 10. 测试指南

### 10.1 客户端 API 测试

```bash
# 1. 检查配置
curl http://localhost:1519/api/agent/config | python3 -m json.tool

# 2. 创建会话
curl -X POST http://localhost:1519/api/agent/sessions \
  -H "Content-Type: application/json" \
  -d '{"title":"测试"}' | python3 -m json.tool

# 3. 发送消息（SSE）
curl -N -X POST "http://localhost:1519/api/agent/sessions/{session_id}/messages" \
  -H "Content-Type: application/json" \
  -d '{"text":"你好"}'

# 4. 检查 Google Arts 连通性
curl http://localhost:1519/api/agent/google-art-health | python3 -m json.tool

# 5. 获取能力列表
curl http://localhost:1519/api/capabilities | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'总工具数: {d[\"total\"]}')"
```

### 10.2 服务端 API 测试

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# 1. 发送消息
curl -X POST http://localhost:1520/api/ai-assistant/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"你好"}' | python3 -m json.tool

# 2. 流式消息
curl -N -X POST http://localhost:1520/api/ai-assistant/chat-stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"帮我搜索梵高向日葵"}'

# 3. 列出在线客户端
curl -X POST http://localhost:1520/api/ai-assistant/mcp/list-clients \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### 10.3 完整采集流程测试

```bash
# 1. 创建会话
SESSION=$(curl -s -X POST http://localhost:1519/api/agent/sessions \
  -H "Content-Type: application/json" \
  -d '{"title":"Google Arts 测试"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
echo "Session: $SESSION"

# 2. 搜索
curl -s -N -X POST "http://localhost:1519/api/agent/sessions/$SESSION/messages" \
  -H "Content-Type: application/json" \
  -d '{"text":"搜索梵高的向日葵"}' | grep "event: complete"

# 3. 获取分辨率（选择第1幅）
curl -s -N -X POST "http://localhost:1519/api/agent/sessions/$SESSION/messages" \
  -H "Content-Type: application/json" \
  -d '{"text":"1"}' | grep "event: complete"

# 4. 采集（选择档位 2）
curl -s -N -X POST "http://localhost:1519/api/agent/sessions/$SESSION/messages" \
  -H "Content-Type: application/json" \
  -d '{"text":"2"}' | grep "event: complete"
```

---

## 11. 配置文件路径

### 11.1 客户端（yishe-client）

| 配置项 | 路径 |
|--------|------|
| Agent 配置 | `src/main/agent/agent-config.ts` |
| 能力注册 | `src/main/capabilities/index.ts` |
| 会话存储 | `~/Library/Application Support/yishe-client/agent-sessions.json` |
| API 路由 | `src/main/agent/agent-api.ts` |
| HTTP 服务 | `src/main/server.ts` |
| MCP Server | `src/main/mcp-server/server.ts` |
| 工具定义 | `src/main/capabilities/*.ts` |

### 11.2 服务端（design-server）

| 配置项 | 路径 |
|--------|------|
| AI Assistant 模块 | `src/ai-assistant/ai-assistant.module.ts` |
| 工具定义 | `src/ai-assistant/tools/definitions/*.ts` |
| 工作流引擎 | `src/workflow/workflow.module.ts` |
| WebSocket Gateway | `src/websocket/websocket.gateway.ts` |
| 节点执行器 | `src/workflow/node-executors.ts` |

---

## 12. 常见问题排查

### 12.1 Agent 不调用工具

**可能原因：**
1. 工具数量超过 48 个被截断
2. 关键词匹配失败
3. 工具未在 CapabilityRegistry 中注册

**排查方法：**
```bash
# 检查工具是否注册
curl http://localhost:1519/api/capabilities | python3 -c "
import sys,json
d=json.load(sys.stdin)
tools = [c for c in d['capabilities'] if c['namespace']=='googleArt']
print(f'googleArt 工具: {len(tools)}')
for t in tools: print(f'  - {t[\"name\"]}')
"
```

### 12.2 服务端无法调用客户端工具

**可能原因：**
1. 客户端未连接到 WebSocket
2. 工具名称格式不匹配
3. MCP Server 未启动

**排查方法：**
```bash
# 检查 WebSocket 连接
curl -s -X POST http://localhost:1520/api/ai-assistant/mcp/list-clients \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 检查 MCP Server 状态
curl http://localhost:1519/api/mcp/info | python3 -m json.tool
```

### 12.3 Google Arts 采集失败

**可能原因：**
1. dezoomify-rs 二进制文件缺失
2. 网络连接问题
3. 素材库 API 不可用

**排查方法：**
```bash
# 检查二进制文件
ls resources/google-art/*/dezoomify-rs-*

# 检查连通性
curl http://localhost:1519/api/agent/google-art-health

# 检查素材库 API
curl -s "https://api.1s.design/api/sticker/list?page=1&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

*文档版本：2.0*  
*最后更新：2026-08-18*  
*维护者：AI Agent Team*

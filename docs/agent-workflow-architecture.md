# Agent 与工作流架构梳理（源码版）

> 更新时间：2026-08-19  
> 范围：`yishe-client`、`design-server`、`yishe-admin` 的 Agent、工具、MCP、工作流链路。  
> 本文回答三个问题：**谁负责理解用户、谁负责执行能力、工作流和 Agent 如何协作。**

---

## 1. 先给结论

系统里不是一个 Agent，而是两个 Agent 加一个工作流运行时：

```text
┌────────────────────────┐
│ 客户端 Agent            │  Electron Main Process
│ ClientLangGraphAgent   │  直接执行本地 Capability
└───────────┬────────────┘
            │ 可选调用服务端能力
            ▼
┌────────────────────────┐
│ 服务端 Agent            │  NestJS / LangGraph
│ AiAssistantService      │  执行数据库和业务工具
└───────────┬────────────┘
            │ 需要电脑端能力时
            ▼
┌────────────────────────┐
│ client_runtime.execute  │  统一客户端能力委托
│ WebSocket / MCP Bridge  │
└────────────────────────┘

┌────────────────────────┐
│ Workflow Runtime        │  服务端工作流引擎
│ WorkflowExecutionEngine │  按画布节点顺序执行
└────────────────────────┘
```

### 能力归属原则

| 能力类型 | 唯一归属 | 典型例子 | 正确执行方式 |
|---|---|---|---|
| 本地能力 | `yishe-client` | 文件、剪贴板、Google Arts、屏幕、COS、桌面插件 | 客户端 `CapabilityRegistry` 直接执行 |
| 服务端业务能力 | `design-server` | 商品、素材数据库、任务、用户、发布记录、统计 | 服务端 `AiAssistantToolRegistryService` 直接执行 |
| 跨端能力 | 客户端实现，服务端委托 | 服务端要求客户端采集 Google Arts、热搜、图片 | `client_runtime.execute` → WebSocket → 客户端 Capability |
| 工作流节点 | 服务端编排 | HTTP、条件、循环、AI、采集、消息推送 | `WorkflowExecutionEngine` 执行节点；节点不复制业务 Handler |

**核心规则：** 客户端能力不上传实现、不复制到服务端；客户端 Agent 不需要重新拉取自己的能力；服务端 Agent 需要客户端能力时使用统一委托入口。

---

## 2. 三个仓库的职责

### 2.1 yishe-client

技术：Electron + Vue + TypeScript。

负责：

- 客户端独立 Agent；
- 本地 CapabilityRegistry；
- 本地文件、屏幕、剪贴板、网络等能力；
- Google Arts、Pinterest 等素材平台的客户端实现；
- Photoshop、浏览器、视频、图片等桌面运行时；
- 1519 本地 HTTP 服务；
- 3210 本地 MCP SSE 服务；
- 与 design-server 的 WebSocket 连接。

关键目录：

```text
src/main/agent/                 客户端 Agent
src/main/capabilities/          本地能力定义和注册
src/main/mcp-server/            本地 MCP 协议适配
src/main/server.ts              1519 HTTP + Socket.IO
src/main/index.ts               Electron 启动和 IPC 注册
src/preload/index.ts            Renderer/Main IPC 边界
src/renderer/src/composables/   Agent UI 状态
src/renderer/src/components/agent/
```

### 2.2 design-server

技术：NestJS + TypeORM + Redis + LangGraph。

负责：

- 用户和权限；
- AI Key 和功能绑定；
- 服务端 Agent；
- 服务端业务工具；
- WebSocket Gateway；
- `client_runtime.execute` 客户端委托；
- 工作流定义、保存、执行、调度、触发和历史。

关键目录：

```text
src/ai-assistant/               服务端 Agent
src/ai-assistant/agent/         LangGraph 图、节点、状态、工具适配
src/ai-assistant/tools/         工具实现和定义
src/websocket/                  客户端连接和消息协议
src/workflow/                   工作流引擎和节点执行器
```

### 2.3 yishe-admin

技术：Vue 3 + Vite + Element Plus。

负责：

- 云端 Agent 对话 UI；
- AI Key 和功能场景绑定；
- 服务端 Agent Run、确认、中断、恢复 UI；
- 工作流列表、编辑器、节点配置、运行和历史；
- 能力库浏览器。

关键目录：

```text
src/components/AiAssistant/       云端 Agent UI
src/store/modules/aiAssistant.ts Agent 状态
src/api/aiAssistant/              Agent API
src/views/workflow/               工作流页面
src/components/workflow/           工作流节点和面板
src/api/workflow/                 工作流 API
```

---

## 3. 客户端 Agent

### 3.1 入口

客户端 Agent 有两种入口，但共用同一个 `ClientLangGraphAgent`：

#### IPC 入口：桌面 UI

```text
Agent.vue
  → useAgent.ts
  → Preload api.agent
  → IPC agent:send-message
  → src/main/agent/agent-ipc.ts
  → ClientLangGraphAgent.run()
```

#### HTTP/SSE 入口：外部测试或本地 UI

```text
POST /api/agent/sessions/:id/messages
  → src/main/agent/agent-api.ts
  → ClientLangGraphAgent.run()
  → SSE reasoning/content/tool_start/tool_end/complete/error
```

本地接口：

```text
http://127.0.0.1:1519/api/agent
```

### 3.2 客户端 Agent 的状态图

```text
用户消息
   │
   ▼
准备配置和工具
   │
   ├── 本地 CapabilityRegistry
   ├── 仅补充客户端没有的服务端工具
   └── 识别 Google Arts 确定性流程
   │
   ▼
agent
   │
   ├── 普通请求 → OpenAI-compatible Chat Completions
   ├── Google Arts 搜索 → 直接 googleArt.search
   ├── 作品编号 → 直接 googleArt.zoom
   └── 分辨率编号 → 直接 googleArt.collect
   │
   ▼
tools
   │
   ├── 本地工具 → CapabilityRegistry.call
   └── server_* → /client-agent/capabilities/execute
   │
   ▼
agent 或结束
```

源码：

```text
src/main/agent/langgraph-agent.ts
```

说明：当前类名叫 `ClientLangGraphAgent`，内部同时保留了官方 LangGraph 和本地 fallback StateGraph，以兼容依赖未完整安装的旧环境。

### 3.3 客户端工具来源

#### 本地工具

启动时由：

```ts
registerAllCapabilities()
```

注册到：

```text
CapabilityRegistry
```

目前客户端目录包含约 183 个能力，来源包括：

```text
filesystem
clipboard
system
screen
network
print
Google Arts
Pinterest
Wikimedia
Pexels
Pixabay
Openverse
Iconify
SVGRepo
新闻
热搜
天气
汇率
```

本地工具名给模型使用时是：

```text
googleArt_search
filesystem_file_read
pinterest_search
```

真实实现仍是：

```text
CapabilityRegistry.call(namespace, name, args, context)
```

#### 服务端补充工具

客户端可以从：

```text
GET /api/ai-assistant/client-agent/capabilities
```

读取服务端能力目录。

当前策略是：

```text
本地工具身份索引
  → 拉取服务端工具
  → 同名能力丢弃
  → 只挂载本地没有的 server_* 工具
```

例如客户端已有：

```text
googleArt_search
```

服务端即使返回同身份能力，也不会重复挂载。

### 3.4 Google Arts 的特殊确定性流程

Google Arts 不能完全交给模型自由规划，客户端已经做了确定性路由：

```text
用户：搜索蒙娜丽莎
  → googleArt.search(keyword="Mona Lisa")
  → 展示 resultIndex

用户：1
  → googleArt.zoom(resultIndex=1)
  → 展示 zooms
  → 强制结束本轮

用户：2
  → googleArt.collect(zoomLevel=2)
  → 下载、COS、素材库入库
```

可信状态在：

```text
src/main/capabilities/googleArt.ts
```

按 `sessionId` 保存，包含：

- 最近搜索结果；
- resultIndex 对应的 URL 和元数据；
- 最近一次 zoom 结果；
- zoom TTL；
- collect 前校验。

collect 不接受模型传入的：

```text
URL
作品 ID
thumbnail
任意 metadata
```

只接受：

```text
zoomLevel
```

### 3.5 客户端 Agent 会话和确认

客户端会话存储：

```text
Electron userData/agent-sessions.json
```

客户端风险：

```text
read   → 自动执行
write  → UI 模式需要确认
system → UI 模式需要确认
```

HTTP API 支持：

```json
{ "autoApprove": false }
```

注意：客户端 Agent 的会话是本地 JSON；服务端 Agent 的会话是数据库，两者不是同一套历史。

---

## 4. 服务端 Agent

### 4.1 入口

主要 API：

```text
POST /api/ai-assistant/chat
POST /api/ai-assistant/chat-stream
POST /api/ai-assistant/runs/stream
POST /api/ai-assistant/runs/:runId/input-stream
POST /api/ai-assistant/runs/:runId/resume-stream
POST /api/ai-assistant/runs/:runId/confirm
POST /api/ai-assistant/runs/:runId/cancel
GET  /api/ai-assistant/runs
GET  /api/ai-assistant/runs/:runId/events
```

入口文件：

```text
src/ai-assistant/ai-assistant.controller.ts
src/ai-assistant/ai-assistant.service.ts
```

### 4.2 服务端 LangGraph 图

```text
START
  ↓
commandRouter
  ├── slash tool command → tools
  ├── prompt command      → agent
  ├── workflow command    → agent
  ├── system command      → END
  └── normal              → agent
       ↓
      agent
       ├── ChatOpenAI.bindTools
       ├── 读取 persona/pageContext/attachments
       └── 产生 tool_calls 或最终文本
       ↓
      tools
       ├── 服务端业务 Tool Registry
       ├── human_input / human_choice / human_form
       ├── interrupt 确认
       └── client_runtime.execute
       ↓
      agent 或 END
```

源码：

```text
src/ai-assistant/agent/graph.ts
src/ai-assistant/agent/state.ts
src/ai-assistant/agent/nodes.ts
src/ai-assistant/agent/tools.ts
```

### 4.3 服务端工具

唯一主要注册中心：

```text
AiAssistantToolRegistryService
```

工具定义包含：

```text
name
label
description
category
readOnly
runtime
inputSchema
executionMode
riskLevel
confirmRequired
plannerEnabled
```

服务端工具例子：

```text
system.user.query_self
system.task.search_queue
product.search
product.detail
sticker.search
publish_task.search
workflow.*
image_processing.*
video.*
client_runtime.execute
```

### 4.4 服务端调用客户端能力

当前目标架构是：

```text
服务端 Agent
  → client_runtime.execute
  → 自动按 userId 找在线客户端
  → 如只有一个，自动选择
  → WebSocket mcp-call
  → yishe-client
  → CapabilityRegistry / MCP adapter
```

调用参数：

```json
{
  "toolName": "googleArt_search",
  "toolArgs": {
    "keyword": "Mona Lisa",
    "maxCount": 8
  },
  "contextId": "optional-workflow-or-run-context"
}
```

旧入口：

```text
mcp_bridge.call
mcp_bridge.list_clients
mcp_bridge.list_tools
```

应视为兼容/诊断入口，不应成为普通 Agent 的规划路径。

### 4.5 服务端 Agent 状态和持久化

服务端持久化：

```text
AiAssistantConversation
AiAssistantMessage
AiAssistantRun
AiAssistantRunEvent
LangGraph checkpointer
```

支持：

```text
确认中断
用户输入中断
表单中断
恢复 Run
取消 Run
查询 Run 事件
```

这比客户端 Agent 的本地 JSON 会话更适合长任务、审计和多人/多设备场景。

---

## 5. 工作流系统

### 5.1 工作流不是 Agent

工作流是确定性运行时：

```text
工作流画布
  → 节点和边
  → WorkflowExecutionEngine
  → NodeExecutor
  → 节点输出
  → 下一个节点
```

Agent 是概率性规划器：

```text
自然语言
  → LLM
  → tool_calls
  → 工具结果
```

二者关系是：

```text
Agent 可以创建、修改、查询、启动工作流
工作流可以包含 AI 节点和客户端能力节点
但工作流本身不等于 Agent
```

### 5.2 工作流数据模型

服务端实体：

```text
Workflow
WorkflowTrigger
WorkflowExecution
WorkflowNodeExecution
WorkflowNodeIndex
```

画布主要包含：

```text
canvas.nodes
canvas.edges
```

每个节点通常包含：

```text
id
type
data.config
data.label
```

### 5.3 工作流 API

```text
POST /api/workflow/create
POST /api/workflow/page
GET  /api/workflow/:id
POST /api/workflow/update
POST /api/workflow/delete
PUT  /api/workflow/:id/toggle-enabled
POST /api/workflow/:id/run
GET  /api/workflow/:id/executions
GET  /api/workflow/executions/:executionId/nodes
DELETE /api/workflow/executions/:executionId
POST /api/workflow/:id/triggers
DELETE /api/workflow/triggers/:triggerId
ALL  /api/workflow/webhook/:path
```

入口：

```text
design-server/src/workflow/workflow.controller.ts
design-server/src/workflow/workflow.service.ts
```

### 5.4 工作流执行引擎

核心文件：

```text
src/workflow/workflow-execution-engine.ts
```

执行步骤：

```text
1. 读取 workflow.canvas.nodes / edges
2. 创建 WorkflowExecutionContext
3. 检测循环区域
4. 构建执行路径
5. 按节点执行
6. 记录 running/success/failed
7. 保存 nodeOutputs
8. 回调 onNodeStateChange
9. 保存执行历史
```

上下文：

```ts
interface WorkflowExecutionContext {
  workflowId: string;
  workflowName: string;
  executionId?: string;
  nodes: any[];
  edges: any[];
  nodeOutputs: Map<string, Record<string, any>>;
  logs: NodeExecutionLog[];
  globalInputs: Record<string, any>;
}
```

模板表达式通过：

```text
src/workflow/workflow-template-evaluator.ts
```

读取前面节点的输出。

### 5.5 节点来源

节点有两份关键清单：

```text
design-server/src/workflow/node-manifest/node-manifest.data.ts
yishe-admin/src/views/workflow/editor/config/node-manifest.ts
```

服务端负责：

```text
节点类型元数据
节点输入输出定义
节点执行器
```

管理端负责：

```text
节点选择器
节点配置 UI
画布渲染
本地预览/编辑器体验
```

### 5.6 节点执行器分类

#### 基础控制节点

```text
start
end
condition
switch
loop
while_loop
```

#### 系统/代码节点

```text
http
js_code
code
llm
ai_call
```

#### 通知节点

```text
message_push
message_push_feishu
message_push_wecom
```

#### 外部数据/热搜节点

```text
hotsearch_*
openmeteo_search
coingecko_search
hackernews_search
github_search
news platform search
```

#### 素材节点

```text
google_arts_culture
pinterest_culture
wikimedia_culture
pexels_search
pixabay_search
openverse_search
iconify_search
svgrepo_search
...
```

当前素材、热搜、外部数据节点已经开始通过统一客户端能力委托执行：

```text
Workflow Node
  → mcpBridgeService
  → client_runtime / MCP call
  → 客户端 CapabilityRegistry
```

节点只负责：

```text
读取配置
选择客户端
传递 contextId
汇总 outputs
```

不能在节点里重复实现下载、搜索、上传和入库。

### 5.7 工作流触发和调度

支持：

```text
manual
cron
webhook
```

组件：

```text
WorkflowTriggerService
WorkflowSchedulerService
Redis ZSET cron trigger
```

Cron 链路：

```text
WorkflowTrigger
  → Redis ZSET
  → Scheduler 扫描到期 trigger
  → WorkflowService.startWorkflow()
  → WorkflowExecutionEngine.execute()
```

Webhook 链路：

```text
POST/GET /api/workflow/webhook/:path
  → 查找启用 trigger
  → startWorkflow()
```

---

## 6. Agent 与工作流如何协作

### 场景 A：Agent 查询数据

```text
用户：查询我最近失败的发布任务
  → 服务端 Agent
  → system.task.search_queue
  → 数据库
  → 回复
```

不需要工作流。

### 场景 B：Agent 执行客户端素材采集

```text
用户：从 Google Arts 搜索蒙娜丽莎
  → 客户端 Agent：直接 CapabilityRegistry
  或
  → 服务端 Agent：client_runtime.execute
  → 客户端 CapabilityRegistry
```

不应该复制客户端工具目录。

### 场景 C：Agent 创建工作流

```text
用户：创建一个每天 9 点采集热搜并发到飞书的工作流
  → 服务端 Agent
  → workflow.* 工具
  → 创建 Workflow canvas
  → 配置 cron trigger
```

### 场景 D：工作流执行客户端采集

```text
Cron 到期
  → WorkflowExecutionEngine
  → hotsearch_weibo / google_arts_culture node
  → client_runtime 委托
  → 客户端执行
  → 节点 outputs
  → 飞书通知节点
```

### 场景 E：工作流中的 AI 节点

```text
Workflow ai_call / llm
  → 服务端 AI 配置
  → 生成文本/结构化结果
  → 写入 nodeOutputs
  → 后续节点引用模板变量
```

---

## 7. 当前最重要的边界问题

### 7.1 已确定的正确方向

- 客户端本地能力只在客户端实现；
- 客户端 Agent 本地能力优先；
- 服务端能力只补充客户端没有的能力；
- 服务端 Agent 不拉取完整客户端工具目录；
- 服务端使用 `client_runtime.execute` 委托客户端能力；
- `list_clients/list_tools` 只用于诊断和多设备场景；
- 工作流节点只编排，不复制业务 Handler；
- Google Arts 必须 search → zoom → 用户选档 → collect。

### 7.2 当前仍需清理的代码

1. `AiAssistantMcpBridgeService.getClientAgentToolDefinitions()` 仍保留在源码中，但新的服务端 Agent 主链路已不应调用它，后续应删除或标记 legacy。
2. `mcp_bridge.call` 保留兼容入口，但普通 Agent 规划应使用 `client_runtime.execute`。
3. `mcp_bridge.list_clients/list_tools` 保留诊断入口，但不应出现在普通规划目录。
4. `node-manifest.data.ts` 和管理端 node manifest 存在双份维护，后续应明确服务端清单为来源，管理端生成或同步。
5. `node-executors.ts` 历史上存在多次控制节点注册痕迹，`Map` 会以后注册覆盖前注册，需进一步清理并增加重复注册检测。
6. 部分旧客户端服务命令仍存在，需继续确认是否还有工作流路径绕过统一 Capability 委托。

---

## 8. 最小排障地图

### 客户端 Agent 不调用本地工具

```text
1. GET localhost:1519/api/health
2. GET localhost:1519/api/capabilities
3. 确认 CapabilityRegistry 已注册
4. 看 SSE tool_start/tool_end
5. 检查 sessionId 是否传入 Google Arts context
6. 最后再看模型工具选择
```

### 服务端 Agent 不调用客户端能力

```text
1. 确认 Agent 工具目录有 client_runtime.execute
2. 确认当前用户有在线客户端
3. 确认 WebSocket 连接归属 userId
4. 确认 client_runtime.execute 的 toolName 规范
5. 确认 mcp-call → mcp-result
6. 检查 requestId/contextId/connectionId
```

### 工作流节点失败

```text
1. 查询 workflow execution
2. 查询 workflow node executions
3. 看 nodeType 和 node config
4. 看 globalInputs.userId
5. 看客户端在线状态
6. 看 client_runtime/MCP 返回内容
7. 确认节点没有使用旧 service-command
```

---

## 9. 建议的最终产品模型

### 用户视角

用户只需要知道：

```text
Agent
工作流
客户端
```

不应该看到：

```text
MCP Bridge
connectionId
工具目录同步
工具注册表
```

除非用户进入开发者诊断页面。

### 开发者视角

每个新能力必须声明：

```text
归属：client/server
canonical name
input schema
risk level
是否需要确认
是否可作为 workflow node
是否支持 client_runtime 委托
```

### 新增客户端能力标准流程

```text
1. 在 yishe-client CapabilityRegistry 定义一次
2. 本地 Agent 自动可见
3. 本地 MCP 自动适配
4. 服务端如需调用，使用 client_runtime.execute
5. 工作流如需调用，使用同一个委托适配器
6. 不在 server tool registry 复制一份业务 Handler
7. 不在 workflow executor 再写一份下载/采集逻辑
```

## 10. 工作流可靠执行当前实现

当前 `design-server` 已接入 BullMQ：

```text
WorkflowService.startWorkflow()
  → WorkflowExecution(queued)
  → yishe:workflow-runs
  → WorkflowQueueService
  → WorkflowRunExecutorService
  → WorkflowExecutionEngine
```

支持：

- 队列接收不设置业务数量上限；
- Worker 并行度通过 `WORKFLOW_RUN_CONCURRENCY` 配置，默认 10；
- 客户端完全离线时最多 3 次重试，固定 60 秒间隔；
- 排队任务服务重启恢复；
- 节点边界取消；
- 节点边界暂停和恢复；
- `POST /api/workflow/executions/:executionId/cancel`；
- `POST /api/workflow/executions/:executionId/pause`；
- `POST /api/workflow/executions/:executionId/resume`；
- 工作流和执行记录按 `userId` 隔离；
- 重试恢复时复用同一 executionId，并跳过已经持久化成功的顶层节点。

当前仍需继续完善：客户端外部调用的 AbortSignal、所有副作用 Handler 的显式幂等键，以及循环体节点的恢复跳过策略。

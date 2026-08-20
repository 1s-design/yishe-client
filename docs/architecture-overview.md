# 衣设系统架构总览（源码事实版）

> 更新时间：2026-08-18  
> 适用范围：`yishe-client`、`design-server`、`yishe-admin` 及 Agent / MCP / 工作流主链路。  
> 本文是架构入口；详细的接口样例和单功能测试仍分别放在 `docs/agent-architecture-handoff.md`、`docs/agent-test-handoff.md` 等文档中。

## 0. 先记住这五件事

1. **这是三个独立仓库，不是一个前后端目录。** 客户端、服务端、管理端必须分别看自己的 Git 状态、依赖和启动命令。
2. **有两个 Agent。** `yishe-client` 的 Agent 在 Electron 主进程运行；`design-server` 的 Agent 在 NestJS 服务端运行。它们都使用 LangGraph 风格的 ReAct 循环，但状态、会话和工具集合不同。
3. **有三种“工具”来源。** 客户端 `CapabilityRegistry`、服务端 `AiAssistantToolRegistryService`、客户端 MCP Server 的动态工具注册表，不能简单当成同一个注册表。
4. **有两个 MCP 语境。** 客户端 `127.0.0.1:3210` 是本机 SSE MCP Server；服务端 `/api/mcp` 是云端 MCP 入口；`mcp_bridge.*` 是服务端 Agent 通过 WebSocket 调用客户端工具的桥。
5. **文档中的工具总数不是协议常量。** 工具会因版本、禁用策略、在线客户端和 `plannerEnabled` 动态变化；排障时以运行时目录接口为准，不要依赖“183 / 153+”等旧数字。

## 1. 仓库边界与职责

| 仓库 | 技术 | 主要职责 | 不应放在哪里 |
|---|---|---|---|
| `yishe-client` | Electron + Vue + TypeScript | 本地 Agent、本地文件/设备/插件能力、PS/浏览器/视频等桌面运行时、本地 HTTP 和 Socket.IO 服务 | 不承担服务端数据库业务规则 |
| `design-server` | NestJS + TypeORM + Redis + LangGraph | 用户与权限、AI Key/功能绑定、云端 Agent、业务工具注册和执行、WebSocket 网关、工作流持久化与执行 | 不直接访问用户电脑文件和桌面应用 |
| `yishe-admin` | Vue 3 + Vite + Element Plus | 管理端 UI、AI Key 与功能场景绑定、云端 Agent UI、工作流编辑器和运行记录 | 不实现客户端本地能力 |
| `yishe-extensions` | WXT/浏览器扩展 | 浏览器侧扩展能力和网页协作 | 不作为 Agent 的唯一状态存储 |
| `yishe-nuxt` / `yishe-docs` | Nuxt / VitePress | 对外站点和文档 | 不作为核心 Agent 运行时 |

### 1.1 核心端口

| 地址 | 进程 | 用途 | 备注 |
|---|---|---|---|
| `127.0.0.1:1519` | yishe-client Main | 本地 Express API、Agent SSE、能力 REST、Socket.IO `/ws` | 仅绑定本机；不是云端 Agent API |
| `127.0.0.1:3210` | yishe-client Main | 本机 MCP SSE：`/sse`、`/messages`、`/health` | 由 `McpServerManager` 管理，和 1519 不同 |
| `:1520` / `https://api.1s.design` | design-server | Nest API（全局前缀 `/api`）和 WebSocket namespace `/ws` | 本地开发通常为 `http://localhost:1520` |
| `:1521` | 旧/辅助运行时（按部署） | 部分客户端 MCP/浏览器 AI 配置代码仍引用 | 不能把它当成主 Agent API，需结合部署确认 |
| `:1595` / `:1596` | PS / 浏览器自动化辅助服务 | 客户端外部进程 | 是否可用取决于机器和插件状态 |

## 2. 总体数据流

```text
┌──────────────┐      REST/SSE       ┌────────────────────┐
│ yishe-admin  │ ───────────────────▶ │ design-server :1520 │
│ 管理端/工作流 │ ◀─────────────────── │ Nest API + DB/Redis │
└──────┬───────┘                      └─────────┬──────────┘
       │ WebSocket /ws                          │ mcp_bridge / service-command
       │                                        ▼
┌──────▼──────────────────────────────────────────────────┐
│ yishe-client Electron                                    │
│ Renderer ──IPC──▶ Main Agent/Registry/Plugins            │
│              │                                           │
│              ├─ OpenAI-compatible Model（主进程直连）     │
│              ├─ 1519 Local API + Socket.IO               │
│              └─ 3210 Local MCP SSE                       │
└─────────────────────────────────────────────────────────┘
```

### 2.1 客户端独立 Agent

```text
Agent.vue / useAgent
  → POST localhost:1519/api/agent/sessions/:id/messages
  → createAgentApiRouter
  → ClientLangGraphAgent（Main）
      → 拉取云端目录（可选，30 秒缓存）
      → 合并本地工具 + server_* 工具
      → OpenAI-compatible Chat Completions(stream=true)
      → agent → tools → agent，最多 8 轮
      → CapabilityRegistry.call(...) 或 executeServerCapability(...)
  → SSE: reasoning/content/tool_*/complete/error
```

Renderer 通过 Preload 只能调用 IPC，不能直接获得 API Key 或执行本地 handler。Agent 的本地运行时在：

- `yishe-client/src/main/agent/langgraph-agent.ts`
- `yishe-client/src/main/agent/agent-api.ts`
- `yishe-client/src/main/agent/agent-ipc.ts`
- `yishe-client/src/main/agent/server-capabilities.ts`
- `yishe-client/src/main/agent/session-store.ts`

### 2.2 服务端 Cloud Agent

```text
yishe-admin AiAssistant
  → POST /api/ai-assistant/chat-stream 或 /runs/stream
  → AiAssistantService
  → createAgentGraph()
      → commandRouter
      → agent（ChatOpenAI.bindTools）
      → tools
      → agent
  → 服务端工具 handler / mcp_bridge.call
  → SSE 事件 + AiAssistantRun/AiAssistantRunEvent 持久化
```

服务端 Agent 的核心状态包含 `runId`、`userId`、`conversationId`、页面上下文、附件、工具结果和 Human interrupt；客户端 Agent 则使用本地 JSON 会话和内存中的运行状态，两者不能互相读取会话。

## 3. 工具系统：三个注册表，四条调用路径

### 3.1 三个注册表

| 注册表 | 位置 | 内容 | 运行时来源 |
|---|---|---|---|
| 客户端能力注册表 | `yishe-client/src/main/capabilities/registry.ts` | `CapabilityDefinition`：Zod schema、风险等级、handler | 启动时 `registerAllCapabilities()` |
| 服务端 Agent 注册表 | `design-server/src/ai-assistant/ai-assistant-tool-registry.service.ts` | `AiAssistantToolDefinition` + `resolveTool` handler | Nest DI + 工具定义数组 |
| 客户端 MCP 注册表 | `yishe-client/src/main/mcp-server/server.ts` 的 `toolRegistry` | MCP 工具、input schema、actions/operations | MCP Server 创建时动态注册 |

服务端的 `GET /api/ai-assistant/tool-catalog` 会把服务端注册表和当前用户在线客户端通过 `mcp-list-tools` 返回的 MCP 工具合并；这属于**目录聚合**，不是把两边实现合并成一个注册表。

### 3.2 名称转换

| 场景 | 示例 |
|---|---|
| 客户端 Capability 完整名 | `googleArt.search` |
| 客户端给 OpenAI 的函数名 | `googleArt_search` |
| 服务端工具定义原名 | `system.task.search_queue` |
| 客户端给 OpenAI 的云端函数名 | `server_system_task_search_queue` |
| 服务端桥接工具 | `mcp_bridge.call` |
| MCP 客户端工具 | `hotsearch_weibo`、`image_process_execute` 等 |

点号转下划线后不能通过简单 `split` 还原服务端工具，所以客户端使用目录建立 `serverToolIndex`；新增工具要优先检查名称映射、目录和执行接口三处。

### 3.3 四条调用路径

1. **客户端本地工具：** `ClientLangGraphAgent → CapabilityRegistry.call → handler`。
2. **客户端 Agent 调服务端工具：** `server_* → POST /api/ai-assistant/client-agent/capabilities/execute → AiAssistantToolRegistryService.execute`。
3. **服务端 Agent 调服务端工具：** `agent → AiAssistantToolRegistryService.execute → 业务 Service/Repository`。
4. **服务端 Agent 调客户端工具：** `mcp_bridge.call → WebSocket mcp-call → client mcp-result → pending request`。

### 3.4 统一工具的硬规则

从本轮开始按以下规则维护，禁止再新增“同一个工具换个名字再实现一次”：

1. **一个能力只能有一个业务 handler。** 客户端本地能力放在 `CapabilityRegistry`；服务端业务能力放在 `AiAssistantToolRegistryService`。
2. **MCP 只能是适配器。** MCP 的协议 schema、目录元数据和调用入口必须从规范注册表生成，不能再次复制 handler。
3. **工作流只能是编排器。** 工作流节点可以组合多个规范工具，但不能直接再实现下载、搜索、上传等业务逻辑。
4. **兼容名称不能产生第二个定义。** 旧名称只允许在入口做 alias → canonical 映射；目录中只展示 canonical 名称。
5. **同一个 MCP Server 实例禁止重复注册。** 客户端 MCP 注册器现在会在重复名称时直接抛错，避免 `server.tool` 和运行时目录静默覆盖。
6. **所有连续调用必须传递 context。** 例如 Google Arts 的 search → zoom → collect 通过 `sessionId/contextId` 隔离，不允许使用全局共享临时状态。

### 3.5 服务端 Agent 的客户端能力委托

服务端 Agent 不再拉取或复制客户端完整工具目录。模型只看到一个服务端入口：

```text
client_runtime.execute
```

调用参数中指定客户端规范能力：

```json
{
  "toolName": "googleArt_search",
  "toolArgs": { "keyword": "Mona Lisa", "maxCount": 8 }
}
```

服务端自动定位当前用户的客户端（单客户端自动选择，多客户端才需要选择），再通过 WebSocket/MCP Bridge 委托给客户端 `CapabilityRegistry`。客户端的 handler、schema、会话状态和风险校验仍归客户端所有，服务端不复制工具目录。

当前规范示例：

```text
CapabilityDefinition: googleArt.search / zoom / collect
MCP canonical name:   googleArt_search / googleArt_zoom / googleArt_collect
Legacy alias:         googleArt.search → googleArt_search
禁止继续注册:         google_art_download / google_art_collect
```

## 4. Google Arts：必须区分两条实现

### 4.1 客户端可信工作流（当前客户端 Agent 首选）

`yishe-client/src/main/capabilities/googleArt.ts` 使用按 `sessionId` 隔离的内存状态：

```text
googleArt.search(keyword)
  → 返回 resultIndex，URL/元数据只用于展示
googleArt.zoom(resultIndex)
  → 主进程保存可信 URL + zooms，等待用户选 zoomLevel
googleArt.collect(zoomLevel)
  → 主进程复用可信状态
  → dezoomify-rs 下载
  → COS 上传
  → sticker/material library 入库
```

模型不应传 URL、thumbnail、作品 ID 给 `zoom/collect`。数字回复会被 `tryAutoCollectZoomLevel` 直接拦截并执行 collect，避免模型只生成“已入库”文本。

### 4.2 MCP 适配结果

旧的 `google_art_search`、`google_art_download`、`google_art_collect` MCP 实现已从客户端注册链路移除；本地 MCP 现在自动适配 `CapabilityRegistry`，只暴露：

```text
googleArt_search
googleArt_zoom
googleArt_collect
googleArt_status
```

`googleArt.search` 仅作为点号到下划线的兼容映射，不创建第二个工具定义。旧的 `google_art_download` / `google_art_collect` 会明确返回停用提示，防止绕过可信状态。

## 5. 工作流引擎

### 5.1 服务端执行链

```text
Admin workflow editor
  → workflow DTO / entity
  → WorkflowService
  → WorkflowExecutionEngine
      → node type → executor
      → template evaluator / context
      → WorkflowExecution + WorkflowNodeExecution
  → scheduler / trigger（可选）
```

核心文件：

- `design-server/src/workflow/workflow-execution-engine.ts`：执行、注册、生命周期和节点结果。
- `design-server/src/workflow/node-executors.ts`：节点执行器注册及外部客户端命令。
- `design-server/src/workflow/node-manifest/`：节点目录/前端可见 schema。
- `design-server/src/workflow/workflow.service.ts`：工作流 CRUD 与执行入口。
- `design-server/src/workflow/workflow-scheduler.service.ts`、`workflow-trigger.service.ts`：定时与触发。
- `yishe-admin/src/views/workflow/editor/`：画布、节点配置和前端执行器。

### 5.2 节点数量的正确表达

源码中 `node-executors.ts` 存在重复注册基础控制节点、平台采集节点和多组兼容注册逻辑；“100+ 节点”可作为产品级概述，但不是可靠的源码计数。真实可用节点应以 `node-manifest.data.ts` + `registerAllNodeExecutors()` 的交集为准。

新增节点必须同时检查：

1. Node manifest / schema；
2. `node-executors.ts` 的 executor；
3. 工作流服务的依赖注入；
4. admin 的节点注册、配置面板、执行器；
5. 若调用客户端，客户端 service-command handler 和 result envelope。

## 6. 认证、状态与数据归属

| 数据 | 归属 | 生命周期 |
|---|---|---|
| 用户 JWT | 客户端 Main 的 token persistence + 服务端 WebSocket auth | 登录到登出；登出应清除 |
| 模型 API Key | 客户端 Main 内存/本地配置文件；服务端 AI Key 数据库 | 由 `ai.client-agent.execute` 绑定同步；Renderer 只拿脱敏配置 |
| 客户端 Agent 会话 | `app.getPath('userData')/agent-sessions.json` | 本机、按客户端用户环境 |
| 服务端 Agent 会话 | `AiAssistantConversation` / `AiAssistantMessage` | 服务端数据库，按 userId 隔离 |
| 服务端 Agent Run | `AiAssistantRun` / `AiAssistantRunEvent` + checkpointer | 支持中断、确认、恢复、取消 |
| Google Arts 可信选择 | 客户端 Main 内存 `workflowBySession` | 30 分钟 TTL，按 sessionId |
| WebSocket 客户端连接 | design-server 内存 + Redis runtime registry + ClientNode | 在线状态和短期运行态 |

## 7. 源码审计发现（按优先级）

| 优先级 | 发现 | 位置 | 处理建议 |
|---|---|---|---|
| P0 | 默认配置曾包含硬编码模型密钥 | `yishe-client/src/main/agent/agent-config.ts`、`src/main/image-tool/legacy/ai-service.js` | 已改为不携带密钥且默认禁用；已泄露凭据必须在供应商侧立即撤销/轮换，不能只改 Git 文件 |
| P0 | 本地 Agent HTTP API 绑定 localhost，但 Agent 路由本身不要求 `x-local-secret` | `yishe-client/src/main/server.ts`、`agent-api.ts` | 仍需防止本机恶意进程调用写工具；建议增加本地 secret / session origin 校验和速率限制 |
| P1 | 客户端独立 Agent 与服务端 Cloud Agent 的会话、确认、取消协议不同 | `yishe-client/src/main/agent/*`、`design-server/src/ai-assistant/*` | 文档和 UI 必须明确是哪一个 Agent；后续可统一事件 envelope，不要直接混用 endpoint |
| P1 | 工作流节点仍通过独立 `service-command` 直接执行 Google Arts 批量采集，绕过客户端 CapabilityRegistry | `design-server/src/workflow/node-executors.ts`、`yishe-client/src/renderer/src/services/websocketClient.ts` | 下一步将工作流改为调用规范 `googleArt_search/zoom/collect`，并明确 workflow 的 `zoomLevel` 策略；禁止再新增第二套下载 handler |
| P1 | 工具目录数量是动态值，旧文档中的固定总数会误导排障 | 三个 registry / `tool-catalog` | 文档只写计数方式，测试通过接口记录 revision/total |
| P2 | `yishe-client` Web 类型检查曾被未使用导入、未使用函数和 `siteAvailable` 未定义阻塞 | `useAgent.ts`、`websocketClient.ts` | 已修复；每次 Agent 改动执行 `npm run typecheck` |

## 8. 排障顺序（不要一上来改模型 Prompt）

### 客户端 Agent 不回复

1. `curl http://localhost:1519/api/health`；
2. `curl http://localhost:1519/api/agent/config`（只看 `enabled/model/hasApiKey`，不要输出密钥）；
3. 检查登录 token 和 `syncCloudAgentConfig()` 是否成功；
4. 检查模型 Base URL 是否是 OpenAI-compatible `/v1`；
5. `curl http://localhost:1519/api/capabilities`，确认能力已注册；
6. 再看 `tool_start/tool_end/error`，最后才看工具选择关键词。

### 客户端 Agent 找不到云端工具

1. 客户端是否已 `setServerEndpoint()`；
2. 请求 `GET /api/ai-assistant/client-agent/capabilities` 是否 200；
3. 目录是否包含工具、`plannerEnabled` 是否为 true；
4. OpenAI 函数名是否为 `server_` 前缀；
5. 执行是否命中 `/client-agent/capabilities/execute`；
6. 若返回 `requires_confirmation`，确认 UI 是否调用 `/api/agent/approve`。

### 服务端 Agent 调不到客户端

1. WebSocket namespace `/ws` 是否在线；
2. 连接是否带有效 token，且 connection 属于当前 userId；
3. `mcp_bridge.list_clients` 获取 connectionId；
4. `mcp_bridge.list_tools` 确认真实 `toolName`；
5. 客户端是否收到 `mcp-call` 并返回 `mcp-result`；
6. 检查 requestId、connectionId、userId 三者是否一致及超时。

## 9. 维护规则

- 代码路径、端口、请求/响应以源码为准；功能完成后再更新本文。
- 工具新增不要手写“总数”；应补充注册位置、schema、风险、执行路径和测试用例。
- 所有写操作明确 `readOnly` / `riskLevel` / `confirmRequired`，并写清楚用户确认发生在哪一层。
- 不在文档、日志、截图和 curl 示例中保存 JWT、API Key、COS Secret 或本地隐私路径。
- 任何 Agent 问题先提供：仓库 + commit + 运行模式 + endpoint + 脱敏日志 + 最小复现输入。

## 10. 工具去重迁移状态

| 范围 | 状态 | 当前做法 |
|---|---|---|
| 客户端本地能力 → 本地 MCP | 已完成第一阶段 | MCP 从 `CapabilityRegistry` 自动生成，schema/handler 不再手写两份 |
| MCP 自定义工具的协议注册 → 运行时目录 | 已完成第一阶段 | 使用 `registerTool()` 统一注册；同一 MCP Server 实例重复名称直接报错 |
| Google Arts Agent / MCP | 已完成 | 只保留 `googleArt_search/zoom/collect/status`，旧批量下载工具移除 |
| Google Arts 服务端工作流节点 | 已完成第一阶段 | 改为通过 MCP Bridge 顺序调用规范工具，并要求显式 `zoomLevel` |
| Pinterest / Wikimedia / Pexels 等素材工作流节点 | 已完成第一阶段 | 统一使用 `namespace_collect` Capability MCP 工具；节点只负责选择设备、传递上下文和汇总结果 |
| 热搜、外部数据、素材工作流节点 | 已完成第一阶段 | 统一通过客户端规范 MCP 工具执行；节点执行器只保留通用设备选择、上下文传递和结果汇总 |
| 图片处理、视频渲染 MCP 工具 | 已完成第一阶段 | 通过统一 `registerTool()` 同时注册 MCP 协议和运行时目录；当前没有对应的重复工作流 executor |

因此当前原则是：**不再新增重复实现；已有非 Google 工作流路径按上表逐步迁移。**

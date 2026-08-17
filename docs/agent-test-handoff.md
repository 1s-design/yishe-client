# 衣设 Agent 全链路测试交接文档

> **用途**：交给测试、产品验收或后续开发人员，用于验证 `yishe-client`、`design-server` 与 `yishe-admin` 的 Agent 配置、模型调用、工具执行、人工确认、素材能力和发布流程。  
> **更新日期**：2026-08-17  
> **文档范围**：客户端独立 Agent；不替代管理端 Cloud Agent 的完整会话验收，但包含客户端调用云端能力适配接口的联调检查。

---

## 1. 测试目标与验收边界

### 1.1 目标

验证用户从登录到 Agent 完成任务时，以下链路正确、可解释且安全：

```text
登录
→ 获取用户身份与服务端 AI 绑定
→ 主进程取得模型密钥（Renderer 不可见）
→ 客户端 Agent 规划并流式输出
→ 按风险执行本地工具 / 请求用户确认
→ 显示工具结果与最终总结
→ 本地保存会话，支持下次继续查看
```

### 1.2 重点验收

- 用户必须已经登录，Agent 才可进入可用状态；
- 无绑定模型时，需要给出明确配置提示，不能静默失败；
- 模型 Key 不可暴露到 Renderer、LocalStorage、日志或 UI；
- 只读工具自动执行；有副作用的工具必须展示确认卡片；
- 用户可执行、取消、补充信息或停止生成；
- 流式输出自动跟随滚动，用户上滚查看历史时不强行打断；
- 工具错误、模型错误、配置错误要可定位；
- 主题、登录、服务控制台等 UI 不影响 Agent 主流程；
- 客户端发布包可成功构建并上传固定 COS 地址。

### 1.3 当前架构状态（测试人员必须知晓）

| 项目            | 当前责任                                                                                 | 是否为客户端独立 Agent 主链路 |
| --------------- | ---------------------------------------------------------------------------------------- | ----------------------------- |
| `yishe-client`  | 登录、模型密钥主进程保管、独立 Agent、客户端本地能力、会话本地保存、Human-in-the-loop UI | 是                            |
| `design-server` | 用户/权限、AI Key、功能场景绑定、Cloud Agent 工具注册与服务端能力执行                    | 是（配置/服务端能力来源）     |
| `yishe-admin`   | 管理 AI Key、功能场景绑定、用户权限及服务端运营配置                                      | 是（配置入口）                |

> **重要现状**：`design-server` 已提供客户端 Agent 云端能力目录和执行接口；当前客户端独立 Agent 的主运行时仍主要直接消费 `CapabilityRegistry` 中的本地能力。  
> 因此，**“服务端能力目录接口可用”** 与 **“客户端独立 Agent 已动态合并全部云端工具”** 应作为两个独立测试项；后者属于后续架构集成验收项，不能默认已完成。

---

## 2. 版本与代码定位

请在每次测试前记录实际 commit / 版本，避免把旧客户端结果当成当前问题。

| 项目            | 建议检查命令                                  | 核心位置                                                                        |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| `yishe-client`  | `node -p "require('./package.json').version"` | `src/main/agent/`、`src/main/capabilities/`、`src/renderer/src/views/Agent.vue` |
| `design-server` | `node -p "require('./package.json').version"` | `src/ai-assistant/`                                                             |
| `yishe-admin`   | `node -p "require('./package.json').version"` | `src/views/system/ai-api-key/`                                                  |

推荐记录格式：

```text
测试日期：
测试人：
客户端版本 / commit：
design-server 版本 / commit：
yishe-admin 版本 / commit：
服务环境：local / remote
账号：测试账号（不要记录密码或 Token）
模型提供商 / 模型：
```

---

## 3. 总体架构与数据流

### 3.1 配置和模型密钥链路

```text
yishe-admin
  └─ AI API Key 管理 / AI 使用设置
       └─ 绑定 feature code: ai.client-agent.execute

客户端登录成功
  └─ yishe-client Renderer 获取 token（仅用于 IPC / 请求）
       └─ Main Process: syncCloudAgentConfig()
            1. POST /api/user/getAiSetting
            2. 读取 featureBindings["ai.client-agent.execute"]
            3. GET  /api/system/ai-api-key/:keyId
            4. 在主进程缓存 apiKey / baseUrl / model

Renderer
  └─ 只获得 enabled、provider、model、keyId 等脱敏信息
```

关键代码：

| 责任                             | 文件                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| 云端配置同步、Key 脱敏、退出清除 | `yishe-client/src/main/agent/agent-config.ts`                                |
| IPC                              | `yishe-client/src/main/agent/agent-ipc.ts`                                   |
| Agent 页面启动时同步             | `yishe-client/src/renderer/src/views/Agent.vue`                              |
| 管理端功能场景绑定               | `yishe-admin/src/views/system/ai-api-key/components/AiUsageSettingPanel.vue` |

### 3.2 客户端独立 Agent 运行链路

```text
Renderer ChatView
  └─ useAgent.sendMessage()
       └─ IPC: agent:send-message
            └─ ClientLangGraphAgent（Electron Main）
                 ├─ 选择相关本地工具
                 ├─ 调用 OpenAI-compatible 模型（流式）
                 ├─ 读取 reasoning_content / content / tool_calls
                 ├─ read 工具：自动执行
                 ├─ write / system 工具：暂停，等待用户确认
                 └─ 工具结果返回模型，再生成最终总结

Main IPC stream events
  └─ Renderer 更新思考、正文、工具状态、确认卡与错误
```

关键代码：

| 责任                                     | 文件                                             |
| ---------------------------------------- | ------------------------------------------------ |
| LangGraph 风格状态图、工具选择、工具协议 | `src/main/agent/langgraph-agent.ts`              |
| 工具审批 IPC                             | `src/main/agent/agent-ipc.ts`                    |
| Preload 暴露                             | `src/preload/index.ts`                           |
| 会话、流式状态、审批状态                 | `src/renderer/src/composables/useAgent.ts`       |
| 对话和确认卡 UI                          | `src/renderer/src/components/agent/ChatView.vue` |

### 3.3 服务端 Cloud Agent 能力适配链路

```text
design-server AiAssistantToolRegistryService
  ├─ 统一定义：名称、描述、分类、Input Schema、风险、确认策略
  ├─ GET  /api/ai-assistant/client-agent/capabilities
  └─ POST /api/ai-assistant/client-agent/capabilities/execute
       ├─ read / safe_write：执行既有 handler
       └─ confirm_required：返回 requires_confirmation
```

该接口**复用既有服务端工具 handler**，不复制业务实现。

---

## 4. 环境准备

### 4.1 测试账号

准备至少两类账号：

| 账号类型                                | 用途                     |
| --------------------------------------- | ------------------------ |
| 已绑定可用模型的普通用户                | 正常 Agent 全流程        |
| 未绑定 `ai.client-agent.execute` 的用户 | 验证未配置提示与权限隔离 |
| 可选：无素材库 / 无写入权限用户         | 验证失败提示和工具确认   |

禁止在测试记录、截图、Issue 中粘贴：

- JWT / Bearer Token；
- API Key / Secret；
- COS SecretId / SecretKey；
- 含用户隐私的本地绝对路径和附件内容。

### 4.2 服务地址

客户端配置位置：

```text
yishe-client/src/renderer/src/config/api.ts
```

| 模式     | API                          | WebSocket                   |
| -------- | ---------------------------- | --------------------------- |
| 开发本地 | `http://localhost:1520/api`  | `http://localhost:1520/ws`  |
| 远程     | `https://1s.design:1520/api` | `https://1s.design:1520/ws` |

客户端本地服务：

```text
http://localhost:1519/api
```

### 4.3 管理端配置步骤

1. 登录 `yishe-admin`；
2. 进入：**系统 → AI API Key**；
3. 新建或确认目标 Key 可用，至少包含：Provider、Base URL、Model、API Key；
4. 打开 **AI 使用设置 → 功能场景绑定**；
5. 找到“客户端 Agent”对应场景，确认 code：

   ```text
   ai.client-agent.execute
   ```

6. 选择可用 Key，点击保存；
7. 使用测试用户登录客户端；
8. 重启客户端或退出重新登录，等待 Agent 页面完成配置同步。

### 4.4 构建前准备

```bash
cd yishe-client
npm ci --legacy-peer-deps
npm run typecheck
npm run build
```

> 若 `npm ci` 报 `@esbuild/aix-ppc64` 等非当前平台包错误，检查 `package-lock.json` 是否又混入了临时目录路径（例如 `../../private/tmp/yishe-lock-stage/...`）。这类记录必须移除；AIX 平台包在正常锁文件中应标记为 `optional: true`。

---

## 5. 必测功能用例

### A. 登录、鉴权和模型绑定

| ID      | 场景       | 操作                      | 预期结果                                          | 优先级 |
| ------- | ---------- | ------------------------- | ------------------------------------------------- | ------ |
| AUTH-01 | 正确登录   | 输入有效账号密码          | 登录成功，进入 Agent                              | P0     |
| AUTH-02 | 错误密码   | 输入错误密码              | 显示“错误的账号密码”                              | P0     |
| AUTH-03 | 无 Token   | 清理本地登录态后重启      | 留在登录页，不加载 Agent                          | P0     |
| AUTH-04 | 已绑定模型 | 登录已配置账号            | Agent 可用，能发消息                              | P0     |
| AUTH-05 | 未绑定模型 | 登录未配置账号            | 空状态显示“客户端 Agent 尚未配置”及管理端提示     | P0     |
| AUTH-06 | 退出登录   | 点击侧栏退出              | Loading 出现，登录态、用户信息和 Agent Key 被清除 | P0     |
| AUTH-07 | 切换用户   | A 登录后退出，再用 B 登录 | B 不可复用 A 的模型 Key、会话配置或权限           | P0     |

### B. 模型与流式输出

| ID      | 场景           | 测试输入                  | 预期结果                                            | 优先级 |
| ------- | -------------- | ------------------------- | --------------------------------------------------- | ------ |
| CHAT-01 | 普通问答       | `介绍一下你能做什么`      | 流式输出正常结束                                    | P0     |
| CHAT-02 | 连续两轮       | 连续发送两句问题          | 第二句不应卡死、无限 loading 或出现 `Unknown error` | P0     |
| CHAT-03 | 停止生成       | 长回答时点击停止          | 输出停止；已输出内容保留                            | P0     |
| CHAT-04 | 思考模型       | 使用支持 reasoning 的模型 | 思考过程可显示/折叠；工具后仍能继续回答             | P0     |
| CHAT-05 | 自动滚动       | 让模型输出长文            | 位于底部时自动跟随；上滚阅读时不强拉回              | P1     |
| CHAT-06 | 工具结果后总结 | 触发搜索工具              | 工具结束后模型给出可读总结                          | P0     |
| CHAT-07 | 新会话         | 点击新建                  | 新会话独立，历史不串台                              | P1     |
| CHAT-08 | 重启恢复       | 对话后重启客户端          | 本地会话能恢复显示                                  | P1     |

### C. 澄清、补充信息与人工确认

#### C1. 自然语言澄清

| ID      | 输入                       | 预期                                                           |
| ------- | -------------------------- | -------------------------------------------------------------- |
| HITL-01 | `帮我下载图片`             | Agent 应追问关键词、数量、保存位置或是否入素材库，而非盲目执行 |
| HITL-02 | `帮我找几张适合海报的图片` | Agent 可先澄清风格、主题、数量；用户补充后继续完成             |
| HITL-03 | `删除一个常用网址`         | Agent 应先询问明确的记录 ID / 名称，再进入确认步骤             |

#### C2. 本地高风险工具确认卡

当前客户端策略：本地 `CapabilityRegistry` 工具的风险等级为：

```text
read   → 自动执行
write  → 需要用户确认
system → 需要用户确认
```

| ID      | 场景           | 操作                   | 预期                                                     |
| ------- | -------------- | ---------------------- | -------------------------------------------------------- |
| HITL-04 | 写入工具待确认 | 要求下载/采集/写入操作 | 聊天中出现“需要你的确认”卡片，显示工具名与参数           |
| HITL-05 | 确认执行       | 点击“执行”             | 卡片显示“已确认，正在执行”，随后工具开始、结束并输出总结 |
| HITL-06 | 取消执行       | 点击“取消”             | 不执行工具；模型收到取消结果并给出对应说明               |
| HITL-07 | 系统级工具     | 触发系统/本机敏感能力  | 卡片文案为“需要系统权限”                                 |
| HITL-08 | 等待确认期间   | 不点击确认，观察 UI    | 不应私自执行工具；不应丢失会话                           |
| HITL-09 | 停止等待       | 在确认卡存在时点击停止 | 等待被中断，不应继续执行                                 |

> 注意：当前确认状态在当前运行内维护。测试“重启客户端后恢复待确认任务”应标记为**后续能力**，不作为已实现行为验收。

### D. 本地工具与素材能力

#### D1. 基础只读能力

| ID      | 测试输入                     | 预期工具方向              |
| ------- | ---------------------------- | ------------------------- |
| TOOL-01 | `北京今天的天气`             | `openmeteo` / `wttr`      |
| TOOL-02 | `查询 USD 转 CNY 汇率`       | `frankfurter`             |
| TOOL-03 | `查一下 GitHub 上的热门仓库` | `github`                  |
| TOOL-04 | `找几个 SVG 图标`            | `svgrepo`                 |
| TOOL-05 | `今天有哪些科技新闻`         | 新闻能力 / Hacker News 等 |

#### D2. 艺术与开放版权素材

| ID      | 测试输入                 | 预期                                                    |
| ------- | ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------- |
| TOOL-06 | `帮我找几个梵高的作品`   | 优先选 Wikimedia Commons / Openverse，而不是默认 Pexels |
| TOOL-07 | `下载几张梵高作品`       | 先搜索；下载前出现确认卡；确认后返回本地路径/素材结果   |
| TOOL-08 | `在 Pexels 搜索摄影图片` | 仅在明确摄影/Pexels 场景下使用 Pexels                   |
| TOOL-09 | Pexels 失败回退          | Pexels 被 Cloudflare/403 限制时                         | 给出可读错误或建议转 Wikimedia/Openverse，不能只显示 `Unknown error` |

已知网络现象：直接访问 Pexels 站点可能出现 Cloudflare `403 Just a moment...`。这不是客户端登录问题；艺术作品测试优先使用 Wikimedia/Openverse。

### E. 服务端 Cloud Agent 能力接口联调

> 此部分验证 `design-server` 适配层本身。当前客户端是否动态合并目录，须按“后续集成”项单独验证。

#### E1. 能力目录

```bash
curl -sS \
  -H "Authorization: Bearer <TEST_TOKEN>" \
  "https://<HOST>/api/ai-assistant/client-agent/capabilities"
```

预期：

```json
{
  "revision": "server-tools-<number>",
  "total": 1,
  "generatedAt": "...",
  "tools": [
    {
      "id": "...",
      "name": "...",
      "label": "...",
      "runtime": "server",
      "readOnly": true,
      "executionMode": "read_only|safe_write|confirm_required",
      "riskLevel": "low|medium|high",
      "confirmRequired": false,
      "inputSchema": {}
    }
  ]
}
```

检查点：

- `total > 0`；
- 不包含 `plannerEnabled === false` 的工具；
- schema、标签、风险级别存在；
- 无 API Key、Token、内部异常栈泄漏。

#### E2. 只读工具执行

```bash
curl -sS -X POST \
  -H "Authorization: Bearer <TEST_TOKEN>" \
  -H "Content-Type: application/json" \
  "https://<HOST>/api/ai-assistant/client-agent/capabilities/execute" \
  -d '{"tool":"<READ_TOOL_NAME>","input":{}}'
```

预期：

```json
{ "status": "completed", "success": true }
```

#### E3. 需要确认的服务端工具

第一次请求不带确认：

```json
{
  "tool": "<CONFIRM_REQUIRED_TOOL>",
  "input": {}
}
```

预期：

```json
{
  "status": "requires_confirmation",
  "tool": "...",
  "label": "...",
  "riskLevel": "medium|high",
  "question": "..."
}
```

第二次请求：

```json
{
  "tool": "<CONFIRM_REQUIRED_TOOL>",
  "input": {},
  "confirmed": true
}
```

预期：正常执行，返回 `completed` 或业务失败的结构化结果。

### F. UI / 主题 / 服务控制台

| ID    | 项目          | 预期                                                               |
| ----- | ------------- | ------------------------------------------------------------------ |
| UI-01 | 日间/夜间切换 | Agent 主界面、侧栏、工具卡、通知跟随主题                           |
| UI-02 | 登录页        | 登录表单与左侧插画轮播随主题适配；轮播图片可淡入淡出切换           |
| UI-03 | 服务控制台    | 全高显示；状态区和设置区可滚动；不应被旧 `max-height:70vh` 限制    |
| UI-04 | 服务状态卡    | Hover 有轻量反馈；不强制撑满整列高度                               |
| UI-05 | 工具卡        | Header、图标、文字、内容区有足够内边距；标题与内容区之间有分隔间距 |
| UI-06 | 确认卡        | 日间/夜间均可读；执行、取消均可点击                                |
| UI-07 | 小窗口        | 登录页隐藏插画区；控制台转为上下布局且内容可滚动                   |

---

## 6. 数据存储、日志与排障

### 6.1 客户端本地数据

| 数据                 | 位置                                               | 注意事项                         |
| -------------------- | -------------------------------------------------- | -------------------------------- |
| Agent 会话           | Renderer `localStorage` 键：`yishe-agent-sessions` | 本地保存；不是服务端会话同步     |
| Agent 缓存配置       | `userData/yishe-client-agent-config.json`          | 含主进程缓存配置；退出登录会清除 |
| 客户端日志（打包版） | `userData/logs/client/YYYY-MM-DD/client.log`       | 默认保留 7 天，容量受控          |
| 开发环境日志         | `<项目根目录>/logs/client/...`                     | 便于本地复现                     |

### 6.2 推荐日志检索

```bash
# 开发环境
rg -n 'client-agent|Agent|Pexels|Wikimedia|Openverse|ERROR' logs/client

# 关注 Agent 运行错误
rg -n 'Agent 流式执行失败|Agent IPC 执行异常' logs/client
```

错误报告必须附带：

1. 客户端版本与 commit；
2. 使用的测试账号类型（已绑定/未绑定，不附 Token）；
3. 测试输入；
4. 从发送到失败的完整界面截图或录屏；
5. 工具确认卡是否出现；
6. 对应时间附近 100 行脱敏日志；
7. 服务端请求 ID / 服务端日志（若有）。

### 6.3 常见问题速查

| 现象                    | 优先检查                                                 | 处理建议                                                  |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `客户端 Agent 尚未配置` | `featureBindings[ai.client-agent.execute]`、Key 是否可用 | 管理端绑定后退出重新登录                                  |
| `未获取到模型密钥`      | `/user/getAiSetting`、`/system/ai-api-key/:id` 权限      | 检查 Key 所属用户、公开/共享权限和服务端返回              |
| `Unknown error`         | 模型兼容协议、工具后第二轮请求、日志 `client-agent`      | 确认 reasoning_content 回传版本已部署；附日志复现         |
| Pexels 搜不到/403       | 网络、防护、Pexels 限流                                  | 使用 Wikimedia/Openverse 进行艺术素材测试                 |
| 确认卡不出现            | 工具风险定义是否为 `write/system`                        | 检查 CapabilityDefinition 的 `riskLevel`                  |
| 点击执行无响应          | IPC `agent:resolve-tool-approval`、callId                | 查 Preload、Main IPC 和 `client-agent` 日志               |
| 输出不自动滚动          | Conversation 组件版本                                    | 检查用户是否主动上滚；回到底部后应恢复跟随                |
| 服务控制台底部空白      | 旧 `.dashboard-modal__body { max-height:70vh }`          | 确认旧样式已删除且当前包已更新                            |
| CI 卡在 COS 上传        | `TencentCloud/cos-action@v1` 单请求上传大文件            | 记录卡住步骤、文件大小、时长；建议后续改 COS SDK 分片上传 |

---

## 7. 发布与安装包测试

### 7.1 发布工作流

工作流：

```text
.github/workflows/build.yml
```

触发逻辑：推送 `main` 且 `package.json` 版本号变化；也可手动 `workflow_dispatch`。

构建矩阵：

| 平台    | Runner           | 产物                       |
| ------- | ---------------- | -------------------------- |
| macOS   | `macos-latest`   | `release/yishe-client.dmg` |
| Windows | `windows-latest` | `release/yishe-client.exe` |

COS 固定对象：

```text
yishe-client/mac/latest.dmg
yishe-client/windows/latest.exe
```

所需 GitHub Actions Secrets：

```text
TENCENT_SECRET_ID
TENCENT_SECRET_KEY
TENCENT_COS_BUCKET
TENCENT_COS_REGION
```

### 7.2 发布测试用例

| ID     | 操作                       | 预期                                               |
| ------ | -------------------------- | -------------------------------------------------- |
| REL-01 | 修改 patch 版本并推送 main | 构建工作流触发                                     |
| REL-02 | macOS 构建                 | 生成 DMG 且 GitHub Release 上传成功                |
| REL-03 | Windows 构建               | 生成 EXE 且 GitHub Release 上传成功                |
| REL-04 | COS 上传                   | `publish-cos` 成功，两个固定对象更新               |
| REL-05 | 下载验证                   | 固定下载地址获取到新版本文件                       |
| REL-06 | 安装验证                   | 安装后启动、登录、模型绑定、一次只读工具调用均正常 |

> 当前 `TencentCloud/cos-action@v1` 对大安装包可能出现长时间无进度。若复现，保留完整 Step 日志和产物文件大小，交给开发处理分片上传改造。

---

## 8. 建议测试顺序（冒烟 → 回归）

### 8.1 P0 冒烟（每次发布必测）

1. 正确登录；
2. 已绑定用户能进入 Agent；
3. 普通问答流式输出；
4. 连续第二轮问答；
5. 一次只读工具调用；
6. 一次写入工具确认后执行；
7. 一次写入工具取消；
8. 退出登录后重新登录；
9. 服务控制台可打开、可滚动；
10. macOS / Windows 构建与 COS 上传状态。

### 8.2 P1 回归（每日或功能合并后）

1. 艺术素材检索与下载；
2. 图片附件提问；
3. 主题切换；
4. 登录插画轮播；
5. 会话创建、删除、重启恢复；
6. 长文本自动滚动与上滚保护；
7. 服务端能力目录与确认接口；
8. 无绑定用户、无权限用户、网络失败用户。

---

## 9. 验收结论模板

```markdown
# Agent 测试结论

- 测试版本：
- 测试环境：
- 测试账号类型：
- P0 通过率：x / 10
- P1 通过率：x / 8

## 阻塞问题

1. [P0/P1] 标题：
   - 输入：
   - 实际：
   - 预期：
   - 日志：
   - 截图/录屏：

## 非阻塞问题

...

## 是否允许发布

- [ ] 允许
- [ ] 有条件允许
- [ ] 不允许
```

---

## 10. 后续架构测试项（尚未作为当前客户端主链路验收）

以下项目建议列为下一阶段专项：

1. 客户端 Agent 动态拉取并合并 `design-server` 云端能力目录；
2. 客户端 UI 对服务端 `requires_confirmation` 返回建立统一确认卡；
3. 将 MCP-only 本地能力（浏览器自动化、Video Template、Google Art、热搜等）统一纳入客户端 Agent 可选能力目录；
4. 待确认任务持久化与客户端重启恢复；
5. Agent 运行轨迹、工具审计与可导出诊断包；
6. COS 安装包上传改为 SDK 分片上传并展示进度、超时与重试；
7. 建立自动化 E2E：登录 → 绑定 → 对话 → 工具确认 → 下载/采集 → 发布验收。

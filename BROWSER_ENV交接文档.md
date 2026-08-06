# Browser Env 交接与排障文档

## 一、先说结论

这条链路的核心问题，不是 `yishe-client` 完全没有浏览器环境能力，而是：

1. 客户端本地已经具备 `profileId` 级别的环境管理能力。
2. MCP 侧也已经支持很多浏览器操作工具，并且这些工具多数已经能透传 `profileId`。
3. 真正没打通的主要是上层服务编排和返回结构：
   - 服务端查询客户端时，没有把浏览器环境列表带出来。
   - 服务端调用浏览器连接/关闭时，没有稳定地传递 `profileId`。
   - 交接文档原描述把“客户端未实现”和“服务端未接入”混在了一起，容易误判问题位置。

一句话概括：`yishe-client` 底层能力大体已在，当前更像“接线问题”，不是“从零开发问题”。

---

## 二、项目现状梳理

### 已经具备的能力

| 模块 | 状态 | 说明 |
|------|------|------|
| Python Browser-Agent 服务 | ✅ | 端口 `1596`，用于 `browser-use` 执行自然语言浏览器任务 |
| MCP Server | ✅ | 端口 `3210`，已注册浏览器类工具 |
| 浏览器环境注册表 | ✅ | 已有多环境管理、活动环境、端口分配等能力 |
| 指定 `profileId` 启动浏览器 | ✅ | 客户端 `connect/launch` 链路已支持 |
| 指定 `profileId` 关闭浏览器 | ✅ | 客户端关闭链路已支持 |
| 浏览器页面操作透传 `profileId` | ✅ | MCP 浏览器操作工具已支持传 `profileId` |

### 当前真实缺口

| 层级 | 问题 | 结论 |
|------|------|------|
| design-server / AI Assistant 服务端 | 查询客户端返回值里没有浏览器环境列表 | 这是当前最需要补的点 |
| design-server / AI Assistant 服务端 | 调用 connect / close 时未稳定传递 `profileId` | 需要补齐工具定义和参数映射 |
| 文档 | 对客户端现状描述失真 | 需要按真实代码更新认知 |

---

## 三、`yishe-client` 里已经实现到什么程度

### 1. Auto Browser HTTP 接口已经存在

文件：`src/main/auto-browser/index.ts`

当前已暴露的关键接口：

- `GET /api/browser/status`
- `POST /api/browser/connect`
- `POST /api/browser/close`
- `GET /api/browser/profiles`
- `POST /api/browser/profiles`
- `GET /api/browser/profiles/:profileId`
- `PUT /api/browser/profiles/:profileId`
- `DELETE /api/browser/profiles/:profileId`
- `POST /api/browser/profiles/:profileId/switch`

这说明客户端本身已经有“环境列表”和“按环境管理”的 HTTP 能力，不是空白状态。

### 2. 浏览器连接链路已经支持 `profileId`

文件：`src/main/auto-browser/index.ts`

- `handleBrowserConnect(body)` 会读取 `body.profileId`
- `handleBrowserClose(body)` 会读取 `body.profileId`

文件：`src/main/auto-browser/legacy/services/BrowserService.js`

- `launchWithDebugPort({ profileId })` 已支持按环境选择 `userDataDir` 和 `debugPort`
- `closeBrowser({ profileId })` 已支持关闭指定环境
- `getBrowserStatus({ profileId })` 已支持按环境查询状态

### 3. 环境注册表与调试端口分配已经存在

文件：`src/main/auto-browser/legacy/services/BrowserProfileService.js`

已具备：

- profile 持久化
- `activeProfileId`
- 自动分配 debug port
- 每个 profile 独立 `userDataDir`
- profile 元信息管理

这说明“浏览器环境”在客户端里并不是临时概念，而是正式的数据模型。

### 4. MCP 浏览器工具已基本支持 `profileId`

文件：`src/main/mcp-server/tools/browser-tools.ts`

工具如：

- `browser_navigate`
- `browser_click`
- `browser_type`
- `browser_get_text`
- `browser_screenshot`

这些工具的 schema 都已经包含可选的 `profileId`，执行时也会传给 `getCurrentPage(profileId)`。

---

## 四、当前问题真正卡在哪

### 问题 1：服务端拿不到环境列表

客户端已经有 `GET /api/browser/profiles`，但如果 design-server 侧的 `query_clients` 或 `query_connections` 只返回客户端在线状态，而不向客户端取 profile 列表，那么 Agent 看不到：

- 有哪些环境
- 哪个环境是活动环境
- 每个环境对应哪个 `profileId`

这就是为什么上层表现为“不能指定环境”，本质上是因为它根本不知道有哪些环境可选。

### 问题 2：服务端 connect / close 没有把 `profileId` 当成一等参数

客户端本地已经支持：

```json
POST /api/browser/connect
{ "profileId": "YC-xxxx" }
```

```json
POST /api/browser/close
{ "profileId": "YC-xxxx" }
```

但如果 design-server 工具定义、参数校验、映射对象里没有这个字段，最终还是只能启动默认环境。

### 问题 3：文档把“客户端能力缺失”写重了

原文档里“浏览器环境查询 / 启动 / 关闭未完成”的说法，对 `yishe-client` 代码现状并不准确。更准确的表述应该是：

- 客户端：大部分已实现
- 服务端聚合层：尚未打通

---

## 五、建议的修复顺序

### P0：让服务端查询客户端时返回 `browserProfiles`

推荐做法：

1. 服务端查询在线客户端后，再调用对应客户端的 `GET /api/browser/profiles`
2. 把结果映射到客户端信息中，例如新增 `browserProfiles`
3. 最少返回这些字段：
   - `profileId`
   - `name`
   - `debugPort`
   - `isActive`
   - `lastUsedAt`

推荐返回结构：

```json
{
  "clientId": "xxx",
  "isOnline": true,
  "browserProfiles": [
    {
      "profileId": "YC-XXX-001",
      "name": "工作环境",
      "debugPort": 9333,
      "isActive": true
    }
  ]
}
```

### P0：让服务端 `connect` 支持 `profileId`

目标调用：

```json
{
  "clientId": "xxx",
  "profileId": "YC-XXX-001"
}
```

服务端最终应转发到客户端：

```json
POST /api/browser/connect
{
  "profileId": "YC-XXX-001"
}
```

### P1：让服务端 `close` 支持 `profileId`

目标调用：

```json
POST /api/browser/close
{
  "profileId": "YC-XXX-001"
}
```

### P1：统一 Agent 的话术到参数映射

例如：

- “启动工作环境”
- “用环境 YC-XXX-001 打开网页”
- “关闭测试环境”

都应该先解析到 `profileId`，再调用工具。

---

## 六、关键代码位置

### 客户端 `yishe-client`

| 文件 | 作用 | 当前判断 |
|------|------|------|
| `src/main/auto-browser/index.ts` | Auto Browser HTTP 接口入口 | 已支持 profiles/list/connect/close |
| `src/main/auto-browser/legacy/services/BrowserService.js` | 浏览器连接、关闭、状态管理 | 已支持 `profileId` |
| `src/main/auto-browser/legacy/services/BrowserProfileService.js` | profile 注册表、debug port、activeProfile | 已完成 |
| `src/main/auto-browser/legacy/services/ManagedProfileBrowserPool.js` | 多环境浏览器实例池 | 已完成基础能力 |
| `src/main/mcp-server/tools/browser-tools.ts` | 页面级操作工具 | 已支持透传 `profileId` |
| `src/main/mcp-server/server.ts` | MCP 工具注册 | 已注册浏览器类工具 |

### 服务端 `design-server`

以下位置仍然是需要修改的重点：

| 文件 | 建议修改点 |
|------|------|
| `src/ai-assistant/tools/definitions/browser-automation-tool.definitions.ts` | 给 `connect/close/query` 类工具补 `profileId` 或 `browserProfiles` 相关定义 |
| `src/ai-assistant/tools/browser-automation-tool-support.service.ts` | 查询客户端时补拉取 profile 列表；转发 connect/close 时透传 `profileId` |

---

## 七、建议的联调流程

```text
1. 先在 yishe-client 本地验证：
   - GET /api/browser/profiles
   - POST /api/browser/connect { profileId }
   - POST /api/browser/close { profileId }

2. 再改 design-server：
   - query_clients 返回 browserProfiles
   - connect / close 支持 profileId

3. 最后验证 Agent 对话：
   - 查询浏览器环境
   - 启动指定环境
   - 用指定环境执行 browser_agent_execute
```

---

## 八、排障建议

如果后续联调仍失败，优先检查这几个点：

1. 服务端是否真的拿到了客户端 `browserProfiles`
2. Agent 选中的环境名是否正确映射成 `profileId`
3. `connect` 请求体里是否真的带上了 `profileId`
4. 客户端本地该 `profileId` 是否存在
5. 该 profile 的 `debugPort` 是否被占用

---

## 九、当前判断

这项工作的最优路径不是继续深挖 `yishe-client` 底层，而是：

1. 认可客户端已有能力
2. 修正服务端工具编排
3. 更新文档，避免后续继续把问题误判到客户端底层

---

**文档版本：** v2.0  
**更新时间：** 2026-08-05  
**整理人：** AI Assistant

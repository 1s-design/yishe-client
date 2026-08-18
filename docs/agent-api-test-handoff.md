# Agent HTTP API — 测试交接报告

## 1. 概述

### 1.1 本次新增内容

在 yishe-client（Electron 应用）的本地 Express 服务（端口 1519）上新增了一组 **Agent HTTP API**，允许外部 HTTP 请求与客户端 Agent 交互。

### 1.2 核心改动文件

| 文件 | 说明 |
|------|------|
| `src/main/agent/agent-api.ts` | **新增** — HTTP API 路由实现 |
| `src/main/agent/session-store.ts` | **新增** — 会话持久化存储（JSON 文件） |
| `src/main/agent/langgraph-agent.ts` | **修改** — 新增 `autoApproveWrite` 自动审批模式 |
| `src/main/agent/agent-config.ts` | **修改** — system prompt 规则 4-6 重写 |
| `src/main/capabilities/googleArt.ts` | **新增** — 可信 Google Arts 工作流 |
| `src/main/materialLibrary.ts` | **新增** — 通用素材库上传模块 |
| `src/main/server.ts` | **修改** — 注册 `/api/agent/*` 路由 |
| `src/main/googleArt.ts` | **修改** — 错误诊断增强、下载健壮性 |

### 1.3 服务端改动（design-server）

| 文件 | 说明 |
|------|------|
| `src/ai-assistant/tools/mcp-bridge.service.ts` | **修改** — Google Arts 搜索缓存校验+自动重试 |
| `src/ai-assistant/tools/definitions/mcp-bridge.tools.ts` | **修改** — 工具描述更新 |
| `src/ai-assistant/agent/nodes.ts` | **修改** — system prompt 增加 Google Arts 专项规则 |

---

## 2. HTTP API 文档

### 2.1 基础信息

- **Base URL**: `http://localhost:1519/api/agent`
- **认证**: 无需额外认证（服务绑定 localhost，需客户端已登录）
- **Content-Type**: `application/json`

### 2.2 接口列表

#### GET /api/agent/config — Agent 配置状态（诊断）

```bash
curl http://localhost:1519/api/agent/config
```

响应：
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

#### GET /api/agent/sessions — 会话列表

```bash
curl http://localhost:1519/api/agent/sessions
```

#### POST /api/agent/sessions — 创建会话

```bash
curl -X POST http://localhost:1519/api/agent/sessions \
  -H "Content-Type: application/json" \
  -d '{"title": "测试会话"}'
```

#### GET /api/agent/sessions/:id — 会话详情（含完整消息历史）

```bash
curl http://localhost:1519/api/agent/sessions/{session_id}
```

#### DELETE /api/agent/sessions/:id — 删除会话

```bash
curl -X DELETE http://localhost:1519/api/agent/sessions/{session_id}
```

#### POST /api/agent/stop — 停止当前生成

```bash
curl -X POST http://localhost:1519/api/agent/stop
```

#### POST /api/agent/sessions/:id/messages — 发送消息（SSE 流式）

```bash
curl -N -X POST http://localhost:1519/api/agent/sessions/{session_id}/messages \
  -H "Content-Type: application/json" \
  -d '{"text": "你好"}' \
  --no-buffer
```

SSE 事件流格式：
```
event: reasoning
data: {"delta": "思考中..."}

event: content
data: {"delta": "你好"}

event: tool_start
data: {"id": "call_xxx", "name": "googleArt.search", "args": {...}}

event: tool_end
data: {"id": "call_xxx", "name": "googleArt.search", "result": {...}}

event: complete
data: {"fullText": "回复内容", "fullReasoning": "..."}
```

---

## 3. Google Arts 采集工作流（重点测试）

### 3.1 工作流概览

```
用户搜索 → googleArt.search → 展示结果（items[].resultIndex）
    ↓
用户选择作品 → googleArt.zoom（传 resultIndex）→ 展示分辨率档位
    ↓
用户选择档位 → googleArt.collect（传 zoomLevel）→ 下载 + COS 上传 + 素材库入库
    ↓
返回 success=true & materialLibraryOk=true
```

### 3.2 关键安全设计

**可信状态隔离**：
- 作品 URL、元数据、可用分辨率保存在**主进程内存**中（按 sessionId 隔离）
- 模型只能传递 `resultIndex`（数字）和 `zoomLevel`（数字）
- **模型无法接触或伪造 URL/元数据**

**多层防编造**：
1. System Prompt 规则（告诉模型不要编造）
2. 工具 schema 限制（collect 只接收 zoomLevel）
3. 主进程可信状态（URL/元数据由主进程保存）
4. `prepareGoogleArtCollect` 校验（写操作前验证）
5. 输出兜底纠偏（用工具真实结果覆盖模型文本）

### 3.3 服务端 MCP Bridge 工作流

```
服务端模型 → mcp_bridge.call("googleArt.search", {...})
    ↓
MCP Bridge → WebSocket → 客户端执行 search
    ↓
MCP Bridge 校验返回 query 是否匹配请求 keyword
    ├── 匹配 → 返回结果
    └── 不匹配（缓存数据）→ 自动重试（带 _cacheBust）
        ├── 重试匹配 → 返回结果
        └── 仍不匹配 → 注入 _warning 告知 Agent
```

### 3.4 素材库入库链路

```
googleArt.collect → syncGoogleArtToMaterialLibrary()
    ↓
getGoogleArtZooms() — 调用 dezoomify-rs 获取可用分辨率
    ↓
spawn(dezoomify-rs --zoom-level N) — 下载高清图到本地
    ↓
uploadToMaterialLibrary() — 通用素材库模块
    ├── uploadFileToCos() — 上传 COS
    └── POST /sticker/create — 入库（写服务端数据库）
```

---

## 4. 测试场景

### 4.1 基础 API 测试

```bash
# 1. 检查 Agent 配置
curl http://localhost:1519/api/agent/config

# 2. 创建会话
SESSION_ID=$(curl -s -X POST http://localhost:1519/api/agent/sessions \
  -H "Content-Type: application/json" \
  -d '{"title": "测试"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")

# 3. 发送简单问题
curl -N -X POST "http://localhost:1519/api/agent/sessions/$SESSION_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"text": "你好，请用一句话介绍你自己"}' --no-buffer

# 4. 查看会话详情
curl -s "http://localhost:1519/api/agent/sessions/$SESSION_ID" | python3 -m json.tool
```

### 4.2 Google Arts 采集测试（完整流程）

```bash
SESSION_ID="你的会话ID"

# Step 1: 搜索
curl -N -X POST "http://localhost:1519/api/agent/sessions/$SESSION_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"text": "帮我搜索 Van Gogh 的向日葵画作"}' --no-buffer

# Step 2: 获取第1幅作品分辨率
curl -N -X POST "http://localhost:1519/api/agent/sessions/$SESSION_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"text": "获取第1幅作品的分辨率"}' --no-buffer

# Step 3: 选择档位并采集
curl -N -X POST "http://localhost:1519/api/agent/sessions/$SESSION_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"text": "选择档位4"}' --no-buffer
```

### 4.3 验证素材库

采集成功后，需要验证素材是否入库：

```bash
# 使用 token 查询服务端素材库
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# 查询最新的 sticker 记录
curl -s "https://api.1s.design/api/sticker/list?page=1&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 或者查询素材库统计
curl -s "https://api.1s.design/api/sticker/stats" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 5. 已知问题和修复记录

### 5.1 已修复

| 问题 | 修复方案 |
|------|----------|
| 模型不调用 collect 工具，直接编造"已入库" | 新增 `tryAutoCollectZoomLevel` 前置拦截（数字回复直接触发 collect） |
| zoom/collect 失败时错误信息被吞 | `getGoogleArtZooms` 增加 stdout 输出暴露 + 进程退出码 |
| 模型无限重试 zoom | system prompt 新增"最多重试一次"规则 |
| HTTP API 调用时工具审批阻塞 | 新增 `autoApproveWrite` 自动审批模式 |
| 素材库上传链路重复实现 | 抽取通用 `materialLibrary.ts` 模块 |

### 5.2 待验证/潜在问题

| 问题 | 说明 |
|------|------|
| Google Arts 搜索缓存 | 服务端 mcp-bridge 会校验 query 匹配，不匹配时自动重试。如果重试仍失败，会注入 `_warning` |
| dezoomify-rs 二进制依赖 | 需要 `resources/google-art/{platform}/dezoomify-rs-*` 文件存在 |
| 模型可能传错 resultIndex | 用户说"第1幅"但模型可能传 `resultIndex: 2`，这是模型行为问题 |
| 采集超时 | collect 超时设置为 10 分钟，高清图下载+上传可能较慢 |

---

## 6. 服务端 Agent 工作流节点说明

### 6.1 工作流中的 Google Arts 节点

在 `design-server/src/workflow/node-executors.ts` 中有 `googleArtsCultureExecutor`，这是**工作流引擎**中的节点执行器，与 HTTP API 调用是**不同的路径**：

- **工作流节点**: 通过 `mcp_bridge.call` → WebSocket → 客户端插件执行
- **HTTP API**: 直接调用 `clientLangGraphAgent.run()` → 本地能力执行

### 6.2 MCP Bridge 缓存校验逻辑

```typescript
// mcp-bridge.service.ts
const isGoogleArtSearch = toolName === "googleArt.search";
const requestedKeyword = isGoogleArtSearch ? String(toolArgs?.keyword || "").trim() : "";

// 执行后校验
if (isGoogleArtSearch && requestedKeyword) {
  const resultData = this.extractResultData(response.result);
  const returnedQuery = String(resultData?.query || "").trim().toLowerCase();
  const isCached = resultData?.cached === true;
  const queryMismatch = returnedQuery && returnedQuery !== requestedKeyword.toLowerCase();

  if (isCached && queryMismatch) {
    // 自动重试
    const retryArgs = { ...toolArgs, _cacheBust: Date.now() };
    const retryResponse = await executeOnce(retryArgs, "retry");
    // ...
  }
}
```

### 6.3 素材库入库 API

服务端素材库接口：`POST /api/sticker/create`

请求体关键字段：
```json
{
  "url": "COS 图片 URL",
  "key": "COS key",
  "suffix": "jpg",
  "originUrl": "Google Arts 作品页 URL",
  "source": "Google Arts & Culture - Van Gogh Museum",
  "group": "google-art",
  "name": "Sunflowers",
  "nameEn": "Sunflowers",
  "description": "Vincent van Gogh · January 1889 · Van Gogh Museum",
  "keywords": "Sunflowers, Vincent van Gogh, Van Gogh Museum",
  "keywordsEn": "Sunflowers, Vincent van Gogh, Van Gogh Museum, google arts culture, fine art, painting",
  "colorPalette": "#hexcolor",
  "meta": { ... }
}
```

响应格式：
```json
{
  "code": 0,
  "status": true,
  "data": { "id": "uuid", "url": "...", ... }
}
```

---

## 7. 测试检查清单

### 7.1 API 功能检查

- [ ] `GET /api/agent/config` 返回正确配置
- [ ] `GET /api/agent/sessions` 返回会话列表
- [ ] `POST /api/agent/sessions` 创建会话成功
- [ ] `GET /api/agent/sessions/:id` 返回完整消息
- [ ] `POST /api/agent/sessions/:id/messages` SSE 流式正常
- [ ] `POST /api/agent/stop` 能停止生成
- [ ] `DELETE /api/agent/sessions/:id` 能删除会话

### 7.2 Google Arts 采集检查

- [ ] 搜索能返回正确结果（Van Gogh 向日葵）
- [ ] zoom 能获取分辨率档位（0-4 或类似）
- [ ] collect 能触发下载 + 入库
- [ ] 采集成功后 `materialLibraryOk === true`
- [ ] 失败时错误信息清晰（不是"未能获取分辨率"）

### 7.3 素材库验证

- [ ] 服务端 `/api/sticker/list` 能查到新入库的素材
- [ ] 素材元数据正确（标题、作者、来源、关键词）
- [ ] 素材图片 URL 可访问

### 7.4 异常场景

- [ ] zoom 失败时不无限重试
- [ ] collect 失败时模型不编造成功
- [ ] 搜索结果与查询词不匹配时有警告
- [ ] 网络超时后错误信息清晰

---

## 8. 快速测试脚本

```bash
#!/bin/bash
# 快速测试 Agent API
# 使用方法: bash test-agent-api.sh

BASE="http://localhost:1519/api/agent"

echo "=== 1. 检查配置 ==="
curl -s "$BASE/config" | python3 -m json.tool

echo -e "\n=== 2. 创建会话 ==="
CREATE=$(curl -s -X POST "$BASE/sessions" -H "Content-Type: application/json" -d '{"title":"API测试"}')
echo "$CREATE" | python3 -m json.tool
SID=$(echo "$CREATE" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
echo "Session ID: $SID"

echo -e "\n=== 3. 发送消息 ==="
curl -N -X POST "$BASE/sessions/$SID/messages" \
  -H "Content-Type: application/json" \
  -d '{"text":"你好"}' --no-buffer | head -20

echo -e "\n\n=== 4. 查看会话 ==="
curl -s "$BASE/sessions/$SID" | python3 -m json.tool

echo -e "\n=== 完成 ==="
```

---

## 9. 构建和启动

```bash
# 构建
cd yishe-client
npm run build

# 启动（需要 GUI 环境）
npm start

# 验证服务
curl http://localhost:1519/api/health
curl http://localhost:1519/api/agent/config
```

---

## 10. 联系人

如有问题请联系：jackie (jackieontheway666@gmail.com)

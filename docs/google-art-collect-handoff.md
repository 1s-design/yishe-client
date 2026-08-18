# Google Arts 采集链路交接文档

> **用途**：交后续开发者继续优化 `yishe-client` 的 Google Arts（`googleArt.search → zoom → collect`）采集工作流。
> **更新日期**：2026-08-17
> **范围**：客户端本地 Agent 的 Google Arts 采集链路；不涉及管理端与服务端存储逻辑。

---

## 1. 背景与目标

原链路的问题：Agent 在「用户从搜索结果中选作品 → 选分辨率档位 → 真正下载入库」的采集流程中反复出现**编造/改写事实**：

1. 跨轮对话时 renderer 只回灌助手总结、不保留工具的结构化结果，模型被迫从自然语言里「重建」URL → URL 被改写。
2. 模型未真正调用 `googleArt.collect`，却直接输出「采集成功！✅ /Users/.../Sunflowers.jpg 17.5 KB」这类**假路径、假成功**。
3. 大量工具被 `allTools.slice(0, 48)` 截断时，`googleArt_collect` 落在第 48 位之后被挤出工具列表，模型根本拿不到 collect 工具，只能编造。

目标：从机制上杜绝「URL 改写」与「假成功/假路径」，保证采集链路真实、可解释、可重复。

**当前状态**：链路已经打通并实测成功（用户确认素材库真实新增记录）。剩余问题是**对话体验混乱**（见 §6），这是下一步优化的重点。

---

## 2. 核心架构：序号寻址 + 服务端可信状态

### 2.1 数据流

```text
googleArt.search(用户关键词)
  └─ 主进程缓存搜索结果（session 隔离，30 分钟 TTL）
  └─ 返回 items[].resultIndex（1 起的序号，不是 URL）

googleArt.zoom(resultIndex)
  └─ 主进程按序号解析真实 URL（可信状态，模型不可见）
  └─ 返回档位 idx / width×height / tiles，并写 latestZoom

googleArt.collect(resultIndex, zoomLevel)
  └─ 主进程用可信 URL 高清拼图 + 下载
  └─ syncLocalFileToMaterialLibrary → POST {apiBase}/sticker/create
  └─ 返回 materialId / materialUrl / filePath（由服务端实体 id + url 解析）
```

### 2.2 关键原则

- **序号寻址**：模型只传 `resultIndex` / `zoomLevel` 整数，永远不需要背 URL；URL 只存在于主进程可信状态里。
- **session 隔离**：`latestSearch` / `latestZoom` / `searchCache` 都挂在按 sessionId 隔离的 `CapabilityCallContext` 的 `workflow` 上，不会串会话。
- **zoom 后必须停下等用户选档**：工具描述和系统提示均要求 zoom 后停止并展示档位表，禁止自行选择。
- **collect 之后确定性输出**：模型不能自由生成「成功/路径」总结，展示层直接用工具结果生成结论。

---

## 3. 关键文件与职责

| 文件 | 职责 |
| --- | --- |
| `src/main/capabilities/googleArt.ts` | search / zoom / collect / status 四个能力定义；序号寻址、searchCache（30 分钟 TTL + cached 标记）、`hasTrustedGoogleArtZoom`（TTL 检查） |
| `src/main/agent/langgraph-agent.ts` | 本地 StateGraph 运行；工具选择与优先级；guardClaim 兜底；`formatGoogleArtCollectResult`；`serializeToolResultForModel` 压缩回灌 |
| `src/main/materialLibrary.ts` | `MaterialLibraryResult`（materialId/materialUrl）；`syncLocalFileToMaterialLibrary`；sticker/create 响应解析 |
| `src/main/googleArt.ts` | 底层搜索/缩放/拼图/下载实现；`syncGoogleArtToMaterialLibrary` 透传 materialId/materialUrl |
| `src/main/capabilities/registry.ts` / `types.ts` / `index.ts` | `CapabilityCallContext`（含 sessionId、workflow）、能力注册 |
| `src/main/agent/agent-config.ts` | 系统提示词规则（禁止自行选档、禁止编造路径等） |
| `src/main/mcp-server/server.ts` | MCP 只从 `CapabilityRegistry` 自动生成 `googleArt_search/zoom/collect/status`，不再维护第二套 Google Art handler |

---

## 4. 已完成的修复（本次会话）

### 4.1 URL 改写根治
- renderer 不再回灌完整工具结果给模型；主进程持有可信 URL，模型只认 `resultIndex` / `zoomLevel`。
- `serializeToolResultForModel`：搜索 items 截断前 8 条，超 16KB 再压缩到前 4 条 + `truncated` 标记，防止整包 URL 回灌模型。

### 4.2 guardClaim 兜底（`langgraph-agent.ts`）
当会话存在**已验证的可信 zoom**，但本回合**没有真正执行过 collect**、而模型最终文本声称「已入库/采集成功」时：
- 用 `textClaimsGoogleArtCollectSuccess(text)` 正则检测（已入库/采集成功/下载成功 + 路径/素材库/尺寸）。
- 命中则用 `formatCollectNotExecutedMessage` 覆盖输出，分三种情况说明：
  1. 无有效 zoom → 引导先 search → zoom；
  2. 之前 collect 失败 → 说明未入库、未编造；
  3. 正常未执行 → 说明本轮未真正执行 collect。
- 缓冲逻辑：guard / ground 期间模型若仍发起工具调用（如重新 zoom/search），把过渡文本补发，避免吞掉后续真实调用。

### 4.3 工具截断修复（`selectRelevantTools`）
- `googleArt_*` 与 `materialLibrary_*` 在所有工具列表中**强制置顶**（含 fallback 分支）。
- 原因：用户回复「0」「1」等档位数字不匹配任何关键词时回退 `allTools.slice(0,48)`，googleArt 注册在末尾会被挤出。

### 4.4 materialId 补齐
- `MaterialLibraryResult` 新增 `materialId` / `materialUrl`。
- `POST {apiBase}/sticker/create` 响应为 TransformInterceptor 包装的 `{ code, data, status }`，解析 `data.id`（uuid 主键）与 `data.url`（COS 直链）。
- 主进程 `googleArt.ts` 同步函数透传。

### 4.5 其他
- collect 超时单独放宽到 10 分钟（高清拼图 + COS 上传）。
- 本地开发后端协议自适应（http/https）。
- node/web typecheck 均通过：
  - node：`npx tsc --noEmit -p tsconfig.node.json --composite false`
  - web：`npx vue-tsc --noEmit -p tsconfig.web.json --composite false`

---

## 5. 测试方法与验证结果

### 5.1 手动测试路径
1. 启动 `design-server`（本地 `http://localhost:1520/api`）与客户端。
2. 用户消息：`去 googleart 帮下载三个向日葵作品`。
3. 预期链路：search（真实关键词）→ 展示结果项 → 用户选序 → zoom 展示档位表 → 用户选档（如 `0`）→ collect → 素材库新增记录。

### 5.2 已观测结果

| 轮次 | 现象 | 结论 |
| --- | --- | --- |
| 1 | 模型直接输出假路径 `/Users/.../Sunflowers.jpg 17.5 KB`，无 collect 调用 | collect 工具被截断 → 已修（§4.3） |
| 2 | 输出被拦截为「检测到你提到的已入库/采集成功…」 | guardClaim 生效，但 collect 仍不可调用 |
| 3 | 用户确认素材库真实新增记录 | **链路打通，采集成功** |

---

## 6. 待优化问题（下一步重点）

### 6.1 对话「乱」：search 关键词固化
最新一轮测试日志显示：
- 用户请求「三个向日葵作品」，模型 reasoning 反复说「用 sunflower 搜索」「搜梵高向日葵」。
- 但实际发出的 `googleArt.search` 参数**始终是 `{"query":"impressionism"}`**，第二次起返回 `cached: true`。
- 结果是永远搜不到向日葵，模型在循环里重复 search。

**疑点排查方向**：
1. `searchCacheKey` 只按 keyword/page/hl/maxCount 判定，`cached: true` 说明同 key 命中；需确认模型到底传了什么（日志里 `{"query":"impressionism"}` 可能是别名 `query`，与 schema 中 `keyword` 并存）。
2. 工具描述里 `query` 与 `keyword` 两个字段并存，模型可能被引导传 `query` 但 handler 的 transform 取 `keyword ?? query`——需核对是否有字段丢失。
3. 历史回灌污染：旧会话搜过 impressionism，模型沿用旧 query。考虑在提示词中强调「必须使用用户本次请求的关键词」。
4. **推荐第一步**：开新会话复测，同时加日志打印实际收到的 args，确认是模型传参问题还是缓存命中问题。

### 6.2 search 返回 24 条全量 JSON 刷屏
- 每次 search 返回完整 24 条 items，即使 `cached: true` 也全量回灌，上下文膨胀。
- 虽然 `serializeToolResultForModel` 会压缩，但工具事件展示层（renderer）仍渲染全量。
- 建议：`cached: true` 时返回精简提示；search 返回默认 `maxCount` 降到合理值（如 8）。

### 6.3 用户消息重复附件
- 日志中用户消息带大量重复的 `image-1` 到 `image-12` 附件占位，疑似前端粘贴/渲染异常，需确认是否干扰模型输入。

---

## 7. 待办清单（给接手人）

1. **定位 §6.1 关键词固化**：打印模型实际传入的 search args（keyword vs query），确认 handler transform 与缓存命中逻辑；必要时统一字段名、强调用用户关键词。
2. **精简 cached 返回**（§6.2），控制上下文膨胀。
3. **复查附件渲染异常**（§6.3），确认前端粘贴图片是否重复。
4. **工作流迁移**：服务端 `google_arts_culture` 已改走 `googleArt_search → googleArt_zoom → googleArt_collect`，需补充带 `zoomLevel` 的自动化回归测试。
5. **密钥处理**：客户端默认模型密钥已移除，必须在供应商侧轮换历史暴露密钥。
6. **回归验证**：完整走一遍 §5.1 链路，确认采集成功且对话展示不混乱。

---

## 8. 注意事项 / 踩坑记录

- `selectRelevantTools` 的 48 截断是历史遗留：关键词不匹配用户消息就会回退全量截断，**任何新工具注册都要考虑是否会被挤出**；googleArt/materialLibrary 靠置顶兜底。
- collect 输出走确定性格式化，**不要**在后续迭代中放开让模型自由写「成功/路径」。
- 服务端契约是 `{ code, data, status }` 包装，解析实体 `id`/`url` 时注意两层结构。
- 本地开发后端可能是 `http://localhost:1520/api`，materialLibrary 已按 protocol 自适应。
- 涉及 langgraph-agent.ts 时，注意项目内置了「本地轻量 StateGraph + 可选官方 @langchain/langgraph」双轨，改动要在两种模式下都兼容。

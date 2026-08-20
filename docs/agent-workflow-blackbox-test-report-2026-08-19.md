# Agent 与工作流真实接口黑盒测试报告

测试日期：2026-08-19
测试方式：仅通过 localhost HTTP/SSE 接口，不调用内部 service 作为测试替代。

## 客户端 Agent

- API：`http://localhost:1519/api/agent`
- 会话：`0ff72428-c443-42cb-b3bc-1d63dc6513ef`
- 回查：`GET /sessions/:id` 返回 20 条消息，用户/助手消息交替持久化。
- 已验证：
  - `googleArt_search` 真实调用并返回 8 条梵高向日葵搜索结果；
  - `system_info`、`system_workspace_dir` 真实调用；
  - 文件写入测试真实返回成功；
  - 写入后的文件读取/删除路径暴露了旧 Electron 进程中模型无 tool_call 的问题。

## 云端 Agent

- API：`http://localhost:1520/api/ai-assistant/chat-stream`
- 认证：客户端配置中的真实登录 token。
- 会话：`conversationId=546`
- 回查：`GET /api/ai-assistant/messages?conversationId=546`、`GET /api/ai-assistant/runs`、`GET /api/ai-assistant/runs/:runId/events`。
- 已验证：
  - `system.user.query_self` 成功；
  - `workflow.status` 成功；
  - `client_runtime.execute(system_info)` 成功通过 Bridge 路由到客户端；
  - 结果包含 `connectionId`、请求 ID 和客户端真实返回值。

## 工作流

临时工作流 `7ebc6020-f17c-4b26-9076-cbd5249fa927` 已删除。

真实 Agent 操作链：

1. `workflow.add_node(js_code)` 成功，节点 `js_code_mt00p3u8`；
2. `workflow.connect(start_test -> js_code_mt00p3u8)` 成功；
3. `workflow.connect(js_code_mt00p3u8 -> end_test)` 成功；
4. `workflow.validate` 返回 `valid=true`；
5. `workflow.run` 返回 execution `acbba1ad-e832-469e-a0b6-7214be533e7d`；
6. execution 最终 `success`，节点记录全部成功；
7. JS 节点真实输出：`{ ok: true, source: "blackbox" }`。

空工作流负例也已验证：校验返回空节点、缺少 start、缺少 end 三项问题。

## 已修复问题

1. 服务端把“客户端系统信息”误判为浏览器 `query_clients`。
2. 确定性 `client_runtime.execute` 路由未设置停止条件，重复调用触发 LangGraph recursion limit。
3. 客户端云端能力已拉取，但 `system/workflow/material` 分类未进入相关工具列表，导致模型误报没有工具。
4. 客户端明确文件读取/删除请求可能被模型直接复述而没有真实工具调用；已加入确定性本地文件读/删入口。
5. Google Arts 客户端重启后历史会话存在但可信 search 状态丢失；已加入基于历史用户搜索文本重新执行真实 search，再按 resultIndex zoom 的恢复逻辑，不恢复 URL/元数据。

## 当前限制

客户端源码已通过 Node 类型检查和 electron-vite build，但当前 Electron 进程由 root 用户启动，当前测试用户无法结束该进程。因此客户端最新修复尚未在这个正在运行的 Electron 进程上完成最终回归；需要该进程自然重启或由启动它的用户重启后继续验证。

## 客户端重启后回归结果

客户端重启后新会话：`a0e5eb0e-b5ff-4a72-b74d-cdd17fd013bb`。

- 客户端云端能力筛选回归通过：真实调用 `server_system_user_query_self`，不再回复没有工具。
- 文件写入回归通过：真实调用 `filesystem_file_write`，随后真实调用 `filesystem_file_read` 校验内容。
- 文件删除回归通过：真实调用 `filesystem_file_delete`，文件系统检查确认文件已不存在。
- Google Arts 重启恢复回归通过：旧会话 `0ff72428-c443-42cb-b3bc-1d63dc6513ef` 在客户端重启后发送作品编号 `2`，先出现可信状态缺失，然后自动真实恢复 `googleArt_search`，再真实调用 `googleArt_zoom(resultIndex=2)`，返回 5 个分辨率档位。
- Google Arts collect 回归通过：用户选择档位 `0` 后真实调用 `googleArt.collect`，返回 `success=true`、`materialLibraryOk=true`。
  - materialId：`2e976f05-7c9c-49f7-a861-fca40704b958`
  - 本地文件：`/Users/jackie/yisheworkspace/google-art/sunflowers-vincent-van-gogh_1787141777279.jpg`
  - 文件：JPEG，250x329，51181 bytes
  - COS HEAD：HTTP 200，Content-Length 51181

## 工作流节点矩阵与触发器测试（追加）

### 节点清单

- 服务端节点 manifest：76 个节点类型。
- 新增接口：`GET /api/workflow/nodes/manifest`。
- 实测返回 76 个节点，全部 `executable=true`。
- Admin 节点库、节点选择器、配置面板已增加服务端 manifest 消费逻辑，节点名称、描述、输入/输出 schema 优先使用服务端数据。

### 立即执行

基础、逻辑、HTTP、JS、热搜、新闻和工具节点已通过临时工作流真实执行矩阵测试：

- 第一轮：76 个节点全部完成创建/执行流程；51 个立即成功，2 个第三方鉴权/访问失败，22 个需要客户端或第三方写入条件，1 个 AI 节点跳过（需要模型配置）。
- Google Arts、Wikimedia、Pexels、Pixabay、StockSnap、Openverse、Kaboompics、SVGRepo 等节点已真实执行并验证输出。
- Reddit 返回上游 HTTP 403；Product Hunt 返回 HTTP 401，判定为第三方授权/访问限制，不是工作流调度错误。
- Rawpixel 返回无可转存图片，属于上游结果为空。

### 素材采集节点修复

发现部分素材节点错误地把批量 `collect` 当作单素材 `collect` 调用，导致：

```text
imageUrl: Invalid input: expected string, received undefined
```

已改为工作流独立编排入口：

```text
node executor
  → platform.search(keyword, maxCount)
  → 从结果解析 imageUrl / svgUrl / downloadUrl
  → platform.collect(imageUrl, metadata)
  → 汇总 successCount/failCount/images/logs
```

已回归成功：

- Openclipart
- undraw
- Iconify
- Kaboompics
- SVGRepo

并对矢量平台优先选择 `svgUrl/downloadUrl`，修复 Iconify 误选 PNG 造成 HTTP 404。

### 立即、Webhook、Cron

真实测试工作流：`51090754-4e57-4198-a88a-8678d7aaee74`（已删除）。

- 立即触发：execution 最终 `success`。
- Webhook 触发：execution `triggerType=webhook`，请求体真实传入节点；此前丢失 webhook body 的问题已修复。
- Webhook headers 已脱敏：`authorization/cookie/x-api-key` 等不再写入明文。
- Cron：表达式 `*/1 * * * *`，等待真实轮询后产生 `triggerType=cron` 的成功 execution，并计算下一次 `nextRunTime`。

### 暂停、恢复、取消

- 取消竞态已修复：取消后的 execution 最终保持 `cancelled`，Worker 不再用旧对象覆盖状态。
- 暂停/恢复已修复：恢复使用新的 BullMQ jobId，真实回归最终 `success`。
- BullMQ 恢复 jobId 示例：`workflow-<executionId>-resume-<timestamp>`。

### 架构问题与当前处理

- 原 `node-executors.ts` 中 `loop/while_loop/switch` 曾重复注册 6 次，已清理为单一注册位置。
- 运行入口目前仍是统一 engine executor map；后续应继续抽出 `WorkflowNodeService`/节点生命周期接口作为工作流节点唯一入口，平台能力仅作为 adapter，不让 Agent 工具名直接成为工作流核心依赖。
- Google Arts 已具备独立的完整节点编排链路：`search → zoomLevel 校验 → collect → 素材库`，不再由 Agent 对话状态驱动。

## 中断后续测与架构修复补充

本轮中断后继续执行了素材节点和调度回归：

- `undraw_search`、`iconify_search`、`kaboompics_search`、`svgrepo_search` 等单素材采集节点重新验证；其中 `iconify` 修复后使用 `svgUrl` 成功入库。
- 剩余部分节点受到上游网络/第三方平台访问限制，未把 `403/401/连接关闭` 误判为工作流调度错误。
- 工作流节点失败结果现在会根据错误类型标记 `retryable`：客户端离线、连接关闭、网络超时可进入队列重试；参数错误、第三方鉴权错误不自动重试。
- 取消执行回归最终保持 `cancelled`；暂停后恢复最终 `success`。

### 本轮新增架构入口

服务端新增：

```text
GET /api/workflow/nodes/manifest
```

返回每个节点的：

- type/name/category/description
- inputSchema/outputSchema
- requiredFields
- executable
- manifest revision

实测：`total=76`，全部 `executable=true`。

Admin 的节点库、节点选择器和配置面板已经接入服务端清单，服务端 schema 优先，本地 manifest 作为兼容回退。

## 全量画布节点审计（第二阶段）

### 真实数量差异

- Admin 画布 manifest：139 个唯一节点类型。
- 服务端原 workflow manifest：76 个。
- Admin 独有：66 个，其中 `string` 是旧配置字段误识别，不是真实节点；实际历史节点缺口为 65 个。
- 已将 65 个历史节点纳入服务端统一节点 manifest，当前接口返回 141 个节点（包含服务端基础节点与兼容节点），全部有 executor。

历史节点包括：

- 额外新闻/RSS：AP、Wired、Engadget、Nature、ScienceDaily、Polygon、Variety、Deadline、Billboard、TMZ 等；
- 招聘：51job、BOSS、拉勾、LinkedIn Jobs；
- 金融/天气：Yahoo Finance、Sina Finance、Eastmoney、CoinMarketCap、中国天气、Weather.com；
- 额外热搜：Google Trends、CNN、NYTimes、Al Jazeera、Dev.to、百度、腾讯新闻/科技等。

### 统一接入实现

新增客户端兼容能力适配器：

```text
src/main/capabilities/legacy-platforms.ts
src/main/capabilities/legacy-hotsearch.ts
```

工作流历史节点统一执行：

```text
历史节点
  → clientMcpWorkflowExecutor
  → 客户端 legacy capability
  → 现有平台模块
```

没有复制每个平台的业务实现。

新增服务端兼容 manifest：

```text
src/workflow/legacy-node-manifest.data.ts
```

新增后端节点执行器统一注册逻辑，所有历史节点均不再返回“未找到执行器”。

客户端已重新 build 成功，但当前运行中的 Electron 尚未加载新增 65 个兼容能力；需要重启客户端后才能完成这些历史节点的最终真实联网回归。

### 可见验收工作流

当前画布中保留以下可直接查看和运行的验收工作流：

- `系统验收-基础HTTP与JS`：已被 Agent 修改，包含 Agent 验收节点；立即运行成功。
- `系统验收-Google Arts完整采集`：搜索、zoomLevel、collect、COS/素材库入库；立即运行成功。
- `系统验收-开放素材采集`：Openclipart 搜索、解析、采集入库；立即运行成功。
- `系统验收-触发器模板`：手动、Webhook、Cron 入口模板；Webhook 已真实触发，Cron 可启用后运行。

## 画布参数展示与全量历史节点接入（第三阶段）

### 画布展示

新增通用 `NodeParameterSummary`，已注入节点组件：

```text
关键词、数量、分辨率、分类、城市、方法、URL、Cron、格式、温度、Token、颜色、时区等
```

节点不再只显示标题；会在画布节点下显示当前真实配置值。Google Arts 会显示：

```text
关键词: Sunflowers
数量: 1
分辨率: 0
```

其他节点按自身配置显示对应字段，代码、Prompt、Headers 等长内容不会污染画布，而是在配置面板查看。

### 全量历史节点接入状态

已将 Admin 画布中的 65 个真实历史节点统一接入服务端 manifest 和 executor adapter；服务端接口当前返回 141 个节点，全部 executable=true。

客户端已完成 build，但新增 legacy capabilities 需要客户端进程重启后才会在运行时注册。重启前，旧进程 `/api/capabilities` 仍显示 183 个能力；重启后应包含新增历史平台能力。

### 待客户端重启后的最终矩阵

重启后将继续真实验证以下 65 个节点：

- 额外热搜平台 15 个；
- RSS/新闻平台 27 个；
- 招聘平台 4 个；
- 金融/天气平台 12 个；
- 体育/娱乐/数据平台 7 个。

每个节点将记录：创建、参数校验、立即执行状态、节点输出、第三方错误分类、executionId 和是否可重试。

## 2026-08-20 全量历史节点最终矩阵

客户端重启后能力数量：`300`。
服务端工作流节点清单：`141`，接口实测全部 `executable=true`。

Admin 独有历史节点：65 个，已逐个创建临时工作流、执行、查询 execution/node output 并清理临时工作流。

结果：

- 成功：58
- 失败：7
- 成功率：89.23%

### 失败明细

| 节点 | 错误 | 分类 | 处理 |
|---|---|---|---|
| `hotsearch_wikipedia` | HTTP 404 | 上游接口/日期数据 | 暂不改，非工作流代码错误 |
| `hotsearch_tencent_news` | `Header name must be a valid HTTP token ["Referer:"]` | 客户端代码错误 | 已修复 `Referer:` → `Referer` |
| `douban_book_search` | HTTP 404 | 上游页面/接口变化 | 暂不改，非工作流代码错误 |
| `stats_gov_search` | HTTP 404 | 上游页面/接口变化 | 暂不改，非工作流代码错误 |
| `eastmoney_search` | socket hang up | 上游网络/反爬 | 暂不改，按外部网络问题处理 |
| `weather_cn_search` | 返回 HTML 导致 JSON parse error | 上游返回非 JSON；客户端错误提示不清 | 已修复为结构化“上游返回非 JSON”错误 |
| `weather_com_search` | HTTP 404 | 客户端 URL 拼接错误 | 已修复位置编码不再重复追加 `:1:US` |

代码修复后客户端已通过：

```text
npm run typecheck:node
npm run build
```

新的 Tencent/Weather 修复需要客户端进程再次加载最新构建后做最终在线回归；当前已完成构建，不能把尚未重启加载的回归冒充为通过。

### 已通过的历史节点分组

- 热搜：13/15 直接成功；Wikipedia 上游 404；Tencent News 客户端 header bug 已修复。
- RSS/新闻：全部本轮成功。
- 娱乐/影视/体育：全部本轮成功。
- 招聘：全部本轮成功。
- 金融：Yahoo/Sina/CLS/CoinMarketCap 成功；Eastmoney 为 socket hang up。
- 天气：Weather CN 代码错误已修复；Weather.com URL 代码错误已修复。
- 其他数据：统计局 404 属上游页面问题；Douban Book 404 属上游页面问题。

### 可见工作流

保留在用户工作流列表：

- `系统验收-基础HTTP与JS`
- `系统验收-Google Arts完整采集`
- `系统验收-开放素材采集`
- `系统验收-触发器模板`

`系统验收-基础HTTP与JS` 已被云端 Agent 真实添加节点、连接、校验并运行；Google Arts 和 Openclipart 验收工作流也已真实运行成功。

## 2026-08-20 最终三节点回归

客户端重启后：

- 客户端能力数量：300；
- 服务端节点数量：141；
- 所有服务端节点 `executable=true`。

最终回归：

| 节点 | 最终结果 | 说明 |
|---|---|---|
| `hotsearch_tencent_news` | 成功返回，但 items=0 | Header 代码问题已修复；腾讯首页当前返回 JS 壳，服务端 HTML 无可解析列表，归类为上游数据/解析覆盖不足，不报告为完整数据成功 |
| `weather_cn_search` | 失败 | 上游返回 `text/html`，已改为结构化上游非 JSON 错误，不再抛 JSON parse 异常；归类外部返回格式问题 |
| `weather_com_search` | 成功 | 修复位置编码重复拼接后真实返回 Weather.com 标题、地点和 JSON-LD 数据 |

因此 65 个历史节点最终统计按“真实有可用数据输出”计：

- 有效成功：59 个；
- 外部限制/空数据：5 个；
- 代码问题已修复：3 个（Tencent header、Weather CN 错误处理、Weather.com URL）；
- 仍需平台侧解析增强：Tencent News 1 个；
- 仍需外部条件：Wikipedia 404、Douban Book 404、Stats Gov 404、Eastmoney socket hang up、Weather CN HTML。

可见验收工作流当前仍在用户工作流列表中：4 个，均为非运行状态，可直接打开查看和运行。

## 2026-08-20 最终重启后回归

客户端再次重启后：

```text
客户端能力：300
服务端工作流节点：141
服务端节点 executable：全部 true
```

最终三节点回归结果：

- `hotsearch_tencent_news`：工作流最终 `success`，Header 错误已消失；但上游页面当前只返回 JS 壳，`items=[]`，因此按“接口成功但业务数据为空”单独标记，不计为完整数据成功。
- `weather_com_search`：工作流最终 `success`，位置编码 URL 修复生效，返回天气标题、地点和结构化 JSON-LD。
- `weather_cn_search`：已不再出现 JSON parse 异常，返回结构化“上游返回 text/html”错误，归类外部数据源问题。

最终 65 个历史节点分类：

- 完整有效输出：59
- 外部限制/上游空数据：5
- 需要继续增强上游解析：1（Tencent News 页面 JS 壳）
- 代码错误：0（已发现的 3 个代码问题均已修复并回归）

Admin 构建也已通过：

```text
npm run build:local ✅
```

## 最终可修复问题收口

已将热搜节点“调用成功但返回空列表”改为明确失败，避免工作流出现假成功：

```text
hotsearch_* + itemCount=0
→ 节点失败
→ 错误：上游页面可能为 JS 壳或当前没有可解析条目
```

Tencent News 最终回归现在不会再返回 `success=true/items=[]` 的误导结果，而是明确失败并保留可诊断原因。

最终仍有问题的节点（均非剩余代码错误）：

1. `hotsearch_wikipedia`：上游 HTTP 404；
2. `douban_book_search`：上游 HTTP 404；
3. `stats_gov_search`：上游 HTTP 404；
4. `eastmoney_search`：上游 socket hang up；
5. `weather_cn_search`：上游返回 HTML 而非 JSON；
6. `hotsearch_tencent_news`：腾讯首页 JS 壳，当前没有可解析条目。

其中 Tencent 属于“上游数据解析覆盖不足”，已从假成功改为明确失败；其余属于第三方接口、网络或上游返回格式问题。

代码问题修复回归：

- Tencent News 非法 Header：已修复并验证不再出现 Header token 错误；
- Weather.com 位置 URL：已修复并成功返回数据；
- Weather CN 非 JSON：已修复错误分类和提示；
- 单素材采集节点 search → collect：已修复并成功验证；
- 取消/暂停恢复/重试/重复 executor/参数摘要：已修复并回归。

## 画布卡片中文化与参数展示优化

- 删除节点卡片中重复的英文 `Limit` 展示；
- 统一通过 `NodeParameterSummary` 展示中文参数标签和值；
- 历史节点回退到 `DefaultNode` 时也会显示参数摘要；
- 枚举值中文化：图标/图片、描边/圆角/锐角/双色、彩色/黑白、手动/定时/Webhook、SVG 矢量/PNG 图片等；
- 关键节点卡片不再显示 `Name`、`Type` 等内部字段；
- Admin `build:local` 最终构建通过。

## 最终不可用节点产品化标记（2026-08-20）

根据节点调研报告，以下节点已在服务端 manifest 标记 `available=false`、`executable=false`，并在 Admin 节点库/节点选择器中隐藏：

- `douban_book_search`：官方旧接口关闭，当前未接入替代数据源；
- `stats_gov_search`：当前云环境 WAF/旧栏目限制，未配置代理数据源；
- `hotsearch_tencent_news`：腾讯首页 JS 壳，当前无稳定热搜数据接口；
- `reddit_search`：需要 OAuth，当前未配置授权；
- `producthunt_search`：需要 API Token，当前未配置令牌。

`weather_cn_search`、`hotsearch_wikipedia`、`eastmoney_search` 不隐藏：它们仍有可用路径或属于间歇性外部网络问题。

画布节点卡片已移除 `Limit`、`Name`、`Type` 等内部英文展示，参数摘要统一使用中文标签；Admin `build:local` 已通过。

## 2026-08-20 不可用节点前端产品化

按照节点调研报告，服务端 manifest 已明确返回 `available=false/executable=false` 的节点：

- `douban_book_search`
- `stats_gov_search`
- `hotsearch_tencent_news`
- `reddit_search`
- `producthunt_search`

Admin 节点库和节点选择器在服务端清单加载前也有本地兜底隐藏集合，避免不可用节点闪现。服务端接口实测隐藏节点均为 `available=false, executable=false`。

画布参数卡片最终中文化：移除 `Limit`、`Name`、`Type`、`True/False`、`Icons/Photos` 等非必要英文展示，使用“数量、名称、类型、满足/不满足、图标/图片”等中文。Admin `build:local` 通过。

## 生产级组合工作流验证

新增并保留在工作流列表：

- `生产验收-多源健康数据流水线`
  - 并行 HTTP 检查服务端与客户端；
  - JS 标准化结果；
  - 条件质量门禁；
  - 生产报告生成；
  - 真实运行 `success`，质量门禁命中“服务正常”，报告节点成功。
- `生产验收-批量循环处理流水线`
  - 生成 3 个任务；
  - For 循环逐项处理；
  - 汇总每次迭代的 index/value/processed；
  - 真实运行 `success`，3 次迭代全部成功。

组合测试同时发现并修复了条件 Edge 时序问题：之前拓扑排序阶段过早用空的 nodeOutputs 计算条件，导致质量门禁走 else 并跳过报告；现在条件 Edge 在源节点执行完成后求值，组合工作流回归通过。

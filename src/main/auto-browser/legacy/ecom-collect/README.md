# 电商采集模块说明

这个目录负责浏览器自动化端的电商前台数据采集。整体目标不是把所有平台逻辑揉在一起，而是把“通用采集流程”和“平台 DOM 规则”彻底拆开，方便后续维护、调试和扩展。

## 目录结构

- `common/`
  - 通用能力，不关心具体平台。
  - 包括超时配置、文本清洗、风险识别、导航等待、DOM 抽取等。
- `platforms/`
  - 一个平台一个目录。
  - `selectors.js` 负责维护该平台的 URL 规则、选择器，以及必要时的场景交互逻辑。
  - `index.js` 负责导出平台配置、`capability` 能力说明和可选 hook。
  - `README.md` 负责说明定位思路、风险点和维护方式。
- `ecomCollectService.js`
  - 采集运行入口。
  - 串联浏览器、平台配置、`taskType` 执行器和统一返回格式。
- `platformConfigs.js`
  - 兼容层，转发到 `platforms/index.js`，避免其他代码引用路径时出问题。

## 通用采集原则

1. 优先使用稳定特征
   - 优先 `href` 模式、`data-*` 属性、语义结构。
   - 对易变 class 只做“模糊包含”匹配，不依赖完整 hash class。

2. 多候选选择器
   - 同一字段允许多个候选选择器。
   - 页面结构轻微变动时，尽量通过 fallback 继续提取。

3. 原始数据优先
   - 当前阶段以“尽量保真”的原始数据入库为主。
   - 平台差异化字段优先保留在 `collectData.records[] / collectData.summary` 中，后续再做分析层结构化。

4. 风控优先退出
   - 遇到验证码、登录页、访问受限时尽快识别并返回。
   - 不在单个平台页面上长时间死等，避免任务卡死。

5. 平台独立扩展
   - 如果某个平台后续需要特殊滚动、点击、关闭弹窗、切换地区、识别验证码，可在平台 hook 中单独实现。
   - 不把平台特例塞进通用流程里。
   - 如果只是某个场景自己的搜索或跳转动作，优先写在场景配置的 `preparePage` 里。

6. 存储边界统一处理
   - `recordKey` 超长时，优先从 URL 中抽结构化 ID；抽不到再哈希兜底。
   - `sourceUrl` 超长时，库里保存精简可回溯 URL，并把完整原始地址保留到 `originalSourceUrl`。
   - 这样既能保证入库稳定，也不会把关键原始信息直接丢掉。

## 可选平台 Hook

平台 `index.js` 可以按需导出 `hooks`：

- `beforeScene`
  - 进入场景前执行。
  - 适合做 cookie 检查、弹窗处理、页面预热。
- `afterScene`
  - 场景完成后执行。
  - 适合补充日志、截图、统计信息。
- `normalizeRecord`
  - 对单条记录做平台级修正。
  - 适合清洗特殊链接、补充平台自己的字段。

如果某个平台存在“趋势榜、联想词、RSS、公开接口”等不适合套通用 DOM 列表流的任务类型，可以在平台 `index.js` 里额外导出：

- `customTaskTypeExecutors`
  - key 为任务类型标识，value 为自定义执行函数。
  - 适合趋势热词、搜索联想词、公开 feed/API 混合采集等场景。
  - 仍然复用统一的运行时、截图目录和返回结构，不要把结果格式做成平台私有协议。

## 能力 schema 约定

平台 `index.js` 里的 `capability` 是当前电商采集模块的唯一平台定义来源，用来给：

- `/api/ecom-collect/capabilities`
  - 提供完整平台能力 schema。
  - 包含字段定义、参数示例、可用性状态、维护路径。
- admin 端动态渲染任务表单
  - 不再在 admin 或服务端手写平台字段。
- 服务端校验与调度
  - 只允许把任务分发给声明支持对应平台/任务类型的客户端。

`capability` 里建议至少维护：

- `status`
  - 当前平台整体可用性，例如 `available / heuristic / blocked / unsupported`
- `access`
  - 平台或任务类型的访问限制和风控信息，例如 `login / captcha / antiBot / notes`
- `docs`
  - 平台概述和补充说明
- `maintenance`
  - 模块目录、选择器文件、README 路径
- `scenes`
  - 每个场景自己的字段、说明、示例、可用性和验证状态

## 字段维护方式

当前字段采用“两层说明”：

1. 静态预期字段
   - 来自 capability schema 的 `docs.packageFields` 和 `docs.recordFields`
   - 用于任务创建前说明“这个 taskType 设计上会返回哪些字段”
   - 适合做跨平台字段目录、维护文档和前端展示

2. 动态实际字段
   - 来自真实运行结果 `collectData.records[]` 的自动扫描
   - 用于查看“这个平台这次实际返回了哪些字段、覆盖率如何”
   - 适合发现字段漂移、平台新增字段和未建档字段

这两层配合使用，可以在不改数据库结构的前提下持续扩平台、扩字段、扩分析能力。

如需导出当前 capability schema 中声明的字段目录，可执行：

```bash
npm run ecom:fields
```

常见用法：

```bash
npm run ecom:fields -- --platform amazon
npm run ecom:fields -- --task-type amazon.search_suggestions
npm run ecom:fields -- --json
```

## 维护约定

1. 先看平台目录下的 `README.md` 再改选择器。
2. 改完后至少跑一次真实浏览器验证。
3. 如果发现页面进入验证码或登录流，先记录风险，再决定是否做平台特例处理。
4. 新增平台时，至少补齐：
   - `selectors.js`
   - `index.js`
   - `README.md`
5. 如果页面 DOM 大改：
   - 先重新定位“卡片根节点”
   - 再修正标题、链接、价格等子字段选择器
   - 最后回归 `search / product_detail / shop_hot_products`
6. 如果导航阶段就失败：
   - 先看是否已经被识别成 `network_error / not_found / login_required / captcha`
   - 再决定是继续修入口、补交互，还是先记录为当前环境阻塞

## 推荐冒烟方式

建议优先跑公开、无登录依赖的信号源场景，持续验证当前环境是否可用：

```bash
npm run ecom:smoke
```

特性：

- 默认顺序验证 `google_trends / trend_keywords`、`amazon / search_suggestions`、`ebay / search_suggestions`
- 遇到 `login_required / captcha / risk_control` 会记为 `skipped`，继续跑后续场景
- 可以通过 `--snapshots --workspace-dir <dir>` 把截图落到指定工作目录，便于人工回看

示例：

```bash
npm run ecom:smoke -- --snapshots --workspace-dir /path/to/workspace
```

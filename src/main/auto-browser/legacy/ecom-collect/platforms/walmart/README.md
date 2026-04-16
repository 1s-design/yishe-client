# Walmart

## 支持场景

- `search`
- `product_detail`
- `shop_hot_products`

## 当前状态

- 2026-04-05 已完成独立平台目录接入与首版选择器整理。
- 当前状态定义为 `heuristic`，建议优先在真实浏览器上下文里回归。
- 运行期如果命中机器人页或风控页，会由通用风险检测流程直接返回受限结果。

## 目标页面

- 搜索页：`https://www.walmart.com/search?q={keyword}&page={page}`
- 详情页：`https://www.walmart.com/ip/{itemId}`
- 列表页：搜索结果、专题列表、店铺商品流

## 选择器策略

- 搜索/列表页优先依赖 `div[role="group"][data-item-id]`、`h3[data-automation-id="product-title"]`、`a[href*="/ip/"]`。
- 详情页优先依赖 `h1[data-automation-id="product-title"]`、`[data-testid="price-wrap"]`、`img[data-testid="hero-image"]`。
- 推广卡片若包含跳转参数，会在平台 hook 中尽量还原为规范化商品链接。

## 风险与限制

- Walmart 较容易返回机器人校验页，不同 IP、Cookie、地区下结果差异会比较大。
- 搜索卡片的价格经常拆成多段 span，后续仍需要继续补候选选择器。
- 详情页规格、配送、卖家模块可能按商品类型变化，当前先抓主信息区与正文摘要。

## 维护方式

1. 搜索页先确认 `data-item-id`、`product-title`、`productTileImage`、`/ip/` 链接是否仍可命中。
2. 详情页优先检查商品标题、价格容器和主图节点是否仍可读。
3. 如果继续出现推广跳转或参数污染，优先在平台 hook 内修正 URL 归一化逻辑。

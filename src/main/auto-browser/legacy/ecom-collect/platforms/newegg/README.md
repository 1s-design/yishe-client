# Newegg

## 支持场景

- `search`
- `product_detail`
- `shop_hot_products`

## 当前状态

- 2026-04-05 已完成独立平台模块接入。
- 搜索页和详情页都已补首版选择器与 URL 规范化逻辑。
- 当前状态定义为 `heuristic`，建议先小批量验证，再逐步放大任务规模。

## 目标页面

- 搜索页：`https://www.newegg.com/p/pl?d={keyword}&page={page}`
- 详情页：`https://www.newegg.com/p/{itemId}`
- 列表页：搜索结果、类目商品流、卖家店铺商品流

## 选择器策略

- 搜索/列表页优先依赖 `.item-cell`、`a.item-title`、`.price-current`、`a.item-img img`。
- 详情页优先依赖 `h1.product-title`、`.product-buy-box .price-current`、`.product-view-img-original`、`.product-bullets`。
- 详情页会额外读取 JSON-LD 与规格表，补充 `detailData`、`bulletPoints`、`specPairs` 等字段。

## 风险与限制

- 搜索结果可能混入赞助位、直销位和推荐卡片，后续需要继续做过滤。
- 不同卖家页不一定完全沿用搜索列表结构，遇到特殊卖家页时要追加验证。
- 详情页 Overview 内容可能很长，当前优先保留可读文本摘要而不是完整富文本。

## 维护方式

1. 搜索页优先确认 `.item-cell`、`.item-title`、`.price-current` 是否仍可命中。
2. 详情页优先检查 `h1.product-title`、`.product-bullets`、`#product-details table tr`、`.product-view-img-original`。
3. 如果后续要补更多卖家、物流、促销字段，优先在平台 hook 内扩充，不要污染公共抽取层。

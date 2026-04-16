# eBay

## 支持场景

- `search`
- `search_suggestions`
- `product_detail`
- `shop_hot_products`

## 当前状态

- 已完成独立平台模块接入。
- 2026-04-05 基于线上页面结构补了首版选择器与 URL 规范化逻辑。
- 当前状态定义为 `heuristic`，适合先小批量验证再逐步扩任务规模。

## 目标页面

- 联想词：`https://autosug.ebay.com/autosug?kwd={keyword}`
- 搜索页：`https://www.ebay.com/sch/i.html?_nkw={keyword}&_pgn={page}`
- 详情页：`https://www.ebay.com/itm/{itemId}`
- 店铺/卖家商品页：卖家商品列表、店铺商品流、类目商品流

## 选择器策略

- 搜索和列表页优先依赖 `li.s-item`、`a.s-item__link`、`/itm/` 商品链接。
- 联想词优先走公共 autosuggest 接口，开启截图时再补首页输入框下拉快照。
- 详情页优先依赖 Evo 模块中的 `data-testid` 与 `x-*` 语义类。
- URL 会尽量规范化为 `https://www.ebay.com/itm/{itemId}`，减少追踪参数污染。

## 风险与限制

- 搜索结果页可能混入广告、推荐卡片和变体卡片，后续需要继续做过滤。
- 部分详情描述是延迟加载或嵌入式结构，当前先抓主信息区和可见文本。
- 不同站点或语言环境下，卖家、运费、退货模块的细节可能变化。

## 维护方式

1. 搜索页先确认 `li.s-item`、`a.s-item__link`、`.s-item__price` 是否仍可命中。
2. 详情页优先检查 `x-item-title`、`x-price-primary`、`x-sellercard-atf`、`x-store-information`。
3. 如果后续要做更深的规格、物流、评价解析，优先在平台目录内加 hook，不要污染公共抽取流程。

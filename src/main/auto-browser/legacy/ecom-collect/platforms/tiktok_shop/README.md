# TikTok Shop

## 支持场景

- `search`
- `product_detail`
- `shop_hot_products`

## 当前状态

- 已完成模块化和初版规则整理。
- 2026-04-04 实测：`https://shop.tiktok.com/search?q={keyword}` 当前直接返回 `404 Not Found`。
- 通用层已把这类入口问题结构化识别为 `not_found`，方便后续继续寻找有效入口。

## 目标页面

- 搜索页：`https://shop.tiktok.com/search?q={keyword}`
- 详情页：`/product/`
- 热门商品页：店铺商品流

## 选择器策略

- 商品链接优先识别 `/product/`。
- `data-testid` 优先级较高，因为平台前端动态 class 变化比较频繁。
- 标题、价格、店铺名均使用多候选组合。

## 风险与验证码

- 该平台容易命中验证码、人机校验或区域限制。
- 如果后续要做更高稳定度，需要在平台层补充 cookie、地区和弹窗处理。
- 当前最先要解决的是正确入口地址，而不是 DOM 选择器本身。

## 维护方式

1. 先看页面是否已经被验证码覆盖。
2. 如果页面本身可见，再确认 `/product/` 链接是否仍稳定存在。
3. 如果 `data-testid` 消失，优先从语义区块重新定位，而不是只追 class 名。

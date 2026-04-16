# 淘宝

## 支持场景

- `search`
- `product_detail`
- `shop_hot_products`

## 当前状态

- 已完成平台目录化和可维护选择器整理。
- 淘宝前台结构更新频率高，当前更强调定位思路可维护，而不是写死单一 class。
- 2026-04-04 实测：当前环境访问 `s.taobao.com` 会在导航阶段触发 `ERR_CONNECTION_CLOSED`。
- 通用层现已把该场景结构化为 `network_error`，方便和登录、验证码区分。

## 目标页面

- 搜索页：`https://s.taobao.com/search?q={keyword}&s={offset}`
- 详情页：`item.taobao.com/item.htm`
- 热门商品页：店铺或活动商品列表

## 选择器策略

- 搜索和列表优先依赖 `item.taobao.com/item.htm` 链接。
- 标题、价格、店铺名依赖语义片段和包含式 class。
- `data-index` 作为卡片根节点兜底。

## 风险与验证码

- 常见问题：登录校验、滑块、PC/无线页面切换。
- 当前如果进入风险页，会直接标记失败并截图。
- 当前更前面的阻塞是网络层拦截，暂时还没进入到可稳定调 DOM 的阶段。

## 维护方式

1. 先确认结果页是否还是标准商品流。
2. 再确认商品链接模式是否仍是 `item.taobao.com/item.htm`。
3. 页面 class 如果变化很快，优先增加新的包含式候选，不要只保留一种定位方式。

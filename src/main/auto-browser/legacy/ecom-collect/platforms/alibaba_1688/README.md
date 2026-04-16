# 1688

## 支持场景

- `search`
- `product_detail`
- `shop_hot_products`

## 当前状态

- 当前按启发式方式接入，优先服务于“找同款 / 供应链匹配”链路。
- 1688 页面容易触发验证码或 punish 页，命中后会尽快返回受限状态。

## 目标页面

- 搜索页：`https://s.1688.com/selloffer/offer_search.htm?keywords={keyword}`
- 商品详情页：`https://detail.1688.com/offer/{offerId}.html`
- 店铺/列表页：店铺商品页、类目列表页、活动列表页

## 选择器策略

- 列表卡片优先：
  - `[data-offerid]`
  - `a[href*="detail.1688.com/offer/"]`
- 标题优先：
  - `[title]`
  - `h2`
  - `[class*="title"]`
- 价格优先：
  - `[class*="price"]`
  - `[data-role*="price"]`

详情链接会尽量规范化为 `detail.1688.com/offer/{id}.html`，方便继续进入详情页补全数据。

## 风险与验证码

- 常见风控表现是跳转到 `_____tmd_____/punish` 页面。
- 当前模块会依赖公共风险检测尽快结束任务，不会一直等待页面恢复。

## 维护方式

1. 先确认是否已经被重定向到验证码或 punish 页面。
2. 再确认详情链接是否仍包含 `detail.1688.com/offer/`。
3. 如果链接还在，再补标题、价格、店铺等候选选择器。
4. 新增选择器时优先追加候选，不直接删掉旧选择器。

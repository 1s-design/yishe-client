# Amazon

## 支持场景

- `search`
- `product_detail`
- `shop_hot_products`

## 当前状态

- 已做真实浏览器回归并完成入库验证。
- 当前优先保证美国站页面可用，其他区域站点可复用同一套定位思路。

## 目标页面

- 搜索页：`https://www.amazon.com/s?k={keyword}&page={page}`
- 商品详情页：`/dp/` 详情链接
- 热门商品页：Best Sellers、类目榜单、热门商品列表

## 选择器策略

- 卡片根节点优先：
  - `[data-component-type="s-search-result"][data-asin]`
  - `[class*="p13n-sc-uncoverable-faceout"]`
- 标题优先：
  - `h2 a span`
  - `[class*="p13n-sc-truncated"]`
- 链接优先：
  - `h2 a.a-link-normal`
  - `a[href*="/dp/"]`
- 价格优先：
  - `.a-price .a-offscreen`
  - `[class*="p13n-sc-price"]`

选择器尽量依赖 Amazon 的语义结构、`data-asin` 和 `/dp/` 链接模式，不依赖完整 class 名，降低样式改版带来的影响。

## 风险与验证码

- 可能出现验证码、人机验证、异常流量提示。
- 如果命中 `ap/signin` 或登录提示，当前会识别为 `login_required` 并尽快结束，不会一直卡住。

## 维护方式

1. 先确认页面是正常结果页，不是地区切换、登录页或验证码页。
2. 优先确认“卡片根节点”是否还在。
3. 如果卡片还在，再看标题、价格、图片等子节点是否变动。
4. Amazon 经常出现相同信息有多套 DOM，新增选择器时优先追加候选，不直接替换旧选择器。

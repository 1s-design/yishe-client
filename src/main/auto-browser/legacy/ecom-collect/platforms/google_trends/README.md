# Google Trends

## 当前场景

- `trend_keywords`
  - 来源: `https://trends.google.com/trending/rss?geo=<GEO>`
  - 目标: 获取公开趋势热词、预估热度、相关新闻线索

## 维护说明

- 当前优先走 RSS 数据源，尽量减少页面 DOM 变动和 `429` 风险带来的不稳定。
- 如果需要页面截图，会额外打开 `https://trends.google.com/trending?geo=<GEO>` 进行快照留存。
- 该平台输出更偏“趋势信号”，适合作为后续商品采集和 AI 选品分析的前置输入。

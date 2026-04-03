/**
 * 任务类型配置（任务队列）
 * 与 yishe-admin 的 src/config/task-types.ts 保持同步，便于查询和维护
 */
export const TASK_TYPE_OPTIONS = [
  // 发布商品 - 各平台
  { label: '发布商品-抖音', value: 'publish-product-douyin' },
  { label: '发布商品-小红书', value: 'publish-product-xiaohongshu' },
  { label: '发布商品-微博', value: 'publish-product-weibo' },
  { label: '发布商品-快手', value: 'publish-product-kuaishou' },
  { label: '发布商品-抖店', value: 'publish-product-doudian' },
  { label: '发布商品-快手小店', value: 'publish-product-kuaishou_shop' },
  { label: '发布商品-B站', value: 'publish-product-bilibili' },
  { label: '发布商品-知乎', value: 'publish-product-zhihu' },
  { label: '发布商品-TikTok', value: 'publish-product-tiktok' },
  { label: '发布商品-Temu', value: 'publish-product-temu' },
  { label: '发布商品-淘宝', value: 'publish-product-taobao' },
  { label: '发布商品-咸鱼', value: 'publish-product-xianyu' },
  { label: '发布商品-YouTube', value: 'publish-product-youtube' },
  // 后续与 admin 同步添加更多任务类型
] as const

export type TaskTypeValue = (typeof TASK_TYPE_OPTIONS)[number]['value']

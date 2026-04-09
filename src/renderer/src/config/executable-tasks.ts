/**
 * 可执行任务类型配置（与具体业务解耦，便于扩展）
 *
 * 任务队列中的任务类型可以是任意的（发布、同步、导出等），不一定通过 yishe-uploader 实现。
 * 本模块只定义「当前客户端能执行」的任务类型：在此注册类型 + 展示名 + 执行器即可。
 * 新增任务类型时：在 EXECUTABLE_TASK_TYPES 与 EXECUTABLE_TASK_DISPLAY_LABELS 中增加一项，
 * 并在 TASK_EXECUTORS 中实现执行逻辑，无需依赖 task-types 或单一实现方。
 */

import { executePlatformTask } from './platform-executors'
import type { PlatformTaskExecutionContext } from './platform-executors'

/** 当前支持在客户端执行的任务类型（可扩展，不限于发布类） */
export const EXECUTABLE_TASK_TYPES = [
  'publish-product-douyin',
  'publish-product-youtube',
  'publish-product-xianyu',
  'publish-product-tiktok',
  'publish-product-kuaishou',
  'publish-product-doudian',
  'publish-product-kuaishou_shop',
  'publish-product-temu',
  'publish-product-xiaohongshu',
  'publish-product-weibo',
] as const

export type ExecutableTaskType = (typeof EXECUTABLE_TASK_TYPES)[number]

/** 可执行类型在 UI 上的展示名称（与 EXECUTABLE_TASK_TYPES 一一对应，新增类型时在此补充） */
export const EXECUTABLE_TASK_DISPLAY_LABELS: Record<ExecutableTaskType, string> = {
  'publish-product-douyin': '发布商品-抖音',
  'publish-product-youtube': '发布商品-YouTube',
  'publish-product-xianyu': '发布商品-咸鱼',
  'publish-product-tiktok': '发布商品-TikTok',
  'publish-product-kuaishou': '发布商品-快手',
  'publish-product-doudian': '发布商品-抖店',
  'publish-product-kuaishou_shop': '发布商品-快手小店',
  'publish-product-temu': '发布商品-Temu',
  'publish-product-xiaohongshu': '发布商品-小红书',
  'publish-product-weibo': '发布商品-微博',
}

/** 供页面展示用的可执行任务列表（类型 + 展示名），与 task-types 解耦 */
export function getExecutableTaskDisplayList(): { value: string; label: string }[] {
  return EXECUTABLE_TASK_TYPES.map((value) => ({
    value,
    label: EXECUTABLE_TASK_DISPLAY_LABELS[value] ?? value,
  }))
}

export function isExecutableTaskType(type: string): type is ExecutableTaskType {
  return (EXECUTABLE_TASK_TYPES as readonly string[]).includes(type)
}

/** 执行器：根据任务类型返回执行函数，不支持的返回 null */
export function getTaskExecutor(
  taskType: string
): ((row: any, context?: PlatformTaskExecutionContext) => Promise<void>) | null {
  if (!isExecutableTaskType(taskType)) return null
  const executor = TASK_EXECUTORS[taskType]
  return executor ? (row, context) => executor(row, context) : null
}

type TaskExecutor = (row: any, context?: PlatformTaskExecutionContext) => Promise<void>

/** 抖音发布处理 */
async function executeDouyinPublish(row: any, context?: PlatformTaskExecutionContext) {
  await executePlatformTask('douyin', row, context)
}

/** 咸鱼发布处理 */
async function executeXianyuPublish(row: any, context?: PlatformTaskExecutionContext) {
  await executePlatformTask('xianyu', row, context)
}

/** YouTube 发布处理 */
async function executeYoutubePublish(row: any, context?: PlatformTaskExecutionContext) {
  await executePlatformTask('youtube', row, context)
}

/** TikTok 发布处理 */
async function executeTiktokPublish(row: any, context?: PlatformTaskExecutionContext) {
  await executePlatformTask('tiktok', row, context)
}

/** 快手发布处理 */
async function executeKuaishouPublish(row: any, context?: PlatformTaskExecutionContext) {
  await executePlatformTask('kuaishou', row, context)
}

/** 抖店发布处理 */
async function executeDoudianPublish(row: any, context?: PlatformTaskExecutionContext) {
  await executePlatformTask('doudian', row, context)
}

/** 快手小店发布处理 */
async function executeKuaishouShopPublish(row: any, context?: PlatformTaskExecutionContext) {
  await executePlatformTask('kuaishou_shop', row, context)
}

/** Temu 发布处理 */
async function executeTemuPublish(row: any, context?: PlatformTaskExecutionContext) {
  await executePlatformTask('temu', row, context)
}

/** 小红书发布处理 */
async function executeXiaohongshuPublish(row: any, context?: PlatformTaskExecutionContext) {
  await executePlatformTask('xiaohongshu', row, context)
}

/** 微博发布处理 */
async function executeWeiboPublish(row: any, context?: PlatformTaskExecutionContext) {
  await executePlatformTask('weibo', row, context)
}

/**
 * 各可执行任务类型的处理实现
 */
const TASK_EXECUTORS: Partial<Record<ExecutableTaskType, TaskExecutor>> = {
  'publish-product-douyin': executeDouyinPublish,
  'publish-product-youtube': executeYoutubePublish,
  'publish-product-xianyu': executeXianyuPublish,
  'publish-product-tiktok': executeTiktokPublish,
  'publish-product-kuaishou': executeKuaishouPublish,
  'publish-product-doudian': executeDoudianPublish,
  'publish-product-kuaishou_shop': executeKuaishouShopPublish,
  'publish-product-temu': executeTemuPublish,
  'publish-product-xiaohongshu': executeXiaohongshuPublish,
  'publish-product-weibo': executeWeiboPublish,
}

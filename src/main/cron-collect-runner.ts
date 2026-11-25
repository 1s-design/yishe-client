/**
 * 定时采集执行体（CronCollectRunner）
 *
 * 职责：把 CronScheduler 的任务调度绑定到 collectEngine 直连执行。
 *  - 客户端本地触发，不走服务端 dispatch（省一轮网络往返）
 *  - 结果通过 WebSocket 推回服务端存快照/素材
 *  - 执行超时兜底（防单个任务挂住调度器）
 */
import { getCronScheduler } from './capabilities/cron-collect';
import type { CronSchedule } from './cron-scheduler';

const TASK_TIMEOUT_MS = 120_000; // 单任务 2 分钟超时

/**
 * 启动定时采集调度器（在 registerAllCapabilities 之后调用）
 */
export async function initCronCollectRunner(options: {
  /** 采集执行函数：接收 sourceId/action/params/materialTarget，返回摘要 */
  execute: (schedule: CronSchedule) => Promise<string>;
  /** 初始调度列表（可选，后续由 WS 推送更新） */
  initialSchedules?: CronSchedule[];
}): Promise<void> {
  const scheduler = getCronScheduler();

  scheduler.setRunner(async (schedule) => {
    return await Promise.race([
      options.execute(schedule),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`任务超时 ${TASK_TIMEOUT_MS / 1000}s`)), TASK_TIMEOUT_MS),
      ),
    ]);
  });

  if (options.initialSchedules?.length) {
    scheduler.setSchedules(options.initialSchedules);
  }

  scheduler.start();
  console.log('[CronCollectRunner] 定时采集调度器已初始化');
}

/**
 * 从服务端 WS 收到调度配置更新时调用
 */
export function updateCronSchedules(schedules: CronSchedule[]): void {
  const scheduler = getCronScheduler();
  scheduler.setSchedules(schedules);
}

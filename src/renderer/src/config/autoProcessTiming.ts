/**
 * 自动处理/自动制作 - 统一时间配置
 * 任务队列与套图管理共用，便于维护和一致体验
 */
export const AUTO_PROCESS_TIMING = {
  /** 已有任务/制作在进行中时的轮询间隔（毫秒） */
  WAIT_WHEN_BUSY_MS: 2 * 1000,
  /** 暂无待处理任务时的轮询间隔（毫秒） */
  IDLE_POLL_INTERVAL_MS: 5 * 1000,
  /** 每个任务/套图处理完成后的间隔（毫秒） */
  TASK_INTERVAL_MS: 2 * 1000,
  /** 发生异常后的重试间隔（毫秒） */
  ERROR_RETRY_MS: 5 * 1000,
} as const

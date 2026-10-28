import { logger } from "../utils/logger.js";

const DEFAULT_CONCURRENCY = Number(process.env.TASK_MANAGER_CONCURRENCY || 1);
const DEFAULT_RETENTION_MS = Number(
  process.env.TASK_MANAGER_RETENTION_MS || 2 * 60 * 60 * 1000,
);
const DEFAULT_CLEANUP_INTERVAL_MS = Number(
  process.env.TASK_MANAGER_CLEANUP_INTERVAL_MS || 5 * 60 * 1000,
);
const DEFAULT_MAX_TASKS = Number(process.env.TASK_MANAGER_MAX_TASKS || 500);
const DEFAULT_MAX_LOGS_PER_TASK = Number(
  process.env.TASK_MANAGER_MAX_LOGS_PER_TASK || 300,
);
// 单个任务执行硬超时（防卡死：executor 卡在永不返回的 await 时会永久占用执行槽）
const DEFAULT_TASK_TIMEOUT_MS = Number(
  process.env.TASK_MANAGER_TASK_TIMEOUT_MS || 20 * 60 * 1000,
);
// 任务在队列中等待被调度的最长存活时间（超时说明执行槽已被占死，移除让上层重新领取）
const DEFAULT_QUEUED_TIMEOUT_MS = Number(
  process.env.TASK_MANAGER_QUEUED_TIMEOUT_MS || 10 * 60 * 1000,
);

function createId(prefix = "task") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneJsonSafe(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function toIsoString(value = new Date()) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isExplicitFailureResult(result) {
  return isPlainObject(result) && result.success === false;
}

function stringifyFailureReason(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (value instanceof Error) return String(value.message || value).trim();
  if (isPlainObject(value)) {
    return String(
      value.message ||
        value.errorMessage ||
        value.reason ||
        value.detail ||
        "",
    ).trim();
  }
  return String(value).trim();
}

function collectFailedPlatformReasons(result) {
  if (!Array.isArray(result?.results)) return [];

  return result.results
    .filter((item) => isPlainObject(item) && item.success === false)
    .map((item) => {
      const platform = String(item.platform || "未知平台").trim() || "未知平台";
      const reason =
        stringifyFailureReason(item.message) ||
        stringifyFailureReason(item.error) ||
        stringifyFailureReason(item.data?.message) ||
        stringifyFailureReason(item.data?.error) ||
        "未知错误";
      return {
        platform,
        reason,
        message: `${platform}: ${reason}`,
      };
    });
}

function normalizeSource(source = {}) {
  const normalized = {
    system: String(source.system || "unknown").trim() || "unknown",
    module: String(source.module || "").trim() || undefined,
    kind: String(source.kind || "").trim() || undefined,
    id: String(source.id || "").trim() || undefined,
    traceId: String(source.traceId || "").trim() || undefined,
    createdAt: source.createdAt ? toIsoString(source.createdAt) : undefined,
  };

  return normalized;
}

function buildSourceKey(source = {}) {
  const normalized = normalizeSource(source);
  return [
    normalized.system || "unknown",
    normalized.module || "",
    normalized.kind || "",
    normalized.id || "",
    normalized.traceId || "",
  ].join("::");
}

export class TaskManager {
  constructor(options = {}) {
    this.tasks = new Map();
    this.taskOrder = [];
    this.taskIdsBySourceKey = new Map();
    this.queue = [];
    this.runningCount = 0;
    // 当前真正占用执行槽的任务集合：runningCount 始终由它推导，
    // 避免「executor 卡死 + 计数器泄漏」导致并发槽永久不可用
    this.runningTaskIds = new Set();
    // 每个任务的私有执行配置（超时时间 / 超时清理回调），不随任务对象序列化外泄
    this.executionOptions = new Map();
    this.concurrency = Number(options.concurrency) || DEFAULT_CONCURRENCY;
    this.taskTimeoutMs =
      Number(options.taskTimeoutMs) || DEFAULT_TASK_TIMEOUT_MS;
    this.queuedTimeoutMs =
      Number(options.queuedTimeoutMs) || DEFAULT_QUEUED_TIMEOUT_MS;
    this.retentionMs = Number(options.retentionMs) || DEFAULT_RETENTION_MS;
    this.cleanupIntervalMs =
      Number(options.cleanupIntervalMs) || DEFAULT_CLEANUP_INTERVAL_MS;
    this.maxTasks = Number(options.maxTasks) || DEFAULT_MAX_TASKS;
    this.maxLogsPerTask =
      Number(options.maxLogsPerTask) || DEFAULT_MAX_LOGS_PER_TASK;
    this.cleanupTimer = null;
  }

  start() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      try {
        this.cleanupExpiredTasks();
      } catch (error) {
        logger.warn("任务管理器清理过期任务失败:", error?.message || error);
      }
    }, this.cleanupIntervalMs);
  }

  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  createTask(input = {}, executor, options = {}) {
    if (typeof executor !== "function") {
      throw new Error("executor 必须是函数");
    }

    const now = new Date();
    const taskId = createId("task");
    const source = normalizeSource(input.source || {});
    const sourceKey = buildSourceKey(source);
    const action = String(input.action || "execute").trim() || "execute";
    const task = {
      id: taskId,
      kind: String(input.kind || "generic").trim() || "generic",
      action,
      platform: String(input.platform || "").trim() || undefined,
      platforms: Array.isArray(input.platforms)
        ? input.platforms
            .map((item) => String(item || "").trim())
            .filter(Boolean)
        : [],
      status: "queued",
      step: "created",
      source,
      sourceKey,
      request: cloneJsonSafe(input.request || {}),
      metadata: cloneJsonSafe(input.metadata || {}),
      progress: null,
      result: null,
      error: null,
      logs: [],
      createdAt: toIsoString(now),
      updatedAt: toIsoString(now),
      startedAt: null,
      finishedAt: null,
    };

    this.tasks.set(taskId, task);
    this.taskOrder.push(taskId);
    this.executionOptions.set(taskId, {
      timeoutMs: Number(options?.timeoutMs) || this.taskTimeoutMs,
      onTimeout:
        typeof options?.onTimeout === "function" ? options.onTimeout : null,
    });
    if (source.id || source.traceId) {
      this.taskIdsBySourceKey.set(sourceKey, taskId);
    }
    this._appendLog(taskId, "info", "任务已创建", {
      kind: task.kind,
      action: task.action,
      platform: task.platform,
      source,
    });
    this._trimTaskStore();
    this.queue.push({ taskId, executor });
    this._processQueue();
    return this.getTask(taskId);
  }

  listTasks(filters = {}) {
    const status = filters.status ? String(filters.status).trim() : "";
    const kind = filters.kind ? String(filters.kind).trim() : "";
    const platform = filters.platform ? String(filters.platform).trim() : "";
    const sourceId = filters.sourceId ? String(filters.sourceId).trim() : "";

    return this.taskOrder
      .map((taskId) => this.tasks.get(taskId))
      .filter(Boolean)
      .filter((task) => !status || task.status === status)
      .filter((task) => !kind || task.kind === kind)
      .filter(
        (task) =>
          !platform ||
          task.platform === platform ||
          task.platforms.includes(platform),
      )
      .filter((task) => !sourceId || task.source?.id === sourceId)
      .map((task) => this._toTaskListItem(task));
  }

  getTaskSummary(taskId) {
    const task = this.tasks.get(taskId);
    return task ? this._toTaskSummary(task) : null;
  }

  getTask(taskId) {
    const task = this.tasks.get(taskId);
    return task ? this._toTaskDetail(task) : null;
  }

  getTaskLogs(taskId, options = {}) {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const logs = task.logs.map((item) => ({ ...item }));
    const afterId = String(options?.afterId || "").trim();
    if (!afterId) {
      return logs;
    }

    const cursorIndex = logs.findIndex(
      (item) => String(item?.id || "").trim() === afterId,
    );
    if (cursorIndex < 0) {
      return logs;
    }

    return logs.slice(cursorIndex + 1);
  }

  findTaskBySource(source = {}) {
    const sourceKey = buildSourceKey(source);
    const taskId = this.taskIdsBySourceKey.get(sourceKey);
    if (!taskId) {
      const fallbackTask = this._findLatestTaskByLooseSource(source);
      return fallbackTask ? this.getTask(fallbackTask.id) : null;
    }
    return this.getTask(taskId);
  }

  findTaskLogsBySource(source = {}, options = {}) {
    const sourceKey = buildSourceKey(source);
    const taskId = this.taskIdsBySourceKey.get(sourceKey);
    if (!taskId) {
      const fallbackTask = this._findLatestTaskByLooseSource(source);
      return fallbackTask ? this.getTaskLogs(fallbackTask.id, options) : null;
    }
    return this.getTaskLogs(taskId, options);
  }

  findTaskSummaryBySource(source = {}) {
    const sourceKey = buildSourceKey(source);
    const taskId = this.taskIdsBySourceKey.get(sourceKey);
    if (!taskId) {
      const fallbackTask = this._findLatestTaskByLooseSource(source);
      return fallbackTask ? this.getTaskSummary(fallbackTask.id) : null;
    }
    return this.getTaskSummary(taskId);
  }

  cancelTask(taskId, reason = "任务已取消") {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    const normalizedReason = String(reason || "").trim() || "任务已取消";
    const terminalStatuses = new Set(["success", "failed", "cancelled"]);
    task.cancelRequested = true;
    task.cancelReason = normalizedReason;

    if (task.status === "queued") {
      this.queue = this.queue.filter((item) => item.taskId !== taskId);
    }

    if (!terminalStatuses.has(task.status)) {
      this._setTaskState(taskId, {
        status: "cancelled",
        step: "cancelled",
        error: {
          message: normalizedReason,
          cancelled: true,
        },
        finishedAt: toIsoString(),
        progress: null,
      });
      this._appendLog(taskId, "warn", "任务已取消", {
        reason: normalizedReason,
      });
    }

    return this.getTask(taskId);
  }

  cancelTaskBySource(source = {}, reason = "任务已取消") {
    const task = this.findTaskBySource(source);
    if (!task?.id) {
      return null;
    }

    return this.cancelTask(task.id, reason);
  }

  _findLatestTaskByLooseSource(source = {}) {
    const normalized = normalizeSource(source);
    if (!normalized.id) {
      return null;
    }

    for (let i = this.taskOrder.length - 1; i >= 0; i -= 1) {
      const taskId = this.taskOrder[i];
      const task = this.tasks.get(taskId);
      if (!task?.source?.id || task.source.id !== normalized.id) {
        continue;
      }
      if (normalized.system && task.source.system !== normalized.system) {
        continue;
      }
      if (normalized.module && task.source.module !== normalized.module) {
        continue;
      }
      if (normalized.traceId && task.source.traceId !== normalized.traceId) {
        continue;
      }
      return task;
    }

    return null;
  }

  queryTasksBySourceList(sources = [], options = {}) {
    const detail = options?.detail === true;
    return (Array.isArray(sources) ? sources : []).map((source) => {
      const normalizedSource = normalizeSource(source);
      const task = detail
        ? this.findTaskBySource(normalizedSource)
        : this.findTaskSummaryBySource(normalizedSource);
      if (!task) {
        return {
          source: normalizedSource,
          exists: false,
        };
      }
      return {
        source: normalizedSource,
        exists: true,
        task,
      };
    });
  }

  _appendLog(taskId, level, message, data) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const logItem = {
      id: createId("log"),
      taskId,
      level,
      message: String(message || ""),
      data: cloneJsonSafe(this._summarizeLogData(message, data)),
      timestamp: toIsoString(),
    };
    task.logs.push(logItem);
    if (task.logs.length > this.maxLogsPerTask) {
      task.logs.splice(0, task.logs.length - this.maxLogsPerTask);
    }
    task.updatedAt = toIsoString();
  }

  _setTaskState(taskId, patch = {}) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    Object.assign(task, patch, {
      updatedAt: toIsoString(),
    });
    return task;
  }

  _buildTaskFailurePayload(result) {
    if (!isPlainObject(result)) {
      return {
        message: "任务执行失败",
      };
    }

    const failedReasons = collectFailedPlatformReasons(result);
    const failedReasonText = failedReasons
      .map((item) => item.message)
      .filter(Boolean)
      .join("；");
    const message = String(
      failedReasonText ||
        result.message ||
        result.error?.message ||
        (typeof result.failedCount === "number" && result.failedCount > 0
          ? `任务执行失败，失败平台数: ${result.failedCount}`
          : "") ||
        "任务执行失败",
    ).trim();

    return {
      message,
      action: result.action,
      platform: result.platform,
      total: Number.isFinite(Number(result.total))
        ? Number(result.total)
        : undefined,
      successCount: Number.isFinite(Number(result.successCount))
        ? Number(result.successCount)
        : undefined,
      failedCount: Number.isFinite(Number(result.failedCount))
        ? Number(result.failedCount)
        : undefined,
      failedReasons: failedReasons.length ? failedReasons : undefined,
      timestamp: result.timestamp,
    };
  }

  async _processQueue() {
    while (this.runningCount < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      this._startQueuedTask(next);
    }
  }

  _startQueuedTask(queueItem) {
    const { taskId } = queueItem;
    this.runningTaskIds.add(taskId);
    this.runningCount = this.runningTaskIds.size;
    this._runTask(queueItem).finally(() => {
      this.runningTaskIds.delete(taskId);
      this.runningCount = this.runningTaskIds.size;
      this._processQueue();
    });
  }

  /**
   * 强制释放某个任务占用的执行槽（用于兜底：executor 卡死时其 promise 永不 settle）
   */
  _releaseExecutionSlot(taskId) {
    const released = this.runningTaskIds.delete(taskId);
    this.runningCount = this.runningTaskIds.size;
    return released;
  }

  /**
   * 给 executor 套一层硬超时。
   * 背景：发布执行器内部会 await 浏览器操作，一旦浏览器被外部关闭 / CDP 连接僵死，
   * 该 await 可能永不返回，导致执行槽被永久占用、后续任务全部卡在 created。
   * 这里在超时后强制结束等待，保证 .finally() 能释放执行槽。
   */
  _withTaskTimeout(taskId, timeoutMs, onTimeout, executorRunner) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.resolve().then(() => executorRunner());
    }

    let timer = null;
    const timeoutSeconds = Math.round(timeoutMs / 1000);
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(async () => {
        this._appendLog(
          taskId,
          "warn",
          `任务执行超时（${timeoutSeconds}s 未返回），强制结束并释放执行槽`,
        );
        try {
          if (onTimeout) {
            await onTimeout();
          }
        } catch (cleanupError) {
          this._appendLog(taskId, "warn", "超时清理回调执行失败", {
            message: cleanupError?.message || String(cleanupError),
          });
        }
        const error = new Error(
          `任务执行超时（超过 ${timeoutSeconds} 秒未返回）`,
        );
        error.code = "TASK_TIMEOUT";
        reject(error);
      }, timeoutMs);
    });

    return Promise.race([
      Promise.resolve().then(() => executorRunner()),
      timeoutPromise,
    ]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
  }

  async _runTask(queueItem) {
    const { taskId, executor } = queueItem;
    const task = this.tasks.get(taskId);
    if (!task) return;

    this._setTaskState(taskId, {
      status: "running",
      step: "running",
      startedAt: toIsoString(),
    });
    this._appendLog(taskId, "info", "任务开始执行");

    const context = {
      taskId,
      setStep: (step, progress = null) => {
        this._setTaskState(taskId, {
          step: step ? String(step) : task.step,
          progress: progress ? cloneJsonSafe(progress) : task.progress,
        });
        if (step) {
          this._appendLog(
            taskId,
            "info",
            `步骤更新: ${step}`,
            progress || undefined,
          );
        }
      },
      setProgress: (progress) => {
        this._setTaskState(taskId, {
          progress: cloneJsonSafe(progress),
        });
      },
      log: (level, message, data) => {
        this._appendLog(taskId, level, message, data);
      },
      getTask: () => this.getTask(taskId),
      isCancelled: () => !!this.tasks.get(taskId)?.cancelRequested,
      throwIfCancelled: () => {
        const currentTask = this.tasks.get(taskId);
        if (currentTask?.cancelRequested) {
          throw new Error(currentTask.cancelReason || "任务已取消");
        }
      },
    };

    const execOptions = this.executionOptions.get(taskId) || {};
    const timeoutMs = Number(execOptions.timeoutMs) || this.taskTimeoutMs;
    const onTimeout =
      typeof execOptions.onTimeout === "function" ? execOptions.onTimeout : null;

    try {
      const result = await logger.runWithContext(
        {
          handler: (entry) => {
            if (!entry?.message) return;
            this._appendLog(
              taskId,
              entry.level || "info",
              entry.message,
              entry.data,
            );
          },
        },
        () =>
          this._withTaskTimeout(taskId, timeoutMs, onTimeout, () =>
            executor(context),
          ),
      );
      const latestTask = this.tasks.get(taskId);
      if (latestTask?.cancelRequested || latestTask?.status === "cancelled") {
        this._appendLog(taskId, "warn", "任务取消后收到执行完成结果，已忽略");
        return;
      }
      if (isExplicitFailureResult(result)) {
        const errorPayload = this._buildTaskFailurePayload(result);
        this._setTaskState(taskId, {
          status: "failed",
          step: "failed",
          result: cloneJsonSafe(result),
          error: errorPayload,
          finishedAt: toIsoString(),
          progress: null,
        });
        this._appendLog(taskId, "error", "任务执行失败", errorPayload);
        return;
      }
      this._setTaskState(taskId, {
        status: "success",
        step: "completed",
        result: cloneJsonSafe(result),
        finishedAt: toIsoString(),
        progress: null,
      });
      this._appendLog(taskId, "info", "任务执行完成", result);
    } catch (error) {
      const latestTask = this.tasks.get(taskId);
      if (latestTask?.cancelRequested || latestTask?.status === "cancelled") {
        this._appendLog(taskId, "warn", "任务取消后收到执行异常，已忽略", {
          message: error?.message || "任务已取消",
        });
        return;
      }
      const errorPayload = {
        message: error?.message || "任务执行失败",
        stack: error?.stack,
      };
      this._setTaskState(taskId, {
        status: "failed",
        step: "failed",
        error: errorPayload,
        finishedAt: toIsoString(),
        progress: null,
      });
      this._appendLog(taskId, "error", "任务执行失败", errorPayload);
    }
  }

  cleanupExpiredTasks() {
    const now = Date.now();
    const removableTaskIds = [];

    for (const taskId of this.taskOrder) {
      const task = this.tasks.get(taskId);
      if (!task) {
        removableTaskIds.push(taskId);
        continue;
      }

      if (task.status === "running") {
        const startedAtValue = task.startedAt
          ? new Date(task.startedAt).getTime()
          : 0;
        if (
          startedAtValue &&
          now - startedAtValue >= this.taskTimeoutMs
        ) {
          // 兜底：executor 卡死时其 promise 永不 settle，这里强行回收执行槽
          this._appendLog(
            taskId,
            "warn",
            `任务运行超时（${Math.round(this.taskTimeoutMs / 1000)}s），清理器强制终止并回收执行槽`,
          );
          this._releaseExecutionSlot(taskId);
          this.cancelTask(taskId, "任务运行超时，已被执行器强制终止");
        }
        continue;
      }

      if (task.status === "queued") {
        const createdAtValue = task.createdAt
          ? new Date(task.createdAt).getTime()
          : 0;
        if (
          createdAtValue &&
          now - createdAtValue >= this.queuedTimeoutMs
        ) {
          // 排队过久说明执行槽被占死，移除后由上层重新领取，避免任务无限堆积
          this._appendLog(
            taskId,
            "warn",
            `任务排队超时（${Math.round(this.queuedTimeoutMs / 1000)}s），已移出队列`,
          );
          this.cancelTask(taskId, "任务排队超时，已被执行器移出队列");
        }
        continue;
      }

      const finishedAt = task.finishedAt
        ? new Date(task.finishedAt).getTime()
        : 0;
      if (!finishedAt) {
        continue;
      }

      if (now - finishedAt >= this.retentionMs) {
        removableTaskIds.push(taskId);
      }
    }

    removableTaskIds.forEach((taskId) => this._removeTask(taskId));

    // 若本轮回收了执行槽，立刻尝试调度队列中等待的任务
    if (this.queue.length > 0 && this.runningCount < this.concurrency) {
      this._processQueue();
    }
  }

  _trimTaskStore() {
    if (this.taskOrder.length <= this.maxTasks) {
      return;
    }

    const removableCount = this.taskOrder.length - this.maxTasks;
    const removableTaskIds = this.taskOrder.slice(0, removableCount);
    removableTaskIds.forEach((taskId) => this._removeTask(taskId));
  }

  _removeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task?.sourceKey) {
      const boundTaskId = this.taskIdsBySourceKey.get(task.sourceKey);
      if (boundTaskId === taskId) {
        this.taskIdsBySourceKey.delete(task.sourceKey);
      }
    }
    this.tasks.delete(taskId);
    this.taskOrder = this.taskOrder.filter((id) => id !== taskId);
    this.queue = this.queue.filter((item) => item.taskId !== taskId);
    this.executionOptions.delete(taskId);
    if (this.runningTaskIds.delete(taskId)) {
      this.runningCount = this.runningTaskIds.size;
    }
  }

  _summarizePlatformResult(result) {
    if (!isPlainObject(result)) {
      return cloneJsonSafe(result);
    }

    return {
      action: result.action,
      message: result.message,
      success: result.success,
      platform: result.platform,
      error: stringifyFailureReason(result.error) || undefined,
      timestamp: result.timestamp,
    };
  }

  _summarizeTaskResult(result) {
    if (!isPlainObject(result)) {
      return cloneJsonSafe(result);
    }

    if (Array.isArray(result.results)) {
      return {
        success: result.success,
        action: result.action,
        total: result.total,
        successCount: result.successCount,
        failedCount: result.failedCount,
        timestamp: result.timestamp,
        results: result.results.map((item) =>
          this._summarizePlatformResult(item),
        ),
      };
    }

    if (
      Object.prototype.hasOwnProperty.call(result, "platform") &&
      Object.prototype.hasOwnProperty.call(result, "success")
    ) {
      return this._summarizePlatformResult(result);
    }

    return cloneJsonSafe(result);
  }

  _summarizeLogData(message, data) {
    if (data === undefined) {
      return undefined;
    }

    const normalizedMessage = String(message || "");
    if (
      normalizedMessage === "任务执行完成" ||
      normalizedMessage === "任务执行返回结果"
    ) {
      return this._summarizeTaskResult(data);
    }

    if (normalizedMessage.includes("执行结果")) {
      if (Array.isArray(data)) {
        return data.map((item) => this._summarizePlatformResult(item));
      }
      return this._summarizePlatformResult(data);
    }

    return data;
  }

  _buildLogInfo(task, options = {}) {
    const includeItems = options.includeItems === true;
    const items = Array.isArray(task?.logs) ? task.logs : [];
    const last = items.length > 0 ? items[items.length - 1] : null;

    return {
      count: items.length,
      last: last
        ? {
            id: last.id,
            level: last.level,
            message: last.message,
            timestamp: last.timestamp,
          }
        : null,
      ...(includeItems ? { items: items.map((item) => ({ ...item })) } : {}),
    };
  }

  _toTaskSummary(task) {
    const logInfo = this._buildLogInfo(task);

    return {
      id: task.id,
      kind: task.kind,
      action: task.action,
      platform: task.platform,
      platforms: [...task.platforms],
      status: task.status,
      step: task.step,
      source: cloneJsonSafe(task.source),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      progress: cloneJsonSafe(task.progress),
      result: this._summarizeTaskResult(task.result),
      error: cloneJsonSafe(task.error),
      logInfo,
      logCount: logInfo.count,
      lastLog: logInfo.last
        ? {
            level: logInfo.last.level,
            message: logInfo.last.message,
            timestamp: logInfo.last.timestamp,
          }
        : null,
    };
  }

  _toTaskListItem(task) {
    const lastLog =
      Array.isArray(task?.logs) && task.logs.length > 0
        ? task.logs[task.logs.length - 1]
        : null;

    return {
      id: task.id,
      kind: task.kind,
      action: task.action,
      platform: task.platform,
      platforms: [...task.platforms],
      status: task.status,
      step: task.step,
      sourceId: task.source?.id || null,
      sourceTraceId: task.source?.traceId || null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      logCount: Array.isArray(task?.logs) ? task.logs.length : 0,
      lastLog: lastLog
        ? {
            id: lastLog.id,
            level: lastLog.level,
            message: lastLog.message,
            timestamp: lastLog.timestamp,
          }
        : null,
      errorMessage: task?.error?.message || null,
    };
  }

  _toTaskDetail(task) {
    const summary = this._toTaskSummary(task);
    const detailedLogInfo = this._buildLogInfo(task);

    return {
      ...summary,
      request: cloneJsonSafe(task.request),
      metadata: cloneJsonSafe(task.metadata),
      logInfo: detailedLogInfo,
    };
  }
}

const taskManager = new TaskManager();

export default taskManager;

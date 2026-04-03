import {
  getTaskDetail,
  type QueueMessage,
  updateTaskStatus,
} from "../api/queue";
import {
  getExecutableTaskDisplayList,
  getTaskExecutor,
  isExecutableTaskType,
} from "../config/executable-tasks";
import type { PlatformTaskExecutionContext } from "../config/platform-executors";

export type PublishTaskRuntimeStatus =
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "pending";

export interface PublishTaskRuntimeSnapshot {
  taskId: string;
  taskType: string;
  queue: string;
  status: PublishTaskRuntimeStatus;
  message?: string;
  currentStep?: string | null;
  progress?: number | null;
  runtime?: Record<string, any> | null;
  error?: string | null;
}

type ExecutePublishTaskOptions = {
  onRuntime?: (snapshot: PublishTaskRuntimeSnapshot) => void | Promise<void>;
};

class PublishTaskRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishTaskRetryableError";
  }
}

function resolveResponseData<T>(response: any): T {
  if (
    response &&
    typeof response === "object" &&
    "data" in response &&
    response.data !== undefined
  ) {
    const innerData = response.data;
    if (
      innerData &&
      typeof innerData === "object" &&
      "data" in innerData &&
      innerData.data !== undefined
    ) {
      return innerData.data as T;
    }
    return innerData as T;
  }
  return response as T;
}

function getTaskLabel(taskType: string) {
  const matched = getExecutableTaskDisplayList().find(
    (item) => item.value === taskType,
  );
  return matched?.label || taskType;
}

function resolveQueueName(task: QueueMessage | null, fallbackQueue: string) {
  return String(task?.queue || fallbackQueue || "").trim();
}

export function buildPublishTaskCapabilitySummary() {
  return getExecutableTaskDisplayList().map((item) => ({
    taskType: item.value,
    label: item.label,
  }));
}

async function emitRuntime(
  options: ExecutePublishTaskOptions | undefined,
  snapshot: PublishTaskRuntimeSnapshot,
) {
  await options?.onRuntime?.(snapshot);
}

export async function executePublishQueueTask(
  taskId: string,
  taskType: string,
  queue?: string,
  options?: ExecutePublishTaskOptions,
) {
  const normalizedTaskId = String(taskId || "").trim();
  const normalizedTaskType = String(taskType || "").trim();
  const normalizedQueue = String(queue || normalizedTaskType || "").trim();

  if (!normalizedTaskId) {
    throw new Error("缺少 taskId");
  }
  if (!normalizedTaskType) {
    throw new Error("缺少 taskType");
  }
  if (!normalizedQueue) {
    throw new Error("缺少 queue");
  }

  await emitRuntime(options, {
    taskId: normalizedTaskId,
    taskType: normalizedTaskType,
    queue: normalizedQueue,
    status: "assigned",
    message: `任务已分配，准备执行 ${getTaskLabel(normalizedTaskType)}`,
    currentStep: "加载任务详情",
    progress: 0,
  });
  let detail: QueueMessage | null = null;
  try {
    const response = await getTaskDetail(normalizedQueue, normalizedTaskId);
    detail = resolveResponseData<QueueMessage | null>(response);
    if (!detail) {
      throw new Error("任务不存在或已被删除");
    }

    if (detail.status === "waiting") {
      throw new PublishTaskRetryableError("任务仍在准备中，请稍后再试");
    }

    if (!isExecutableTaskType(detail.type)) {
      throw new Error(`当前客户端暂不支持执行该任务类型：${detail.type}`);
    }

    if (detail.data?.meta?.titleStatus === "pending") {
      throw new PublishTaskRetryableError("标题仍在生成中，请稍后再试");
    }

    const executor = getTaskExecutor(detail.type);
    if (!executor) {
      throw new Error(`未找到任务执行器：${detail.type}`);
    }

    const executionContext: PlatformTaskExecutionContext = {
      onTaskStatusUpdate: async ({ status, error }) => {
        await emitRuntime(options, {
          taskId: detail!.id,
          taskType: detail!.type,
          queue: resolveQueueName(detail, normalizedQueue),
          status:
            status === "failed"
              ? "failed"
              : status === "completed"
                ? "completed"
                : "running",
          message:
            status === "failed"
              ? error || "任务执行失败"
              : status === "completed"
                ? `任务执行完成：${getTaskLabel(detail!.type)}`
                : `任务执行中：${getTaskLabel(detail!.type)}`,
          currentStep:
            status === "completed"
              ? "执行完成"
              : status === "failed"
                ? "执行失败"
                : "任务处理中",
          progress: status === "completed" ? 100 : undefined,
          error: error || null,
        });
      },
      onRuntimeUpdate: async ({ runtime, mappedStatus, task }) => {
        await emitRuntime(options, {
          taskId: detail!.id,
          taskType: detail!.type,
          queue: resolveQueueName(detail, normalizedQueue),
          status:
            mappedStatus === "failed"
              ? "failed"
              : mappedStatus === "completed"
                ? "completed"
                : "running",
          message:
            task?.step ||
            runtime?.message ||
            (mappedStatus === "completed"
              ? "任务执行完成"
              : mappedStatus === "failed"
                ? "任务执行失败"
                : "任务执行中"),
          currentStep:
            task?.step || runtime?.step || runtime?.status || "任务执行中",
          progress:
            typeof task?.progress === "number"
              ? task.progress
              : typeof runtime?.progress === "number"
                ? runtime.progress
                : null,
          runtime: runtime || null,
          error:
            mappedStatus === "failed"
              ? task?.error?.message || runtime?.error || null
              : null,
        });
      },
    };

    await emitRuntime(options, {
      taskId: detail.id,
      taskType: detail.type,
      queue: resolveQueueName(detail, normalizedQueue),
      status: "running",
      message: `开始执行 ${getTaskLabel(detail.type)}`,
      currentStep: "开始执行",
      progress: 0,
    });

    await executor(detail, executionContext);

    await emitRuntime(options, {
      taskId: detail.id,
      taskType: detail.type,
      queue: resolveQueueName(detail, normalizedQueue),
      status: "completed",
      message: `执行完成：${getTaskLabel(detail.type)}`,
      currentStep: "执行完成",
      progress: 100,
    });

    return detail;
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const fallbackStatus: PublishTaskRuntimeStatus =
      error instanceof PublishTaskRetryableError ? "pending" : "failed";

    try {
      if (detail) {
        await updateTaskStatus(
          detail.type,
          detail.id,
          fallbackStatus,
          errorMessage,
        );
      }
    } catch {
      // 忽略兜底状态回写异常，主流程错误优先向上抛出
    }

    await emitRuntime(options, {
      taskId: detail?.id || normalizedTaskId,
      taskType: detail?.type || normalizedTaskType,
      queue: resolveQueueName(detail, normalizedQueue),
      status: fallbackStatus,
      message: errorMessage,
      currentStep: fallbackStatus === "pending" ? "等待重新调度" : "执行失败",
      error: errorMessage,
    });
    throw error;
  }
}

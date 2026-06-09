import { reactive } from "vue";
import {
  claimNextPublishTask,
  recoverClientPublishTaskOrphans,
} from "../api/queue";
import { getUserSetting } from "../api/user";
import {
  executePublishQueueTask,
  type PublishTaskRuntimeSnapshot,
} from "./publishTaskDispatch";

type PlatformTaskClientRuntime = {
  clientId?: string | null;
  machineCode?: string | null;
  profileId?: string | null;
  profileExists?: boolean | null;
  wsConnected?: boolean;
  browserAutomationReady?: boolean;
  browserAutomationAutoDispatchEnabled?: boolean | null;
  browserAutomationManualClosed?: boolean;
  browserAutomationBusy?: boolean;
  browserAutomationLastError?: string | null;
};

type PlatformAutoDispatchConfig = {
  autoSchedulingEnabled: boolean;
  targetClientId: string;
  targetMachineCode: string;
  targetProfileId: string;
  currentProfileId: string;
  currentClientId: string;
  currentMachineCode: string;
  targetMode: "clientId" | "machineCode" | null;
  isMatch: boolean;
  enabled: boolean;
  reason: string | null;
};

export const platformTaskAutoState = reactive({
  autoSchedulingEnabled: false,
  enabled: false,
  polling: false,
  running: false,
  currentTaskId: null as string | null,
  currentTaskType: null as string | null,
  currentStep: null as string | null,
  progress: null as number | null,
  targetClientId: null as string | null,
  targetMachineCode: null as string | null,
  targetProfileId: null as string | null,
  currentProfileId: null as string | null,
  lastReason: null as string | null,
  lastError: null as string | null,
  lastSyncedAt: null as string | null,
});

const PLATFORM_TASK_POLL_INTERVAL_MS = 4000;
const PLATFORM_CONFIG_SYNC_INTERVAL_MS = 30000;
const PLATFORM_TASK_SKIP_LOG_INTERVAL_MS = 30000;
const PLATFORM_TASK_RELEASE_GRACE_MS = 2500;
const PLATFORM_TASK_RECOVERY_INTERVAL_MS = 30000;
let platformTaskPollTimer: ReturnType<typeof setInterval> | null = null;
let platformTaskPollInFlight = false;
let lastConfigSyncAt = 0;
let lastSkipLogSignature = "";
let lastSkipLogAt = 0;
let nextPollNotBefore = 0;
let lastRecoveryAt = 0;

let platformTaskRuntimeCallback:
  | ((snapshot: PublishTaskRuntimeSnapshot) => void | Promise<void>)
  | null = null;

let platformTaskClientRuntimeProvider:
  | (() => PlatformTaskClientRuntime)
  | null = null;

export function setPlatformTaskRuntimeCallback(
  cb: typeof platformTaskRuntimeCallback,
) {
  platformTaskRuntimeCallback = cb;
}

export function setPlatformTaskClientRuntimeProvider(
  cb: typeof platformTaskClientRuntimeProvider,
) {
  platformTaskClientRuntimeProvider = cb;
}

function pickFirstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function getClientRuntime(): PlatformTaskClientRuntime {
  try {
    return platformTaskClientRuntimeProvider?.() || {};
  } catch {
    return {};
  }
}

function normalizePlatformAutoDispatchConfig(
  setting: unknown,
  runtime: PlatformTaskClientRuntime,
): PlatformAutoDispatchConfig {
  const root =
    setting && typeof setting === "object"
      ? (setting as Record<string, any>)
      : {};
  const source =
    root.browserAutomation && typeof root.browserAutomation === "object"
      ? (root.browserAutomation as Record<string, any>)
      : root;
  const autoSchedulingEnabled = source.autoSchedulingEnabled === true;
  const targetClientId = pickFirstNonEmptyString(source.autoDispatchClientId);
  const targetMachineCode = pickFirstNonEmptyString(
    source.autoDispatchMachineCode,
  );
  const targetProfileId = pickFirstNonEmptyString(source.autoDispatchProfileId);
  const currentProfileId = pickFirstNonEmptyString(runtime.profileId);
  const currentClientId = pickFirstNonEmptyString(runtime.clientId);
  const currentMachineCode = pickFirstNonEmptyString(runtime.machineCode);
  const targetMode = targetMachineCode
    ? ("machineCode" as const)
    : targetClientId
      ? ("clientId" as const)
      : null;
  const targetValue =
    targetMode === "machineCode"
      ? targetMachineCode
      : targetMode === "clientId"
        ? targetClientId
        : "";
  const currentValue =
    targetMode === "machineCode"
      ? currentMachineCode
      : targetMode === "clientId"
        ? currentClientId
        : "";
  const isMatch = !!targetValue && targetValue === currentValue;
  const reason = !autoSchedulingEnabled
    ? "auto-scheduling-disabled"
    : !targetValue
      ? "target-missing"
      : !targetProfileId
        ? "target-profile-missing"
        : !isMatch
          ? "target-mismatch"
          : null;

  return {
    autoSchedulingEnabled,
    targetClientId,
    targetMachineCode,
    targetProfileId,
    currentProfileId,
    currentClientId,
    currentMachineCode,
    targetMode,
    isMatch,
    enabled: autoSchedulingEnabled && isMatch,
    reason,
  };
}

function applyPlatformAutoDispatchConfig(config: PlatformAutoDispatchConfig) {
  platformTaskAutoState.autoSchedulingEnabled = config.autoSchedulingEnabled;
  platformTaskAutoState.enabled = config.enabled;
  platformTaskAutoState.targetClientId = config.targetClientId || null;
  platformTaskAutoState.targetMachineCode = config.targetMachineCode || null;
  platformTaskAutoState.targetProfileId = config.targetProfileId || null;
  platformTaskAutoState.currentProfileId = config.currentProfileId || null;
  platformTaskAutoState.lastReason = config.reason;
  platformTaskAutoState.lastError = null;
  platformTaskAutoState.lastSyncedAt = new Date().toISOString();
}

export async function syncPlatformAutoDispatchConfig() {
  try {
    const setting = await getUserSetting("browserAutomation");
    const config = normalizePlatformAutoDispatchConfig(
      setting,
      getClientRuntime(),
    );
    applyPlatformAutoDispatchConfig(config);
    lastConfigSyncAt = Date.now();

    console.log(
      "[platform-task] 配置同步结果:",
      JSON.stringify({
        autoSchedulingEnabled: config.autoSchedulingEnabled,
        enabled: config.enabled,
        targetMode: config.targetMode,
        targetClientId: config.targetClientId,
        targetMachineCode: config.targetMachineCode,
        targetProfileId: config.targetProfileId,
        currentProfileId: config.currentProfileId,
        currentClientId: config.currentClientId,
        currentMachineCode: config.currentMachineCode,
        reason: config.reason,
      }),
    );

    if (config.enabled) {
      ensureTimerRunning();
      void pollPlatformTask();
    } else {
      stopTimer();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    platformTaskAutoState.lastReason = "config-error";
    platformTaskAutoState.lastError = message;
    platformTaskAutoState.lastSyncedAt = new Date().toISOString();
    lastConfigSyncAt = Date.now();
    console.warn("[platform-task] 配置同步失败:", error);
  }
}

function ensureTimerRunning() {
  if (!platformTaskPollTimer) {
    platformTaskPollTimer = setInterval(() => {
      void pollPlatformTask();
    }, PLATFORM_TASK_POLL_INTERVAL_MS);
  }
  platformTaskAutoState.polling = true;
}

function stopTimer() {
  if (platformTaskPollTimer) {
    clearInterval(platformTaskPollTimer);
    platformTaskPollTimer = null;
  }
  platformTaskAutoState.polling = false;
}

function resolvePollReadiness() {
  const runtime = getClientRuntime();
  const reasons: string[] = [];
  const targetProfileId = String(
    platformTaskAutoState.targetProfileId || "",
  ).trim();

  if (!platformTaskAutoState.enabled) {
    reasons.push(platformTaskAutoState.lastReason || "auto-dispatch-disabled");
  }
  if (!runtime.clientId) {
    reasons.push("client-id-missing");
  }
  if (runtime.wsConnected !== true) {
    reasons.push("websocket-not-connected");
  }
  if (runtime.browserAutomationAutoDispatchEnabled === false) {
    reasons.push("node-auto-dispatch-disabled");
  }
  if (runtime.browserAutomationManualClosed) {
    reasons.push("browser-manual-closed");
  }
  if (runtime.browserAutomationReady !== true) {
    reasons.push("browser-automation-not-ready");
  }
  if (!targetProfileId) {
    reasons.push("target-profile-missing");
  }
  if (
    targetProfileId &&
    runtime.profileId === targetProfileId &&
    runtime.profileExists === false
  ) {
    reasons.push("browser-profile-missing");
  }
  if (runtime.browserAutomationBusy === true) {
    reasons.push("browser-automation-busy");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    runtime,
  };
}

function logPollSkip(reason: string, runtime: PlatformTaskClientRuntime) {
  const signature = JSON.stringify({
    reason,
    clientId: runtime.clientId || null,
    machineCode: runtime.machineCode || null,
    targetClientId: platformTaskAutoState.targetClientId || null,
    targetMachineCode: platformTaskAutoState.targetMachineCode || null,
    targetProfileId: platformTaskAutoState.targetProfileId || null,
  });
  const now = Date.now();
  if (
    signature === lastSkipLogSignature &&
    now - lastSkipLogAt < PLATFORM_TASK_SKIP_LOG_INTERVAL_MS
  ) {
    return;
  }
  lastSkipLogSignature = signature;
  lastSkipLogAt = now;
  console.log(
    "[platform-task] 暂不领取:",
    JSON.stringify({
      reason,
      clientId: runtime.clientId || null,
      machineCode: runtime.machineCode || null,
      profileId: runtime.profileId || null,
      targetProfileId: platformTaskAutoState.targetProfileId || null,
      profileExists: runtime.profileExists ?? null,
      wsConnected: runtime.wsConnected === true,
      browserAutomationReady: runtime.browserAutomationReady === true,
      browserAutomationAutoDispatchEnabled:
        runtime.browserAutomationAutoDispatchEnabled,
      browserAutomationManualClosed:
        runtime.browserAutomationManualClosed === true,
      browserAutomationBusy: runtime.browserAutomationBusy === true,
      targetClientId: platformTaskAutoState.targetClientId || null,
      targetMachineCode: platformTaskAutoState.targetMachineCode || null,
    }),
  );
}

async function emitPlatformTaskRuntime(snapshot: PublishTaskRuntimeSnapshot) {
  platformTaskAutoState.currentStep =
    snapshot.currentStep || snapshot.message || null;
  platformTaskAutoState.progress =
    typeof snapshot.progress === "number" ? snapshot.progress : null;
  platformTaskAutoState.currentTaskType = snapshot.taskType || null;
  platformTaskAutoState.lastError = snapshot.error || null;
  await platformTaskRuntimeCallback?.(snapshot);
}

async function pollPlatformTask() {
  if (platformTaskPollInFlight) return;
  if (platformTaskAutoState.running) return;
  if (Date.now() < nextPollNotBefore) return;

  try {
    platformTaskPollInFlight = true;

    if (Date.now() - lastConfigSyncAt > PLATFORM_CONFIG_SYNC_INTERVAL_MS) {
      await syncPlatformAutoDispatchConfig();
    }

    const readiness = resolvePollReadiness();
    if (!readiness.ok) {
      const reason = readiness.reasons.join(",");
      platformTaskAutoState.lastReason = reason;
      logPollSkip(reason, readiness.runtime);
      return;
    }

    if (
      !platformTaskAutoState.running &&
      Date.now() - lastRecoveryAt > PLATFORM_TASK_RECOVERY_INTERVAL_MS
    ) {
      lastRecoveryAt = Date.now();
      try {
        const targetProfileId = String(
          platformTaskAutoState.targetProfileId || "",
        ).trim();
        const recovery = await recoverClientPublishTaskOrphans({
          clientId: readiness.runtime.clientId || undefined,
          machineCode: readiness.runtime.machineCode || undefined,
          profileId: targetProfileId || undefined,
          reason: "客户端本地空闲，释放遗留发布任务",
        });
        const releasedCount = Number(
          (recovery as any)?.data?.releasedCount ??
            (recovery as any)?.releasedCount ??
            0,
        );
        if (releasedCount > 0) {
          console.warn(
            "[platform-task] 已释放遗留执行态:",
            JSON.stringify(recovery),
          );
        }
      } catch (error) {
        console.warn("[platform-task] 遗留执行态自愈失败:", error);
      }
    }

    const targetProfileId = String(
      platformTaskAutoState.targetProfileId || "",
    ).trim();
    const res = await claimNextPublishTask({
      clientId: readiness.runtime.clientId || undefined,
      machineCode: readiness.runtime.machineCode || undefined,
      profileId: targetProfileId || undefined,
    });

    console.log("[platform-task] claim response:", JSON.stringify(res));

    if (!res?.success || !res?.claimed) {
      const reason = res?.reason || "unknown";
      platformTaskAutoState.lastReason = reason;
      console.log(
        "[platform-task] 本轮未领取任务:",
        JSON.stringify({
          reason,
          message: res?.message || null,
          data: res?.data || null,
        }),
      );
      if (res?.debug) {
        console.log("[platform-task] 诊断信息:", JSON.stringify(res.debug));
      }
      if (
        [
          "disabled",
          "no-binding",
          "client-id-mismatch",
          "machine-code-mismatch",
          "target-unavailable",
        ].includes(reason)
      ) {
        void syncPlatformAutoDispatchConfig();
      }
      return;
    }

    const task = res.data;
    if (!task) return;

    const taskId = String(task.taskId || "").trim();
    if (!taskId) return;

    platformTaskAutoState.running = true;
    platformTaskAutoState.currentTaskId = taskId;
    platformTaskAutoState.currentTaskType = task.taskType || null;
    platformTaskAutoState.currentStep = "开始执行";
    platformTaskAutoState.progress = 0;
    platformTaskAutoState.lastReason = null;
    platformTaskAutoState.lastError = null;

    console.log("[platform-task] 开始执行:", taskId);

    try {
      await executePublishQueueTask(
        taskId,
        task.taskType || "",
        task.queue || "",
        {
          onRuntime: emitPlatformTaskRuntime,
          dispatchToken: task.dispatchToken || undefined,
          profileId: task.profileId || targetProfileId || undefined,
        },
      );
    } catch (execError) {
      const message =
        execError instanceof Error ? execError.message : String(execError);
      platformTaskAutoState.lastError = message;
      console.warn("[platform-task] 执行失败:", execError);
    } finally {
      nextPollNotBefore = Date.now() + PLATFORM_TASK_RELEASE_GRACE_MS;
      platformTaskAutoState.running = false;
      platformTaskAutoState.currentTaskId = null;
      platformTaskAutoState.currentTaskType = null;
      platformTaskAutoState.currentStep = null;
      platformTaskAutoState.progress = null;
    }
  } catch (error: any) {
    const message = error?.message || String(error);
    platformTaskAutoState.lastError = message;
    platformTaskAutoState.lastReason = message.includes("timeout")
      ? "claim-timeout"
      : "poll-error";
    if (message.includes("timeout")) {
      console.warn("[platform-task] 领取请求超时，下次轮询重试");
    } else {
      console.warn("[platform-task] 轮询失败:", error);
    }
  } finally {
    platformTaskPollInFlight = false;
  }
}

export function startPlatformTaskPolling() {
  console.log("[platform-task] 启动轮询...");
  void syncPlatformAutoDispatchConfig();
}

export function stopPlatformTaskPolling() {
  stopTimer();
  platformTaskAutoState.enabled = false;
  platformTaskAutoState.lastReason = "stopped";
  if (!platformTaskAutoState.running) {
    platformTaskAutoState.currentTaskId = null;
    platformTaskAutoState.currentTaskType = null;
    platformTaskAutoState.currentStep = null;
    platformTaskAutoState.progress = null;
  }
}

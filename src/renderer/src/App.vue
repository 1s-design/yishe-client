<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { websocketClient, autoPsdBatchState } from "./services/websocketClient";
import {
  platformTaskAutoState,
  startPlatformTaskPolling,
  stopPlatformTaskPolling,
} from "./services/platformTaskPolling";
import { getExecutableTaskDisplayList } from "./config/executable-tasks";
import { getUserInfo, logout, type UserInfo } from "./api/auth";
import { getTokenFromClient } from "./api/user";
import { LOCAL_API_BASE, getServiceMode } from "./config/api";
import request from "./api/request";
import { downloadImageAndUploadMaterial } from "./services/materialUpload";
import { uploadFileResource } from "./services/fileUpload";
import { useToast } from "./composables/useToast";
import { useThemeMode } from "./composables/useThemeMode";
import LoadingOverlay from "./components/LoadingOverlay.vue";
import Login from "./views/Login.vue";
import Dashboard, {
  type DashboardStatusCard,
  type DashboardStatusCardDetail,
} from "./views/Dashboard.vue";
import Settings from "./views/Settings.vue";

type ServiceStatusTone = "success" | "warning" | "danger" | "muted";

interface ExtensionConnectionStatus {
  connected: boolean;
  totalConnections?: number;
}

const { showToast } = useToast();
const { themePreferenceLabel, themeToggleIcon, setThemePreference } =
  useThemeMode();

const appVersion = ref("");
const serverStatus = ref(false);
const isLoggedIn = ref(false);
const userInfo = ref<UserInfo | null>(null);
const loadingUserInfo = ref(false);
const checkingAuth = ref(true);
const isLoggingOut = ref(false);
const browserAutomationActionLoading = ref(false);
const videoTemplateActionLoading = ref(false);
const imageToolActionLoading = ref(false);

// 热搜采集状态
const hotsearchScheduleEnabled = ref(false);
const hotsearchFetching = ref(false);
const hotsearchScheduleInfo = ref({
  intervalMinutes: 0,
  platformCount: 0,
  lastRunAt: "",
});

// 本地实际支持的平台数量（从本地 API 获取，用于替代服务端的平台数）
const localPlatformCount = ref(0);

let hotsearchSyncErrorCount = 0;

async function pollHotsearchStatus() {
  try {
    // Step 1: 获取 deviceKey（多渠道 fallback）
    let deviceKey = "";

    // 优先从本地 Electron 服务获取（最准确）
    try {
      const localRes = await fetch("http://localhost:1519/api/hotsearch/info");
      if (localRes.ok) {
        const localData = await localRes.json();
        deviceKey = localData.deviceId || "";
        // 获取本地实际平台数量（与 allPlatforms 一致）
        if (localData.platformCount) {
          localPlatformCount.value = localData.platformCount;
        }
        if (deviceKey) {
          console.log("[HotSearch] deviceKey (from local API) =", deviceKey, "platformCount =", localData.platformCount);
        }
      } else {
        console.warn("[HotSearch] 本地热搜服务不可用, HTTP", localRes.status);
      }
    } catch (localErr: any) {
      console.warn("[HotSearch] 本地热搜服务连接失败:", localErr?.message);
    }

    // Fallback 1: 从 WebSocket identity 获取（已与 main 进程同步）
    if (!deviceKey) {
      deviceKey =
        (websocketClient.identity as any)?.deviceKey ||
        (websocketClient.profile as any)?.deviceKey ||
        "";
      if (deviceKey) {
        console.log("[HotSearch] deviceKey (from identity) =", deviceKey);
      }
    }

    // Fallback 2: 从 localStorage 读取
    if (!deviceKey) {
      try {
        const raw = localStorage.getItem("yishe-device-identity");
        if (raw) {
          const parsed = JSON.parse(raw);
          deviceKey = parsed?.deviceKey || "";
          if (deviceKey) {
            console.log(
              "[HotSearch] deviceKey (from localStorage) =",
              deviceKey,
            );
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!deviceKey) {
      console.warn("[HotSearch] 无法获取 deviceKey，跳过状态同步");
      return;
    }

    // Step 2: 获取渲染进程 token（传给代理 fallback）
    let rendererToken = "";
    try {
      rendererToken = (await getTokenFromClient()) || "";
    } catch {
      /* ignore */
    }

    // Step 3: 获取 schedules
    let schedules: any[] | null = null;
    try {
      const rawRes = await request.get<any>({
        url: "/hotsearch-data/schedules",
      });
      console.log("[HotSearch] rawRes 类型:", typeof rawRes, ", isArray:", Array.isArray(rawRes), ", keys:", rawRes ? Object.keys(rawRes).slice(0, 5) : "null");
      // API 返回 { data: [...], code: 0, status: true }，需要提取 data
      schedules = Array.isArray(rawRes)
        ? rawRes
        : Array.isArray(rawRes?.data)
          ? rawRes.data
          : null;
      console.log(
        "[HotSearch] 直连获取 schedules 成功, count =",
        Array.isArray(schedules) ? schedules.length : "non-array",
      );
    } catch (directErr: any) {
      console.warn(
        "[HotSearch] 直连远程获取 schedules 失败，尝试代理:",
        directErr?.message,
      );
      try {
        const proxyUrl = `http://localhost:1519/api/hotsearch-data/schedules?clientId=${encodeURIComponent(deviceKey)}`;
        const headers: Record<string, string> = {};
        if (rendererToken) headers["Authorization"] = `Bearer ${rendererToken}`;
        const proxyRes = await fetch(proxyUrl, { headers });
        if (proxyRes.ok) {
          const proxyData = await proxyRes.json();
          schedules = proxyData?.success
            ? proxyData.data
            : Array.isArray(proxyData)
              ? proxyData
              : null;
          console.log(
            "[HotSearch] 代理获取 schedules 成功, count =",
            Array.isArray(schedules) ? schedules.length : "non-array",
          );
        } else {
          console.warn("[HotSearch] 代理返回非 200:", proxyRes.status);
        }
      } catch (proxyErr: any) {
        console.warn("[HotSearch] 代理 fallback 也失败:", proxyErr?.message);
      }
    }

    if (!schedules) {
      hotsearchSyncErrorCount++;
      console.warn(
        `[HotSearch] 无法获取 schedules (连续 ${hotsearchSyncErrorCount} 次)`,
      );
      if (hotsearchSyncErrorCount >= 3) {
        hotsearchScheduleEnabled.value = false;
        console.warn("[HotSearch] 连续多次同步失败，已重置状态");
      }
      return;
    }

    hotsearchSyncErrorCount = 0;

    const mySchedule = Array.isArray(schedules)
      ? (() => {
          console.log(
            "[HotSearch] DB 返回",
            schedules.length,
            "条 schedules, clientId:",
            schedules.map((s: any) => s.clientId),
            "| 当前 deviceKey:",
            deviceKey,
          );
          return schedules.find((s: any) => s.clientId === deviceKey) || null;
        })()
      : null;

    console.log(
      "[HotSearch] 匹配结果:",
      mySchedule
        ? `ID=${mySchedule.id} enabled=${mySchedule.enabled} platforms=${mySchedule.platforms?.length}`
        : "未匹配 (deviceKey=" + deviceKey + ")",
    );

    if (mySchedule) {
      hotsearchScheduleEnabled.value = mySchedule.enabled ?? false;
      hotsearchScheduleInfo.value = {
        intervalMinutes: mySchedule.intervalMinutes || 0,
        platformCount: mySchedule.platforms?.length || 0,
        lastRunAt: mySchedule.lastRunAt || "",
      };
    } else {
      hotsearchScheduleEnabled.value = false;
    }
  } catch (e: any) {
    console.warn("[HotSearch] 状态同步异常:", e?.message || e);
  }
}

setInterval(pollHotsearchStatus, 15000);
pollHotsearchStatus();

// WebSocket 实时同步：管理后台修改配置后即时更新状态
websocketClient.events.on("hotsearchScheduleChanged", (schedule: any) => {
  console.log("[HotSearch] WS push received:", schedule);
  hotsearchScheduleEnabled.value = schedule.enabled ?? false;
  hotsearchScheduleInfo.value = {
    intervalMinutes: schedule.intervalMinutes || 0,
    platformCount: schedule.platforms?.length || 0,
    lastRunAt: schedule.lastRunAt || "",
  };
  hotsearchSyncErrorCount = 0;
});

const extensionConnectionStatus = ref<ExtensionConnectionStatus | null>(null);
const uploaderServiceStatus = ref<"running" | "warning" | "stopped" | "error">(
  "stopped",
);
const localServiceStatus = ref<"running" | "stopped" | "error">("stopped");
const currentServiceMode =
  ref<ReturnType<typeof getServiceMode>>(getServiceMode());

const wsState = websocketClient.state;
const clientProfile = websocketClient.profile;
const networkProfile = websocketClient.network;

let serverTimer: number | null = null;
let psServiceStatusInterval: NodeJS.Timeout | null = null;
let uploaderServiceStatusInterval: NodeJS.Timeout | null = null;
let localServiceStatusInterval: NodeJS.Timeout | null = null;
let extensionStatusTimer: NodeJS.Timeout | null = null;
let lastServerCheck = 0;

const THROTTLE_DELAY = 5000;
const ACTIVE_WS_STATUSES = ["connecting", "connected", "reconnecting"];

function getNativeApi() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as typeof window & { api?: typeof window.api }).api;
}

function toggleDevTools() {
  getNativeApi()?.toggleDevTools?.();
}

watch(
  userInfo,
  (nextUserInfo) => {
    if (typeof window === "undefined") {
      return;
    }

    (window as any).__currentUserInfo = nextUserInfo;
    try {
      if (nextUserInfo) {
        window.localStorage.setItem("userInfo", JSON.stringify(nextUserInfo));
      } else {
        window.localStorage.removeItem("userInfo");
      }
    } catch (error) {
      console.warn("同步用户信息失败:", error);
    }
  },
  { immediate: true },
);

function serviceToneByState(
  state: "running" | "warning" | "stopped" | "error" | boolean,
): ServiceStatusTone {
  if (state === true || state === "running") {
    return "success";
  }

  if (state === "error") {
    return "danger";
  }

  return "warning";
}

function browserAutomationToneByState(
  state: "running" | "warning" | "stopped" | "error",
): ServiceStatusTone {
  if (state === "running" || state === "warning") {
    return "success";
  }

  if (state === "error") {
    return "danger";
  }

  return "warning";
}

function resolvePhotoshopRuntimeMeta() {
  const runtime =
    clientProfile.services?.["ps-automation"] ||
    clientProfile.services?.photoshop ||
    null;
  const psAutomation = clientProfile.psAutomation ?? null;
  const details = runtime?.details || {};
  const connected = !!runtime?.connected;
  const available = !!runtime?.available;
  const busy = !!(
    runtime?.busy ||
    runtime?.state === "busy" ||
    runtime?.currentTaskId ||
    psAutomation?.running ||
    psAutomation?.currentPsSetId
  );
  const taskId = String(
    runtime?.currentTaskId || psAutomation?.currentPsSetId || "",
  ).trim();
  const psdSetId = String(psAutomation?.currentPsSetId || "").trim();
  const psdSetName = String(psAutomation?.currentPsSetName || "").trim();
  const currentStep = String(
    psAutomation?.currentStep ||
      runtime?.details?.currentStep ||
      runtime?.message ||
      "",
  ).trim();
  const progress =
    typeof psAutomation?.progress === "number"
      ? Math.max(0, Math.min(100, Math.round(psAutomation.progress)))
      : null;
  const profileId = String(psAutomation?.profileId || "").trim();
  const dispatchToken = String(psAutomation?.dispatchToken || "").trim();
  const heartbeatAt = String(
    psAutomation?.lastHeartbeatAt || runtime?.lastCheckedAt || "",
  ).trim();
  const photoshopRunning = !!(details?.photoshopRunning ?? (available || busy));
  const photoshopReady = !!(details?.photoshopReady ?? available);
  const photoshopStatus = String(
    details?.photoshopStatus ||
      (busy
        ? "busy"
        : photoshopReady
          ? "ready"
          : photoshopRunning
            ? "starting"
            : connected
              ? "stopped"
              : "unknown"),
  );
  const serviceError =
    runtime?.status === "error" || (!connected && runtime?.state === "error");

  const valueText = busy
    ? "制作中"
    : photoshopStatus === "ready"
      ? "PS 可用"
      : photoshopStatus === "starting"
        ? "启动中"
        : connected
          ? "PS 未启动"
          : serviceError
            ? "异常"
            : "未启动";

  const description = busy
    ? currentStep || "当前有套图任务正在处理"
    : photoshopStatus === "ready"
      ? "PS 服务已连接，可执行"
      : photoshopStatus === "starting"
        ? "等待 PS 就绪"
        : connected
          ? "PS 尚未启动"
          : serviceError
            ? runtime?.message || "PS 异常"
            : "服务未启动";

  const tone: ServiceStatusTone = busy
    ? "warning"
    : photoshopStatus === "ready"
      ? "success"
      : connected
        ? "warning"
        : serviceError
          ? "danger"
          : "warning";

  const detailsList = busy
    ? [
        psdSetName || psdSetId ? `套图：${psdSetName || psdSetId}` : "",
        currentStep ? `步骤：${currentStep}` : "",
        progress !== null ? `进度：${progress}%` : "",
        taskId && taskId !== psdSetId ? `任务：${taskId}` : "",
        profileId ? `实例：${profileId}` : "",
        dispatchToken ? `令牌：${dispatchToken}` : "",
        heartbeatAt
          ? `心跳：${heartbeatAt.replace("T", " ").slice(0, 19)}`
          : "",
      ].filter(Boolean)
    : [];

  return {
    connected,
    available,
    busy,
    valueText,
    description,
    tone,
    hoverLines: detailsList,
  };
}

const photoshopRuntimeMeta = computed(() => resolvePhotoshopRuntimeMeta());
const psAutoProductionEnabled = computed(
  () => autoPsdBatchState.autoDispatchEnabled === true,
);
const psAutoProductionDetail = computed<DashboardStatusCardDetail>(() => ({
  text: psAutoProductionEnabled.value ? "自动制作：已开启" : "自动制作：已关闭",
  tone: psAutoProductionEnabled.value ? "success" : "muted",
}));

function resolvePlatformTaskLabel(taskType: string) {
  const normalizedTaskType = String(taskType || "").trim();
  if (!normalizedTaskType) {
    return "";
  }
  const matched = getExecutableTaskDisplayList().find(
    (item) => item.value === normalizedTaskType,
  );
  return matched?.label || normalizedTaskType;
}

function normalizePlatformTaskStep(step: string, taskType: string) {
  const rawStep = String(step || "").trim();
  const normalizedStep = rawStep.toLowerCase();
  const taskLabel = resolvePlatformTaskLabel(taskType);

  if (
    !rawStep ||
    normalizedStep === "dispatch" ||
    normalizedStep === "running" ||
    normalizedStep === "processing" ||
    normalizedStep === "in-progress"
  ) {
    return taskLabel ? `正在执行${taskLabel}` : "正在执行发布任务";
  }
  if (normalizedStep === "assigned" || normalizedStep === "pending") {
    return "准备执行发布任务";
  }
  return rawStep;
}

function resolvePlatformTaskMeta() {
  const enabled = platformTaskAutoState.enabled === true;
  const running = platformTaskAutoState.running === true;
  const step = platformTaskAutoState.currentStep || "";
  const taskId = platformTaskAutoState.currentTaskId || "";
  const taskType = platformTaskAutoState.currentTaskType || "";
  const progress = platformTaskAutoState.progress;
  const taskLabel = resolvePlatformTaskLabel(taskType);
  const readableStep = normalizePlatformTaskStep(step, taskType);

  const valueText = running ? "执行中" : enabled ? "自动领取就绪" : "未开启";

  const description = running
    ? readableStep
    : enabled
      ? "自动领取待处理任务"
      : "等待管理端开启自动执行";

  const tone: ServiceStatusTone = running
    ? "warning"
    : enabled
      ? "success"
      : "muted";

  const details: DashboardStatusCardDetail[] = [
    {
      text: enabled ? "自动执行：已开启" : "自动执行：已关闭",
      tone: enabled ? "success" : "muted",
    },
  ];
  if (running && progress !== null) {
    details.push({
      text: `进度：${progress}%`,
      tone: "warning",
    });
  }
  if (running && taskLabel) {
    details.push({
      text: `任务：${taskLabel}`,
      tone: "muted",
    });
  }
  const hoverLines = running
    ? [
        taskLabel ? `任务：${taskLabel}` : "",
        readableStep ? `步骤：${readableStep}` : "",
        progress !== null ? `进度：${progress}%` : "",
        taskId ? `任务ID：${taskId}` : "",
      ].filter(Boolean)
    : enabled
      ? ["客户端定期轮询领取待发布任务", "执行完成后自动领取下一个"]
      : [];

  return {
    valueText,
    description,
    tone,
    details,
    hoverTitle: running
      ? "平台任务执行详情"
      : enabled
        ? "客户端自动领取模式"
        : undefined,
    hoverLines,
    running,
    enabled,
  };
}

const platformTaskMeta = computed(() => resolvePlatformTaskMeta());

function resolveVideoTemplateRuntimeMeta() {
  const runtime =
    clientProfile.services?.["video-template"] ||
    clientProfile.services?.remotion ||
    clientProfile.services?.["remotion-video"] ||
    null;
  const details = runtime?.details || {};
  const available = !!runtime?.available;
  const hasChecked = !!runtime?.lastCheckedAt;
  const activeJobsCount = Number(
    details?.activeJobsCount ?? details?.queueCount ?? 0,
  );
  const queuedJobsCount = Number(details?.queuedJobsCount ?? 0);
  const isBusy = !!(
    runtime?.busy ||
    runtime?.state === "busy" ||
    activeJobsCount > 0
  );
  const serviceError =
    runtime?.status === "error" || runtime?.state === "error";
  const valueText = available ? "可用" : hasChecked ? "不可用" : "检测中";
  const tone: ServiceStatusTone = available
    ? "success"
    : serviceError
      ? "danger"
      : "muted";
  const description = !hasChecked
    ? ""
    : !available
      ? String(runtime?.lastError || runtime?.message || "服务不可用")
      : isBusy
        ? queuedJobsCount > 0
          ? `${activeJobsCount} 个任务，排队 ${queuedJobsCount}`
          : "有视频任务制作中"
        : "本地渲染服务在线";

  return {
    connected: !!runtime?.connected,
    available,
    busy: isBusy,
    hasChecked,
    valueText,
    description,
    tone,
  };
}

const videoTemplateRuntimeMeta = computed(() =>
  resolveVideoTemplateRuntimeMeta(),
);

function resolveImageProcessingRuntimeMeta() {
  const runtime =
    clientProfile.services?.["image-processing"] ||
    clientProfile.services?.images ||
    clientProfile.services?.["yishe-images"] ||
    null;
  const details = runtime?.details || {};
  const available = !!runtime?.available;
  const hasChecked = !!runtime?.lastCheckedAt;
  const activeJobsCount = Number(details?.activeJobsCount ?? 0);
  const isBusy = !!(
    runtime?.busy ||
    runtime?.state === "busy" ||
    activeJobsCount > 0
  );
  const valueText = available ? "可用" : hasChecked ? "不可用" : "检测中";
  const tone: ServiceStatusTone = available ? "success" : "muted";
  const description = !hasChecked
    ? ""
    : !available
      ? String(runtime?.message || runtime?.lastError || "当前不可用")
      : isBusy
        ? `${activeJobsCount} 个图片任务处理中`
        : "图片处理已就绪";

  return {
    connected: !!runtime?.connected,
    available,
    busy: isBusy,
    hasChecked,
    valueText,
    description,
    tone,
  };
}

const imageProcessingRuntimeMeta = computed(() =>
  resolveImageProcessingRuntimeMeta(),
);

function websocketTone(status: string): ServiceStatusTone {
  if (status === "connected") return "success";
  if (status === "connecting" || status === "reconnecting") return "warning";
  if (status === "error") return "danger";
  return "muted";
}

function websocketText(status: string) {
  switch (status) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "reconnecting":
      return "重连中";
    case "error":
      return "连接异常";
    default:
      return "未连接";
  }
}

function throttle(lastCheck: number, delay: number) {
  return Date.now() - lastCheck >= delay;
}

function ensureWebsocketConnected() {
  if (ACTIVE_WS_STATUSES.includes(wsState.status)) return;
  websocketClient.connect();
}

function disconnectWebsocketIfNeeded() {
  if (["idle", "disconnected"].includes(wsState.status)) return;
  websocketClient.disconnect();
}

function handleWindowForegroundRecovery() {
  if (!isLoggedIn.value) return;
  if (document.visibilityState !== "visible") return;

  if (!ACTIVE_WS_STATUSES.includes(wsState.status)) {
    websocketClient.reconnect();
  }

  void checkServerStatus();
  void checkPsServiceStatus();
  void checkUploaderServiceStatus();
  void checkLocalServiceStatus();
  void websocketClient.syncServiceRuntime("video-template");
}

async function checkServerStatus() {
  if (!throttle(lastServerCheck, THROTTLE_DELAY)) return;
  lastServerCheck = Date.now();

  try {
    const response = await fetch(`${LOCAL_API_BASE}/health`);
    serverStatus.value = response.ok;
  } catch {
    serverStatus.value = false;
  }
}

function startServerPolling() {
  void checkServerStatus();
  if (serverTimer) window.clearInterval(serverTimer);
  serverTimer = window.setInterval(checkServerStatus, 4000);
}

async function checkPsServiceStatus() {
  try {
    await websocketClient.syncServiceRuntime("photoshop");
  } catch {
    // handled internally
  }
}

async function checkUploaderServiceStatus() {
  try {
    const runtime = await websocketClient.syncServiceRuntime("uploader");
    if (!runtime?.connected) {
      uploaderServiceStatus.value = "stopped";
      return;
    }

    if (runtime.available) {
      uploaderServiceStatus.value = "running";
      return;
    }

    uploaderServiceStatus.value =
      runtime.status === "error" || runtime.state === "error"
        ? "error"
        : "warning";
  } catch (error: any) {
    uploaderServiceStatus.value =
      error?.code === "ECONNREFUSED" || error?.message?.includes("fetch")
        ? "stopped"
        : "error";
  }
}

async function checkLocalServiceStatus() {
  const lastCheckedAt = new Date().toISOString();
  const nativeApi = getNativeApi();

  if (!nativeApi?.checkLocalServiceStatus) {
    localServiceStatus.value = "stopped";
    websocketClient.updateServiceStatus(
      "localService",
      {
        label: "本地服务",
        connected: false,
        available: false,
        status: "disconnected",
        state: "offline",
        busy: false,
        message: "当前为浏览器环境",
        lastCheckedAt,
        lastError: null,
        supportedCommands: ["refreshRuntime", "health"],
      },
      { emitClientInfo: false },
    );
    return;
  }

  try {
    let status = await nativeApi.checkLocalServiceStatus();
    if (!status?.running) {
      const token = await getTokenFromClient();
      if (token && typeof nativeApi.startLocalService === "function") {
        await nativeApi.startLocalService().catch(() => null);
        status = await nativeApi.checkLocalServiceStatus();
      }
    }
    const available = !!(status?.running && status?.available !== false);
    localServiceStatus.value = available ? "running" : "stopped";
    websocketClient.updateServiceStatus(
      "localService",
      {
        label: "本地服务",
        connected: available,
        available,
        status: available ? "connected" : "disconnected",
        state: available ? "idle" : "offline",
        busy: false,
        message: available ? "1519 本地服务可用" : "1519 未响应",
        lastCheckedAt,
        lastError: available ? null : "1519 未响应",
        supportedCommands: ["refreshRuntime", "health"],
      },
      { emitClientInfo: false },
    );
  } catch (error: any) {
    localServiceStatus.value = "error";
    websocketClient.updateServiceStatus(
      "localService",
      {
        label: "本地服务",
        connected: false,
        available: false,
        status: "error",
        state: "error",
        busy: false,
        message: error?.message || "1519 本地服务异常",
        lastCheckedAt,
        lastError: error?.message || "1519 本地服务异常",
        supportedCommands: ["refreshRuntime", "health"],
      },
      { emitClientInfo: false },
    );
  }
}

async function checkAuthAndGetUserInfo() {
  checkingAuth.value = true;

  try {
    const token = await getTokenFromClient();
    if (!token) {
      isLoggedIn.value = false;
      userInfo.value = null;
      loadingUserInfo.value = false;
      checkingAuth.value = false;
      return;
    }

    loadingUserInfo.value = true;
    const info = await getUserInfo();
    userInfo.value = info;
    isLoggedIn.value = true;
  } catch (error: any) {
    const status = error?.response?.status;
    const msg = String(
      error?.response?.data?.message || error?.response?.data?.error || "",
    );
    const isAuthExpired =
      status === 401 &&
      /token|未授权|未登录|登录|会话|过期|失效|unauthorized/i.test(msg);

    if (isAuthExpired) {
      isLoggedIn.value = false;
      userInfo.value = null;
      try {
        await fetch(`${LOCAL_API_BASE}/logoutToken`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      } catch {
        // ignore
      }
    } else {
      console.error("获取用户信息失败:", error);
      // 服务端数据库/Redis 抖动会导致 500、超时或连接断开；这不是退出登录。
      // 保留登录态和本地 token，等服务恢复后由前台恢复逻辑重新拉取用户信息。
      if (!userInfo.value) {
        userInfo.value = JSON.parse(
          window.localStorage.getItem("userInfo") || "null",
        );
      }
      isLoggedIn.value = true;
    }
  } finally {
    loadingUserInfo.value = false;
    checkingAuth.value = false;
  }
}

async function handleLoginSuccess() {
  try {
    loadingUserInfo.value = true;
    const info = await getUserInfo();
    userInfo.value = info;
    isLoggedIn.value = true;
    showToast({
      color: "success",
      icon: "mdi-check-circle",
      message: `欢迎回来，${info.username || info.account}!`,
    });
  } catch (error: any) {
    console.error("获取用户信息失败:", error);
    isLoggedIn.value = false;
    userInfo.value = null;
    showToast({
      color: "error",
      icon: "mdi-alert-circle",
      message:
        error?.response?.data?.message || error?.message || "获取用户信息失败",
    });
  } finally {
    loadingUserInfo.value = false;
  }
}

async function handleLogout() {
  if (isLoggingOut.value) return;

  isLoggingOut.value = true;
  try {
    const logoutPromise = logout();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("退出登录超时")), 5000);
    });

    await Promise.race([logoutPromise, timeoutPromise]);
  } catch (error) {
    console.error("退出登录失败:", error);
  } finally {
    isLoggedIn.value = false;
    userInfo.value = null;
    disconnectWebsocketIfNeeded();
    isLoggingOut.value = false;
    showToast({
      color: "success",
      icon: "mdi-logout",
      message: "已退出登录",
    });
  }
}

async function reconnectWebsocket() {
  websocketClient.reconnect();
  showToast({
    color: "primary",
    icon: "mdi-rotate-right",
    message: "正在重新连接远程服务...",
  });
}

async function connectBrowserAutomationFromDashboard() {
  browserAutomationActionLoading.value = true;
  try {
    const handler = (websocketClient as any).executeLocalServiceCommand;
    if (typeof handler === "function") {
      await handler({ pluginKey: "browser-automation", action: "connect" });
    } else {
      await window.api?.invokeAutoBrowser?.({
        method: "POST",
        path: "/api/browser/connect",
        body: {},
      });
      await websocketClient.syncServiceRuntime("uploader");
    }
    await checkUploaderServiceStatus();
    showToast({
      color: "success",
      icon: "mdi-robot-outline",
      message: "浏览器窗口已打开",
    });
  } catch (error: any) {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "打开浏览器窗口失败",
    });
  } finally {
    browserAutomationActionLoading.value = false;
  }
}

async function closeBrowserAutomationFromDashboard() {
  browserAutomationActionLoading.value = true;
  try {
    const handler = (websocketClient as any).executeLocalServiceCommand;
    if (typeof handler === "function") {
      await handler({ pluginKey: "browser-automation", action: "close" });
    } else {
      await window.api?.invokeAutoBrowser?.({
        method: "POST",
        path: "/api/browser/close",
        body: {},
      });
      await websocketClient.syncServiceRuntime("uploader");
    }
    await checkUploaderServiceStatus();
    showToast({
      color: "success",
      icon: "mdi-close-circle-outline",
      message: "浏览器窗口已关闭",
    });
  } catch (error: any) {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "关闭浏览器窗口失败",
    });
  } finally {
    browserAutomationActionLoading.value = false;
  }
}

async function refreshBrowserAutomationFromDashboard() {
  browserAutomationActionLoading.value = true;
  try {
    await checkUploaderServiceStatus();
    showToast({
      color: "success",
      icon: "mdi-refresh",
      message: "浏览器自动化状态已刷新",
    });
  } catch (error: any) {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "刷新浏览器自动化状态失败",
    });
  } finally {
    browserAutomationActionLoading.value = false;
  }
}

async function startVideoTemplateFromDashboard() {
  const nativeApi = window?.api;
  if (typeof nativeApi?.startVideoTemplateService !== "function") {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "当前客户端不支持启动 Video Template",
    });
    return;
  }

  videoTemplateActionLoading.value = true;
  try {
    await nativeApi.startVideoTemplateService();
    await websocketClient.syncServiceRuntime("video-template");
    showToast({
      color: "success",
      icon: "mdi-filmstrip-box-multiple",
      message: "Video Template 已启动",
    });
  } catch (error: any) {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "启动 Video Template 失败",
    });
  } finally {
    videoTemplateActionLoading.value = false;
  }
}

async function stopVideoTemplateFromDashboard() {
  const nativeApi = window?.api;
  if (typeof nativeApi?.stopVideoTemplateService !== "function") {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "当前客户端不支持关闭 Video Template",
    });
    return;
  }

  videoTemplateActionLoading.value = true;
  try {
    await nativeApi.stopVideoTemplateService();
    websocketClient.updateServiceStatus("video-template", {
      label: "Video Template 视频引擎",
      connected: false,
      available: false,
      status: "disconnected",
      state: "offline",
      busy: false,
      message: "Video Template 已关闭",
      lastError: null,
      details: { warmed: false },
    });
    await websocketClient.syncServiceRuntime("video-template");
    showToast({
      color: "success",
      icon: "mdi-stop-circle-outline",
      message: "Video Template 已关闭",
    });
  } catch (error: any) {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "关闭 Video Template 失败",
    });
  } finally {
    videoTemplateActionLoading.value = false;
  }
}

async function refreshVideoTemplateFromDashboard() {
  videoTemplateActionLoading.value = true;
  try {
    await websocketClient.syncServiceRuntime("video-template");
    showToast({
      color: "success",
      icon: "mdi-refresh",
      message: "Video Template 状态已刷新",
    });
  } catch (error: any) {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "刷新 Video Template 状态失败",
    });
  } finally {
    videoTemplateActionLoading.value = false;
  }
}

async function startImageToolFromDashboard() {
  const nativeApi = window?.api;
  if (typeof nativeApi?.startImageToolService !== "function") {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "当前客户端不支持启动 Image Tool",
    });
    return;
  }

  imageToolActionLoading.value = true;
  try {
    await nativeApi.startImageToolService();
    await websocketClient.syncServiceRuntime("image-processing");
    showToast({
      color: "success",
      icon: "mdi-image-multiple-outline",
      message: "Image Tool 已启动",
    });
  } catch (error: any) {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "启动 Image Tool 失败",
    });
  } finally {
    imageToolActionLoading.value = false;
  }
}

async function stopImageToolFromDashboard() {
  const nativeApi = window?.api;
  if (typeof nativeApi?.stopImageToolService !== "function") {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "当前客户端不支持关闭 Image Tool",
    });
    return;
  }

  imageToolActionLoading.value = true;
  try {
    await nativeApi.stopImageToolService();
    websocketClient.updateServiceStatus("image-processing", {
      label: "Image Tool 图片处理",
      connected: false,
      available: false,
      status: "disconnected",
      state: "offline",
      busy: false,
      message: "Image Tool 已关闭",
      lastError: null,
      details: { loaded: false },
    });
    await websocketClient.syncServiceRuntime("image-processing");
    showToast({
      color: "success",
      icon: "mdi-stop-circle-outline",
      message: "Image Tool 已关闭",
    });
  } catch (error: any) {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "关闭 Image Tool 失败",
    });
  } finally {
    imageToolActionLoading.value = false;
  }
}

async function refreshImageToolFromDashboard() {
  imageToolActionLoading.value = true;
  try {
    await websocketClient.syncServiceRuntime("image-processing");
    showToast({
      color: "success",
      icon: "mdi-refresh",
      message: "Image Tool 状态已刷新",
    });
  } catch (error: any) {
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "刷新 Image Tool 状态失败",
    });
  } finally {
    imageToolActionLoading.value = false;
  }
}

function handleDashboardCardAction(key: string) {
  if (key === "video-template-toggle") {
    if (
      videoTemplateRuntimeMeta.value.connected ||
      videoTemplateRuntimeMeta.value.busy
    ) {
      void stopVideoTemplateFromDashboard();
    } else {
      void startVideoTemplateFromDashboard();
    }
    return;
  }
  if (key === "video-template-refresh") {
    void refreshVideoTemplateFromDashboard();
    return;
  }
  if (key === "browser-automation-toggle") {
    if (uploaderServiceStatus.value === "running") {
      void closeBrowserAutomationFromDashboard();
    } else {
      void connectBrowserAutomationFromDashboard();
    }
    return;
  }
  if (key === "browser-automation-refresh") {
    void refreshBrowserAutomationFromDashboard();
    return;
  }
  if (key === "image-tool-toggle") {
    if (
      imageProcessingRuntimeMeta.value.connected ||
      imageProcessingRuntimeMeta.value.busy
    ) {
      void stopImageToolFromDashboard();
    } else {
      void startImageToolFromDashboard();
    }
    return;
  }
  if (key === "image-tool-refresh") {
    void refreshImageToolFromDashboard();
  }
}

const isDevelopment = process.env.NODE_ENV === "development";
const currentUserLabel = computed(
  () => userInfo.value?.username || userInfo.value?.account || "未命名账号",
);

const serviceModeLabel = computed(() =>
  currentServiceMode.value === "local" ? "本地模式" : "远程模式",
);

const networkLocation = computed(
  () =>
    [networkProfile.city, networkProfile.region, networkProfile.country]
      .filter(Boolean)
      .join(" / ") || "--",
);

const dashboardStatusCards = computed<DashboardStatusCard[]>(() => [
  {
    key: "ws",
    title: "远程连接",
    value: websocketText(wsState.status),
    description: serviceModeLabel.value,
    icon: "mdi-connection",
    tone: websocketTone(wsState.status),
  },
  {
    key: "client",
    title: "客户端服务",
    value: serverStatus.value ? "在线" : "离线",
    description: serverStatus.value ? "1519 可访问" : "1519 未响应",
    icon: "mdi-monitor-cellphone",
    tone: serviceToneByState(serverStatus.value),
  },
  {
    key: "browser",
    title: "浏览器自动化",
    value:
      uploaderServiceStatus.value === "running"
        ? "就绪"
        : uploaderServiceStatus.value === "warning"
          ? "已启动"
          : uploaderServiceStatus.value === "error"
            ? "异常"
            : "未启动",
    description:
      uploaderServiceStatus.value === "running"
        ? "服务与浏览器已连接"
        : uploaderServiceStatus.value === "warning"
          ? "等待浏览器实例连接"
          : uploaderServiceStatus.value === "error"
            ? "状态检测异常"
            : "服务未启动",
    icon: "mdi-robot-outline",
    tone: browserAutomationToneByState(uploaderServiceStatus.value),
    actions: [
      {
        key: "browser-automation-toggle",
        label: uploaderServiceStatus.value === "running" ? "关闭" : "打开",
        icon:
          uploaderServiceStatus.value === "running"
            ? "mdi-close-circle-outline"
            : "mdi-open-in-new",
        loading: browserAutomationActionLoading.value,
      },
      {
        key: "browser-automation-refresh",
        label: "刷新",
        icon: "mdi-refresh",
        loading: browserAutomationActionLoading.value,
      },
    ],
  },
  {
    key: "ps",
    title: "Photoshop",
    value: photoshopRuntimeMeta.value.busy
      ? "制作中"
      : autoPsdBatchState.autoDispatchEnabled
        ? "自动制作已开启"
        : photoshopRuntimeMeta.value.valueText,
    description: photoshopRuntimeMeta.value.busy
      ? photoshopRuntimeMeta.value.description || "处理中"
      : autoPsdBatchState.autoDispatchEnabled
        ? "等待领取任务，完成后自动领取下一个"
        : photoshopRuntimeMeta.value.description,
    details: [psAutoProductionDetail.value],
    hoverTitle: photoshopRuntimeMeta.value.busy
      ? "PS 制作详情"
      : autoPsdBatchState.autoDispatchEnabled
        ? "客户端自动领取模式"
        : undefined,
    hoverLines: photoshopRuntimeMeta.value.busy
      ? photoshopRuntimeMeta.value.hoverLines
      : autoPsdBatchState.autoDispatchEnabled
        ? ["客户端定期轮询领取待制作任务", "制作完成后自动领取下一个"]
        : undefined,
    icon: "mdi-image-filter-drama",
    tone: photoshopRuntimeMeta.value.busy
      ? "warning"
      : autoPsdBatchState.autoDispatchEnabled
        ? "success"
        : photoshopRuntimeMeta.value.tone,
    highlight:
      autoPsdBatchState.autoDispatchEnabled && !photoshopRuntimeMeta.value.busy,
    busy: photoshopRuntimeMeta.value.busy,
  },
  {
    key: "platform-task",
    title: "平台任务",
    value: platformTaskMeta.value.valueText,
    description: platformTaskMeta.value.description,
    details: platformTaskMeta.value.details,
    hoverTitle: platformTaskMeta.value.hoverTitle,
    hoverLines: platformTaskMeta.value.hoverLines,
    icon: "mdi-clipboard-text-clock-outline",
    tone: platformTaskMeta.value.tone,
    highlight:
      platformTaskMeta.value.enabled && !platformTaskMeta.value.running,
    busy: platformTaskMeta.value.running,
  },
  {
    key: "video-template",
    title: "Video Template",
    value: videoTemplateRuntimeMeta.value.valueText,
    description: videoTemplateRuntimeMeta.value.description,
    icon: "mdi-filmstrip-box-multiple",
    tone: videoTemplateRuntimeMeta.value.tone,
    actions: [
      {
        key: "video-template-toggle",
        label:
          videoTemplateRuntimeMeta.value.connected ||
          videoTemplateRuntimeMeta.value.busy
            ? "关闭"
            : "启动",
        icon:
          videoTemplateRuntimeMeta.value.connected ||
          videoTemplateRuntimeMeta.value.busy
            ? "mdi-stop-circle-outline"
            : "mdi-play-circle-outline",
        loading: videoTemplateActionLoading.value,
      },
      {
        key: "video-template-refresh",
        label: "刷新",
        icon: "mdi-refresh",
        loading: videoTemplateActionLoading.value,
      },
    ],
  },
  {
    key: "image-processing",
    title: "Image Tool",
    value: imageProcessingRuntimeMeta.value.valueText,
    description: imageProcessingRuntimeMeta.value.description,
    icon: "mdi-image-multiple-outline",
    tone: imageProcessingRuntimeMeta.value.tone,
    actions: [
      {
        key: "image-tool-toggle",
        label:
          imageProcessingRuntimeMeta.value.connected ||
          imageProcessingRuntimeMeta.value.busy
            ? "关闭"
            : "启动",
        icon:
          imageProcessingRuntimeMeta.value.connected ||
          imageProcessingRuntimeMeta.value.busy
            ? "mdi-stop-circle-outline"
            : "mdi-play-circle-outline",
        loading: imageToolActionLoading.value,
      },
      {
        key: "image-tool-refresh",
        label: "刷新",
        icon: "mdi-refresh",
        loading: imageToolActionLoading.value,
      },
    ],
  },
  {
    key: "hotsearch",
    title: "热搜采集",
    value: hotsearchScheduleEnabled.value
      ? hotsearchFetching.value
        ? "采集中..."
        : "定时已开启"
      : "未开启",
    description: hotsearchScheduleEnabled.value
      ? hotsearchFetching.value
        ? "正在采集热搜数据"
        : `每 ${hotsearchScheduleInfo.value.intervalMinutes} 分钟 · ${localPlatformCount.value || hotsearchScheduleInfo.value.platformCount} 个平台`
      : "未配置定时采集",
    icon: "mdi-fire",
    tone: hotsearchScheduleEnabled.value
      ? hotsearchFetching.value
        ? "warning"
        : "success"
      : "muted",
    busy: hotsearchFetching.value,
    highlight: hotsearchScheduleEnabled.value && !hotsearchFetching.value,
  },
]);

watch(isLoggedIn, (loggedIn) => {
  if (loggedIn) {
    ensureWebsocketConnected();
  } else {
    disconnectWebsocketIfNeeded();
  }
});

const logHandler = (log: { level: string; message: string }) => {
  console.log(log.message);
};

const handleAuthLogout = () => {
  isLoggedIn.value = false;
  userInfo.value = null;
};

const handleServiceModeChanged = ((
  event: CustomEvent<{ mode: "local" | "remote" }>,
) => {
  currentServiceMode.value = event.detail.mode;
}) as EventListener;

onMounted(() => {
  const nativeApi = getNativeApi();

  startServerPolling();
  startPlatformTaskPolling();
  websocketClient.events.on("toast", showToast);
  websocketClient.events.on("log", logHandler);

  if (typeof nativeApi?.getAppVersion === "function") {
    void nativeApi
      .getAppVersion()
      .then((version: string) => {
        appVersion.value = version;
        websocketClient.updateClientInfo({ appVersion: version });
      })
      .catch((error) => {
        console.warn("获取客户端版本失败:", error);
      });
  } else {
    const fallbackVersion =
      (import.meta.env.VITE_APP_VERSION as string | undefined) || "web";
    appVersion.value = fallbackVersion;
    websocketClient.updateClientInfo({ appVersion: fallbackVersion });
  }

  if (typeof nativeApi?.getWorkspaceDirectory === "function") {
    void nativeApi
      .getWorkspaceDirectory()
      .then((workspaceDirectory: string) => {
        websocketClient.updateClientInfo({
          workspaceDirectory: String(workspaceDirectory || "").trim(),
        });
      })
      .catch((error) => {
        console.warn("获取工作目录失败:", error);
      });
  }

  void checkAuthAndGetUserInfo();

  (window as any).__materialUploadService = downloadImageAndUploadMaterial;
  (window as any).__crawlerMaterialUploadService =
    downloadImageAndUploadMaterial;
  (window as any).__fileResourceUploadService = uploadFileResource;

  void checkPsServiceStatus();
  psServiceStatusInterval = setInterval(checkPsServiceStatus, 8000);

  void websocketClient.syncServiceRuntime("image-processing");
  void websocketClient.syncServiceRuntime("video-template");

  void checkUploaderServiceStatus();
  uploaderServiceStatusInterval = setInterval(checkUploaderServiceStatus, 3000);

  void checkLocalServiceStatus();
  localServiceStatusInterval = setInterval(checkLocalServiceStatus, 8000);

  window.addEventListener("auth:logout", handleAuthLogout);
  window.addEventListener("service-mode-changed", handleServiceModeChanged);
  window.addEventListener("focus", handleWindowForegroundRecovery);
  window.addEventListener("pageshow", handleWindowForegroundRecovery);
  document.addEventListener("visibilitychange", handleWindowForegroundRecovery);

  if (typeof nativeApi?.onExtensionConnectionStatus === "function") {
    nativeApi.onExtensionConnectionStatus(
      (status: ExtensionConnectionStatus) => {
        extensionConnectionStatus.value = status;
      },
    );
  }

  const checkExtensionStatus = async () => {
    try {
      const response = await fetch(`${LOCAL_API_BASE}/extension/connections`);
      if (!response.ok) {
        extensionConnectionStatus.value = null;
        return;
      }

      const data = await response.json();
      extensionConnectionStatus.value = {
        connected: data.total > 0,
        totalConnections: data.total,
      };
    } catch {
      extensionConnectionStatus.value = null;
    }
  };

  void checkExtensionStatus();
  extensionStatusTimer = setInterval(checkExtensionStatus, 5000);
});

onBeforeUnmount(() => {
  if (serverTimer) {
    window.clearInterval(serverTimer);
    serverTimer = null;
  }

  if (psServiceStatusInterval) {
    clearInterval(psServiceStatusInterval);
    psServiceStatusInterval = null;
  }

  if (uploaderServiceStatusInterval) {
    clearInterval(uploaderServiceStatusInterval);
    uploaderServiceStatusInterval = null;
  }

  if (localServiceStatusInterval) {
    clearInterval(localServiceStatusInterval);
    localServiceStatusInterval = null;
  }

  if (extensionStatusTimer) {
    clearInterval(extensionStatusTimer);
    extensionStatusTimer = null;
  }

  stopPlatformTaskPolling();
  websocketClient.events.off("toast", showToast);
  websocketClient.events.off("log", logHandler);
  window.removeEventListener("auth:logout", handleAuthLogout);
  window.removeEventListener("service-mode-changed", handleServiceModeChanged);
  window.removeEventListener("focus", handleWindowForegroundRecovery);
  window.removeEventListener("pageshow", handleWindowForegroundRecovery);
  document.removeEventListener(
    "visibilitychange",
    handleWindowForegroundRecovery,
  );
  disconnectWebsocketIfNeeded();
});
</script>

<template>
  <div
    class="client-app"
    :class="{ 'client-app--auth': checkingAuth || !isLoggedIn }"
  >
    <div v-if="checkingAuth" class="auth-checking">
      <div class="auth-checking__spinner"></div>
      <div class="auth-checking__title">正在进入客户端</div>
      <div class="auth-checking__desc">正在检查登录状态并准备运行环境…</div>
    </div>

    <Login v-else-if="!isLoggedIn" @login-success="handleLoginSuccess" />

    <template v-else>
      <LoadingOverlay
        :visible="isLoggingOut"
        title="正在退出登录"
        message="正在结束当前会话"
        icon="mdi-logout"
      />

      <div class="app-shell" :class="{ 'is-logging-out': isLoggingOut }">
        <header class="app-topbar">
          <div class="app-topbar__left">
            <span class="app-topbar__brand">
              <i class="mdi mdi-creation-outline"></i>
            </span>
            <span class="app-topbar__title">衣设客户端</span>
          </div>

          <div class="app-topbar__center">
            <span class="app-topbar__meta">{{ currentUserLabel }}</span>
            <span class="app-topbar__sep">·</span>
            <span class="app-topbar__meta app-topbar__meta--muted">{{
              networkLocation
            }}</span>
            <span class="app-topbar__sep">·</span>
            <span class="app-topbar__meta app-topbar__meta--muted"
              >v{{ appVersion || "--" }}</span
            >
          </div>

          <div class="app-topbar__right">
            <el-dropdown trigger="click" placement="bottom-end">
              <button
                type="button"
                class="topbar-btn"
                :title="themePreferenceLabel"
              >
                <i :class="['mdi', themeToggleIcon]"></i>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="setThemePreference('auto')"
                    >跟随时间</el-dropdown-item
                  >
                  <el-dropdown-item @click="setThemePreference('light')"
                    >浅色模式</el-dropdown-item
                  >
                  <el-dropdown-item @click="setThemePreference('dark')"
                    >深色模式</el-dropdown-item
                  >
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <button
              type="button"
              class="topbar-btn"
              title="刷新连接"
              @click="reconnectWebsocket"
            >
              <i class="mdi mdi-rotate-right"></i>
            </button>

            <button
              v-if="isDevelopment"
              type="button"
              class="topbar-btn"
              title="开发者工具"
              @click="toggleDevTools"
            >
              <i class="mdi mdi-bug-outline"></i>
            </button>

            <button
              type="button"
              class="topbar-btn topbar-btn--danger"
              title="退出登录"
              :disabled="isLoggingOut"
              @click="handleLogout"
            >
              <i
                :class="[
                  'mdi',
                  isLoggingOut ? 'mdi-loading mdi-spin' : 'mdi-logout',
                ]"
              ></i>
            </button>
          </div>
        </header>

        <main class="app-body">
          <section class="app-section">
            <div class="app-section__title">运行状态</div>
            <Dashboard
              :status-cards="dashboardStatusCards"
              @card-action="handleDashboardCardAction"
            />
          </section>

          <section class="app-section">
            <div class="app-section__title">设置</div>
            <Settings />
          </section>
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.client-app {
  height: 100vh;
  min-height: 100vh;
  padding: 12px;
  overflow: auto;
}

.client-app--auth {
  padding: 0;
  overflow: hidden;
}

.auth-checking {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 12px;
}

.auth-checking__spinner {
  width: 42px;
  height: 42px;
  border: 3px solid color-mix(in srgb, var(--theme-primary) 18%, transparent);
  border-top-color: var(--theme-primary);
  border-radius: 999px;
  animation: client-spin 0.8s linear infinite;
}

.auth-checking__title {
  color: var(--theme-text);
  font-size: 18px;
  font-weight: 700;
}

.auth-checking__desc {
  color: var(--theme-text-muted);
  font-size: 13px;
}

.app-shell {
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  min-height: min(580px, calc(100vh - 24px));
  margin: 0 auto;
  border: 1px solid var(--theme-border);
  border-radius: 14px;
  background: var(--theme-surface-elevated);
  box-shadow: var(--theme-shadow-xs);
  overflow: hidden;
}

.app-shell.is-logging-out {
  pointer-events: none;
}

.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--theme-border);
  background: var(--theme-sidebar);
  flex-shrink: 0;
}

.app-topbar__left {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.app-topbar__brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  background: var(--theme-surface-muted);
  color: var(--theme-primary);
  font-size: 12px;
}

.app-topbar__title {
  color: var(--theme-text);
  font-size: 11px;
  font-weight: 700;
}

.app-topbar__center {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex: 1;
  justify-content: center;
}

.app-topbar__meta {
  color: var(--theme-text);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-topbar__meta--muted {
  color: var(--theme-text-muted);
  font-weight: 400;
}

.app-topbar__sep {
  color: var(--theme-text-soft);
  font-size: 10px;
}

.app-topbar__right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.topbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--theme-border);
  border-radius: 7px;
  background: var(--theme-surface-muted);
  color: var(--theme-text);
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    opacity 0.18s ease;
}

.topbar-btn:hover {
  border-color: var(--theme-border-strong);
  background: var(--theme-surface-strong);
}

.topbar-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

.topbar-btn--danger {
  color: var(--theme-danger);
}

.topbar-btn--danger:hover {
  border-color: color-mix(
    in srgb,
    var(--theme-danger) 40%,
    var(--theme-border)
  );
  background: color-mix(
    in srgb,
    var(--theme-danger) 10%,
    var(--theme-surface-muted)
  );
}

.topbar-btn .mdi-spin {
  animation: client-spin 0.8s linear infinite;
}

.app-body {
  flex: 1;
  min-height: 0;
  padding: 10px 12px 12px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.app-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.app-section__title {
  color: var(--theme-text);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

@keyframes client-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 600px) {
  .app-topbar__center {
    display: none;
  }

  .client-app {
    padding: 6px;
  }

  .app-shell {
    border-radius: 10px;
  }
}
</style>

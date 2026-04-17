<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { websocketClient } from "./services/websocketClient";
import { getUserInfo, logout, type UserInfo } from "./api/auth";
import { getTokenFromClient } from "./api/user";
import { LOCAL_API_BASE, getServiceMode } from "./config/api";
import { downloadImageAndUploadMaterial } from "./services/materialUpload";
import { useToast } from "./composables/useToast";
import { useThemeMode } from "./composables/useThemeMode";
import LoadingOverlay from "./components/LoadingOverlay.vue";
import Login from "./views/Login.vue";
import Dashboard, {
  type DashboardMetaItem,
  type DashboardQuickAction,
  type DashboardStatusCard,
} from "./views/Dashboard.vue";
import Settings from "./views/Settings.vue";
import {
  checkUploaderStatus,
  getUploaderBrowserStatus,
  isUploaderBrowserReady,
  type UploaderBrowserStatus,
} from "./api/uploader";

type AppPageKey = "overview" | "settings";
type ServiceStatusTone = "success" | "warning" | "danger" | "muted";

interface ExtensionConnectionStatus {
  connected: boolean;
  clientId?: string;
  clientSource?: string;
  connectedAt?: string;
  lastClientInfoAt?: string;
  workspaceDirectory?: string;
  user?: {
    id?: string | number | null;
    account?: string | null;
    name?: string | null;
    nickname?: string | null;
    email?: string | null;
  } | null;
  machine?: {
    code?: string | null;
    platform?: string | null;
    createdAt?: string | null;
  } | null;
  totalConnections?: number;
}

const { showToast } = useToast();
const { themePreferenceLabel, themeToggleIcon, setThemePreference } =
  useThemeMode();

const activePage = ref<AppPageKey>("overview");
const appVersion = ref("");
const serverStatus = ref(false);
const isLoggedIn = ref(false);
const userInfo = ref<UserInfo | null>(null);
const loadingUserInfo = ref(false);
const checkingAuth = ref(true);
const isLoggingOut = ref(false);

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

const pageMap: Record<
  AppPageKey,
  { label: string; description: string; icon: string }
> = {
  overview: {
    label: "执行概览",
    description: "查看客户端在线状态、桥接能力与当前执行环境。",
    icon: "mdi-view-dashboard-outline",
  },
  settings: {
    label: "客户端设置",
    description: "维护主题模式、服务地址与必要的运行配置。",
    icon: "mdi-cog-outline",
  },
};

const menuItems: Array<{ key: AppPageKey; label: string; icon: string }> = [
  { key: "overview", label: "执行概览", icon: "mdi-view-dashboard-outline" },
  { key: "settings", label: "客户端设置", icon: "mdi-cog-outline" },
];

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

function buildUploaderRuntimeDetails(
  browserStatus?: UploaderBrowserStatus | null,
) {
  return {
    ...(browserStatus || {}),
    browserConnected: !!browserStatus?.isConnected,
    hasInstance: !!browserStatus?.hasInstance,
    pageCount: browserStatus?.pageCount ?? 0,
    pages: Array.isArray(browserStatus?.pages) ? browserStatus.pages : [],
  };
}

function resolvePhotoshopRuntimeMeta() {
  const runtime =
    clientProfile.services?.["ps-automation"] ||
    clientProfile.services?.photoshop ||
    null;
  const details = runtime?.details || {};
  const connected = !!runtime?.connected;
  const available = !!runtime?.available;
  const busy = !!(
    runtime?.busy ||
    runtime?.state === "busy" ||
    runtime?.currentTaskId
  );
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

  const serviceText = serviceError
    ? "服务异常"
    : connected
      ? "服务在线"
      : "服务未启动";

  const appText = busy
    ? "执行中"
    : photoshopStatus === "ready"
      ? "PS 可用"
      : photoshopStatus === "starting"
        ? "启动中"
        : connected
          ? "PS 未启动"
          : "不可用";

  const summaryText = busy
    ? "执行中"
    : photoshopStatus === "ready"
      ? "就绪"
      : photoshopStatus === "starting"
        ? "等待就绪"
        : connected
          ? "服务在线"
          : serviceError
            ? "异常"
            : "未启动";

  const description = busy
    ? "当前有套图任务正在处理。"
    : photoshopStatus === "ready"
      ? "PS 服务已连接，Photoshop 可执行。"
      : photoshopStatus === "starting"
        ? "PS 服务已连接，Photoshop 已启动，等待可执行状态。"
        : connected
          ? "PS 服务已连接，但 Photoshop 尚未启动。"
          : serviceError
            ? runtime?.message || "PS 处理服务异常。"
            : "客户端保留桌面桥接与执行能力。";

  const headerLabel = busy
    ? "PS 正在执行"
    : photoshopStatus === "ready"
      ? "PS 可用"
      : photoshopStatus === "starting"
        ? "服务在线 / PS 启动中"
        : connected
          ? "服务在线 / PS 未启动"
          : serviceError
            ? "PS 桥接异常"
            : "PS 桥接未启动";

  const tone: ServiceStatusTone = busy
    ? "warning"
    : photoshopStatus === "ready"
      ? "success"
      : connected
        ? "warning"
        : serviceError
          ? "danger"
          : "warning";

  return {
    connected,
    available,
    busy,
    serviceText,
    appText,
    summaryText,
    description,
    headerLabel,
    tone,
  };
}

const photoshopRuntimeMeta = computed(() => resolvePhotoshopRuntimeMeta());

function resolveVideoTemplateRuntimeMeta() {
  const runtime =
    clientProfile.services?.["video-template"] ||
    clientProfile.services?.remotion ||
    clientProfile.services?.["remotion-video"] ||
    null;
  const details = runtime?.details || {};
  const available = !!runtime?.available;
  const hasChecked = !!runtime?.lastCheckedAt;
  const activeJobsCount = Number(details?.activeJobsCount ?? details?.queueCount ?? 0);
  const queuedJobsCount = Number(details?.queuedJobsCount ?? 0);
  const isBusy = !!(runtime?.busy || runtime?.state === "busy" || activeJobsCount > 0);
  const serviceError =
    runtime?.status === "error" || runtime?.state === "error";
  const summaryText = available
    ? "服务可用"
    : hasChecked
      ? "服务不可用"
      : "检测中";
  const tone: ServiceStatusTone = available
    ? "success"
    : serviceError
      ? "danger"
      : hasChecked
      ? "warning"
        : "muted";
  const description = !hasChecked
    ? ""
    : !available
      ? "服务不可用"
      : isBusy
        ? queuedJobsCount > 0
          ? `当前有 ${activeJobsCount} 个任务，排队中 ${queuedJobsCount} 个`
          : "当前有视频任务制作中"
        : "本地渲染服务在线";

  return {
    available,
    hasChecked,
    summaryText,
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
  const isBusy = !!(runtime?.busy || runtime?.state === "busy" || activeJobsCount > 0);
  const summaryText = available ? "可用" : hasChecked ? "不可用" : "检测中";
  const tone: ServiceStatusTone = available ? "success" : "muted";
  const description = !hasChecked
    ? ""
    : !available
      ? String(runtime?.message || runtime?.lastError || "当前不可用")
      : isBusy
        ? `当前有 ${activeJobsCount} 个图片任务处理中`
        : "客户端内置图片处理已就绪";

  return {
    available,
    hasChecked,
    summaryText,
    description,
    tone,
  };
}

const imageProcessingRuntimeMeta = computed(() =>
  resolveImageProcessingRuntimeMeta(),
);

function websocketTone(status: string): ServiceStatusTone {
  if (status === "connected") {
    return "success";
  }

  if (status === "connecting" || status === "reconnecting") {
    return "warning";
  }

  if (status === "error") {
    return "danger";
  }

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

function toneClass(tone: ServiceStatusTone) {
  return `is-${tone}`;
}

function throttle(lastCheck: number, delay: number) {
  return Date.now() - lastCheck >= delay;
}

function ensureWebsocketConnected() {
  if (ACTIVE_WS_STATUSES.includes(wsState.status)) {
    return;
  }
  websocketClient.connect();
}

function disconnectWebsocketIfNeeded() {
  if (["idle", "disconnected"].includes(wsState.status)) {
    return;
  }
  websocketClient.disconnect();
}

function handleWindowForegroundRecovery() {
  if (!isLoggedIn.value) {
    return;
  }

  if (document.visibilityState !== "visible") {
    return;
  }

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
  if (!throttle(lastServerCheck, THROTTLE_DELAY)) {
    return;
  }

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
  if (serverTimer) {
    window.clearInterval(serverTimer);
  }
  serverTimer = window.setInterval(checkServerStatus, 4000);
}

async function checkPsServiceStatus() {
  try {
    await websocketClient.syncServiceRuntime("photoshop");
  } catch {
    // runtime 会在 websocketClient 内部兜底写回 profile，这里无需额外处理
  }
}

async function checkUploaderServiceStatus() {
  const lastCheckedAt = new Date().toISOString();

  try {
    const status = await checkUploaderStatus();
    if (!status.connected) {
      uploaderServiceStatus.value = "stopped";
      websocketClient.updateServiceStatus("uploader", {
        label: "浏览器自动化",
        connected: false,
        available: false,
        status: "disconnected",
        state: "offline",
        busy: false,
        message: "自动化服务未启动",
        lastCheckedAt,
        lastError: null,
        supportedCommands: ["refreshRuntime", "health"],
        details: buildUploaderRuntimeDetails(),
      }, { emitClientInfo: false });
      return;
    }

    const browserStatus = await getUploaderBrowserStatus();
    const browserReady =
      browserStatus.success && isUploaderBrowserReady(browserStatus.data);
    const browserDetails = buildUploaderRuntimeDetails(browserStatus.data);

    if (browserReady) {
      uploaderServiceStatus.value = "running";
      websocketClient.updateServiceStatus("uploader", {
        label: "浏览器自动化",
        connected: true,
        available: true,
        status: "connected",
        state: "idle",
        busy: false,
        message: "自动化服务与浏览器实例已连接",
        lastCheckedAt,
        lastError: null,
        supportedCommands: ["refreshRuntime", "health"],
        details: browserDetails,
      }, { emitClientInfo: false });
      return;
    }

    uploaderServiceStatus.value = browserStatus.success ? "warning" : "error";
    websocketClient.updateServiceStatus("uploader", {
      label: "浏览器自动化",
      connected: true,
      available: false,
      status: "connected",
      state: browserStatus.success ? "offline" : "error",
      busy: false,
      message: browserStatus.message || "自动化服务已启动，但浏览器实例未就绪",
      lastCheckedAt,
      lastError: browserStatus.success
        ? null
        : (browserStatus.message ?? "浏览器状态检测失败"),
      supportedCommands: ["refreshRuntime", "health"],
      details: browserDetails,
    }, { emitClientInfo: false });
  } catch (error: any) {
    if (error?.code === "ECONNREFUSED" || error?.message?.includes("fetch")) {
      uploaderServiceStatus.value = "stopped";
      websocketClient.updateServiceStatus("uploader", {
        label: "浏览器自动化",
        connected: false,
        available: false,
        status: "disconnected",
        state: "offline",
        busy: false,
        message: "自动化服务未启动",
        lastCheckedAt,
        lastError: null,
        supportedCommands: ["refreshRuntime", "health"],
        details: buildUploaderRuntimeDetails(),
      }, { emitClientInfo: false });
      return;
    }

    uploaderServiceStatus.value = "error";
    websocketClient.updateServiceStatus("uploader", {
      label: "浏览器自动化",
      connected: false,
      available: false,
      status: "error",
      state: "error",
      busy: false,
      message: error?.message || "自动化服务异常",
      lastCheckedAt,
      lastError: error?.message || "自动化服务异常",
      supportedCommands: ["refreshRuntime", "health"],
      details: buildUploaderRuntimeDetails(),
    }, { emitClientInfo: false });
  }
}

async function checkLocalServiceStatus() {
  const lastCheckedAt = new Date().toISOString();
  const nativeApi = getNativeApi();

  if (!nativeApi?.checkLocalServiceStatus) {
    localServiceStatus.value = "stopped";
    websocketClient.updateServiceStatus("localService", {
      label: "本地服务",
      connected: false,
      available: false,
      status: "disconnected",
      state: "offline",
      busy: false,
      message: "当前为浏览器环境，未注入桌面端本地服务能力",
      lastCheckedAt,
      lastError: null,
      supportedCommands: ["refreshRuntime", "health"],
    }, { emitClientInfo: false });
    return;
  }

  try {
    const status = await nativeApi.checkLocalServiceStatus();
    localServiceStatus.value = status?.running ? "running" : "stopped";
    websocketClient.updateServiceStatus("localService", {
      label: "本地服务",
      connected: !!status?.running,
      available: !!status?.running,
      status: status?.running ? "connected" : "disconnected",
      state: status?.running ? "idle" : "offline",
      busy: false,
      message: status?.running ? "1519 本地服务可用" : "1519 本地服务未启动",
      lastCheckedAt,
      lastError: null,
      supportedCommands: ["refreshRuntime", "health"],
    }, { emitClientInfo: false });
  } catch (error: any) {
    localServiceStatus.value = "error";
    websocketClient.updateServiceStatus("localService", {
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
    }, { emitClientInfo: false });
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
    if (error?.response?.status === 401) {
      isLoggedIn.value = false;
      userInfo.value = null;
      try {
        await fetch(`${LOCAL_API_BASE}/logoutToken`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }).catch(() => {});
      } catch {
        // ignore
      }
    } else {
      console.error("获取用户信息失败:", error);
      isLoggedIn.value = false;
      userInfo.value = null;
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
  if (isLoggingOut.value) {
    return;
  }

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

async function refreshLocation() {
  showToast({
    color: "info",
    icon: "mdi-map-search",
    message: "正在刷新位置信息...",
  });

  try {
    await websocketClient.refreshLocation(true);
    showToast({
      color: "success",
      icon: "mdi-map-marker",
      message: "位置信息已更新",
    });
  } catch (error) {
    console.error("刷新位置失败", error);
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "刷新位置信息失败",
    });
  }
}

async function openWorkspaceFromDashboard() {
  try {
    const path = await window.api.getWorkspaceDirectory();
    if (!path) {
      activePage.value = "settings";
      showToast({
        color: "warning",
        icon: "mdi-folder-alert-outline",
        message: "工作目录未设置，已为你切换到客户端设置",
      });
      return;
    }

    await window.api.openPath(path);
  } catch (error: any) {
    console.error("打开工作目录失败", error);
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "打开工作目录失败",
    });
  }
}

async function handleToggleDevTools() {
  try {
    if (window?.api?.toggleDevTools) {
      await window.api.toggleDevTools();
    }
  } catch (error) {
    console.warn("切换开发者工具失败:", error);
  }
}

function handleDashboardAction(key: string) {
  if (key === "settings") {
    activePage.value = key;
    return;
  }

  if (key === "reconnect") {
    void reconnectWebsocket();
    return;
  }

  if (key === "refresh-location") {
    void refreshLocation();
    return;
  }

  if (key === "open-workspace") {
    void openWorkspaceFromDashboard();
  }
}

const isDevelopment = process.env.NODE_ENV === "development";

const currentPage = computed(() => pageMap[activePage.value]);
const currentUserLabel = computed(
  () => userInfo.value?.username || userInfo.value?.account || "未命名账号",
);
const serviceModeLabel = computed(() =>
  currentServiceMode.value === "local" ? "本地服务模式" : "远程服务模式",
);
const sidebarRuntimeItems = computed(() => [
  {
    key: "client",
    label: "客户端服务",
    value: serverStatus.value ? "在线" : "离线",
    tone: serviceToneByState(serverStatus.value),
  },
  {
    key: "ws",
    label: "远程链路",
    value: websocketText(wsState.status),
    tone: websocketTone(wsState.status),
  },
  {
    key: "uploader",
    label: "浏览器自动化",
    value:
      uploaderServiceStatus.value === "running"
        ? "就绪"
        : uploaderServiceStatus.value === "warning"
          ? "待连接"
          : uploaderServiceStatus.value === "error"
            ? "异常"
            : "未启动",
    tone: browserAutomationToneByState(uploaderServiceStatus.value),
  },
  {
    key: "ps",
    label: "Photoshop",
    value: photoshopRuntimeMeta.value.summaryText,
    tone: photoshopRuntimeMeta.value.tone,
  },
  {
    key: "video-template",
    label: "Video Template",
    value: videoTemplateRuntimeMeta.value.summaryText,
    tone: videoTemplateRuntimeMeta.value.tone,
  },
  {
    key: "image-processing",
    label: "Image Tool",
    value: imageProcessingRuntimeMeta.value.summaryText,
    tone: imageProcessingRuntimeMeta.value.tone,
  },
]);

const dashboardStatusCards = computed<DashboardStatusCard[]>(() => [
  {
    key: "ws",
    title: "远程连接",
    value: websocketText(wsState.status),
    description:
      currentServiceMode.value === "local" ? "本地服务模式" : "远程服务模式",
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
  },
  {
    key: "ps",
    title: "Photoshop",
    value: `${photoshopRuntimeMeta.value.serviceText} / ${photoshopRuntimeMeta.value.appText}`,
    description: photoshopRuntimeMeta.value.busy
      ? "任务执行中"
      : photoshopRuntimeMeta.value.connected
        ? "桌面桥接已连接"
        : "服务未启动",
    icon: "mdi-image-filter-drama",
    tone: photoshopRuntimeMeta.value.tone,
  },
  {
    key: "video-template",
    title: "Video Template",
    value: videoTemplateRuntimeMeta.value.summaryText,
    description: videoTemplateRuntimeMeta.value.description,
    icon: "mdi-filmstrip-box-multiple",
    tone: videoTemplateRuntimeMeta.value.tone,
  },
  {
    key: "image-processing",
    title: "Image Tool",
    value: imageProcessingRuntimeMeta.value.summaryText,
    description: imageProcessingRuntimeMeta.value.description,
    icon: "mdi-image-multiple-outline",
    tone: imageProcessingRuntimeMeta.value.tone,
  },
]);

const dashboardQuickActions = computed<DashboardQuickAction[]>(() => [
  {
    key: "open-workspace",
    title: "工作目录",
    description: "打开当前目录",
    icon: "mdi-folder-open-outline",
  },
  {
    key: "reconnect",
    title: "刷新连接",
    description: "重新连接远程服务",
    icon: "mdi-rotate-right",
  },
  {
    key: "refresh-location",
    title: "刷新位置",
    description: "更新网络位置信息",
    icon: "mdi-crosshairs-gps",
  },
  {
    key: "settings",
    title: "客户端设置",
    description: "打开设置页面",
    icon: "mdi-cog-outline",
  },
]);

const dashboardMetaItems = computed<DashboardMetaItem[]>(() => [
  {
    key: "machine",
    label: "设备编码",
    value:
      clientProfile.machine?.code ||
      websocketClient.identity.machineCode ||
      "--",
  },
  {
    key: "version",
    label: "客户端版本",
    value: appVersion.value || "--",
  },
  {
    key: "service-mode",
    label: "服务模式",
    value: currentServiceMode.value === "local" ? "本地服务" : "远程服务",
  },
  {
    key: "location",
    label: "网络位置",
    value:
      [networkProfile.city, networkProfile.region, networkProfile.country]
        .filter(Boolean)
        .join(" / ") || "--",
  },
  {
    key: "user",
    label: "当前账号",
    value: userInfo.value?.username || userInfo.value?.account || "--",
  },
  {
    key: "workspace",
    label: "工作目录",
    value: clientProfile.workspaceDirectory || "--",
  },
  {
    key: "extension",
    label: "插件连接",
    value: extensionConnectionStatus.value?.totalConnections
      ? `${extensionConnectionStatus.value.totalConnections} 个连接`
      : "暂无连接",
  },
]);

const appFooterText = computed(
  () => `版本 ${appVersion.value || "--"} · ${serviceModeLabel.value}`,
);

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
  // 兼容旧主进程注入名，实际仍复用统一素材上传服务。
  (window as any).__crawlerMaterialUploadService = downloadImageAndUploadMaterial;

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
        ...(data.connections?.[0] || {}),
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

  websocketClient.events.off("toast", showToast);
  websocketClient.events.off("log", logHandler);
  window.removeEventListener("auth:logout", handleAuthLogout);
  window.removeEventListener("service-mode-changed", handleServiceModeChanged);
  window.removeEventListener("focus", handleWindowForegroundRecovery);
  window.removeEventListener("pageshow", handleWindowForegroundRecovery);
  document.removeEventListener("visibilitychange", handleWindowForegroundRecovery);
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
        <aside class="app-sidebar">
          <div class="app-sidebar__top">
            <div class="app-brand">
              <div class="app-brand__icon">
                <i class="mdi mdi-creation-outline"></i>
              </div>
              <div class="app-brand__title">衣设客户端</div>
            </div>

            <nav class="app-nav">
              <button
                v-for="item in menuItems"
                :key="item.key"
                type="button"
                class="app-nav__item"
                :class="{ 'is-active': activePage === item.key }"
                @click="activePage = item.key"
              >
                <span class="app-nav__icon">
                  <i :class="['mdi', item.icon]"></i>
                </span>
                <span class="app-nav__text">{{ item.label }}</span>
                <span class="app-nav__marker"></span>
              </button>
            </nav>

            <div class="app-sidebar__status">
              <div class="sidebar-section__title">运行状态</div>
              <div class="sidebar-runtime-list">
                <div
                  v-for="item in sidebarRuntimeItems"
                  :key="item.key"
                  class="sidebar-runtime"
                  :class="toneClass(item.tone)"
                >
                  <span class="sidebar-runtime__signal"></span>
                  <span class="sidebar-runtime__label">{{ item.label }}</span>
                  <span class="sidebar-runtime__value">{{ item.value }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="app-sidebar__bottom">
            <div class="app-sidebar__footer">
              <div class="app-sidebar__meta">{{ currentUserLabel }}</div>
              <div class="app-sidebar__meta app-sidebar__meta--muted">
                {{ appFooterText }}
              </div>
              <el-button
                class="sidebar-logout"
                type="danger"
                :loading="isLoggingOut"
                @click="handleLogout"
              >
                <i class="mdi mdi-logout"></i>
                <span>{{ isLoggingOut ? "退出中..." : "退出登录" }}</span>
              </el-button>
            </div>
          </div>
        </aside>

        <main class="app-main">
          <header class="app-header">
            <div class="app-header__text">
              <h1 class="app-header__title">{{ currentPage.label }}</h1>
              <p class="app-header__desc">{{ currentPage.description }}</p>
            </div>

            <div class="app-header__actions">
              <el-dropdown trigger="click" placement="bottom-end">
                <el-button class="header-button" text>
                  <i :class="['mdi', themeToggleIcon]"></i>
                  <span>{{ themePreferenceLabel }}</span>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="setThemePreference('auto')">
                      跟随时间
                    </el-dropdown-item>
                    <el-dropdown-item @click="setThemePreference('light')">
                      浅色模式
                    </el-dropdown-item>
                    <el-dropdown-item @click="setThemePreference('dark')">
                      深色模式
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>

              <el-button class="header-button" text @click="reconnectWebsocket">
                <i class="mdi mdi-rotate-right"></i>
                <span>刷新连接</span>
              </el-button>

              <el-button
                v-if="isDevelopment"
                class="header-button"
                text
                @click="handleToggleDevTools"
              >
                <i class="mdi mdi-bug-outline"></i>
                <span>调试</span>
              </el-button>
            </div>
          </header>

          <section class="page-shell">
            <div class="page-shell__inner">
              <Dashboard
                v-if="activePage === 'overview'"
                :status-cards="dashboardStatusCards"
                :quick-actions="dashboardQuickActions"
                :meta-items="dashboardMetaItems"
                @navigate="handleDashboardAction"
              />
              <Settings v-else-if="activePage === 'settings'" />
            </div>
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
  padding: 18px;
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
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  gap: 0;
  width: min(840px, 100%);
  height: min(580px, calc(100vh - 24px));
  margin: 0 auto;
  border: 1px solid var(--theme-border);
  border-radius: 16px;
  background: var(--theme-surface-elevated);
  box-shadow: var(--theme-shadow-xs);
  overflow: hidden;
}

.app-shell.is-logging-out {
  pointer-events: none;
}

.app-sidebar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  min-height: 0;
  padding: 10px;
  border-right: 1px solid var(--theme-border);
  background: var(--theme-sidebar);
  overflow: hidden;
}

.app-sidebar__top,
.app-sidebar__bottom {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.app-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 6px;
  border-radius: 10px;
  color: var(--theme-text);
}

.app-brand__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--theme-surface-strong);
  color: var(--theme-primary);
  font-size: 13px;
}

.app-brand__title {
  color: var(--theme-text);
  font-size: 11px;
  font-weight: 700;
}

.app-sidebar__status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.sidebar-section__title {
  color: var(--theme-text-soft);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.app-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.app-nav__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--theme-text-muted);
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}

.app-nav__item:hover {
  background: var(--theme-surface-strong);
  border-color: var(--theme-border);
  color: var(--theme-text);
}

.app-nav__item.is-active {
  background: var(--theme-surface-strong);
  border-color: var(--theme-border-strong);
  color: var(--theme-text);
}

.app-nav__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: var(--theme-surface-muted);
  color: inherit;
  font-size: 11px;
}

.app-nav__text {
  flex: 1;
  min-width: 0;
  color: inherit;
  font-size: 11px;
  font-weight: 600;
}

.app-nav__marker {
  width: 4px;
  height: 14px;
  border-radius: 999px;
  background: transparent;
  transition: background-color 0.18s ease;
}

.app-nav__item.is-active .app-nav__marker {
  background: var(--theme-primary);
}

.sidebar-runtime-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar-runtime {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--theme-surface-strong);
  border: 1px solid var(--theme-border);
  color: var(--theme-text-muted);
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease;
}

.sidebar-runtime__signal {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 0 0 currentColor;
  animation: sidebarRuntimePulse 2s ease-in-out infinite;
}

.sidebar-runtime__label {
  min-width: 0;
  color: var(--theme-text);
  font-size: 10px;
  font-weight: 600;
}

.sidebar-runtime__value {
  color: inherit;
  font-size: 9px;
  font-weight: 700;
}

.sidebar-runtime.is-success {
  color: var(--theme-success);
}

.sidebar-runtime.is-warning {
  color: var(--theme-warning);
}

.sidebar-runtime.is-danger {
  color: var(--theme-danger);
}

.sidebar-runtime.is-muted {
  color: var(--theme-text-soft);
}

.app-sidebar__footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 12px;
  background: var(--theme-surface-strong);
}

.app-sidebar__meta {
  color: var(--theme-text);
  font-size: 10px;
  line-height: 1.4;
}

.app-sidebar__meta--muted {
  color: var(--theme-text-soft);
}

.sidebar-logout {
  width: 100%;
  min-height: 30px;
  border: none;
  border-radius: 10px;
  background: var(--theme-danger) !important;
  color: #fff !important;
  font-size: 12px;
  font-weight: 700;
}

.sidebar-logout:hover,
.sidebar-logout:focus-visible {
  background: color-mix(in srgb, var(--theme-danger) 88%, #000 12%) !important;
  color: #fff !important;
}

.sidebar-logout :deep(span) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.app-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--theme-border);
  background: var(--theme-surface);
}

.app-header__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.app-header__title {
  margin: 0;
  color: var(--theme-text);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
}

.app-header__desc {
  margin: 0;
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.35;
}

.app-header__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.header-button {
  min-height: 28px;
  padding: 0 8px;
  border-radius: 9px;
  border: 1px solid var(--theme-border);
  background: var(--theme-surface-strong);
  color: var(--theme-text);
  font-size: 10px;
}

.header-button :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.page-shell {
  flex: 1;
  min-height: 0;
  padding: 10px 12px 12px;
  overflow: auto;
}

.page-shell__inner {
  max-width: 100%;
  margin: 0 auto;
}

@keyframes client-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes sidebarRuntimePulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 32%, transparent 68%);
  }
  70% {
    box-shadow: 0 0 0 6px color-mix(in srgb, currentColor 0%, transparent 100%);
  }
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 0%, transparent 100%);
  }
}

@media (max-width: 1180px) {
  .app-shell {
    grid-template-columns: 1fr;
    height: auto;
  }

  .app-sidebar {
    border-right: none;
    border-bottom: 1px solid var(--theme-border);
    overflow: visible;
  }

  .app-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .app-sidebar__status {
    display: none;
  }
}

@media (max-width: 767px) {
  .client-app {
    padding: 8px;
  }

  .app-sidebar {
    padding: 8px;
  }

  .app-nav {
    grid-template-columns: 1fr;
  }

  .app-header,
  .page-shell {
    padding-left: 14px;
    padding-right: 14px;
  }

  .app-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .app-header__title {
    font-size: 15px;
  }

  .app-header__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .header-button {
    width: 100%;
    justify-content: center;
  }
}
</style>

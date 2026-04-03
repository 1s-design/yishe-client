<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { websocketClient } from "./services/websocketClient";
import { getUserInfo, logout, type UserInfo } from "./api/auth";
import { getTokenFromClient } from "./api/user";
import { LOCAL_API_BASE, getServiceMode } from "./config/api";
import { downloadImageAndUploadToCrawler } from "./services/crawlerMaterialUpload";
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
  totalConnections?: number;
}

const { showToast } = useToast();
const {
  themePreferenceLabel,
  resolvedThemeLabel,
  themeToggleIcon,
  setThemePreference,
} = useThemeMode();

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
      });
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
      });
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
    });
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
      });
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
    });
  }
}

async function checkLocalServiceStatus() {
  const lastCheckedAt = new Date().toISOString();

  try {
    const status = await window.api.checkLocalServiceStatus();
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
    });
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
    });
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
const currentUserSubtitle = computed(() => {
  if (userCompanyLabel.value) {
    return userCompanyLabel.value;
  }

  return userInfo.value?.isAdmin ? "管理员账号" : "客户端执行账号";
});
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
]);

const dashboardStatusCards = computed<DashboardStatusCard[]>(() => [
  {
    key: "ws",
    title: "远程连接",
    value: websocketText(wsState.status),
    description: `当前服务模式为${currentServiceMode.value === "local" ? "本地" : "远程"}。`,
    icon: "mdi-connection",
    tone: websocketTone(wsState.status),
  },
  {
    key: "client",
    title: "客户端服务",
    value: serverStatus.value ? "在线" : "离线",
    description: serverStatus.value
      ? "本地客户端服务可访问。"
      : "本地客户端服务未响应。",
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
        ? "服务与浏览器实例已连接。"
        : uploaderServiceStatus.value === "warning"
          ? "自动化服务已启动，等待浏览器实例连接。"
          : uploaderServiceStatus.value === "error"
            ? "自动化服务状态检测异常，请检查本地服务日志。"
            : "详细控制已迁移到 admin，客户端仅保留桥接能力。",
    icon: "mdi-robot-outline",
    tone: browserAutomationToneByState(uploaderServiceStatus.value),
  },
  {
    key: "ps",
    title: "Photoshop",
    value: `${photoshopRuntimeMeta.value.serviceText} / ${photoshopRuntimeMeta.value.appText}`,
    description: photoshopRuntimeMeta.value.description,
    icon: "mdi-image-filter-drama",
    tone: photoshopRuntimeMeta.value.tone,
  },
]);

const dashboardQuickActions = computed<DashboardQuickAction[]>(() => [
  {
    key: "open-workspace",
    title: "打开工作目录",
    description: "快速进入当前工作目录，便于检查缓存、下载和导出结果。",
    icon: "mdi-folder-open-outline",
  },
  {
    key: "settings",
    title: "打开客户端设置",
    description: "切换主题模式，查看当前服务地址与运行配置。",
    icon: "mdi-cog-outline",
  },
  {
    key: "reconnect",
    title: "重新连接远程服务",
    description: "主动触发 WebSocket 重连，适合网络切换后使用。",
    icon: "mdi-rotate-right",
  },
  {
    key: "refresh-location",
    title: "刷新位置信息",
    description: "更新当前设备网络环境与定位信息。",
    icon: "mdi-map-marker-refresh-outline",
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
    key: "extension",
    label: "插件连接",
    value: extensionConnectionStatus.value?.totalConnections
      ? `${extensionConnectionStatus.value.totalConnections} 个连接`
      : "暂无连接",
  },
]);

const appFooterText = computed(
  () => `${themePreferenceLabel.value} · ${resolvedThemeLabel.value}`,
);

const userCompanyLabel = computed(() => {
  const company = userInfo.value?.company as
    | string
    | Record<string, unknown>
    | undefined;

  if (!company) {
    return "";
  }

  if (typeof company === "object") {
    return String(company.name || company.label || "--");
  }

  return String(company);
});

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
  startServerPolling();
  websocketClient.events.on("toast", showToast);
  websocketClient.events.on("log", logHandler);

  void (window.api as any).getAppVersion().then((version: string) => {
    appVersion.value = version;
    websocketClient.updateClientInfo({ appVersion: version });
  });

  void checkAuthAndGetUserInfo();

  (window as any).__crawlerMaterialUploadService =
    downloadImageAndUploadToCrawler;

  void checkPsServiceStatus();
  psServiceStatusInterval = setInterval(checkPsServiceStatus, 8000);

  void checkUploaderServiceStatus();
  uploaderServiceStatusInterval = setInterval(checkUploaderServiceStatus, 3000);

  void checkLocalServiceStatus();
  localServiceStatusInterval = setInterval(checkLocalServiceStatus, 8000);

  window.addEventListener("auth:logout", handleAuthLogout);
  window.addEventListener("service-mode-changed", handleServiceModeChanged);

  if (window.api.onExtensionConnectionStatus) {
    window.api.onExtensionConnectionStatus(
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
  disconnectWebsocketIfNeeded();
});
</script>

<template>
  <div class="client-app">
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
        message="请稍候..."
        icon="mdi-logout"
        :minimal="true"
      />

      <div class="app-shell" :class="{ 'is-logging-out': isLoggingOut }">
        <aside class="app-sidebar">
          <div class="app-sidebar__top">
            <div class="app-brand">
              <div class="app-brand__icon">
                <i class="mdi mdi-creation-outline"></i>
              </div>
              <div>
                <div class="app-brand__title">衣设客户端</div>
                <div class="app-brand__subtitle">Yishe Client Console</div>
              </div>
            </div>

            <section class="sidebar-spotlight">
              <div class="sidebar-spotlight__eyebrow">Workspace</div>
              <div class="sidebar-spotlight__title">{{ currentUserLabel }}</div>
              <div class="sidebar-spotlight__desc">
                {{ currentUserSubtitle }}
              </div>
              <div class="sidebar-spotlight__chips">
                <span class="sidebar-chip">{{ serviceModeLabel }}</span>
                <span class="sidebar-chip">版本 {{ appVersion || "--" }}</span>
              </div>
            </section>

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
                <span class="app-nav__content">
                  <span class="app-nav__text">{{ item.label }}</span>
                  <span class="app-nav__hint">{{
                    pageMap[item.key].description
                  }}</span>
                </span>
                <span class="app-nav__marker"></span>
              </button>
            </nav>
          </div>

          <div class="app-sidebar__bottom">
            <div class="sidebar-section">
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

            <div class="app-sidebar__footer">
              <div class="app-sidebar__meta">{{ appFooterText }}</div>
            </div>
          </div>
        </aside>

        <main class="app-main">
          <header class="app-header">
            <div class="app-header__intro">
              <div class="app-header__eyebrow">Yishe Client</div>
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

              <el-dropdown trigger="click" placement="bottom-end">
                <button type="button" class="user-entry">
                  <el-avatar :size="36" class="user-entry__avatar">
                    <span>{{
                      (userInfo?.username ||
                        userInfo?.account ||
                        "U")[0].toUpperCase()
                    }}</span>
                  </el-avatar>
                  <div class="user-entry__meta">
                    <div class="user-entry__name">
                      {{ userInfo?.username || userInfo?.account }}
                    </div>
                    <div class="user-entry__desc">
                      {{ userInfo?.isAdmin ? "管理员" : "已登录" }}
                    </div>
                  </div>
                  <i class="mdi mdi-chevron-down user-entry__arrow"></i>
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item disabled>
                      {{ userInfo?.account || "--" }}
                    </el-dropdown-item>
                    <el-dropdown-item v-if="userCompanyLabel" disabled>
                      {{ userCompanyLabel }}
                    </el-dropdown-item>
                    <el-dropdown-item
                      @click="handleLogout"
                      :disabled="isLoggingOut"
                    >
                      {{ isLoggingOut ? "退出中..." : "退出登录" }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
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
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 0;
  height: 100vh;
  overflow: hidden;
}

.app-shell.is-logging-out {
  pointer-events: none;
}

.app-sidebar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
  min-height: 0;
  max-height: 100vh;
  padding: 18px 14px 14px;
  border-right: 1px solid var(--theme-border);
  background: var(--theme-sidebar);
  overflow-y: auto;
}

.app-sidebar__top,
.app-sidebar__bottom {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.app-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 18px;
  background: var(--theme-surface);
  border: 1px solid var(--theme-border);
}

.app-brand__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: color-mix(
    in srgb,
    var(--theme-primary) 10%,
    var(--theme-surface)
  );
  color: var(--theme-primary);
  font-size: 19px;
}

.app-brand__title {
  color: var(--theme-text);
  font-size: 15px;
  font-weight: 700;
}

.app-brand__subtitle {
  margin-top: 2px;
  color: var(--theme-text-muted);
  font-size: 12px;
}

.sidebar-spotlight {
  padding: 14px;
  border-radius: 20px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--theme-primary) 10%, var(--theme-surface)),
    var(--theme-surface)
  );
  border: 1px solid
    color-mix(in srgb, var(--theme-primary) 12%, var(--theme-border));
}

.sidebar-spotlight__eyebrow,
.app-header__eyebrow,
.sidebar-section__title {
  color: var(--theme-text-soft);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sidebar-spotlight__title {
  margin-top: 10px;
  color: var(--theme-text);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.15;
}

.sidebar-spotlight__desc {
  margin-top: 8px;
  color: var(--theme-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.sidebar-spotlight__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.sidebar-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--theme-surface);
  border: 1px solid var(--theme-border);
  color: var(--theme-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.app-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.app-nav__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 62px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 18px;
  background: transparent;
  color: var(--theme-text-muted);
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.app-nav__item:hover {
  background: var(--theme-surface);
  border-color: var(--theme-border);
  color: var(--theme-text);
  transform: translateX(2px);
}

.app-nav__item.is-active {
  background: var(--theme-surface);
  border-color: color-mix(
    in srgb,
    var(--theme-primary) 16%,
    var(--theme-border)
  );
  color: var(--theme-text);
  box-shadow: var(--theme-shadow-xs);
}

.app-nav__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--theme-surface-strong);
  color: inherit;
  font-size: 18px;
}

.app-nav__item.is-active .app-nav__icon {
  background: color-mix(
    in srgb,
    var(--theme-primary) 10%,
    var(--theme-surface)
  );
  color: var(--theme-primary-strong);
}

.app-nav__content {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.app-nav__text {
  color: inherit;
  font-size: 13px;
  font-weight: 700;
}

.app-nav__hint {
  color: var(--theme-text-soft);
  font-size: 11px;
  line-height: 1.4;
}

.app-nav__marker {
  width: 6px;
  height: 6px;
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
  gap: 8px;
}

.sidebar-runtime {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 14px;
  background: var(--theme-surface);
  border: 1px solid var(--theme-border);
  color: var(--theme-text-muted);
}

.sidebar-runtime__signal {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
}

.sidebar-runtime__label {
  min-width: 0;
  color: var(--theme-text);
  font-size: 12px;
  font-weight: 600;
}

.sidebar-runtime__value {
  color: inherit;
  font-size: 11px;
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
  padding: 4px 2px 0;
}

.app-sidebar__meta {
  color: var(--theme-text-soft);
  font-size: 12px;
  line-height: 1.6;
}

.app-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100vh;
  overflow-y: auto;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 22px 28px 12px;
  background: linear-gradient(180deg, var(--theme-bg) 74%, transparent 100%);
  backdrop-filter: blur(10px);
}

.app-header__title {
  margin: 6px 0 0;
  color: var(--theme-text);
  font-size: 32px;
  font-weight: 700;
  line-height: 1.08;
}

.app-header__desc {
  margin: 10px 0 0;
  max-width: 720px;
  color: var(--theme-text-muted);
  font-size: 14px;
  line-height: 1.72;
}

.app-header__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.header-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--theme-border);
  background: var(--theme-surface);
  color: var(--theme-text);
}

.header-button :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.user-entry {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 4px 10px 4px 4px;
  border: 1px solid var(--theme-border);
  border-radius: 999px;
  background: var(--theme-surface);
  color: inherit;
  cursor: pointer;
}

.user-entry__avatar {
  background: color-mix(
    in srgb,
    var(--theme-primary) 12%,
    var(--theme-surface)
  );
  color: var(--theme-primary-strong);
}

.user-entry__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.user-entry__name {
  color: var(--theme-text);
  font-size: 13px;
  font-weight: 700;
}

.user-entry__desc {
  color: var(--theme-text-muted);
  font-size: 11px;
}

.user-entry__arrow {
  color: var(--theme-text-soft);
  font-size: 18px;
}

.page-shell {
  flex: 1;
  min-height: 0;
  padding: 0 28px 28px;
}

.page-shell__inner {
  max-width: 1380px;
  margin: 0 auto;
}

@keyframes client-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1180px) {
  .app-shell {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .app-sidebar {
    gap: 12px;
    max-height: none;
    border-right: none;
    border-bottom: 1px solid var(--theme-border);
  }

  .app-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .app-main {
    height: auto;
  }
}

@media (max-width: 767px) {
  .client-app {
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .app-sidebar {
    padding: 12px;
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
    padding-top: 16px;
  }

  .app-header__title {
    font-size: 26px;
  }

  .app-header__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .header-button,
  .user-entry {
    width: 100%;
    justify-content: center;
  }
}
</style>

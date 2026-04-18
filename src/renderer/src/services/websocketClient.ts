import { io, type Socket } from "socket.io-client";
import { reactive } from "vue";
import mitt from "mitt";
import { getTokenFromClient } from "../api/user";
import { stickerPsdSetApi } from "../api/stickerPsdSet";
import photoshopApi from "../api/photoshop";
import {
  type BrowserAutomationErrorDetail,
  checkUploaderStatus,
  closeUploaderBrowser,
  connectUploaderBrowser,
  createUploaderProfile,
  deleteUploaderProfile,
  executeUploaderBrowserDebug,
  focusUploaderBrowser,
  forceCloseUploaderBrowser,
  getUploaderBrowserSmallFeatures,
  getUploaderLoginStatus,
  getUploaderProfileDetail,
  getUploaderProfiles,
  getUploaderBrowserPages,
  getUploaderBrowserStatus,
  getUploaderEcomCollectCapabilities,
  getUploaderEcomCollectPlatforms,
  getUploaderPlatforms,
  getUploaderTaskDetail,
  getUploaderTaskList,
  getUploaderTaskLogs,
  isUploaderBrowserReady,
  openUploaderLink,
  openUploaderPlatform,
  publishByUploader,
  runUploaderBrowserSmallFeature,
  runUploaderEcomCollect,
  switchUploaderProfile,
  updateUploaderProfile,
  type UploaderEcomCollectCapabilitySchema,
} from "../api/uploader";
import {
  buildPublishTaskCapabilitySummary,
  executePublishQueueTask,
  stopPublishQueueTaskExecution,
  type PublishTaskRuntimeSnapshot,
} from "./publishTaskDispatch";
import { executeEcomSelectionSupplyMatchTask } from "./ecomSelectionSupplyMatch";
import { getRemoteApiBase, getWsEndpoint, setServiceMode } from "../config/api";

type UploaderProfilesResponse = Awaited<ReturnType<typeof getUploaderProfiles>>;

type WsStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

const CLIENT_SOURCE = "客户端";
const HEARTBEAT_INTERVAL = 10_000;
const HEARTBEAT_TIMEOUT = 35_000;
const UPLOADER_RUNTIME_SYNC_INTERVAL = 4_000;
const PHOTOSHOP_RUNTIME_SYNC_INTERVAL = 8_000;
const IMAGE_PROCESSING_RUNTIME_SYNC_INTERVAL = 8_000;
const VIDEO_TEMPLATE_RUNTIME_SYNC_INTERVAL = 5_000;
const IMAGE_PROCESSING_REQUEST_TIMEOUT_MS = 20_000;
const IMAGE_PROCESSING_HEALTH_TIMEOUT_MS = 2_500;
const IMAGE_PROCESSING_TASK_TIMEOUT_MS = 5 * 60_000;
const IMAGE_PROCESSING_META_CACHE_TTL_MS = 60_000;
const IMAGE_PROCESSING_LOCAL_BASE = "electron://image-tool";
const REMOTION_REQUEST_TIMEOUT_MS = 30_000;
const REMOTION_HEALTH_TIMEOUT_MS = 15_000;
const REMOTION_TEMPLATE_REQUEST_TIMEOUT_MS = 15_000;
const REMOTION_TEMPLATE_CACHE_TTL_MS = 60_000;
const REMOTION_RECORD_PROGRESS_PERSIST_STEP = 10;
const REMOTION_RECORD_PROGRESS_PERSIST_INTERVAL_MS = 15_000;
const REMOTION_LOCAL_BASE = "electron://video-template";
const PROD_WS_ENDPOINT = "https://1s.design:1520/ws";
const DEV_WS_ENDPOINT = "http://localhost:1520/ws";
const FALLBACK_ENDPOINT = import.meta.env.PROD
  ? PROD_WS_ENDPOINT
  : DEV_WS_ENDPOINT;
const DEFAULT_WS_ENDPOINT =
  import.meta.env.VITE_WS_ENDPOINT ?? FALLBACK_ENDPOINT;
const IDENTITY_STORAGE_KEY = "yishe.ws.identity";
const BROWSER_AUTOMATION_DISPATCH_STORAGE_KEY =
  "yishe.browserAutomation.autoDispatchEnabled";
const NETWORK_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const LOCATION_ENDPOINT = "https://ipapi.co/json/";
const PLUGIN_KEY_ALIASES: Record<string, string> = {
  photoshop: "ps-automation",
  uploader: "browser-automation",
  browser: "browser-automation",
  images: "image-processing",
  "yishe-images": "image-processing",
  remotion: "video-template",
  "remotion-video": "video-template",
};
const LEGACY_SERVICE_KEYS: Record<string, string> = {
  "ps-automation": "photoshop",
  "browser-automation": "uploader",
  "image-processing": "images",
  "local-service": "localService",
  "video-template": "video-template",
};

function getNativeApi() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as typeof window & { api?: typeof window.api }).api;
}

// 将图片文件（SVG, WebP等）转换为PNG文件
async function convertImageFileToPng(
  inputPath: string,
  pngPath: string,
  width?: number,
  height?: number,
): Promise<void> {
  try {
    // 通过IPC调用主进程进行转换
    const payload: any = {
      inputPath,
      pngPath,
    };

    // 只有在指定了尺寸时才传递width和height
    if (width !== undefined && height !== undefined) {
      payload.width = width;
      payload.height = height;
    }

    const result = await (window.api as any).convertToPng(payload);

    if (!result.success) {
      throw new Error(result.error || "图片转PNG失败");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`图片转PNG失败: ${errorMessage}`);
  }
}

interface WsState {
  endpoint: string;
  status: WsStatus;
  connectedAt: string | null;
  lastPingAt: string | null;
  lastPongAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  retryCount: number;
}

interface DeviceIdentity {
  clientId: string;
  machineCode: string;
  createdAt: string;
}

interface NetworkProfile {
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  org?: string;
  timezone?: string;
  fetchedAt?: string;
  source?: string;
}

type ClientServiceState = "connected" | "disconnected" | "error" | "unknown";
type ClientServiceRuntimeState =
  | "idle"
  | "busy"
  | "offline"
  | "error"
  | "connected";

interface ClientServiceStatus {
  key: string;
  pluginKey?: string;
  label: string;
  connected: boolean;
  available: boolean;
  status: ClientServiceState;
  state?: ClientServiceRuntimeState;
  busy?: boolean;
  message?: string;
  version?: string;
  endpoint?: string;
  lastCheckedAt?: string;
  currentTaskId?: string | null;
  lastError?: string | null;
  debugAvailable?: boolean;
  supportedCommands?: string[];
  supportedTaskTypes?: string[];
  autoDispatchEnabled?: boolean;
  details?: Record<string, any>;
}

interface ServiceCommandEnvelope {
  commandId: string;
  clientId?: string;
  service?: string;
  pluginKey?: string;
  action?: string;
  mode?: "production" | "debug" | "maintenance";
  payload?: Record<string, any>;
  target?: {
    clientId?: string;
    pluginKey?: string;
  };
  command?: {
    name?: string;
    payload?: Record<string, any>;
  };
  tenant?: {
    userId?: string;
    account?: string;
  };
  createdAt?: string;
  operator?: {
    id?: string | number;
    account?: string;
  };
}

interface ServiceCommandResult {
  commandId: string;
  service: string;
  action: string;
  pluginKey?: string;
  success: boolean;
  message?: string;
  data?: any;
  error?: string | null;
  errorDetail?: BrowserAutomationErrorDetail | null;
  finishedAt: string;
}

interface LocalServiceHandler {
  key: string;
  label: string;
  pluginKey?: string;
  channel?: "client-bridge";
  getRuntime?: () => Promise<Partial<ClientServiceStatus>>;
  execute?: (
    command: ServiceCommandEnvelope,
  ) => Promise<{ success: boolean; message?: string; data?: any }>;
}

interface ClientInfoPayload {
  clientId: string;
  source: string;
  appVersion?: string;
  workspaceDirectory?: string;
  extension?: {
    name?: string;
    version?: string;
    manifestVersion?: number | string;
  };
  browser?: {
    name?: string;
    version?: string;
  };
  os?: {
    name?: string;
    version?: string;
  };
  platform?:
    | string
    | {
        os?: string;
        arch?: string;
        nacl_arch?: string;
      };
  locale?: string;
  timezone?: string;
  device?: {
    memory?: number;
    hardwareConcurrency?: number;
  };
  machine?: {
    code?: string;
    platform?: string;
    createdAt?: string;
  };
  location?: NetworkProfile;
  user?: {
    id?: string | number;
    account?: string;
    name?: string;
    nickname?: string;
    email?: string;
  };
  services?: Record<string, ClientServiceStatus>;
  psAutomation?: {
    enabled?: boolean;
    autoDispatchEnabled?: boolean;
    running: boolean;
    queueCount: number;
    currentPsSetId: string | null;
    currentPsSetName: string | null;
    progress: number | null;
    lastError: string | null;
    lastHeartbeatAt: string | null;
    updatedAt: string | null;
  };
  notes?: Record<string, unknown>;
}

function normalizePluginKey(value?: string | null) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return PLUGIN_KEY_ALIASES[normalized] || normalized;
}

function resolveCommandPluginKey(command: ServiceCommandEnvelope) {
  return normalizePluginKey(
    command.pluginKey || command.target?.pluginKey || command.service,
  );
}

function resolveCommandAction(command: ServiceCommandEnvelope) {
  return String(command.command?.name || command.action || "").trim();
}

function getLegacyServiceKey(pluginKey: string) {
  return LEGACY_SERVICE_KEYS[pluginKey] || pluginKey;
}

const identity = reactive<DeviceIdentity>(loadIdentity());

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

function generateClientId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `yc_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

function generateMachineCode(clientId: string) {
  return `YC-${clientId
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-12)
    .toUpperCase()}`;
}

function loadIdentity(): DeviceIdentity {
  const storage = getLocalStorage();
  const now = new Date().toISOString();
  if (!storage) {
    const newClientId = generateClientId();
    return {
      clientId: newClientId,
      machineCode: generateMachineCode(newClientId),
      createdAt: now,
    };
  }

  try {
    const saved = storage.getItem(IDENTITY_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<DeviceIdentity>;
      if (parsed.clientId) {
        const identityValue: DeviceIdentity = {
          clientId: parsed.clientId,
          machineCode:
            parsed.machineCode || generateMachineCode(parsed.clientId),
          createdAt: parsed.createdAt || now,
        };
        storage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identityValue));
        return identityValue;
      }
    }
  } catch (error) {
    console.warn("[ws] 读取本地 identity 失败", error);
  }

  const clientId = generateClientId();
  const newIdentity: DeviceIdentity = {
    clientId,
    machineCode: generateMachineCode(clientId),
    createdAt: now,
  };
  try {
    storage?.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(newIdentity));
  } catch (error) {
    console.warn("[ws] 保存 identity 失败", error);
  }
  return newIdentity;
}

// 初始化 endpoint，使用默认值，实际连接时会从配置动态获取
const wsState = reactive<WsState>({
  endpoint: DEFAULT_WS_ENDPOINT, // 初始值，实际连接时会从 getWsEndpoint() 动态获取
  status: "idle",
  connectedAt: null,
  lastPingAt: null,
  lastPongAt: null,
  lastLatencyMs: null,
  lastError: null,
  retryCount: 0,
});

const networkProfile = reactive<NetworkProfile>({});

const clientInfo = reactive<ClientInfoPayload>({
  clientId: identity.clientId,
  source: CLIENT_SOURCE,
  platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
  locale: typeof navigator !== "undefined" ? navigator.language : "unknown",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  device: {
    memory:
      typeof navigator !== "undefined"
        ? (navigator as any).deviceMemory
        : undefined,
    hardwareConcurrency:
      typeof navigator !== "undefined"
        ? navigator.hardwareConcurrency
        : undefined,
  },
  machine: {
    code: identity.machineCode,
    platform: typeof navigator !== "undefined" ? navigator.platform : undefined,
    createdAt: identity.createdAt,
  },
  location: networkProfile,
});

export type WebsocketEvents = {
  log: { level: "info" | "warn" | "error"; message: string };
  toast: { color: string; icon: string; message: string };
  adminMessage: { data: any; timestamp: string };
  serviceRuntime: {
    service: string;
    pluginKey?: string;
    runtime: ClientServiceStatus;
  };
  serviceCommandResult: ServiceCommandResult;
  publishTaskRuntime: PublishTaskRuntimeSnapshot;
  psdSetProgress: {
    psdSetId: string;
    step: string;
    message: string;
    progress?: number;
    total?: number;
  };
  psdSetProgressStart: { psdSetId: string };
  psdSetProgressEnd: { psdSetId: string; success: boolean; message?: string };
  psAutomationToggle: {
    enabled?: boolean | null;
    operator?: { id?: string | number; account?: string };
  };
};

const emitter = mitt<WebsocketEvents>();

const localServiceHandlers = new Map<string, LocalServiceHandler>();
registerBuiltInLocalServices();

const WS_CLIENT_INFO_REFRESH_MS = 60_000;
const WS_SERVICE_RUNTIME_REFRESH_MS = 20_000;
const WS_TRANSIENT_TOAST_DEBOUNCE_MS = 15_000;
const WS_FINGERPRINT_VOLATILE_KEYS = new Set([
  "updatedAt",
  "lastHeartbeatAt",
  "lastCheckedAt",
  "reportedAt",
  "fetchedAt",
  "timestamp",
  "lastActivity",
  "lastPingAt",
  "lastPongAt",
]);

let socket: Socket | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
let uploaderRuntimeSyncInterval: ReturnType<typeof setInterval> | null = null;
let photoshopRuntimeSyncInterval: ReturnType<typeof setInterval> | null = null;
let imageProcessingRuntimeSyncInterval: ReturnType<typeof setInterval> | null =
  null;
let videoTemplateRuntimeSyncInterval: ReturnType<typeof setInterval> | null =
  null;
let lastPingTimestamp: number | null = null;
let intentionalDisconnect = false;
let networkFetchPromise: Promise<void> | null = null;
let lastClientInfoFingerprint = "";
let lastClientInfoEmittedAt = 0;
const transientWsToastCache = new Map<string, number>();
const lastServiceRuntimeEmitCache = new Map<
  string,
  { fingerprint: string; emittedAt: number }
>();
const remotionTemplateCache = {
  items: [] as Array<Record<string, any>>,
  lastFetchedAt: 0,
};
const imageProcessingMetaCache = {
  catalog: null as Record<string, any> | null,
  operations: [] as Array<Record<string, any>>,
  variations: [] as Array<Record<string, any>>,
  processorStatus: null as Record<string, any> | null,
  lastFetchedAt: 0,
};
const activeImageProcessingTasks = new Map<
  string,
  {
    recordId: string;
    taskType: "process" | "variations";
    title: string | null;
    imageUrl: string | null;
    startedAt: string;
    updatedAt: string;
  }
>();
const remotionRecordRuntimeCache = new Map<
  string,
  {
    lastEventFingerprint: string;
    lastPersistedFingerprint: string;
    lastPersistedAt: number;
    lastPersistedProgress: number | null;
    lastPersistedStatus: string | null;
  }
>();
// 跟踪是否正在制作中
let isProductionInProgress = false;
let currentProductionTaskId: string | null = null;
const psAutomationControlState = reactive({
  enabled: null as boolean | null,
  autoDispatchEnabled: null as boolean | null,
});

// 供全局展示的套图制作运行状态
export const autoPsdBatchState = reactive({
  active: false,
  running: false,
  stopping: false,
  queueCount: 0,
  currentPsSetId: null as string | null,
  currentPsSetName: null as string | null,
  progress: null as number | null,
  lastError: null as string | null,
  lastHeartbeatAt: null as string | null,
  updatedAt: null as string | null,
});

const browserAutomationDispatchState = reactive({
  autoDispatchEnabled: loadBrowserAutomationAutoDispatchEnabled(),
});

const browserAutomationExecutionState = reactive({
  running: false,
  taskId: null as string | null,
  taskType: null as string | null,
  queue: null as string | null,
  profileId: null as string | null,
  currentStep: null as string | null,
  progress: null as number | null,
  lastError: null as string | null,
  runtime: null as Record<string, any> | null,
  startedAt: null as string | null,
  finishedAt: null as string | null,
  updatedAt: null as string | null,
});

const browserAutomationExecutionSlots = reactive<
  Record<
    string,
    {
      slotKey: string;
      running: boolean;
      taskId: string | null;
      taskType: string | null;
      queue: string | null;
      profileId: string | null;
      currentStep: string | null;
      progress: number | null;
      lastError: string | null;
      runtime: Record<string, any> | null;
      startedAt: string | null;
      finishedAt: string | null;
      updatedAt: string | null;
    }
  >
>({});

function resolveBrowserAutomationExecutionSlotKey(
  profileId?: string | null,
  fallbackTaskType?: string | null,
) {
  const normalizedProfileId = String(profileId || "").trim();
  if (normalizedProfileId) {
    return `profile:${normalizedProfileId}`;
  }
  const normalizedTaskType = String(fallbackTaskType || "").trim();
  return normalizedTaskType ? `task:${normalizedTaskType}` : "task:default";
}

function getBrowserAutomationExecutionEntries() {
  return Object.values(browserAutomationExecutionSlots);
}

function syncBrowserAutomationAggregateExecutionState() {
  const entries = getBrowserAutomationExecutionEntries().sort((a, b) => {
    if (!!a.running !== !!b.running) {
      return a.running ? -1 : 1;
    }
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  const primary = entries[0] || null;
  Object.assign(browserAutomationExecutionState, {
    running: entries.some((item) => item.running),
    taskId: primary?.taskId || null,
    taskType: primary?.taskType || null,
    queue: primary?.queue || null,
    profileId: primary?.profileId || null,
    currentStep: primary?.currentStep || null,
    progress:
      typeof primary?.progress === "number"
        ? primary.progress
        : (primary?.progress ?? null),
    lastError: primary?.lastError || null,
    runtime: primary?.runtime || null,
    startedAt: primary?.startedAt || null,
    finishedAt: primary?.finishedAt || null,
    updatedAt: primary?.updatedAt || null,
  });
}

function upsertBrowserAutomationExecutionSlot(
  slotKey: string,
  patch: Partial<(typeof browserAutomationExecutionSlots)[string]>,
) {
  if (!browserAutomationExecutionSlots[slotKey]) {
    browserAutomationExecutionSlots[slotKey] = {
      slotKey,
      running: false,
      taskId: null,
      taskType: null,
      queue: null,
      profileId: null,
      currentStep: null,
      progress: null,
      lastError: null,
      runtime: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: null,
    };
  }

  Object.assign(browserAutomationExecutionSlots[slotKey], patch);
  syncBrowserAutomationAggregateExecutionState();
  return browserAutomationExecutionSlots[slotKey];
}

function isBrowserAutomationExecutionSlotRunning(
  profileId?: string | null,
  fallbackTaskType?: string | null,
) {
  const slotKey = resolveBrowserAutomationExecutionSlotKey(
    profileId,
    fallbackTaskType,
  );
  return !!browserAutomationExecutionSlots[slotKey]?.running;
}

function findBrowserAutomationExecutionSlotKeyByTaskId(taskId?: string | null) {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    return "";
  }

  return (
    Object.keys(browserAutomationExecutionSlots).find(
      (slotKey) =>
        String(
          browserAutomationExecutionSlots[slotKey]?.taskId || "",
        ).trim() === normalizedTaskId,
    ) || ""
  );
}

const uploaderEcomCollectCapabilityCache = {
  fetchedAt: 0,
  data: null as UploaderEcomCollectCapabilitySchema | null,
};
const uploaderProfilesCache = {
  fetchedAt: 0,
  data: null as UploaderProfilesResponse | null,
  promise: null as Promise<UploaderProfilesResponse> | null,
  revision: 0,
};

const UPLOADER_ECOM_CAPABILITY_CACHE_TTL = 60_000;
const UPLOADER_PROFILES_CACHE_TTL = 2_000;
const EMPTY_UPLOADER_PROFILES_RESPONSE: UploaderProfilesResponse = {
  success: false,
  message: "获取环境列表失败",
  data: {
    activeProfileId: null,
    workspaceDir: undefined,
    profilesRootDir: undefined,
    items: [],
  },
};

function extractUploaderEcomCollectSupportedTaskTypes(
  capability: UploaderEcomCollectCapabilitySchema | null | undefined,
) {
  const taskTypes = (
    Array.isArray(capability?.platforms) ? capability.platforms : []
  )
    .flatMap((platform) => [
      ...(Array.isArray(platform?.supportedTaskTypes)
        ? platform.supportedTaskTypes
        : []),
      ...(Array.isArray(platform?.taskTypes)
        ? platform.taskTypes.map((item) => item?.value || item?.taskType)
        : []),
    ])
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return Array.from(new Set(taskTypes));
}

function buildBrowserAutomationSupportedTaskTypes(
  capability: UploaderEcomCollectCapabilitySchema | null | undefined,
) {
  return Array.from(
    new Set([
      ...buildPublishTaskCapabilitySummary().map((item) => item.taskType),
      ...extractUploaderEcomCollectSupportedTaskTypes(capability),
    ]),
  );
}

async function getCachedUploaderEcomCollectCapabilities(
  force = false,
): Promise<UploaderEcomCollectCapabilitySchema | null> {
  const now = Date.now();
  if (
    !force &&
    uploaderEcomCollectCapabilityCache.data &&
    now - uploaderEcomCollectCapabilityCache.fetchedAt <
      UPLOADER_ECOM_CAPABILITY_CACHE_TTL
  ) {
    return uploaderEcomCollectCapabilityCache.data;
  }

  const response = await getUploaderEcomCollectCapabilities();
  if (!response.success) {
    return uploaderEcomCollectCapabilityCache.data;
  }

  uploaderEcomCollectCapabilityCache.fetchedAt = now;
  uploaderEcomCollectCapabilityCache.data = response.data || null;
  return uploaderEcomCollectCapabilityCache.data;
}

function invalidateUploaderProfilesCache() {
  uploaderProfilesCache.fetchedAt = 0;
  uploaderProfilesCache.data = null;
  uploaderProfilesCache.promise = null;
  uploaderProfilesCache.revision += 1;
}

async function getCachedUploaderProfiles(
  force = false,
): Promise<UploaderProfilesResponse> {
  const now = Date.now();
  if (
    !force &&
    uploaderProfilesCache.data &&
    now - uploaderProfilesCache.fetchedAt < UPLOADER_PROFILES_CACHE_TTL
  ) {
    return uploaderProfilesCache.data;
  }

  if (uploaderProfilesCache.promise) {
    return uploaderProfilesCache.promise;
  }

  const requestRevision = uploaderProfilesCache.revision;
  let requestPromise: Promise<UploaderProfilesResponse>;
  requestPromise = getUploaderProfiles()
    .then((response) => {
      if (
        response.success &&
        uploaderProfilesCache.revision === requestRevision
      ) {
        uploaderProfilesCache.fetchedAt = Date.now();
        uploaderProfilesCache.data = response;
      }
      return response;
    })
    .catch(() => EMPTY_UPLOADER_PROFILES_RESPONSE)
    .finally(() => {
      if (uploaderProfilesCache.promise === requestPromise) {
        uploaderProfilesCache.promise = null;
      }
    });

  uploaderProfilesCache.promise = requestPromise;
  return requestPromise;
}

function loadBrowserAutomationAutoDispatchEnabled() {
  const storage = getLocalStorage();
  if (!storage) {
    return true;
  }

  try {
    const stored = storage.getItem(BROWSER_AUTOMATION_DISPATCH_STORAGE_KEY);
    if (!stored) {
      return true;
    }
    return stored === "true";
  } catch {
    return true;
  }
}

function updateBrowserAutomationCommandExecution(payload: {
  running: boolean;
  taskId?: string | null;
  taskType?: string | null;
  queue?: string | null;
  profileId?: string | null;
  currentStep?: string | null;
  progress?: number | null;
  lastError?: string | null;
  runtime?: Record<string, any> | null;
  updatedAt?: string | null;
}) {
  const normalizedProfileId = String(payload.profileId || "").trim() || null;
  const normalizedTaskType = String(payload.taskType || "").trim() || null;
  const slotKey = resolveBrowserAutomationExecutionSlotKey(
    normalizedProfileId,
    normalizedTaskType,
  );
  const previousSlot = browserAutomationExecutionSlots[slotKey];
  const updatedAt = payload.updatedAt || new Date().toISOString();

  upsertBrowserAutomationExecutionSlot(slotKey, {
    slotKey,
    running: payload.running,
    taskId: payload.taskId ?? previousSlot?.taskId ?? null,
    taskType: normalizedTaskType ?? previousSlot?.taskType ?? null,
    queue: payload.queue ?? previousSlot?.queue ?? null,
    profileId: normalizedProfileId,
    currentStep: payload.currentStep ?? null,
    progress:
      typeof payload.progress === "number"
        ? payload.progress
        : (payload.progress ?? null),
    lastError: payload.lastError ?? null,
    runtime: payload.runtime ?? null,
    startedAt: payload.running
      ? previousSlot?.startedAt || updatedAt
      : previousSlot?.startedAt || updatedAt,
    finishedAt: payload.running ? null : updatedAt,
    updatedAt,
  });
}

function persistBrowserAutomationAutoDispatchEnabled(enabled: boolean) {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(BROWSER_AUTOMATION_DISPATCH_STORAGE_KEY, String(enabled));
  } catch {
    // ignore persistence failures
  }
}

function buildPsAutomationSnapshot() {
  return {
    ...(psAutomationControlState.enabled === null
      ? {}
      : { enabled: psAutomationControlState.enabled }),
    ...(psAutomationControlState.autoDispatchEnabled === null
      ? {}
      : { autoDispatchEnabled: psAutomationControlState.autoDispatchEnabled }),
    running: !!autoPsdBatchState.running,
    queueCount: autoPsdBatchState.queueCount,
    currentPsSetId: autoPsdBatchState.currentPsSetId,
    currentPsSetName: autoPsdBatchState.currentPsSetName,
    progress: autoPsdBatchState.progress,
    lastError: autoPsdBatchState.lastError,
    lastHeartbeatAt: autoPsdBatchState.lastHeartbeatAt,
    updatedAt: autoPsdBatchState.updatedAt,
  };
}

function setPsAutomationState(patch: Partial<typeof autoPsdBatchState>) {
  const now = new Date().toISOString();
  Object.assign(autoPsdBatchState, patch, {
    lastHeartbeatAt: patch.lastHeartbeatAt ?? now,
    updatedAt: patch.updatedAt ?? now,
  });
  clientInfo.psAutomation = buildPsAutomationSnapshot();
}

function emitPsAutomationStatus(patch?: Partial<typeof autoPsdBatchState>) {
  if (patch) {
    setPsAutomationState(patch);
  } else if (!clientInfo.psAutomation) {
    setPsAutomationState({});
  } else {
    clientInfo.psAutomation = buildPsAutomationSnapshot();
  }

  if (!socket?.connected) {
    return;
  }

  socket.emit("ps-automation-status", buildPsAutomationSnapshot());
}

function buildBrowserAutomationExecutionSnapshot() {
  const items = getBrowserAutomationExecutionEntries()
    .map((item) => ({ ...item }))
    .sort((a, b) => {
      if (!!a.running !== !!b.running) {
        return a.running ? -1 : 1;
      }
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });

  return {
    running: browserAutomationExecutionState.running,
    taskId: browserAutomationExecutionState.taskId,
    taskType: browserAutomationExecutionState.taskType,
    queue: browserAutomationExecutionState.queue,
    profileId: browserAutomationExecutionState.profileId,
    currentStep: browserAutomationExecutionState.currentStep,
    progress: browserAutomationExecutionState.progress,
    lastError: browserAutomationExecutionState.lastError,
    runtime: browserAutomationExecutionState.runtime,
    startedAt: browserAutomationExecutionState.startedAt,
    finishedAt: browserAutomationExecutionState.finishedAt,
    updatedAt: browserAutomationExecutionState.updatedAt,
    items,
    runningCount: items.filter((item) => item.running).length,
  };
}

function normalizeWsStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function sanitizeBrowserAutomationExecutionForWs(value: unknown) {
  const execution =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};

  return {
    running: execution.running === true,
    taskId: String(execution.taskId || "").trim() || null,
    taskType: String(execution.taskType || "").trim() || null,
    queue: String(execution.queue || "").trim() || null,
    profileId: String(execution.profileId || "").trim() || null,
    currentStep: String(execution.currentStep || "").trim() || null,
    progress:
      typeof execution.progress === "number" ? execution.progress : null,
    lastError: String(execution.lastError || "").trim() || null,
    startedAt: String(execution.startedAt || "").trim() || null,
    finishedAt: String(execution.finishedAt || "").trim() || null,
    updatedAt: String(execution.updatedAt || "").trim() || null,
  };
}

function sanitizeBrowserAutomationProfileForWs(profile: unknown) {
  const source =
    profile && typeof profile === "object" && !Array.isArray(profile)
      ? (profile as Record<string, any>)
      : {};

  return {
    id: String(source.id || "").trim() || null,
    name: String(source.name || "").trim() || null,
    remark: String(source.remark || "").trim() || null,
    account: String(source.account || "").trim() || null,
    platforms: Array.isArray(source.platforms) ? source.platforms : [],
    debugPort: typeof source.debugPort === "number" ? source.debugPort : null,
    browserVersion: String(source.browserVersion || "").trim() || null,
    loginSummary:
      source.loginSummary &&
      typeof source.loginSummary === "object" &&
      !Array.isArray(source.loginSummary)
        ? source.loginSummary
        : null,
    createdAt: String(source.createdAt || "").trim() || null,
    updatedAt: String(source.updatedAt || "").trim() || null,
    lastUsedAt: String(source.lastUsedAt || "").trim() || null,
    userDataDir: String(source.userDataDir || "").trim() || null,
    exists: source.exists === true,
    isActive: source.isActive === true,
  };
}

function sanitizeBrowserAutomationConnectionForWs(value: unknown) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};

  return {
    profileId: String(source.profileId || "").trim() || null,
    activeProfileId: String(source.activeProfileId || "").trim() || null,
    port: typeof source.port === "number" ? source.port : null,
    debugPort: typeof source.debugPort === "number" ? source.debugPort : null,
    remoteDebuggingPort:
      typeof source.remoteDebuggingPort === "number"
        ? source.remoteDebuggingPort
        : null,
    remoteDebugPort:
      typeof source.remoteDebugPort === "number"
        ? source.remoteDebugPort
        : null,
    isConnected: source.isConnected === true,
    connected: source.connected === true || source.isConnected === true,
    hasInstance: source.hasInstance === true,
    connecting: source.connecting === true,
    pageCount: typeof source.pageCount === "number" ? source.pageCount : null,
    lastActivity: String(source.lastActivity || "").trim() || null,
  };
}

function sanitizeBrowserAutomationInstanceForWs(instance: unknown) {
  const source =
    instance && typeof instance === "object" && !Array.isArray(instance)
      ? (instance as Record<string, any>)
      : {};

  return {
    profileId: String(source.profileId || source.id || "").trim() || null,
    profileName: String(source.profileName || source.name || "").trim() || null,
    port: typeof source.port === "number" ? source.port : null,
    connected: source.connected === true || source.isConnected === true,
    available: source.available === true,
    busy: source.busy === true,
    currentTaskId: String(source.currentTaskId || "").trim() || null,
    taskType: String(source.taskType || "").trim() || null,
    currentStep: String(source.currentStep || "").trim() || null,
    pageCount: typeof source.pageCount === "number" ? source.pageCount : null,
    lastActivity: String(source.lastActivity || "").trim() || null,
    lastError: String(source.lastError || "").trim() || null,
    browserVersion: String(source.browserVersion || "").trim() || null,
    hasInstance: source.hasInstance === true,
    connecting: source.connecting === true,
    userDataDir: String(source.userDataDir || "").trim() || null,
    isActiveProfile: source.isActiveProfile === true,
  };
}

function sanitizeClientObjectSubsetForWs(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, any>;
  const result = keys.reduce<Record<string, any>>((acc, key) => {
    if (source[key] !== undefined) {
      acc[key] = source[key];
    }
    return acc;
  }, {});

  return Object.keys(result).length ? result : null;
}

function sanitizeClientExtensionForWs(value: unknown) {
  return sanitizeClientObjectSubsetForWs(value, [
    "name",
    "version",
    "manifestVersion",
  ]);
}

function sanitizeClientBrowserForWs(value: unknown) {
  return sanitizeClientObjectSubsetForWs(value, ["name", "version"]);
}

function sanitizeClientOsForWs(value: unknown) {
  return sanitizeClientObjectSubsetForWs(value, ["name", "version"]);
}

function sanitizeClientPlatformForWs(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? { os: normalized } : null;
  }

  return sanitizeClientObjectSubsetForWs(value, ["os", "arch", "nacl_arch"]);
}

function sanitizeClientDeviceForWs(value: unknown) {
  return sanitizeClientObjectSubsetForWs(value, [
    "memory",
    "hardwareConcurrency",
    "model",
    "touchPoints",
  ]);
}

function sanitizeClientMachineForWs(value: unknown) {
  return sanitizeClientObjectSubsetForWs(value, [
    "code",
    "platform",
    "createdAt",
  ]);
}

function sanitizeClientLocationForWs(value: unknown) {
  return sanitizeClientObjectSubsetForWs(value, [
    "ip",
    "city",
    "region",
    "country",
    "timeZone",
  ]);
}

function sanitizeClientUserForWs(value: unknown) {
  return sanitizeClientObjectSubsetForWs(value, [
    "id",
    "account",
    "name",
    "nickname",
    "email",
    "phone",
    "companyId",
    "company",
  ]);
}

function sanitizeClientPsAutomationForWs(value: unknown) {
  return sanitizeClientObjectSubsetForWs(value, [
    "enabled",
    "autoDispatchEnabled",
    "running",
    "queueCount",
    "currentPsSetId",
    "currentPsSetName",
    "progress",
    "lastError",
    "lastHeartbeatAt",
    "updatedAt",
  ]);
}

function sanitizeClientServiceRuntimeForWs(
  service: string,
  runtime: ClientServiceStatus,
): ClientServiceStatus {
  const pluginKey = normalizePluginKey(
    service || runtime.pluginKey || runtime.key,
  );

  if (pluginKey !== "browser-automation") {
    return runtime;
  }

  const details =
    runtime.details && typeof runtime.details === "object"
      ? (runtime.details as Record<string, any>)
      : {};
  const supportedTaskTypes = normalizeWsStringArray(
    details.supportedTaskTypes ?? runtime.supportedTaskTypes,
  );
  const profiles = Array.isArray(details.profiles)
    ? details.profiles
        .map((item: unknown) => sanitizeBrowserAutomationProfileForWs(item))
        .filter((item) => !!item.id)
    : [];
  const instances = Array.isArray(details.instances)
    ? details.instances
        .map((item: unknown) => sanitizeBrowserAutomationInstanceForWs(item))
        .filter((item) => !!item.profileId)
    : [];
  const activeProfile =
    details.activeProfile &&
    typeof details.activeProfile === "object" &&
    !Array.isArray(details.activeProfile)
      ? sanitizeBrowserAutomationProfileForWs(details.activeProfile)
      : null;

  return {
    ...runtime,
    supportedTaskTypes,
    details: {
      autoDispatchEnabled:
        details.autoDispatchEnabled ?? runtime.autoDispatchEnabled ?? true,
      browserConnected: details.browserConnected === true,
      hasInstance: details.hasInstance === true,
      pageCount:
        typeof details.pageCount === "number" ? details.pageCount : null,
      lastActivity: String(details.lastActivity || "").trim() || null,
      connection: sanitizeBrowserAutomationConnectionForWs(details.connection),
      profiles,
      instances,
      activeProfileId: String(details.activeProfileId || "").trim() || null,
      activeProfile,
      currentExecution: sanitizeBrowserAutomationExecutionForWs(
        details.currentExecution,
      ),
    },
  };
}

function buildClientInfoPayloadForWs() {
  const services = Object.entries(clientInfo.services || {}).reduce(
    (result, [serviceKey, runtime]) => {
      if (!runtime || typeof runtime !== "object") {
        return result;
      }

      result[serviceKey] = sanitizeClientServiceRuntimeForWs(
        serviceKey,
        runtime as ClientServiceStatus,
      );
      return result;
    },
    {} as Record<string, ClientServiceStatus>,
  );

  const payload: Record<string, any> = {
    clientId: clientInfo.clientId,
    source: clientInfo.source,
    appVersion: clientInfo.appVersion,
    workspaceDirectory: String(clientInfo.workspaceDirectory || "").trim() || undefined,
    services,
  };

  const machine = sanitizeClientMachineForWs(clientInfo.machine);
  if (machine) {
    payload.machine = machine;
  }

  const location = sanitizeClientLocationForWs(clientInfo.location);
  if (location) {
    payload.location = location;
  }

  const extension = sanitizeClientExtensionForWs(clientInfo.extension);
  if (extension) {
    payload.extension = extension;
  }

  const browser = sanitizeClientBrowserForWs(clientInfo.browser);
  if (browser) {
    payload.browser = browser;
  }

  const os = sanitizeClientOsForWs(clientInfo.os);
  if (os) {
    payload.os = os;
  }

  const platform = sanitizeClientPlatformForWs(clientInfo.platform);
  if (platform) {
    payload.platform = platform;
  }

  const device = sanitizeClientDeviceForWs(clientInfo.device);
  if (device) {
    payload.device = device;
  }

  const user = sanitizeClientUserForWs(clientInfo.user);
  if (user) {
    payload.user = user;
  }

  const psAutomation = sanitizeClientPsAutomationForWs(clientInfo.psAutomation);
  if (psAutomation) {
    payload.psAutomation = psAutomation;
  }

  return {
    ...payload,
  };
}

function stableStringifyForWs(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyForWs(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const source = value as Record<string, any>;
    const keys = Object.keys(source).sort();
    return `{${keys
      .map(
        (key) => `${JSON.stringify(key)}:${stableStringifyForWs(source[key])}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function stripVolatileWsFieldsForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripVolatileWsFieldsForFingerprint(item));
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, any>;
    return Object.keys(source).reduce<Record<string, unknown>>(
      (result, key) => {
        if (WS_FINGERPRINT_VOLATILE_KEYS.has(key)) {
          return result;
        }
        result[key] = stripVolatileWsFieldsForFingerprint(source[key]);
        return result;
      },
      {},
    );
  }

  return value;
}

function buildWsFingerprint(value: unknown) {
  return stableStringifyForWs(stripVolatileWsFieldsForFingerprint(value));
}

function emitTransientWsToast(
  key: string,
  payload: { color: string; icon: string; message: string },
) {
  const now = Date.now();
  const lastEmittedAt = transientWsToastCache.get(key) || 0;
  if (now - lastEmittedAt < WS_TRANSIENT_TOAST_DEBOUNCE_MS) {
    return;
  }
  transientWsToastCache.set(key, now);
  emitter.emit("toast", payload);
}

function mergeBrowserAutomationInstancesWithExecutions(
  instances: Array<Record<string, any>>,
  executionSnapshot: ReturnType<typeof buildBrowserAutomationExecutionSnapshot>,
) {
  const runningExecutionMap = new Map(
    executionSnapshot.items
      .filter((item) => item.running && item.profileId)
      .map((item) => [String(item.profileId || "").trim(), item] as const),
  );

  return instances.map((instance) => {
    const profileId = String(instance?.profileId || instance?.id || "").trim();
    if (!profileId) {
      return instance;
    }

    const runningExecution = runningExecutionMap.get(profileId) || null;
    const connected =
      instance?.connected === true || instance?.isConnected === true;
    const available =
      typeof instance?.available === "boolean" ? instance.available : connected;

    return {
      ...instance,
      connected,
      isConnected: instance?.isConnected === true || connected,
      busy: !!runningExecution,
      available: runningExecution ? false : available,
      currentTaskId:
        runningExecution?.taskId || instance?.currentTaskId || null,
      taskType: runningExecution?.taskType || instance?.taskType || null,
      currentStep:
        runningExecution?.currentStep || instance?.currentStep || null,
      lastError:
        runningExecution?.lastError !== undefined
          ? runningExecution.lastError
          : instance?.lastError || null,
    };
  });
}

function buildBrowserAutomationRuntimePatch(
  payload: Partial<ClientServiceStatus> = {},
): Partial<ClientServiceStatus> {
  const previous: Record<string, any> =
    clientInfo.services?.["browser-automation"] ||
    clientInfo.services?.uploader ||
    {};
  const executionSnapshot = buildBrowserAutomationExecutionSnapshot();
  const previousDetails: Record<string, any> = previous?.details || {};
  const payloadDetails: Record<string, any> = payload.details || {};
  const ecomCollectCapability =
    payloadDetails.ecomCollect && typeof payloadDetails.ecomCollect === "object"
      ? (payloadDetails.ecomCollect as UploaderEcomCollectCapabilitySchema)
      : previousDetails.ecomCollect &&
          typeof previousDetails.ecomCollect === "object"
        ? (previousDetails.ecomCollect as UploaderEcomCollectCapabilitySchema)
        : uploaderEcomCollectCapabilityCache.data;
  const supportedTaskTypes = buildBrowserAutomationSupportedTaskTypes(
    ecomCollectCapability,
  );
  const baseProfiles = Array.isArray(payloadDetails.profiles)
    ? payloadDetails.profiles
    : Array.isArray(previousDetails.profiles)
      ? previousDetails.profiles
      : [];
  const baseInstances = Array.isArray(payloadDetails.instances)
    ? payloadDetails.instances
    : Array.isArray(previousDetails.instances)
      ? previousDetails.instances
      : baseProfiles.length
        ? buildBrowserAutomationProfileInstances(baseProfiles, null)
        : [];
  const mergedInstances = mergeBrowserAutomationInstancesWithExecutions(
    baseInstances,
    executionSnapshot,
  );
  const runningProfileIds = Array.from(
    new Set(
      [
        ...mergedInstances
          .filter((item) => item?.busy)
          .map((item) => String(item?.profileId || "").trim()),
        ...executionSnapshot.items
          .filter((item) => item.running && item.profileId)
          .map((item) => String(item.profileId || "").trim()),
      ].filter(Boolean),
    ),
  );
  const availableProfileIds = mergedInstances.length
    ? mergedInstances
        .filter((item) => item?.available)
        .map((item) => String(item?.profileId || "").trim())
        .filter(Boolean)
    : [
        ...(Array.isArray(payloadDetails.availableProfileIds)
          ? payloadDetails.availableProfileIds
          : []),
        ...(Array.isArray(previousDetails.availableProfileIds)
          ? previousDetails.availableProfileIds
          : []),
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean);
  const hasBusy = Object.prototype.hasOwnProperty.call(payload, "busy");
  const hasState = Object.prototype.hasOwnProperty.call(payload, "state");
  const hasCurrentTaskId = Object.prototype.hasOwnProperty.call(
    payload,
    "currentTaskId",
  );
  const connected = payload.connected ?? previous?.connected ?? false;
  const available = payload.available ?? previous?.available ?? false;
  const busy = executionSnapshot.running
    ? true
    : hasBusy
      ? !!payload.busy
      : false;
  const currentTaskId = executionSnapshot.running
    ? executionSnapshot.taskId ||
      (hasCurrentTaskId
        ? (payload.currentTaskId ?? null)
        : (previous?.currentTaskId ?? null))
    : hasCurrentTaskId
      ? (payload.currentTaskId ?? null)
      : null;
  const state = executionSnapshot.running
    ? "busy"
    : hasState && payload.state
      ? payload.state
      : payload.status === "error"
        ? "error"
        : connected
          ? available
            ? "idle"
            : "offline"
          : "offline";

  return {
    ...payload,
    busy,
    state,
    currentTaskId,
    autoDispatchEnabled: browserAutomationDispatchState.autoDispatchEnabled,
    supportedTaskTypes,
    supportedCommands: Array.from(
      new Set([
        ...(Array.isArray(payload.supportedCommands)
          ? payload.supportedCommands
          : []),
        ...(Array.isArray(previous?.supportedCommands)
          ? previous.supportedCommands
          : []),
        "executePublishTask",
        "ecomCollectRun",
        "ecomSelectionSupplyMatchRun",
        "setAutoDispatch",
      ]),
    ),
    details: {
      ...previousDetails,
      ...payloadDetails,
      autoDispatchEnabled: browserAutomationDispatchState.autoDispatchEnabled,
      supportedTaskTypes,
      executableTaskTypes: buildPublishTaskCapabilitySummary().map(
        (item) => item.taskType,
      ),
      executableTaskLabels: buildPublishTaskCapabilitySummary(),
      currentExecution: executionSnapshot,
      executions: executionSnapshot.items,
      ...(mergedInstances.length ? { instances: mergedInstances } : {}),
      runningProfileIds,
      availableProfileIds,
    },
    lastError:
      payload.lastError !== undefined
        ? payload.lastError
        : browserAutomationExecutionState.lastError ||
          previous?.lastError ||
          null,
  };
}

async function syncUploaderRuntimeFromLocalState(
  payload: Partial<ClientServiceStatus> = {},
) {
  const nextRuntime = updateServiceStatus(
    "uploader",
    buildBrowserAutomationRuntimePatch(payload),
    { emitClientInfo: false },
  );
  await emitServiceRuntime("uploader", nextRuntime);
  return nextRuntime;
}

function buildBrowserAutomationProfileInstances(
  profileItems: Array<Record<string, any>>,
  browserData?: Record<string, any> | null,
) {
  const resolveBrowserPort = (
    source: Record<string, any> | null | undefined,
  ) => {
    const candidates = [
      source?.port,
      source?.debugPort,
      source?.remoteDebuggingPort,
      source?.remoteDebugPort,
    ];

    for (const candidate of candidates) {
      const port = Number(candidate);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    }

    return null;
  };
  const browserInstances = Array.isArray(browserData?.instances)
    ? browserData.instances
    : [];
  const activeConnection =
    browserData?.connection && typeof browserData.connection === "object"
      ? browserData.connection
      : null;
  const activeConnectionProfileId =
    String(
      activeConnection?.activeProfileId || activeConnection?.profileId || "",
    ).trim() || "";
  const browserInstanceMap = new Map(
    browserInstances
      .map((item) => [String(item?.profileId || "").trim(), item] as const)
      .filter(([profileId]) => !!profileId),
  );
  const runningExecutionMap = new Map(
    getBrowserAutomationExecutionEntries()
      .filter((item) => item.running)
      .map((item) => [String(item.profileId || "").trim(), item] as const),
  );

  return profileItems.map((profile) => {
    const profileId = String(profile?.id || "").trim();
    const browserInstance = browserInstanceMap.get(profileId) || null;
    const runningExecution = runningExecutionMap.get(profileId) || null;
    const port =
      resolveBrowserPort(browserInstance) ??
      resolveBrowserPort(profile) ??
      (activeConnectionProfileId && activeConnectionProfileId === profileId
        ? resolveBrowserPort(activeConnection)
        : null);

    return {
      profileId,
      profileName: String(profile?.name || profileId).trim() || profileId,
      port,
      connected: !!browserInstance?.isConnected,
      available: !!browserInstance?.isConnected && !runningExecution,
      busy: !!runningExecution,
      currentTaskId: runningExecution?.taskId || null,
      taskType: runningExecution?.taskType || null,
      currentStep: runningExecution?.currentStep || null,
      pageCount: browserInstance?.pageCount ?? 0,
      lastActivity: browserInstance?.lastActivity ?? null,
      pages: Array.isArray(browserInstance?.pages) ? browserInstance.pages : [],
      browserVersion:
        String(
          browserInstance?.browserVersion || profile?.browserVersion || "",
        ).trim() || "",
      hasInstance: browserInstance?.hasInstance === true,
      connecting: browserInstance?.connecting === true,
      lastError:
        runningExecution?.lastError || browserInstance?.lastError || null,
      userDataDir:
        String(
          browserInstance?.userDataDir || profile?.userDataDir || "",
        ).trim() || null,
      isActiveProfile: profile?.isActive === true,
    };
  });
}

async function emitPublishTaskRuntime(snapshot: PublishTaskRuntimeSnapshot) {
  const channelSnapshot: PublishTaskRuntimeSnapshot = {
    ...snapshot,
    // 运行日志通过既有任务数据落库链路同步，避免在执行中反复通过 ws 发送大包导致通道抖动。
    runtime: undefined,
  };
  const now = new Date().toISOString();
  const currentStatus =
    channelSnapshot.status === "pending" ? "pending" : channelSnapshot.status;
  const running = currentStatus === "assigned" || currentStatus === "running";
  const slotKey = resolveBrowserAutomationExecutionSlotKey(
    channelSnapshot.profileId,
    channelSnapshot.taskType,
  );
  const previousSlot = browserAutomationExecutionSlots[slotKey];
  upsertBrowserAutomationExecutionSlot(slotKey, {
    slotKey,
    running,
    taskId: channelSnapshot.taskId,
    taskType: channelSnapshot.taskType,
    queue: channelSnapshot.queue,
    profileId: String(channelSnapshot.profileId || "").trim() || null,
    currentStep: channelSnapshot.currentStep ?? channelSnapshot.message ?? null,
    progress: channelSnapshot.progress ?? null,
    lastError: channelSnapshot.error ?? null,
    runtime: null,
    startedAt: running
      ? previousSlot?.startedAt || now
      : previousSlot?.startedAt || now,
    finishedAt: running ? null : now,
    updatedAt: now,
  });

  emitter.emit("publishTaskRuntime", channelSnapshot);
  socket?.emit("publish-task-runtime", channelSnapshot);
  await syncUploaderRuntimeFromLocalState({
    busy: browserAutomationExecutionState.running,
    state: browserAutomationExecutionState.running ? "busy" : undefined,
    currentTaskId: browserAutomationExecutionState.running
      ? browserAutomationExecutionState.taskId
      : null,
    lastError: browserAutomationExecutionState.lastError,
  });
}

async function uploadEcomSnapshotsToCos(
  command: ServiceCommandEnvelope,
  snapshots: Array<Record<string, any>>,
  category = "ecom-collect",
) {
  const apiBridge = window.api as any;
  if (!apiBridge?.generateCosKey || !apiBridge?.uploadFileToCos) {
    return snapshots;
  }

  const userId = String(command.tenant?.userId || "").trim() || undefined;
  const account = String(command.tenant?.account || "").trim() || undefined;
  const entityId =
    String(command.payload?.runId || command.payload?.taskId || "").trim() ||
    undefined;

  const uploadedSnapshots: Array<Record<string, any>> = [];
  for (const snapshot of snapshots) {
    const localPath = String(snapshot?.path || "").trim();
    if (!localPath) {
      uploadedSnapshots.push(snapshot);
      continue;
    }

    try {
      const filename =
        localPath
          .split(/[/\\\\]/)
          .filter(Boolean)
          .pop() || `snapshot-${Date.now()}.png`;
      const keyResult = await apiBridge.generateCosKey({
        category,
        filename,
        account,
        userId,
        entityId,
      });
      if (!keyResult?.ok || !keyResult?.key) {
        throw new Error(keyResult?.msg || "生成 COS Key 失败");
      }

      const key = keyResult.key;
      const uploadResult = await apiBridge.uploadFileToCos({
        filePath: localPath,
        key,
      });

      uploadedSnapshots.push({
        ...snapshot,
        url: uploadResult?.url || null,
        key: uploadResult?.key || key || null,
        uploaded: !!uploadResult?.ok,
        uploadError:
          uploadResult?.ok === false
            ? uploadResult?.msg || "COS 上传失败"
            : null,
      });
    } catch (error) {
      uploadedSnapshots.push({
        ...snapshot,
        uploaded: false,
        uploadError: serializeError(error),
      });
    }
  }

  return uploadedSnapshots;
}

function mergeUploadedSnapshotsIntoValue(
  value: unknown,
  uploadedSnapshotMap: Map<string, Record<string, any>>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      mergeUploadedSnapshotsIntoValue(item, uploadedSnapshotMap),
    );
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, any>;
  const localPath = String(source.path || "").trim();
  const nextValue =
    localPath && uploadedSnapshotMap.has(localPath)
      ? {
          ...source,
          ...uploadedSnapshotMap.get(localPath),
        }
      : {
          ...source,
        };

  Object.keys(nextValue).forEach((key) => {
    const current = nextValue[key];
    if (current && typeof current === "object") {
      nextValue[key] = mergeUploadedSnapshotsIntoValue(
        current,
        uploadedSnapshotMap,
      );
    }
  });

  return nextValue;
}

async function executeEcomCollectCommand(command: ServiceCommandEnvelope) {
  const runId = String(command.payload?.runId || "").trim();
  const taskId = String(command.payload?.taskId || "").trim();
  const platform = String(command.payload?.platform || "").trim();
  const taskType = String(command.payload?.taskType || "").trim();
  const profileId = String(command.payload?.profileId || "").trim() || null;
  const timeoutMs = Number(command.payload?.timeoutMs) || 20 * 60 * 1000;
  const taskLabel = taskType || platform;
  const runtimeTaskType = taskType || platform || "ecom-collect";

  if (!runId) {
    throw new Error("缺少 runId");
  }
  if (!platform && !taskType) {
    throw new Error("缺少 platform/taskType");
  }
  if (!taskType && !platform) {
    throw new Error("缺少 platform");
  }

  const now = new Date().toISOString();
  updateBrowserAutomationCommandExecution({
    running: true,
    taskId: runId,
    taskType: runtimeTaskType,
    queue: taskLabel,
    profileId,
    currentStep: `执行电商采集：${taskLabel || platform}`,
    progress: null,
    lastError: null,
    runtime: {
      runId,
      taskId,
      platform,
      taskType,
      profileId,
    },
    updatedAt: now,
  });

  await syncUploaderRuntimeFromLocalState({
    busy: true,
    state: "busy",
    currentTaskId: runId,
    lastError: null,
  });

  const workspaceDir =
    typeof (window.api as any)?.getWorkspaceDirectory === "function"
      ? String((await (window.api as any).getWorkspaceDirectory()) || "").trim()
      : "";

  const response = await runUploaderEcomCollect({
    runId,
    taskId,
    platform,
    taskType,
    workspaceDir,
    timeoutMs,
    configData:
      command.payload?.configData &&
      typeof command.payload.configData === "object"
        ? command.payload.configData
        : {},
  });

  const uploadedSnapshots = await uploadEcomSnapshotsToCos(
    command,
    Array.isArray(response.data?.snapshots) ? response.data.snapshots : [],
    "ecom-collect",
  );
  const uploadedSnapshotMap = new Map(
    uploadedSnapshots
      .map((item) => [String(item?.path || "").trim(), item] as const)
      .filter(([path]) => !!path),
  );
  const uploadedRecords = Array.isArray(response.data?.records)
    ? response.data.records.map((item) =>
        mergeUploadedSnapshotsIntoValue(item, uploadedSnapshotMap),
      )
    : [];

  const finishedAt = new Date().toISOString();
  updateBrowserAutomationCommandExecution({
    running: false,
    taskId: runId,
    taskType: runtimeTaskType,
    queue: taskLabel,
    profileId,
    currentStep: response.success ? "电商采集完成" : "电商采集失败",
    progress: response.success ? 100 : null,
    lastError: response.success ? null : response.message || "电商采集失败",
    runtime: {
      runId,
      taskId,
      platform,
      taskType,
      profileId,
      status: response.status || (response.success ? "success" : "failed"),
      summary: response.data?.summary || null,
    },
    updatedAt: finishedAt,
  });

  await syncUploaderRuntimeFromLocalState({
    busy: false,
    state: undefined,
    currentTaskId: null,
    lastError: response.success ? null : response.message || "电商采集失败",
  });

  return {
    success: response.success,
    message:
      response.message || (response.success ? "电商采集完成" : "电商采集失败"),
    data: {
      ...(response.data || {}),
      records: uploadedRecords,
      runId,
      taskId,
      platform,
      taskType,
      status: response.status || (response.success ? "success" : "failed"),
      snapshots: uploadedSnapshots,
    },
  };
}

async function executeEcomSelectionSupplyMatchCommand(
  command: ServiceCommandEnvelope,
) {
  const runId = String(command.payload?.runId || "").trim();
  const taskId = String(command.payload?.taskId || "").trim();
  const profileId = String(command.payload?.profileId || "").trim() || null;
  const matchType = String(command.payload?.matchType || "supply_match").trim();
  const timeoutMs = Number(command.payload?.timeoutMs) || 30 * 60 * 1000;
  const sourceProducts = Array.isArray(command.payload?.sourceProducts)
    ? command.payload.sourceProducts
    : [];
  const optionsData =
    command.payload?.optionsData &&
    typeof command.payload.optionsData === "object"
      ? command.payload.optionsData
      : {};
  const supplierPlatforms = Array.isArray(optionsData?.supplierPlatforms)
    ? optionsData.supplierPlatforms
    : [];

  if (!runId) {
    throw new Error("缺少 runId");
  }
  if (!sourceProducts.length) {
    throw new Error("缺少 sourceProducts");
  }

  const queueLabel = supplierPlatforms.length
    ? supplierPlatforms.join(",")
    : "supply-match";
  const now = new Date().toISOString();
  updateBrowserAutomationCommandExecution({
    running: true,
    taskId: runId,
    taskType: "ecom-selection-supply-match",
    queue: queueLabel,
    profileId,
    currentStep: `执行找同款：${queueLabel}`,
    progress: null,
    lastError: null,
    runtime: {
      runId,
      taskId,
      matchType,
      profileId,
      supplierPlatforms,
      sourceCount: sourceProducts.length,
    },
    updatedAt: now,
  });

  await syncUploaderRuntimeFromLocalState({
    busy: true,
    state: "busy",
    currentTaskId: runId,
    lastError: null,
  });

  const workspaceDir =
    typeof (window.api as any)?.getWorkspaceDirectory === "function"
      ? String((await (window.api as any).getWorkspaceDirectory()) || "").trim()
      : "";

  try {
    const response = await executeEcomSelectionSupplyMatchTask({
      runId,
      taskId,
      matchType,
      sourceProducts,
      sourceSummary:
        command.payload?.sourceSummary &&
        typeof command.payload.sourceSummary === "object"
          ? command.payload.sourceSummary
          : null,
      optionsData,
      timeoutMs,
      workspaceDir,
      runCollect: runUploaderEcomCollect,
    });

    const uploadedSnapshots = await uploadEcomSnapshotsToCos(
      command,
      Array.isArray(response.data?.snapshots) ? response.data.snapshots : [],
      "ecom-selection-supply-match",
    );
    const uploadedSnapshotMap = new Map(
      uploadedSnapshots
        .map((item) => [String(item?.path || "").trim(), item] as const)
        .filter(([path]) => !!path),
    );
    const uploadedMatchedItems = Array.isArray(response.data?.matchedItems)
      ? response.data.matchedItems.map((item) =>
          mergeUploadedSnapshotsIntoValue(item, uploadedSnapshotMap),
        )
      : [];

    const finishedAt = new Date().toISOString();
    updateBrowserAutomationCommandExecution({
      running: false,
      taskId: runId,
      taskType: "ecom-selection-supply-match",
      queue: queueLabel,
      profileId,
      currentStep: response.success ? "找同款完成" : "找同款失败",
      progress: response.success ? 100 : null,
      lastError: response.success ? null : response.message || "找同款失败",
      runtime: {
        runId,
        taskId,
        matchType,
        profileId,
        supplierPlatforms,
        status: response.status || (response.success ? "success" : "failed"),
        summary: response.data?.summary || null,
      },
      updatedAt: finishedAt,
    });

    await syncUploaderRuntimeFromLocalState({
      busy: false,
      state: undefined,
      currentTaskId: null,
      lastError: response.success ? null : response.message || "找同款失败",
    });

    return {
      success: response.success,
      message:
        response.message || (response.success ? "找同款完成" : "找同款失败"),
      data: {
        ...(response.data || {}),
        matchedItems: uploadedMatchedItems,
        runId,
        taskId,
        matchType,
        status: response.status || (response.success ? "success" : "failed"),
        snapshots: uploadedSnapshots,
      },
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const errorMessage = serializeError(error);

    updateBrowserAutomationCommandExecution({
      running: false,
      taskId: runId,
      taskType: "ecom-selection-supply-match",
      queue: queueLabel,
      profileId,
      currentStep: "找同款失败",
      progress: null,
      lastError: errorMessage,
      runtime: {
        runId,
        taskId,
        matchType,
        profileId,
        supplierPlatforms,
        status: "failed",
      },
      updatedAt: finishedAt,
    });

    await syncUploaderRuntimeFromLocalState({
      busy: false,
      state: undefined,
      currentTaskId: null,
      lastError: errorMessage,
    });

    return {
      success: false,
      message: errorMessage,
      data: {
        runId,
        taskId,
        matchType,
        status: "failed",
      },
    };
  }
}

async function fetchNetworkProfile(force = false) {
  if (typeof fetch === "undefined") {
    return;
  }
  const lastFetched = networkProfile.fetchedAt
    ? Date.parse(networkProfile.fetchedAt)
    : 0;
  if (!force && lastFetched && Date.now() - lastFetched < NETWORK_CACHE_TTL) {
    return;
  }
  if (networkFetchPromise) {
    return networkFetchPromise;
  }

  networkFetchPromise = (async () => {
    try {
      const response = await fetch(LOCATION_ENDPOINT, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const patch: NetworkProfile = {
        ip: data.ip,
        city: data.city,
        region: data.region,
        country: data.country_name || data.country,
        org: data.org,
        timezone: data.timezone,
        fetchedAt: new Date().toISOString(),
        source: "ipapi.co",
      };
      Object.assign(networkProfile, patch);
      if (socket?.connected) {
        emitClientInfo();
      }
      emitter.emit("log", {
        level: "info",
        message: `[ws] 网络信息刷新: ${patch.ip || "unknown"}`,
      });
    } catch (error) {
      emitter.emit("log", {
        level: "warn",
        message: `[ws] 获取网络信息失败: ${serializeError(error)}`,
      });
    } finally {
      networkFetchPromise = null;
    }
  })();

  await networkFetchPromise;
}

function updateState(patch: Partial<WsState>) {
  Object.assign(wsState, patch);
  emitter.emit("log", {
    level: "info",
    message: `[ws] state updated ${JSON.stringify(patch)}`,
  });
}

function registerLocalService(handler: LocalServiceHandler) {
  const pluginKey = normalizePluginKey(handler.pluginKey || handler.key);
  localServiceHandlers.set(pluginKey, {
    ...handler,
    key: pluginKey,
    pluginKey,
    channel: handler.channel || "client-bridge",
  });
}

async function emitServiceRuntime(
  service: string,
  runtime: ClientServiceStatus,
) {
  const pluginKey = normalizePluginKey(service);
  const legacyServiceKey = getLegacyServiceKey(pluginKey);
  const normalizedRuntime = sanitizeClientServiceRuntimeForWs(pluginKey, {
    ...runtime,
    key: pluginKey,
    pluginKey,
  });
  emitter.emit("serviceRuntime", {
    service: legacyServiceKey,
    pluginKey,
    runtime: normalizedRuntime,
  });
  if (!socket?.connected) {
    return;
  }
  const now = Date.now();
  const fingerprint = buildWsFingerprint(normalizedRuntime);
  const previousEmit = lastServiceRuntimeEmitCache.get(pluginKey);
  if (
    previousEmit &&
    previousEmit.fingerprint === fingerprint &&
    now - previousEmit.emittedAt < WS_SERVICE_RUNTIME_REFRESH_MS
  ) {
    return;
  }
  socket.emit("service-runtime", {
    service: legacyServiceKey,
    pluginKey,
    runtime: normalizedRuntime,
  });
  lastServiceRuntimeEmitCache.set(pluginKey, {
    fingerprint,
    emittedAt: now,
  });
}

async function syncServiceRuntime(serviceKey: string) {
  const pluginKey = normalizePluginKey(serviceKey);
  const handler = localServiceHandlers.get(pluginKey);
  if (!handler?.getRuntime) {
    return null;
  }

  try {
    const runtimePatch = await handler.getRuntime();
    const nextRuntime = updateServiceStatus(pluginKey, runtimePatch, {
      emitClientInfo: false,
    });
    await emitServiceRuntime(pluginKey, nextRuntime);
    return nextRuntime;
  } catch (error) {
    const failedRuntime = updateServiceStatus(
      pluginKey,
      {
        label: handler.label,
        connected: false,
        available: false,
        status: "error",
        state: "error",
        busy: false,
        message: serializeError(error),
        lastError: serializeError(error),
        supportedCommands: clientInfo.services?.[pluginKey]
          ?.supportedCommands || ["refreshRuntime"],
      },
      { emitClientInfo: false },
    );
    await emitServiceRuntime(pluginKey, failedRuntime);
    return failedRuntime;
  }
}

let uploaderRuntimeSyncPromise: Promise<Partial<ClientServiceStatus> | null> | null =
  null;

function queueUploaderRuntimeSync() {
  if (uploaderRuntimeSyncPromise) {
    return uploaderRuntimeSyncPromise;
  }

  uploaderRuntimeSyncPromise = syncServiceRuntime("uploader").finally(() => {
    uploaderRuntimeSyncPromise = null;
  });
  return uploaderRuntimeSyncPromise;
}

async function fetchRemotionJson(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
) {
  const { timeoutMs = REMOTION_REQUEST_TIMEOUT_MS, ...requestInit } =
    init || {};
  const nativeApi = getNativeApi() as any;
  if (!nativeApi) {
    throw new Error("当前环境未注入桌面端 video-template 能力");
  }

  const bodyPayload =
    typeof requestInit.body === "string" && requestInit.body.trim()
      ? JSON.parse(requestInit.body)
      : requestInit.body && typeof requestInit.body === "object"
        ? requestInit.body
        : {};

  const action = async () => {
    if (path === "/api/health") {
      return nativeApi.getVideoTemplateStatus?.();
    }
    if (path === "/api/templates") {
      return nativeApi.getVideoTemplateCatalog?.();
    }
    if (path === "/api/renders") {
      if (String(requestInit.method || "GET").toUpperCase() === "POST") {
        return nativeApi.enqueueVideoTemplateRender?.(bodyPayload || {});
      }
      return nativeApi.listVideoTemplateRenders?.();
    }
    if (path.startsWith("/api/renders/")) {
      const jobId = decodeURIComponent(path.replace("/api/renders/", "").trim());
      if (!jobId) {
        throw new Error("缺少 jobId");
      }
      if (String(requestInit.method || "GET").toUpperCase() === "DELETE") {
        return nativeApi.cancelVideoTemplateRender?.(jobId);
      }
      return nativeApi.getVideoTemplateRender?.(jobId);
    }

    throw new Error(`未实现的 video-template 路径: ${path}`);
  };

  try {
    const result = await Promise.race([
      action(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Video Template 心跳超时 (${timeoutMs}ms)`)),
          timeoutMs,
        ),
      ),
    ]);
    return result;
  } catch (error: any) {
    throw error;
  }
}

async function getCachedRemotionTemplates(force = false) {
  const now = Date.now();
  if (
    !force &&
    remotionTemplateCache.items.length > 0 &&
    now - remotionTemplateCache.lastFetchedAt < REMOTION_TEMPLATE_CACHE_TTL_MS
  ) {
    return remotionTemplateCache.items;
  }

  const templatesRes = await fetchRemotionJson("/api/templates", {
    timeoutMs: REMOTION_TEMPLATE_REQUEST_TIMEOUT_MS,
  });
  const templates = Array.isArray(templatesRes?.templates)
    ? templatesRes.templates
    : Array.isArray(templatesRes?.data)
    ? templatesRes.data
    : Array.isArray(templatesRes)
      ? templatesRes
      : [];

  remotionTemplateCache.items = templates;
  remotionTemplateCache.lastFetchedAt = now;

  return remotionTemplateCache.items;
}

function normalizeRemotionQueueJobStatus(status: unknown) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return "queued";
  }
  if (normalized === "in-progress" || normalized === "processing") {
    return "in-progress";
  }
  if (normalized === "completed" || normalized === "success") {
    return "completed";
  }
  if (normalized === "failed" || normalized === "error") {
    return "failed";
  }
  if (normalized === "queued" || normalized === "pending") {
    return "queued";
  }
  return normalized;
}

function normalizeRemotionQueueJob(job: any) {
  const numericProgress = Number(job?.progress);

  return {
    id: String(job?.id || job?.jobId || "").trim(),
    status: normalizeRemotionQueueJobStatus(job?.status),
    progress: Number.isFinite(numericProgress)
      ? Math.max(0, Math.min(1, numericProgress))
      : null,
    stage: String(job?.stage || "").trim() || null,
    message: String(job?.message || "").trim() || null,
    createdAt:
      typeof job?.createdAt === "number" ? Number(job.createdAt) : null,
    startedAt:
      typeof job?.startedAt === "number" ? Number(job.startedAt) : null,
    completedAt:
      typeof job?.completedAt === "number" ? Number(job.completedAt) : null,
    updatedAt:
      typeof job?.updatedAt === "number" ? Number(job.updatedAt) : null,
    lastHeartbeatAt:
      typeof job?.lastHeartbeatAt === "number"
        ? Number(job.lastHeartbeatAt)
        : null,
    elapsedMs:
      typeof job?.elapsedMs === "number" ? Number(job.elapsedMs) : null,
    videoUrl: String(job?.videoUrl || "").trim() || null,
    localPath: String(job?.localPath || "").trim() || null,
    data:
      job?.data && typeof job.data === "object" && !Array.isArray(job.data)
        ? job.data
        : {},
  };
}

function toRemotionIsoTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }

  const normalized = String(value || "").trim();
  return normalized || null;
}

function resolveRemotionResponseMessage(
  payload: Record<string, any> | null | undefined,
  fallbackMessage: string,
) {
  const candidates = [
    payload?.message,
    payload?.error,
    payload?.error?.message,
    payload?.data?.message,
    payload?.data?.error,
    payload?.data?.error?.message,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return fallbackMessage;
}

function ensureRemotionResponseOk(
  payload: Record<string, any> | null | undefined,
  fallbackMessage: string,
) {
  if (payload?.success === false) {
    throw new Error(resolveRemotionResponseMessage(payload, fallbackMessage));
  }

  return payload;
}

async function getRemotionQueueSnapshot(targetJobId?: string | null) {
  const response = ensureRemotionResponseOk(
    await fetchRemotionJson("/api/renders", {
      timeoutMs: REMOTION_HEALTH_TIMEOUT_MS,
    }),
    "获取本地视频渲染队列失败",
  );
  const jobList = Array.isArray(response?.data)
    ? response.data
    : Array.isArray(response)
      ? response
      : [];
  const jobs = jobList
    .map((job: any) => normalizeRemotionQueueJob(job))
    .filter((job: ReturnType<typeof normalizeRemotionQueueJob>) => !!job.id);

  const activeJobs = jobs
    .filter((job) => job.status === "queued" || job.status === "in-progress")
    .sort((left, right) => {
      const leftPriority = left.status === "in-progress" ? 0 : 1;
      const rightPriority = right.status === "in-progress" ? 0 : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      const leftTimestamp =
        left.status === "in-progress"
          ? left.startedAt ?? left.createdAt ?? 0
          : left.createdAt ?? 0;
      const rightTimestamp =
        right.status === "in-progress"
          ? right.startedAt ?? right.createdAt ?? 0
          : right.createdAt ?? 0;

      return leftTimestamp - rightTimestamp;
    });

  const normalizedTargetJobId = String(targetJobId || "").trim();
  const targetIndex = normalizedTargetJobId
    ? activeJobs.findIndex((job) => job.id === normalizedTargetJobId)
    : -1;

  return {
    jobs,
    activeJobs,
    activeJobsCount: activeJobs.length,
    queuedJobsCount: activeJobs.filter((job) => job.status === "queued").length,
    processingJobsCount: activeJobs.filter(
      (job) => job.status === "in-progress",
    ).length,
    currentJob: activeJobs.find((job) => job.status === "in-progress") || null,
    currentJobId:
      activeJobs.find((job) => job.status === "in-progress")?.id || null,
    targetJob: targetIndex >= 0 ? activeJobs[targetIndex] : null,
    queuePosition: targetIndex >= 0 ? targetIndex + 1 : null,
    queueAheadCount: targetIndex >= 0 ? targetIndex : null,
  };
}

function buildRemotionQueuePayload(
  snapshot:
    | Awaited<ReturnType<typeof getRemotionQueueSnapshot>>
    | null
    | undefined,
  fallbackJob?: any,
) {
  const targetJob =
    snapshot?.targetJob || (fallbackJob ? normalizeRemotionQueueJob(fallbackJob) : null);

  return {
    queueStatus: targetJob?.status || null,
    queuePosition:
      typeof snapshot?.queuePosition === "number" ? snapshot.queuePosition : null,
    queueAheadCount:
      typeof snapshot?.queueAheadCount === "number"
        ? snapshot.queueAheadCount
        : null,
    queueActiveCount:
      typeof snapshot?.activeJobsCount === "number"
        ? snapshot.activeJobsCount
        : null,
    queueQueuedCount:
      typeof snapshot?.queuedJobsCount === "number"
        ? snapshot.queuedJobsCount
        : null,
    queueProcessingCount:
      typeof snapshot?.processingJobsCount === "number"
        ? snapshot.processingJobsCount
        : null,
    localJobStatus: targetJob?.status || null,
    localJobStage: targetJob?.stage || null,
    localJobMessage: targetJob?.message || null,
    createdAt: toRemotionIsoTimestamp(targetJob?.createdAt),
    startedAt: toRemotionIsoTimestamp(targetJob?.startedAt),
    completedAt: toRemotionIsoTimestamp(targetJob?.completedAt),
    lastHeartbeatAt: toRemotionIsoTimestamp(targetJob?.lastHeartbeatAt),
    updatedAt: toRemotionIsoTimestamp(targetJob?.updatedAt),
    elapsedMs:
      typeof targetJob?.elapsedMs === "number" ? targetJob.elapsedMs : null,
  };
}

function buildRemotionQueuedMessage(
  snapshot:
    | Awaited<ReturnType<typeof getRemotionQueueSnapshot>>
    | null
    | undefined,
) {
  const aheadCount = Number(snapshot?.queueAheadCount);
  if (Number.isFinite(aheadCount)) {
    if (aheadCount <= 0) {
      return "排队中，即将开始";
    }
    return `排队中，前方 ${aheadCount} 个任务`;
  }

  return "排队中";
}

function getRemotionPayloadMetaValue(
  payload: Record<string, any>,
  key: string,
) {
  if (Object.prototype.hasOwnProperty.call(payload, key)) {
    return payload[key];
  }

  const responseData =
    payload.responseData &&
    typeof payload.responseData === "object" &&
    !Array.isArray(payload.responseData)
      ? payload.responseData
      : null;

  return responseData && Object.prototype.hasOwnProperty.call(responseData, key)
    ? responseData[key]
    : null;
}

async function getRemotionRuntime() {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const previousRuntime = clientInfo.services?.["video-template"];
  const previousDetails =
    previousRuntime?.details && typeof previousRuntime.details === "object"
      ? (previousRuntime.details as Record<string, any>)
      : {};

  try {
    const health = await fetchRemotionJson("/api/health", {
      timeoutMs: REMOTION_HEALTH_TIMEOUT_MS,
    });
    const healthPayload = (health?.data || health || null) as Record<
      string,
      any
    > | null;

    if (
      health?.success === false ||
      (healthPayload &&
        typeof healthPayload === "object" &&
        "status" in healthPayload &&
        healthPayload.status !== "ok")
    ) {
      throw new Error(
        resolveRemotionResponseMessage(
          healthPayload || health,
          "Video Template 健康检查返回异常",
        ),
      );
    }

    const templateCount = Number(
      healthPayload?.templateCount ??
        previousDetails.templateCount ??
        remotionTemplateCache.items.length,
    );
    const previousTemplates = Array.isArray(previousDetails.templates)
      ? previousDetails.templates
      : remotionTemplateCache.items;
    const shouldRefreshTemplates =
      !previousTemplates.length ||
      (Number.isFinite(templateCount) &&
        templateCount >= 0 &&
        templateCount !== previousTemplates.length);
    const templates = await getCachedRemotionTemplates(
      shouldRefreshTemplates,
    ).catch(() => previousTemplates);
    const queueSnapshot = await getRemotionQueueSnapshot().catch(() => null);
    const heartbeatLatencyMs = Date.now() - startedAt;
    const activeJobsCount =
      typeof queueSnapshot?.activeJobsCount === "number"
        ? queueSnapshot.activeJobsCount
        : 0;
    const queuedJobsCount =
      typeof queueSnapshot?.queuedJobsCount === "number"
        ? queueSnapshot.queuedJobsCount
        : 0;
    const processingJobsCount =
      typeof queueSnapshot?.processingJobsCount === "number"
        ? queueSnapshot.processingJobsCount
        : 0;
    const currentExecution =
      queueSnapshot?.currentJob || queueSnapshot?.activeJobs?.[0] || null;
    const isBusy = activeJobsCount > 0;

    return {
      label: "Video Template 视频引擎",
      connected: true,
      available: true,
      status: "connected" as const,
      state: isBusy ? ("busy" as const) : ("idle" as const),
      busy: isBusy,
      message: "服务可用",
      endpoint: REMOTION_LOCAL_BASE,
      lastCheckedAt: checkedAt,
      lastError: null,
      currentTaskId: currentExecution?.id || null,
      supportedCommands: ["refreshRuntime", "health", "enqueueRender"],
      details: {
        templates,
        health: healthPayload,
        processStatus: "embedded",
        serviceHealthy: true,
        heartbeatLatencyMs,
        lastHeartbeatAt: checkedAt,
        templateCount: Number.isFinite(templateCount)
          ? templateCount
          : templates.length,
        queueCount: activeJobsCount,
        activeJobsCount,
        queuedJobsCount,
        processingJobsCount,
        currentExecution: currentExecution
          ? {
              running: currentExecution.status === "in-progress",
              jobId: currentExecution.id,
              templateId: currentExecution.data?.templateId || null,
              progress:
                typeof currentExecution.progress === "number"
                  ? Math.round(currentExecution.progress * 100)
                  : null,
              createdAt: toRemotionIsoTimestamp(currentExecution.createdAt),
              startedAt: toRemotionIsoTimestamp(currentExecution.startedAt),
              elapsedMs:
                typeof currentExecution.elapsedMs === "number"
                  ? currentExecution.elapsedMs
                  : null,
            }
          : {
              running: false,
            },
      },
    };
  } catch (error) {
    const errorMessage = serializeError(error);

    return {
      label: "Video Template 视频引擎",
      connected: false,
      available: false,
      status: "error" as const,
      state: "error" as const,
      busy: false,
      message: errorMessage,
      endpoint: REMOTION_LOCAL_BASE,
      lastCheckedAt: checkedAt,
      lastError: errorMessage,
      supportedCommands: ["refreshRuntime", "health", "enqueueRender"],
      details: {
        templates: Array.isArray(previousDetails.templates)
          ? previousDetails.templates
          : remotionTemplateCache.items,
        processStatus: "embedded",
        serviceHealthy: false,
        lastHeartbeatAt: checkedAt,
        heartbeatError: errorMessage,
      },
    };
  }
}

async function reportRemotionRecordStatus(
  recordId: string,
  payload: Record<string, any>,
) {
  const token = await getTokenFromClient();
  const response = await fetch(
    `${getRemoteApiBase()}/remotion-video-record/${encodeURIComponent(recordId)}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(
      String(json?.message || json?.msg || `状态回传失败: ${response.status}`),
    );
  }

  return response.json().catch(() => null);
}

function normalizeRemotionRecordProgress(progress: unknown) {
  const numericValue = Number(progress);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(numericValue)));
}

function buildRemotionRecordRealtimePayload(
  recordId: string,
  payload: Record<string, any>,
) {
  return {
    recordId,
    status: payload.status || "processing",
    progress: normalizeRemotionRecordProgress(payload.progress),
    message: payload.message || "",
    errorMessage: payload.errorMessage || null,
    remotionJobId: payload.remotionJobId || null,
    remotionVideoUrl: payload.remotionVideoUrl || null,
    resultUrl: payload.resultUrl || null,
    url: payload.url || null,
    queueStatus: getRemotionPayloadMetaValue(payload, "queueStatus"),
    queuePosition: getRemotionPayloadMetaValue(payload, "queuePosition"),
    queueAheadCount: getRemotionPayloadMetaValue(payload, "queueAheadCount"),
    queueActiveCount: getRemotionPayloadMetaValue(payload, "queueActiveCount"),
    queueQueuedCount: getRemotionPayloadMetaValue(payload, "queueQueuedCount"),
    queueProcessingCount: getRemotionPayloadMetaValue(
      payload,
      "queueProcessingCount",
    ),
    localJobStatus: getRemotionPayloadMetaValue(payload, "localJobStatus"),
    localJobStage: getRemotionPayloadMetaValue(payload, "localJobStage"),
    localJobMessage: getRemotionPayloadMetaValue(payload, "localJobMessage"),
    createdAt: getRemotionPayloadMetaValue(payload, "createdAt"),
    startedAt: getRemotionPayloadMetaValue(payload, "startedAt"),
    completedAt: getRemotionPayloadMetaValue(payload, "completedAt"),
    lastHeartbeatAt: getRemotionPayloadMetaValue(payload, "lastHeartbeatAt"),
    elapsedMs: getRemotionPayloadMetaValue(payload, "elapsedMs"),
    reportedAt: new Date().toISOString(),
  };
}

function shouldPersistRemotionRecordStatus(
  recordId: string,
  payload: Record<string, any>,
) {
  const normalizedStatus = String(payload.status || "")
    .trim()
    .toLowerCase();
  if (!normalizedStatus) {
    return false;
  }

  if (normalizedStatus === "success" || normalizedStatus === "failed") {
    return true;
  }

  const cacheEntry = remotionRecordRuntimeCache.get(recordId);
  if (!cacheEntry) {
    return true;
  }

  const currentFingerprint = buildWsFingerprint({
    status: normalizedStatus,
    progress: normalizeRemotionRecordProgress(payload.progress),
    message: payload.message || null,
    remotionJobId: payload.remotionJobId || null,
    remotionVideoUrl: payload.remotionVideoUrl || null,
    resultUrl: payload.resultUrl || null,
    url: payload.url || null,
    queueStatus: getRemotionPayloadMetaValue(payload, "queueStatus"),
    queuePosition: getRemotionPayloadMetaValue(payload, "queuePosition"),
    queueAheadCount: getRemotionPayloadMetaValue(payload, "queueAheadCount"),
    queueActiveCount: getRemotionPayloadMetaValue(payload, "queueActiveCount"),
    queueQueuedCount: getRemotionPayloadMetaValue(payload, "queueQueuedCount"),
    queueProcessingCount: getRemotionPayloadMetaValue(
      payload,
      "queueProcessingCount",
    ),
    localJobStage: getRemotionPayloadMetaValue(payload, "localJobStage"),
    localJobMessage: getRemotionPayloadMetaValue(payload, "localJobMessage"),
  });

  if (currentFingerprint === cacheEntry.lastPersistedFingerprint) {
    return false;
  }

  if (normalizedStatus !== cacheEntry.lastPersistedStatus) {
    return true;
  }

  const currentProgress = normalizeRemotionRecordProgress(payload.progress);
  if (
    currentProgress !== null &&
    cacheEntry.lastPersistedProgress !== null &&
    currentProgress - cacheEntry.lastPersistedProgress >=
      REMOTION_RECORD_PROGRESS_PERSIST_STEP
  ) {
    return true;
  }

  return (
    Date.now() - cacheEntry.lastPersistedAt >=
    REMOTION_RECORD_PROGRESS_PERSIST_INTERVAL_MS
  );
}

async function syncRemotionRecordStatus(
  recordId: string,
  payload: Record<string, any>,
  options?: {
    persist?: "always" | "auto" | "never";
  },
) {
  const persistMode = options?.persist || "auto";
  const normalizedProgress = normalizeRemotionRecordProgress(payload.progress);
  const realtimePayload = buildRemotionRecordRealtimePayload(recordId, payload);
  const eventFingerprint = buildWsFingerprint(realtimePayload);
  const cacheEntry = remotionRecordRuntimeCache.get(recordId) || {
    lastEventFingerprint: "",
    lastPersistedFingerprint: "",
    lastPersistedAt: 0,
    lastPersistedProgress: null,
    lastPersistedStatus: null,
  };

  if (
    socket?.connected &&
    eventFingerprint !== cacheEntry.lastEventFingerprint
  ) {
    socket.emit("remotion-video-record-status", realtimePayload);
    cacheEntry.lastEventFingerprint = eventFingerprint;
  }

  const shouldPersist =
    persistMode === "always"
      ? true
      : persistMode === "never"
        ? false
        : shouldPersistRemotionRecordStatus(recordId, payload);

  if (shouldPersist) {
    await reportRemotionRecordStatus(recordId, payload);
    cacheEntry.lastPersistedFingerprint = buildWsFingerprint({
      status: payload.status || null,
      progress: normalizedProgress,
      message: payload.message || null,
      errorMessage: payload.errorMessage || null,
      remotionJobId: payload.remotionJobId || null,
      remotionVideoUrl: payload.remotionVideoUrl || null,
      resultUrl: payload.resultUrl || null,
      url: payload.url || null,
      queueStatus: getRemotionPayloadMetaValue(payload, "queueStatus"),
      queuePosition: getRemotionPayloadMetaValue(payload, "queuePosition"),
      queueAheadCount: getRemotionPayloadMetaValue(payload, "queueAheadCount"),
      queueActiveCount: getRemotionPayloadMetaValue(payload, "queueActiveCount"),
      queueQueuedCount: getRemotionPayloadMetaValue(payload, "queueQueuedCount"),
      queueProcessingCount: getRemotionPayloadMetaValue(
        payload,
        "queueProcessingCount",
      ),
      localJobStage: getRemotionPayloadMetaValue(payload, "localJobStage"),
      localJobMessage: getRemotionPayloadMetaValue(payload, "localJobMessage"),
    });
    cacheEntry.lastPersistedAt = Date.now();
    cacheEntry.lastPersistedProgress = normalizedProgress;
    cacheEntry.lastPersistedStatus = String(payload.status || "")
      .trim()
      .toLowerCase();
  }

  const normalizedStatus = String(payload.status || "")
    .trim()
    .toLowerCase();
  if (normalizedStatus === "success" || normalizedStatus === "failed") {
    remotionRecordRuntimeCache.delete(recordId);
    return;
  }

  remotionRecordRuntimeCache.set(recordId, cacheEntry);
}

async function executeRemotionRender(command: ServiceCommandEnvelope) {
  const recordId = String(command.payload?.recordId || "").trim();
  const templateId = String(command.payload?.templateId || "").trim();
  if (!recordId) {
    throw new Error("缺少 recordId");
  }
  if (!templateId) {
    throw new Error("缺少 templateId");
  }

  await syncRemotionRecordStatus(
    recordId,
    {
      status: "assigned",
      message: "客户端已接单，等待加入本地队列",
      responseData: {
        commandId: command.commandId,
        acceptedAt: new Date().toISOString(),
      },
    },
    { persist: "always" },
  );

  const createRes = await fetchRemotionJson("/api/renders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      templateId,
      inputProps: command.payload?.inputProps || {},
    }),
  }).then((result) =>
    ensureRemotionResponseOk(result, "本地 Video Template 创建渲染任务失败"),
  );

  const jobId = String(createRes?.data?.jobId || createRes?.jobId || "").trim();
  if (!jobId) {
    throw new Error("本地 Video Template 未返回 jobId");
  }

  const initialQueueSnapshot = await getRemotionQueueSnapshot(jobId).catch(
    () => null,
  );
  const initialQueuePayload = buildRemotionQueuePayload(
    initialQueueSnapshot,
    createRes?.data || createRes,
  );

  await syncRemotionRecordStatus(
    recordId,
    {
      status: "queued",
      remotionJobId: jobId,
      message: buildRemotionQueuedMessage(initialQueueSnapshot),
      ...initialQueuePayload,
      responseData: {
        commandId: command.commandId,
        jobCreatedAt: new Date().toISOString(),
        ...initialQueuePayload,
      },
    },
    { persist: "always" },
  );
  void syncServiceRuntime("video-template");

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const jobRes = ensureRemotionResponseOk(
      await fetchRemotionJson(`/api/renders/${encodeURIComponent(jobId)}`),
      "查询本地视频渲染任务失败",
    );
    const payload = jobRes?.data || jobRes || {};
    const status = normalizeRemotionQueueJobStatus(payload?.status);
    const progress = Number.isFinite(Number(payload?.progress))
      ? Math.round(Number(payload.progress) * 100)
      : null;

    if (status === "completed") {
      const completedQueuePayload = buildRemotionQueuePayload(null, payload);
      try {
        const uploadedVideo = await uploadRemotionResultFileToCos(command, {
          recordId,
          jobId,
          localPath: payload?.localPath || null,
          serviceUrl: payload?.videoUrl || null,
        });
        await syncRemotionRecordStatus(
          recordId,
          {
            status: "success",
            progress: 100,
            message: "视频渲染完成",
            remotionJobId: jobId,
            remotionVideoUrl: uploadedVideo.url,
            resultUrl: uploadedVideo.url,
            url: uploadedVideo.url,
            ...completedQueuePayload,
            responseData: {
              ...payload,
              ...completedQueuePayload,
              cosUrl: uploadedVideo.url,
              cosKey: uploadedVideo.key,
              localPath: uploadedVideo.localPath,
              serviceUrl: uploadedVideo.serviceUrl,
            },
          },
          { persist: "always" },
        );
        void syncServiceRuntime("video-template");
        return {
          success: true,
          message: "Video Template 视频渲染完成",
          data: {
            recordId,
            jobId,
            videoUrl: uploadedVideo.url,
            localPath: uploadedVideo.localPath,
            cosKey: uploadedVideo.key,
          },
        };
      } catch (error) {
        const errorMessage = `视频渲染完成，但上传 COS 失败: ${serializeError(error)}`;
        await syncRemotionRecordStatus(
          recordId,
          {
            status: "failed",
            progress: 100,
            message: errorMessage,
            errorMessage,
            remotionJobId: jobId,
            ...completedQueuePayload,
            responseData: {
              ...payload,
              ...completedQueuePayload,
              localPath: payload?.localPath || null,
              serviceUrl: payload?.videoUrl || null,
              uploadError: serializeError(error),
            },
          },
          { persist: "always" },
        );
        void syncServiceRuntime("video-template");
        throw new Error(errorMessage);
      }
    }

    if (status === "failed") {
      const errorMessage = String(
        payload?.error?.message || payload?.message || "本地视频渲染失败",
      );
      const failedQueuePayload = buildRemotionQueuePayload(null, payload);
      await syncRemotionRecordStatus(
        recordId,
        {
          status: "failed",
          progress,
          message: errorMessage,
          errorMessage,
          remotionJobId: jobId,
          ...failedQueuePayload,
          responseData: {
            ...payload,
            ...failedQueuePayload,
          },
        },
        { persist: "always" },
      );
      void syncServiceRuntime("video-template");
      throw new Error(errorMessage);
    }

    if (status === "queued") {
      const queueSnapshot = await getRemotionQueueSnapshot(jobId).catch(
        () => null,
      );
      const queuedPayload = buildRemotionQueuePayload(queueSnapshot, payload);
      await syncRemotionRecordStatus(
        recordId,
        {
          status: "queued",
          progress: null,
          message: buildRemotionQueuedMessage(queueSnapshot),
          remotionJobId: jobId,
          ...queuedPayload,
          responseData: {
            ...payload,
            ...queuedPayload,
          },
        },
        { persist: "auto" },
      );
      continue;
    }

    const processingQueuePayload = buildRemotionQueuePayload(null, payload);
    await syncRemotionRecordStatus(
      recordId,
      {
        status: "processing",
        progress,
        message: payload?.message || "本地渲染中",
        remotionJobId: jobId,
        ...processingQueuePayload,
        responseData: {
          ...payload,
          ...processingQueuePayload,
        },
      },
      { persist: "auto" },
    );
  }
}

async function fetchImageProcessingJson(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
) {
  const { timeoutMs = IMAGE_PROCESSING_REQUEST_TIMEOUT_MS, ...requestInit } = init || {};
  const nativeApi = getNativeApi() as any;
  if (!nativeApi) {
    throw new Error("当前环境未注入桌面端 image-tool 能力");
  }

  const bodyPayload =
    typeof requestInit.body === "string" && requestInit.body.trim()
      ? JSON.parse(requestInit.body)
      : requestInit.body && typeof requestInit.body === "object"
        ? requestInit.body
        : {};

  const action = async () => {
    if (path === "/api/health") {
      const status = await nativeApi.getImageToolStatus?.();
      const processors = Array.isArray(status?.processors) ? status.processors : [];
      const imageProcessor =
        processors.find((item: any) => item?.id === status?.defaultProcessorId) ||
        processors[0] || {
          installed: false,
          message: status?.lastError || "未检测到图像处理引擎",
        };
      return {
        success: !!status?.success,
        status: status?.success ? "healthy" : "unhealthy",
        defaultImageProcessorId: status?.defaultProcessorId || "",
        availableImageProcessors: processors,
        imageProcessor,
        data: {
          ...(status && typeof status === "object" ? status : {}),
          runtimeStatus: status?.status || "unknown",
          status: status?.success ? "healthy" : "unhealthy",
          defaultImageProcessorId: status?.defaultProcessorId || "",
          availableImageProcessors: processors,
          imageProcessor,
        },
      };
    }

    if (path === "/api/catalog") {
      return nativeApi.getImageToolCatalog?.();
    }
    if (path === "/api/operations") {
      return nativeApi.getImageToolOperations?.();
    }
    if (path === "/api/variations-config") {
      return nativeApi.getImageToolVariationsConfig?.();
    }
    if (path === "/api/image-processor-status") {
      const status = await nativeApi.getImageToolStatus?.();
      return {
        success: true,
        defaultProcessorId: status?.defaultProcessorId || "",
        processors: status?.processors || [],
      };
    }
    if (path === "/api/process") {
      return nativeApi.processImageTool?.(bodyPayload || {});
    }
    if (path === "/api/variations") {
      return nativeApi.generateImageToolVariations?.(bodyPayload || {});
    }
    if (path === "/api/files/delete") {
      return nativeApi.deleteImageToolFile?.({
        directory: bodyPayload?.directory || "output",
        fileName: bodyPayload?.filename || bodyPayload?.fileName,
      });
    }

    throw new Error(`未实现的 image-tool 路径: ${path}`);
  };

  return Promise.race([
    action(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`图片处理服务心跳超时 (${timeoutMs}ms)`)),
        timeoutMs,
      ),
    ),
  ]).catch((error: any) => {
    throw new Error(serializeError(error));
  });
}

async function ensureImageProcessingProcessReady() {
  const health = await fetchImageProcessingJson("/api/health", {
    timeoutMs: IMAGE_PROCESSING_HEALTH_TIMEOUT_MS,
  });
  const payload = (health?.data || health || {}) as Record<string, any>;
  if (
    health?.success === false ||
    payload?.status !== "healthy" ||
    payload?.imageProcessor?.installed === false
  ) {
    throw new Error(
      String(
        payload?.imageProcessor?.message ||
          payload?.message ||
          "图片处理能力未就绪",
      ),
    );
  }
}

async function getCachedImageProcessingMeta(force = false) {
  const now = Date.now();
  if (
    !force &&
    imageProcessingMetaCache.catalog &&
    imageProcessingMetaCache.operations.length > 0 &&
    imageProcessingMetaCache.variations.length > 0 &&
    now - imageProcessingMetaCache.lastFetchedAt <
      IMAGE_PROCESSING_META_CACHE_TTL_MS
  ) {
    return {
      catalog: imageProcessingMetaCache.catalog,
      operations: imageProcessingMetaCache.operations,
      variations: imageProcessingMetaCache.variations,
      processorStatus: imageProcessingMetaCache.processorStatus,
    };
  }

  const [catalogRes, operationsRes, variationsRes, processorStatusRes] =
    await Promise.all([
      fetchImageProcessingJson("/api/catalog"),
      fetchImageProcessingJson("/api/operations"),
      fetchImageProcessingJson("/api/variations-config"),
      fetchImageProcessingJson("/api/image-processor-status"),
    ]);

  imageProcessingMetaCache.catalog =
    catalogRes?.catalog && typeof catalogRes.catalog === "object"
      ? catalogRes.catalog
      : catalogRes?.data?.catalog && typeof catalogRes.data.catalog === "object"
        ? catalogRes.data.catalog
        : null;
  imageProcessingMetaCache.operations = Array.isArray(
    operationsRes?.operations,
  )
    ? operationsRes.operations
    : Array.isArray(operationsRes?.data?.operations)
      ? operationsRes.data.operations
      : [];
  imageProcessingMetaCache.variations = Array.isArray(
    variationsRes?.variations,
  )
    ? variationsRes.variations
    : Array.isArray(variationsRes?.data?.variations)
      ? variationsRes.data.variations
      : [];
  imageProcessingMetaCache.processorStatus =
    processorStatusRes && typeof processorStatusRes === "object"
      ? processorStatusRes
      : null;
  imageProcessingMetaCache.lastFetchedAt = now;

  return {
    catalog: imageProcessingMetaCache.catalog,
    operations: imageProcessingMetaCache.operations,
    variations: imageProcessingMetaCache.variations,
    processorStatus: imageProcessingMetaCache.processorStatus,
  };
}

function buildImageProcessingActiveTaskList() {
  return Array.from(activeImageProcessingTasks.values()).sort((left, right) =>
    String(left.startedAt || "").localeCompare(String(right.startedAt || "")),
  );
}

async function getImageProcessingRuntime() {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const activeTasks = buildImageProcessingActiveTaskList();
  const previousRuntime = clientInfo.services?.["image-processing"];
  const previousDetails =
    previousRuntime?.details && typeof previousRuntime.details === "object"
      ? (previousRuntime.details as Record<string, any>)
      : {};

  try {
    const health = await fetchImageProcessingJson("/api/health", {
      timeoutMs: IMAGE_PROCESSING_HEALTH_TIMEOUT_MS,
    });
    const healthPayload = (health?.data || health || {}) as Record<string, any>;
    const processorStatusFromHealth =
      healthPayload?.imageProcessor && typeof healthPayload.imageProcessor === "object"
        ? healthPayload.imageProcessor
        : null;
    const processorInstalled = processorStatusFromHealth?.installed !== false;

    if (health?.success === false || healthPayload?.status !== "healthy") {
      throw new Error(
        String(
          processorStatusFromHealth?.message ||
            healthPayload?.message ||
            "图片处理服务未就绪",
        ),
      );
    }

    let meta = {
      catalog:
        previousDetails.catalog && typeof previousDetails.catalog === "object"
          ? previousDetails.catalog
          : imageProcessingMetaCache.catalog,
      operations: Array.isArray(previousDetails.operations)
        ? previousDetails.operations
        : imageProcessingMetaCache.operations,
      variations: Array.isArray(previousDetails.variations)
        ? previousDetails.variations
        : imageProcessingMetaCache.variations,
      processorStatus:
        previousDetails.processorStatus && typeof previousDetails.processorStatus === "object"
          ? previousDetails.processorStatus
          : imageProcessingMetaCache.processorStatus,
    };

    try {
      meta = await getCachedImageProcessingMeta(
        !previousDetails.catalog ||
          !Array.isArray(previousDetails.operations) ||
          !Array.isArray(previousDetails.variations),
      );
    } catch (metaError) {
      emitter.emit("log", {
        level: "warn",
        message: `[image-processing] meta fallback: ${serializeError(metaError)}`,
      });
    }

    const activeTaskCount = activeTasks.length;
    const currentTask = activeTasks[0] || null;

    const processorStatus =
      processorStatusFromHealth ||
      meta.processorStatus ||
      healthPayload?.imageProcessor ||
      null;
    const runtimeAvailable = processorInstalled && processorStatus?.installed !== false;
    const runtimeStatus: "connected" | "error" = processorInstalled
      ? "connected"
      : "error";
    const runtimeState: "idle" | "busy" | "error" = !processorInstalled
      ? "error"
      : activeTaskCount > 0
        ? "busy"
        : "idle";
    const runtimeMessage = !processorInstalled
      ? String(processorStatus?.message || "图片处理插件已连接，但当前引擎不可执行")
      : activeTaskCount > 0
        ? `图片处理中，当前执行 ${activeTaskCount} 个任务`
        : String(processorStatus?.message || "图片处理能力可用");

    return {
      label: "Image Tool 图片处理",
      connected: true,
      available: runtimeAvailable,
      status: runtimeStatus,
      state: runtimeState,
      busy: activeTaskCount > 0,
      message: runtimeMessage,
      endpoint: IMAGE_PROCESSING_LOCAL_BASE,
      lastCheckedAt: checkedAt,
      lastError: runtimeAvailable ? null : runtimeMessage,
      currentTaskId: currentTask?.recordId || null,
      supportedCommands: ["refreshRuntime", "health", "createTask"],
      supportedTaskTypes: ["process", "variations"],
      details: {
        health: healthPayload,
        catalog: meta.catalog,
        operations: meta.operations,
        variations: meta.variations,
        processorStatus,
        executable: runtimeAvailable,
        processStatus: activeTaskCount > 0 ? "running" : "ready",
        serviceHealthy: runtimeAvailable,
        heartbeatLatencyMs: Date.now() - startedAt,
        lastHeartbeatAt: checkedAt,
        activeJobsCount: activeTaskCount,
        currentExecutions: activeTasks.map((task) => ({
          recordId: task.recordId,
          taskType: task.taskType,
          title: task.title,
          imageUrl: task.imageUrl,
          startedAt: task.startedAt,
          updatedAt: task.updatedAt,
        })),
      },
    };
  } catch (error) {
    const errorMessage = serializeError(error);
    const looksOffline = true;

    return {
      label: "Image Tool 图片处理",
      connected: false,
      available: false,
      status: looksOffline ? ("disconnected" as const) : ("error" as const),
      state: looksOffline ? ("offline" as const) : ("error" as const),
      busy: false,
      message: "图片处理插件未就绪，当前不可执行",
      endpoint: IMAGE_PROCESSING_LOCAL_BASE,
      lastCheckedAt: checkedAt,
      lastError: errorMessage,
      supportedCommands: ["refreshRuntime", "health", "createTask"],
      supportedTaskTypes: ["process", "variations"],
      details: {
        catalog:
          previousDetails.catalog && typeof previousDetails.catalog === "object"
            ? previousDetails.catalog
            : imageProcessingMetaCache.catalog,
        operations: Array.isArray(previousDetails.operations)
          ? previousDetails.operations
          : imageProcessingMetaCache.operations,
        variations: Array.isArray(previousDetails.variations)
          ? previousDetails.variations
          : imageProcessingMetaCache.variations,
        processorStatus:
          previousDetails.processorStatus && typeof previousDetails.processorStatus === "object"
            ? previousDetails.processorStatus
            : imageProcessingMetaCache.processorStatus,
        executable: false,
        processStatus: "error",
        serviceHealthy: false,
        lastHeartbeatAt: checkedAt,
        heartbeatError: errorMessage,
        activeJobsCount: activeTasks.length,
        currentExecutions: activeTasks.map((task) => ({
          recordId: task.recordId,
          taskType: task.taskType,
          title: task.title,
          imageUrl: task.imageUrl,
          startedAt: task.startedAt,
          updatedAt: task.updatedAt,
        })),
      },
    };
  }
}

async function reportImageProcessingRecordStatus(
  recordId: string,
  payload: Record<string, any>,
) {
  const token = await getTokenFromClient();
  const response = await fetch(
    `${getRemoteApiBase()}/image-processing-record/${encodeURIComponent(recordId)}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(
      String(json?.message || json?.msg || `状态回传失败: ${response.status}`),
    );
  }

  return response.json().catch(() => null);
}

async function cleanupImageProcessingOutputFile(outputFile?: string | null) {
  const normalizedOutputFile = String(outputFile || "").trim();
  if (!normalizedOutputFile) {
    return;
  }

  try {
    await fetchImageProcessingJson("/api/files/delete", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        directory: "output",
        filename: normalizedOutputFile,
      }),
      timeoutMs: IMAGE_PROCESSING_HEALTH_TIMEOUT_MS,
    });
  } catch (error) {
    emitter.emit("log", {
      level: "warn",
      message: `[image-processing] cleanup failed: ${serializeError(error)}`,
    });
  }
}

async function uploadImageProcessingResultFileToCos(
  command: ServiceCommandEnvelope,
  options: {
    recordId: string;
    localPath?: string | null;
    outputFile?: string | null;
    name?: string | null;
    description?: string | null;
    serviceUrl?: string | null;
    engine?: Record<string, any> | null;
    extra?: Record<string, any> | null;
  },
) {
  const apiBridge = window.api as any;
  if (!apiBridge?.generateCosKey || !apiBridge?.uploadFileToCos) {
    throw new Error("当前环境未注入 COS 上传能力");
  }

  const localPath = String(options.localPath || "").trim();
  if (!localPath) {
    throw new Error("缺少本地结果文件路径");
  }

  const fileName =
    String(options.outputFile || "").trim() ||
    localPath.split(/[/\\\\]/).filter(Boolean).pop() ||
    `image-processing-${Date.now()}.png`;
  const keyResult = await apiBridge.generateCosKey({
    category: "image-processing-record",
    filename: fileName,
    account: String(command.tenant?.account || "").trim() || undefined,
    userId: String(command.tenant?.userId || "").trim() || undefined,
    entityId: options.recordId,
  });
  if (!keyResult?.ok || !keyResult?.key) {
    throw new Error(keyResult?.msg || "生成 COS Key 失败");
  }

  const uploadResult = await apiBridge.uploadFileToCos({
    filePath: localPath,
    key: keyResult.key,
  });
  if (!uploadResult?.ok || !uploadResult?.url) {
    throw new Error(uploadResult?.msg || "COS 上传失败");
  }

  return {
    success: true,
    name: String(options.name || "").trim() || "图片处理结果",
    description: String(options.description || "").trim() || "",
    outputFile: fileName,
    serviceUrl: String(options.serviceUrl || "").trim() || null,
    url: uploadResult.url,
    key: uploadResult.key || keyResult.key || null,
    owned: true,
    engine: options.engine || null,
    extra: options.extra || null,
  };
}

async function uploadRemotionResultFileToCos(
  command: ServiceCommandEnvelope,
  options: {
    recordId: string;
    jobId?: string | null;
    localPath?: string | null;
    serviceUrl?: string | null;
  },
) {
  const apiBridge = window.api as any;
  if (!apiBridge?.generateCosKey || !apiBridge?.uploadFileToCos) {
    throw new Error("当前环境未注入 COS 上传能力");
  }

  const localPath = String(options.localPath || "").trim();
  if (!localPath) {
    throw new Error("缺少本地视频文件路径");
  }

  const fileName =
    localPath.split(/[/\\\\]/).filter(Boolean).pop() ||
    `${String(options.jobId || options.recordId || "video-template").trim() || "video-template"}.mp4`;

  const keyResult = await apiBridge.generateCosKey({
    category: "video-template-record",
    filename: fileName,
    account: String(command.tenant?.account || "").trim() || undefined,
    userId: String(command.tenant?.userId || "").trim() || undefined,
    entityId: options.recordId,
  });
  if (!keyResult?.ok || !keyResult?.key) {
    throw new Error(keyResult?.msg || "生成 COS Key 失败");
  }

  const uploadResult = await apiBridge.uploadFileToCos({
    filePath: localPath,
    key: keyResult.key,
  });
  if (!uploadResult?.ok || !uploadResult?.url) {
    throw new Error(uploadResult?.msg || "COS 上传失败");
  }

  return {
    url: String(uploadResult.url || "").trim(),
    key: String(uploadResult.key || keyResult.key || "").trim() || null,
    fileName,
    localPath,
    serviceUrl: String(options.serviceUrl || "").trim() || null,
  };
}

function resolveImageProcessingResultStatus(resultFiles: Array<Record<string, any>>) {
  const successCount = resultFiles.filter((item) => item?.success).length;
  const total = resultFiles.length;
  if (!total || successCount <= 0) {
    return "failed" as const;
  }
  if (successCount < total) {
    return "partial" as const;
  }
  return "success" as const;
}

function buildImageProcessingFailedMessage(
  resultFiles: Array<Record<string, any>>,
  fallback = "图片处理失败",
) {
  return String(
    resultFiles.find((item) => !item?.success)?.error ||
      resultFiles.find((item) => !item?.success)?.uploadError ||
      fallback,
  );
}

async function archiveImageProcessingExecutionPayload(
  command: ServiceCommandEnvelope,
  recordId: string,
  taskType: "process" | "variations",
  payload: Record<string, any>,
) {
  if (taskType === "variations") {
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const archivedResults: Array<Record<string, any>> = [];

    for (const item of results) {
      try {
        if (!item?.success) {
          archivedResults.push({
            success: false,
            name: item?.name || "未命名预设",
            description: item?.description || "",
            error: item?.error || "裂变执行失败",
            outputFile: item?.outputFile || "",
            serviceUrl: item?.url || null,
            engine: item?.engine || null,
          });
          continue;
        }

        const archived = await uploadImageProcessingResultFileToCos(command, {
          recordId,
          localPath: item?.localPath || null,
          outputFile: item?.outputFile || null,
          name: item?.name || "裂变结果",
          description: item?.description || "",
          serviceUrl: item?.url || null,
          engine: item?.engine || null,
        });
        archivedResults.push(archived);
      } catch (error) {
        archivedResults.push({
          success: false,
          name: item?.name || "未命名预设",
          description: item?.description || "",
          error: serializeError(error),
          outputFile: item?.outputFile || "",
          serviceUrl: item?.url || null,
          engine: item?.engine || null,
        });
      } finally {
        await cleanupImageProcessingOutputFile(item?.outputFile || null);
      }
    }

    return {
      resultFiles: archivedResults,
      processorId: String(payload?.engine?.id || "").trim() || null,
      processorLabel: String(payload?.engine?.label || "").trim() || null,
      responseData: {
        execution: {
          successCount: payload?.successCount ?? null,
          failCount: payload?.failCount ?? null,
        },
      },
    };
  }

  const archived = await uploadImageProcessingResultFileToCos(command, {
    recordId,
    localPath: payload?.localPath || null,
    outputFile: payload?.outputFile || null,
    name: "处理结果",
    description: "链式处理输出",
    serviceUrl: payload?.url || null,
    engine: payload?.engine || null,
    extra: {
      commands: Array.isArray(payload?.commands) ? payload.commands : [],
      durationMs:
        typeof payload?.durationMs === "number" ? payload.durationMs : null,
    },
  });

  await cleanupImageProcessingOutputFile(payload?.outputFile || null);

  return {
    resultFiles: [archived],
    processorId: String(payload?.engine?.id || "").trim() || null,
    processorLabel: String(payload?.engine?.label || "").trim() || null,
    responseData: {
      execution: {
        durationMs:
          typeof payload?.durationMs === "number" ? payload.durationMs : null,
        commands: Array.isArray(payload?.commands) ? payload.commands : [],
      },
    },
  };
}

async function executeImageProcessingTask(command: ServiceCommandEnvelope) {
  const recordId = String(command.payload?.recordId || "").trim();
  const taskType =
    String(command.payload?.taskType || "").trim() === "variations"
      ? "variations"
      : "process";
  const imageUrl = String(command.payload?.imageUrl || "").trim();
  const operations = Array.isArray(command.payload?.operations)
    ? command.payload.operations
    : [];
  const processorId = String(command.payload?.processorId || "").trim() || null;

  if (!recordId) {
    throw new Error("缺少 recordId");
  }
  if (!imageUrl) {
    throw new Error("缺少 imageUrl");
  }
  if (taskType === "process" && operations.length <= 0) {
    throw new Error("缺少 operations");
  }

  await ensureImageProcessingProcessReady();

  const now = new Date().toISOString();
  activeImageProcessingTasks.set(recordId, {
    recordId,
    taskType,
    title: String(command.payload?.title || "").trim() || null,
    imageUrl,
    startedAt: now,
    updatedAt: now,
  });
  void syncServiceRuntime("image-processing");

  try {
    await reportImageProcessingRecordStatus(recordId, {
      status: "processing",
      message:
        taskType === "variations"
          ? "客户端正在执行图片裂变"
          : "客户端正在执行图片处理",
      responseData: {
        startedAt: now,
        clientRuntime: {
          clientId: identity.clientId,
          machineCode: identity.machineCode,
          reportedAt: now,
        },
      },
    });

    const executionPayload = await fetchImageProcessingJson(
      taskType === "variations" ? "/api/variations" : "/api/process",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl,
          ...(taskType === "process" ? { operations } : {}),
          ...(processorId ? { engine: processorId } : {}),
        }),
        timeoutMs: IMAGE_PROCESSING_TASK_TIMEOUT_MS,
      },
    );

    if (executionPayload?.success === false) {
      throw new Error(
        String(
          executionPayload?.error ||
            executionPayload?.message ||
            "图片处理执行失败",
        ),
      );
    }

    const archivedPayload = await archiveImageProcessingExecutionPayload(
      command,
      recordId,
      taskType,
      executionPayload,
    );
    const finalStatus = resolveImageProcessingResultStatus(
      archivedPayload.resultFiles,
    );
    const finalMessage =
      finalStatus === "success"
        ? taskType === "variations"
          ? "图片裂变完成"
          : "图片处理完成"
        : finalStatus === "partial"
          ? "部分结果上传失败"
          : buildImageProcessingFailedMessage(archivedPayload.resultFiles);

    await reportImageProcessingRecordStatus(recordId, {
      status: finalStatus,
      message: finalMessage,
      errorMessage:
        finalStatus === "failed" ? finalMessage : finalStatus === "partial" ? finalMessage : null,
      processorId: archivedPayload.processorId,
      processorLabel: archivedPayload.processorLabel,
      resultFiles: archivedPayload.resultFiles,
      responseData: {
        ...(archivedPayload.responseData || {}),
        completedAt: new Date().toISOString(),
        source: executionPayload?.source || null,
        originalFilename: executionPayload?.originalFilename || null,
      },
    });

    return {
      success: finalStatus !== "failed",
      message: finalMessage,
      data: {
        recordId,
        status: finalStatus,
        resultFiles: archivedPayload.resultFiles,
      },
    };
  } catch (error) {
    const errorMessage = serializeError(error);
    await reportImageProcessingRecordStatus(recordId, {
      status: "failed",
      message: errorMessage,
      errorMessage,
      responseData: {
        completedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
    throw error;
  } finally {
    activeImageProcessingTasks.delete(recordId);
    void syncServiceRuntime("image-processing");
  }
}

async function handleServiceCommand(command: ServiceCommandEnvelope) {
  const pluginKey = resolveCommandPluginKey(command);
  const action = resolveCommandAction(command);
  const payload = command.command?.payload ?? command.payload ?? {};
  const normalizedCommand: ServiceCommandEnvelope = {
    ...command,
    pluginKey,
    service: pluginKey,
    action,
    payload,
    target: {
      clientId: command.target?.clientId || command.clientId,
      pluginKey,
    },
    command: {
      name: action,
      payload,
    },
  };
  const legacyServiceKey = getLegacyServiceKey(pluginKey);
  const handler = localServiceHandlers.get(pluginKey);
  if (!handler) {
    const result: ServiceCommandResult = {
      commandId: normalizedCommand.commandId,
      service: legacyServiceKey || normalizedCommand.service || "unknown",
      pluginKey,
      action: action || "unknown",
      success: false,
      message: "客户端不支持该服务",
      error: "unsupported_service",
      finishedAt: new Date().toISOString(),
    };
    socket?.emit("service-command-result", result);
    emitter.emit("serviceCommandResult", result);
    return;
  }

  try {
    if (action === "refreshRuntime" || action === "health") {
      const runtime = await syncServiceRuntime(pluginKey);
      const result: ServiceCommandResult = {
        commandId: normalizedCommand.commandId,
        service: legacyServiceKey,
        pluginKey,
        action,
        success: !!runtime,
        message: runtime?.message || `${handler.label} 状态已刷新`,
        data: runtime,
        finishedAt: new Date().toISOString(),
      };
      socket?.emit("service-command-result", result);
      emitter.emit("serviceCommandResult", result);
      return;
    }

    if (!handler.execute) {
      throw new Error("服务未实现该命令");
    }

    const response = await handler.execute(normalizedCommand);
    const errorDetail =
      !response.success &&
      response.data &&
      typeof response.data === "object" &&
      !Array.isArray(response.data) &&
      "errorDetail" in response.data
        ? ((
            response.data as {
              errorDetail?: BrowserAutomationErrorDetail | null;
            }
          ).errorDetail ?? null)
        : null;
    const result: ServiceCommandResult = {
      commandId: normalizedCommand.commandId,
      service: legacyServiceKey,
      pluginKey,
      action,
      success: response.success,
      message: response.message,
      data: response.data,
      error: response.success ? null : response.message || "command_failed",
      errorDetail,
      finishedAt: new Date().toISOString(),
    };
    socket?.emit("service-command-result", result);
    emitter.emit("serviceCommandResult", result);
  } catch (error) {
    const result: ServiceCommandResult = {
      commandId: normalizedCommand.commandId,
      service: legacyServiceKey || normalizedCommand.service || "unknown",
      pluginKey,
      action: action || "unknown",
      success: false,
      message: serializeError(error),
      error: serializeError(error),
      finishedAt: new Date().toISOString(),
    };
    socket?.emit("service-command-result", result);
    emitter.emit("serviceCommandResult", result);
  }
}

function clearHeartbeatInterval() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function clearHeartbeatTimeout() {
  if (heartbeatTimeout) {
    clearTimeout(heartbeatTimeout);
    heartbeatTimeout = null;
  }
}

function clearUploaderRuntimeSyncInterval() {
  if (uploaderRuntimeSyncInterval) {
    clearInterval(uploaderRuntimeSyncInterval);
    uploaderRuntimeSyncInterval = null;
  }
}

function clearPhotoshopRuntimeSyncInterval() {
  if (photoshopRuntimeSyncInterval) {
    clearInterval(photoshopRuntimeSyncInterval);
    photoshopRuntimeSyncInterval = null;
  }
}

function clearImageProcessingRuntimeSyncInterval() {
  if (imageProcessingRuntimeSyncInterval) {
    clearInterval(imageProcessingRuntimeSyncInterval);
    imageProcessingRuntimeSyncInterval = null;
  }
}

function clearVideoTemplateRuntimeSyncInterval() {
  if (videoTemplateRuntimeSyncInterval) {
    clearInterval(videoTemplateRuntimeSyncInterval);
    videoTemplateRuntimeSyncInterval = null;
  }
}

function stopHeartbeat() {
  clearHeartbeatInterval();
  clearHeartbeatTimeout();
  clearUploaderRuntimeSyncInterval();
  clearPhotoshopRuntimeSyncInterval();
  clearImageProcessingRuntimeSyncInterval();
  clearVideoTemplateRuntimeSyncInterval();
  lastPingTimestamp = null;
}

function startUploaderRuntimeSyncLoop() {
  clearUploaderRuntimeSyncInterval();
  uploaderRuntimeSyncInterval = setInterval(() => {
    if (!socket || !socket.connected) return;
    void syncServiceRuntime("uploader");
  }, UPLOADER_RUNTIME_SYNC_INTERVAL);
}

function startPhotoshopRuntimeSyncLoop() {
  clearPhotoshopRuntimeSyncInterval();
  photoshopRuntimeSyncInterval = setInterval(() => {
    if (!socket || !socket.connected) return;
    void syncServiceRuntime("photoshop");
  }, PHOTOSHOP_RUNTIME_SYNC_INTERVAL);
}

function startImageProcessingRuntimeSyncLoop() {
  clearImageProcessingRuntimeSyncInterval();
  imageProcessingRuntimeSyncInterval = setInterval(() => {
    if (!socket || !socket.connected) return;
    void syncServiceRuntime("image-processing");
  }, IMAGE_PROCESSING_RUNTIME_SYNC_INTERVAL);
}

function startVideoTemplateRuntimeSyncLoop() {
  clearVideoTemplateRuntimeSyncInterval();
  videoTemplateRuntimeSyncInterval = setInterval(() => {
    if (!socket || !socket.connected) return;
    void syncServiceRuntime("video-template");
  }, VIDEO_TEMPLATE_RUNTIME_SYNC_INTERVAL);
}

function scheduleHeartbeatTimeout() {
  clearHeartbeatTimeout();
  heartbeatTimeout = setTimeout(() => {
    const isHidden =
      typeof document !== "undefined" && document.visibilityState !== "visible";

    emitter.emit("log", {
      level: "warn",
      message: isHidden
        ? "[ws] heartbeat timeout while hidden"
        : "[ws] heartbeat timeout",
    });

    if (isHidden) {
      return;
    }

    if (!socket || !socket.connected) {
      updateState({
        status: "error",
        lastError: "Heartbeat timeout",
      });
      reconnect();
      return;
    }

    updateState({
      lastError: "Heartbeat timeout",
    });
  }, HEARTBEAT_TIMEOUT);
}

function emitHeartbeat() {
  if (!socket || !socket.connected) return;
  lastPingTimestamp = Date.now();
  updateState({
    lastPingAt: new Date(lastPingTimestamp).toISOString(),
  });
  socket.emit("ping");
  scheduleHeartbeatTimeout();
}

function startHeartbeatLoop() {
  clearHeartbeatInterval();
  clearHeartbeatTimeout();
  lastPingTimestamp = null;
  heartbeatInterval = setInterval(emitHeartbeat, HEARTBEAT_INTERVAL);
  emitHeartbeat();
}

function cleanupSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  lastClientInfoFingerprint = "";
  lastClientInfoEmittedAt = 0;
  transientWsToastCache.clear();
  lastServiceRuntimeEmitCache.clear();
  stopHeartbeat();
}

function buildQuery() {
  return {
    clientSource: CLIENT_SOURCE,
    clientId: identity.clientId,
    machineCode: identity.machineCode,
  };
}

function bindSocketEvents(currentSocket: Socket) {
  currentSocket.on("connect", () => {
    emitter.emit("log", { level: "info", message: "[ws] connected" });
    updateState({
      status: "connected",
      connectedAt: new Date().toISOString(),
      lastError: null,
      retryCount: 0,
    });
    emitClientInfo();
    emitPsAutomationStatus();
    void Promise.all(
      Array.from(localServiceHandlers.keys()).map((key) =>
        syncServiceRuntime(key),
      ),
    );
    startUploaderRuntimeSyncLoop();
    startPhotoshopRuntimeSyncLoop();
    startImageProcessingRuntimeSyncLoop();
    startVideoTemplateRuntimeSyncLoop();
    startHeartbeatLoop();
  });

  currentSocket.on("disconnect", (reason) => {
    emitter.emit("log", {
      level: "warn",
      message: `[ws] disconnected: ${reason}`,
    });
    if (!intentionalDisconnect) {
      emitTransientWsToast(`disconnect:${reason || "unknown"}`, {
        color: "warning",
        icon: "mdi-plug",
        message: `通道断开：${reason || "未知原因"}`,
      });
    }
    stopHeartbeat();
    updateState({
      status: intentionalDisconnect ? "disconnected" : "error",
      lastError: reason || null,
      connectedAt: null,
    });
  });

  currentSocket.on("pong", () => {
    clearHeartbeatTimeout();
    const now = Date.now();
    updateState({
      status: "connected",
      lastPongAt: new Date(now).toISOString(),
      lastLatencyMs: lastPingTimestamp ? now - lastPingTimestamp : null,
      lastError: null,
    });
    lastPingTimestamp = null;
  });

  currentSocket.on("connect_error", (error) => {
    const message = serializeError(error);
    emitter.emit("log", {
      level: "error",
      message: `[ws] connect_error: ${message}`,
    });
    emitTransientWsToast(`connect_error:${message}`, {
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "服务连接错误",
    });
    updateState({
      status: "error",
      lastError: message,
    });
  });

  currentSocket.on("error", (error) => {
    emitter.emit("log", {
      level: "error",
      message: `[ws] error: ${serializeError(error)}`,
    });
    updateState({
      status: "error",
      lastError: serializeError(error),
    });
  });

  currentSocket.io.on("reconnect_attempt", (attempt) => {
    emitter.emit("log", {
      level: "info",
      message: `[ws] reconnect attempt #${attempt}`,
    });
    updateState({
      status: "reconnecting",
      retryCount: attempt,
    });
  });

  currentSocket.io.on("reconnect_failed", () => {
    emitter.emit("log", { level: "error", message: "[ws] reconnect failed" });
    emitTransientWsToast("reconnect_failed", {
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "实时通道重连失败",
    });
    updateState({
      status: "error",
      lastError: "Reconnect failed",
    });
  });

  currentSocket.io.on("reconnect_error", (error) => {
    emitter.emit("log", {
      level: "error",
      message: `[ws] reconnect_error: ${serializeError(error)}`,
    });
    updateState({
      status: "error",
      lastError: serializeError(error),
    });
  });

  currentSocket.on("service-command", (command: ServiceCommandEnvelope) => {
    void handleServiceCommand(command);
  });

  currentSocket.on(
    "ps-automation-toggle",
    (payload: {
      enabled?: boolean;
      autoDispatchEnabled?: boolean;
      operator?: { id?: string | number; account?: string };
    }) => {
      const enabled =
        typeof payload?.enabled === "boolean"
          ? payload.enabled
          : psAutomationControlState.enabled;
      const autoDispatchEnabled =
        typeof payload?.autoDispatchEnabled === "boolean"
          ? payload.autoDispatchEnabled
          : psAutomationControlState.autoDispatchEnabled;
      psAutomationControlState.enabled = enabled ?? null;
      psAutomationControlState.autoDispatchEnabled =
        autoDispatchEnabled ?? null;
      emitter.emit("log", {
        level: "info",
        message: `[ws] received ps-automation-toggle: ${enabled}`,
      });
      emitter.emit("psAutomationToggle", {
        enabled,
        operator: payload?.operator,
      });
      emitPsAutomationStatus();
    },
  );

  // 监听来自管理后台的消息
  currentSocket.on("admin-message", async (data: any) => {
    emitter.emit("log", {
      level: "info",
      message: `[ws] received admin-message: ${JSON.stringify(data)}`,
    });
    emitter.emit("adminMessage", {
      data,
      timestamp: new Date().toISOString(),
    });

    // 默认显示 toast 通知
    const messageText =
      typeof data === "string"
        ? data
        : data?.message || data?.text || "收到管理消息";
    emitter.emit("toast", {
      color: "info",
      icon: "mdi-message-text-outline",
      message: messageText,
    });
  });

  // 监听测试消息并响应
  currentSocket.on("test-message", (data: any) => {
    emitter.emit("log", {
      level: "info",
      message: `[ws] received test-message: ${JSON.stringify(data)}`,
    });
    // 发送响应确认收到
    currentSocket.emit("test-message-ack", {
      received: true,
      timestamp: new Date().toISOString(),
      originalData: data,
    });
  });
}

function serializeError(error: unknown) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * 规范化 Windows 本地路径，去除首尾空格/引号并统一分隔符
 */
function normalizeWindowsPath(input: string) {
  if (!input) return input;
  let path = input.trim();
  // 去掉首尾引号
  path = path.replace(/^["']|["']$/g, "");

  // UNC 前缀保留
  if (path.startsWith("\\\\")) {
    const rest = path.slice(2).replace(/[\\/]+/g, "\\");
    return "\\\\" + rest;
  }

  // 标准化分隔符
  path = path.replace(/[\\/]+/g, "\\");
  // 标准化盘符格式
  path = path.replace(
    /^([A-Za-z]):[\\/]+/,
    (_, drive) => `${drive.toUpperCase()}:\\`,
  );
  return path;
}

/**
 * 处理套图制作流程
 * 1. 查询套图完整信息
 * 2. 下载贴纸和PSD模板到本地
 * 3. 调用PS服务处理PSD
 * 4. 上传生成的图片到COS
 * 5. 更新套图的images字段
 */
async function handlePsdSetProduction(psdSetId: string, taskId?: string) {
  // 记录制作开始时间
  const productionStartTime = Date.now();

  // 设置制作状态为进行中
  isProductionInProgress = true;
  currentProductionTaskId = taskId || psdSetId;
  emitPsAutomationStatus({
    running: true,
    currentPsSetId: psdSetId,
    progress: 0,
    lastError: null,
  });
  void syncServiceRuntime("photoshop");

  // 发送开始事件，触发全局loading
  emitter.emit("psdSetProgressStart", { psdSetId });
  // 向服务器发送制作开始状态，便于管理后台收到实时更新
  try {
    if (socket && socket.connected) {
      socket.emit("production-status", {
        psdSetId,
        status: "processing",
        message: "客户端已开始制作",
        progress: 0,
      });
    }
  } catch (e) {
    emitter.emit("log", {
      level: "warn",
      message: `[ws] 发送 production-status（开始）失败: ${serializeError(e)}`,
    });
  }

  try {
    emitter.emit("log", {
      level: "info",
      message: `[psd-set] 开始处理套图制作，ID: ${psdSetId}`,
    });
    emitter.emit("toast", {
      color: "info",
      icon: "mdi-image-edit-outline",
      message: "开始处理套图制作...",
    });

    // 1. 查询套图完整信息
    emitter.emit("psdSetProgress", {
      psdSetId,
      step: "步骤 1/5: 查询套图信息",
      message: "正在从服务器获取套图详细信息...",
      progress: 1,
      total: 5,
    });
    emitter.emit("log", {
      level: "info",
      message: `[psd-set] 正在查询套图信息...`,
    });
    const psdSetResponse = await stickerPsdSetApi.findOne(psdSetId);

    if (!psdSetResponse.status || !psdSetResponse.data) {
      throw new Error(`查询套图信息失败: ${psdSetResponse.code}`);
    }

    const psdSet = psdSetResponse.data;
    emitPsAutomationStatus({
      currentPsSetId: psdSetId,
      currentPsSetName: psdSet.name || null,
      progress: 20,
    });
    if (!psdSet.psdTemplate) {
      throw new Error("套图信息不完整，缺少 PSD 模板");
    }

    // 检查 PSD 模板是否有 url 或 windowsLocalPath
    const psdTemplate = psdSet.psdTemplate;
    const hasUrl = psdTemplate.url && psdTemplate.url.trim();
    const hasLocalPath =
      psdTemplate.windowsLocalPath && psdTemplate.windowsLocalPath.trim();

    if (!hasUrl && !hasLocalPath) {
      const tplId = psdTemplate?.id || "unknown";
      const tplName = psdTemplate?.name || "未命名PSD";
      const errorMessage = `PSD 模板无可用路径 (id=${tplId}, name=${tplName}) — 未配置远程 URL 或 Windows 本地路径。建议：在后台编辑该 PSD 模板，填写有效的 URL 或 Windows 本地路径，或上传 PSD 文件。`;
      emitter.emit("psdSetProgress", {
        psdSetId,
        step: "步骤 1/5: 查询套图信息",
        message: errorMessage,
        progress: 1,
        total: 5,
      });
      emitter.emit("toast", {
        color: "error",
        icon: "mdi-alert-circle-outline",
        message: "PSD 模板缺少可用路径，无法制作套图",
      });
      throw new Error(errorMessage);
    }

    emitter.emit("psdSetProgress", {
      psdSetId,
      step: "步骤 1/5: 查询套图信息",
      message: `已获取套图信息：${psdSet.name || "未命名套图"}`,
      progress: 1,
      total: 5,
    });

    // 把进度发送到服务器（供管理后台实时订阅）
    try {
      if (socket && socket.connected) {
        socket.emit("production-status", {
          psdSetId,
          status: "processing",
          message: `已获取套图信息：${psdSet.name || "未命名套图"}`,
          progress: 1,
          total: 5,
        });
      }
    } catch (e) {
      emitter.emit("log", {
        level: "warn",
        message: `[ws] 发送 production-status（查询信息）失败: ${serializeError(e)}`,
      });
    }

    const localPsdPathRaw =
      (psdSet.psdTemplate.windowsLocalPath || "").trim?.() ?? "";
    const localPsdPath = localPsdPathRaw
      ? normalizeWindowsPath(localPsdPathRaw)
      : "";
    const remotePsdUrl = (psdSet.psdTemplate.url || "").trim?.() ?? "";
    let psdSourcePath = localPsdPath || remotePsdUrl;
    let psdSourceType: "local" | "remote" = localPsdPath ? "local" : "remote";

    const stickers =
      Array.isArray((psdSet as any).stickers) && (psdSet as any).stickers.length
        ? (psdSet as any).stickers
        : psdSet.sticker
          ? [psdSet.sticker]
          : [];

    if (!stickers.length) {
      throw new Error("套图信息不完整，缺少贴纸");
    }

    const stickerDesc = stickers
      .map((s) => s.name || s.id || "")
      .filter(Boolean)
      .join(", ");
    emitter.emit("log", {
      level: "info",
      message: `[psd-set] 套图信息: ${psdSet.name}, 贴纸: ${stickerDesc || stickers.length}, PSD(${psdSourceType}): ${psdSourcePath}`,
    });

    // 2. 下载贴纸和PSD模板到本地（如果已下载则跳过）
    emitter.emit("psdSetProgress", {
      psdSetId,
      step: "步骤 2/5: 下载资源文件",
      message: "正在检查并下载贴纸和PSD模板...",
      progress: 2,
      total: 5,
    });
    const downloadSticker = async (url: string) => {
      emitter.emit("log", {
        level: "info",
        message: `[psd-set] 检查贴纸是否已下载: ${url}`,
      });
      const checkResult = await (window.api as any).checkFileDownloaded(url);
      if (checkResult.found && checkResult.filePath) {
        emitter.emit("log", {
          level: "info",
          message: `[psd-set] 贴纸已存在，跳过下载: ${checkResult.filePath}`,
        });
        return checkResult.filePath as string;
      }
      const downloadResult = await (window.api as any).downloadFile(url);
      if (!downloadResult.success || !downloadResult.filePath) {
        throw new Error(
          `下载贴纸失败: ${downloadResult.message || "未知错误"}`,
        );
      }
      emitter.emit("log", {
        level: "info",
        message: `[psd-set] 贴纸下载完成: ${downloadResult.filePath}`,
      });
      return downloadResult.filePath as string;
    };

    emitter.emit("psdSetProgress", {
      psdSetId,
      step: "步骤 2/5: 下载资源文件",
      message: "正在检查并下载贴纸文件...",
      progress: 2,
      total: 5,
    });
    try {
      if (socket && socket.connected) {
        socket.emit("production-status", {
          psdSetId,
          status: "processing",
          message: "正在下载贴纸文件",
          progress: 2,
          total: 5,
        });
      }
    } catch (e) {
      emitter.emit("log", {
        level: "warn",
        message: `[ws] 发送 production-status（下载贴纸）失败: ${serializeError(e)}`,
      });
    }
    emitPsAutomationStatus({
      currentPsSetId: psdSetId,
      currentPsSetName: psdSet.name || null,
      progress: 40,
    });

    // 辅助函数：获取文件扩展名
    const getFileExtension = (filePath: string): string => {
      const lastDot = filePath.lastIndexOf(".");
      const lastSlash = Math.max(
        filePath.lastIndexOf("/"),
        filePath.lastIndexOf("\\"),
      );
      if (lastDot > lastSlash && lastDot !== -1) {
        return filePath.substring(lastDot);
      }
      return "";
    };

    // 辅助函数：获取文件名（不含扩展名）
    const getFileNameWithoutExt = (filePath: string): string => {
      const lastSlash = Math.max(
        filePath.lastIndexOf("/"),
        filePath.lastIndexOf("\\"),
      );
      const fileName =
        lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
      const lastDot = fileName.lastIndexOf(".");
      if (lastDot > 0) {
        return fileName.substring(0, lastDot);
      }
      return fileName;
    };

    // 辅助函数：获取目录路径
    const getDirPath = (filePath: string): string => {
      const lastSlash = Math.max(
        filePath.lastIndexOf("/"),
        filePath.lastIndexOf("\\"),
      );
      if (lastSlash >= 0) {
        return filePath.substring(0, lastSlash + 1);
      }
      return "";
    };

    // 辅助函数：获取文件名
    const getFileName = (filePath: string): string => {
      const lastSlash = Math.max(
        filePath.lastIndexOf("/"),
        filePath.lastIndexOf("\\"),
      );
      return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
    };

    const stickerLocalPaths: string[] = [];
    for (const sticker of stickers) {
      const url = (sticker?.url || "").trim();
      if (!url) {
        throw new Error(`贴纸缺少URL，ID=${sticker?.id || "unknown"}`);
      }
      let filePath = await downloadSticker(url);
      stickerLocalPaths.push(filePath);
    }

    // 辅助函数：处理图片格式标准化（SVG/WebP转换为PNG，Photoshop兼容性更好）
    const processImageToPngIfNeeded = async (
      imagePath: string,
    ): Promise<string> => {
      // 检查文件扩展名
      const fileExt = getFileExtension(imagePath).toLowerCase();
      if (fileExt !== ".svg" && fileExt !== ".webp") {
        return imagePath;
      }

      const formatLabel = fileExt === ".svg" ? "SVG" : "WebP";
      emitter.emit("log", {
        level: "info",
        message: `[psd-set] 检测到${formatLabel}素材，正在转换为PNG: ${getFileName(imagePath)}`,
      });

      try {
        // 生成安全的PNG文件路径，避免特殊字符和转义符问题
        const dir = getDirPath(imagePath);
        let baseName = getFileNameWithoutExt(imagePath);

        // 先进行URL解码，处理%20等编码字符
        try {
          baseName = decodeURIComponent(baseName);
        } catch (error) {
          // 如果解码失败，保持原名
          console.warn("文件名URL解码失败:", error);
        }

        // 清理连续的空白字符，替换为单个空格
        baseName = baseName.replace(/\s+/g, " ").trim();

        // 清理文件名中的特殊字符，确保Photoshop能正确处理
        const safeBaseName = baseName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
        const pngFilePath = dir + safeBaseName + ".png";

        // 直接使用本地文件路径进行转换，保持原始比例，不指定尺寸
        await convertImageFileToPng(imagePath, pngFilePath);

        emitter.emit("log", {
          level: "info",
          message: `[psd-set] ${formatLabel}转换完成，PNG文件保存到: ${getFileName(pngFilePath)}`,
        });

        return pngFilePath;
      } catch (convertError) {
        emitter.emit("log", {
          level: "error",
          message: `[psd-set] ${formatLabel}转PNG失败，使用原始文件: ${serializeError(convertError)}`,
        });
        // 如果转换失败，继续使用原始文件
        return imagePath;
      }
    };

    // 检查 / 准备 PSD 模板：优先使用本地路径，其次远程 URL（本地不可用则自动回退）
    const ensureRemotePsd = async (remoteUrl: string): Promise<string> => {
      emitter.emit("log", {
        level: "info",
        message: `[psd-set] 检查PSD模板是否已下载...`,
      });
      const psdCheckResult = await (window.api as any).checkFileDownloaded(
        remoteUrl,
      );

      if (psdCheckResult.found && psdCheckResult.filePath) {
        emitter.emit("psdSetProgress", {
          psdSetId,
          step: "步骤 2/5: 下载资源文件",
          message: "PSD模板已存在，资源文件准备完成",
          progress: 2,
          total: 5,
        });
        emitter.emit("log", {
          level: "info",
          message: `[psd-set] PSD模板已存在，跳过下载: ${psdCheckResult.filePath}`,
        });
        return psdCheckResult.filePath;
      }

      emitter.emit("psdSetProgress", {
        psdSetId,
        step: "步骤 2/5: 下载资源文件",
        message: "正在下载PSD模板文件...",
        progress: 2,
        total: 5,
      });
      try {
        if (socket && socket.connected) {
          socket.emit("production-status", {
            psdSetId,
            status: "processing",
            message: "正在下载PSD模板文件",
            progress: 2,
            total: 5,
          });
        }
      } catch (e) {
        emitter.emit("log", {
          level: "warn",
          message: `[ws] 发送 production-status（下载PSD）失败: ${serializeError(e)}`,
        });
      }
      emitter.emit("log", {
        level: "info",
        message: `[psd-set] 正在下载PSD模板到工作目录...`,
      });
      const psdDownloadResult = await (window.api as any).downloadFile(
        remoteUrl,
      );
      if (!psdDownloadResult.success || !psdDownloadResult.filePath) {
        const urlInfo = remoteUrl || "unknown";
        const statusCode = psdDownloadResult.statusCode
          ? ` (statusCode=${psdDownloadResult.statusCode})`
          : "";
        const errorMsg =
          psdDownloadResult.message || psdDownloadResult.error || "未知错误";
        const msg = `下载 PSD 模板失败：${errorMsg}，URL：${urlInfo}${statusCode}。建议：确认 URL 在浏览器可访问，检查网络/代理/证书设置，或在后台改用本地路径。`;
        emitter.emit("psdSetProgress", {
          psdSetId,
          step: "步骤 2/5: 下载资源文件",
          message: msg,
          progress: 2,
          total: 5,
        });
        emitter.emit("toast", {
          color: "error",
          icon: "mdi-alert-circle-outline",
          message: msg,
        });
        throw new Error(msg);
      }
      if (psdDownloadResult.skipped) {
        emitter.emit("psdSetProgress", {
          psdSetId,
          step: "步骤 2/5: 下载资源文件",
          message: "PSD模板文件已存在，资源文件准备完成",
          progress: 2,
          total: 5,
        });
        emitter.emit("log", {
          level: "info",
          message: `[psd-set] PSD模板文件已存在，已跳过下载: ${psdDownloadResult.filePath}`,
        });
      } else {
        emitter.emit("psdSetProgress", {
          psdSetId,
          step: "步骤 2/5: 下载资源文件",
          message: "PSD模板下载完成，资源文件准备完成",
          progress: 2,
          total: 5,
        });
        emitter.emit("log", {
          level: "info",
          message: `[psd-set] PSD模板下载完成: ${psdDownloadResult.filePath}`,
        });
      }
      return psdDownloadResult.filePath;
    };

    let psdLocalPath: string;
    if (psdSourceType === "local") {
      psdLocalPath = psdSourcePath;
      emitter.emit("psdSetProgress", {
        psdSetId,
        step: "步骤 2/5: 下载资源文件",
        message: "已使用本地 PSD 路径，跳过下载",
        progress: 2,
        total: 5,
      });
      emitter.emit("log", {
        level: "info",
        message: `[psd-set] 使用本地 PSD 路径，跳过下载: ${psdLocalPath}`,
      });
      // 验证本地路径是否真实存在，如不存在则自动回退到远程 URL（若有）
      try {
        const checkResult = await (window.api as any).checkLocalFileExists(
          psdLocalPath,
        );
        if (!checkResult || !checkResult.exists || !checkResult.isFile) {
          if (remotePsdUrl) {
            const fallbackMsg = `本地 PSD 文件不存在或不可访问：${psdLocalPath}，将回退使用远程 URL 进行下载。`;
            emitter.emit("psdSetProgress", {
              psdSetId,
              step: "步骤 2/5: 下载资源文件",
              message: fallbackMsg,
              progress: 2,
              total: 5,
            });
            emitter.emit("log", {
              level: "warn",
              message: `[psd-set] ${fallbackMsg}`,
            });
            psdLocalPath = await ensureRemotePsd(remotePsdUrl);
            psdSourceType = "remote";
          } else {
            const msg = `本地 PSD 文件不存在或不可访问：${psdLocalPath}。建议：确认该路径为正确的绝对路径，文件存在且客户端进程有读取权限；网络盘请先挂载并测试。`;
            emitter.emit("psdSetProgress", {
              psdSetId,
              step: "步骤 2/5: 下载资源文件",
              message: msg,
              progress: 2,
              total: 5,
            });
            emitter.emit("toast", {
              color: "error",
              icon: "mdi-alert-circle-outline",
              message: msg,
            });
            throw new Error(msg);
          }
        }
      } catch (checkErr) {
        if (remotePsdUrl) {
          const fallbackMsg = `验证本地 PSD 路径异常，将回退使用远程 URL：${serializeError(checkErr)}`;
          emitter.emit("psdSetProgress", {
            psdSetId,
            step: "步骤 2/5: 下载资源文件",
            message: fallbackMsg,
            progress: 2,
            total: 5,
          });
          emitter.emit("log", {
            level: "warn",
            message: `[psd-set] ${fallbackMsg}`,
          });
          psdLocalPath = await ensureRemotePsd(remotePsdUrl);
          psdSourceType = "remote";
        } else {
          const msg = `验证本地 PSD 路径时发生错误：${serializeError(checkErr)}。建议检查路径格式与访问权限。`;
          emitter.emit("psdSetProgress", {
            psdSetId,
            step: "步骤 2/5: 下载资源文件",
            message: msg,
            progress: 2,
            total: 5,
          });
          emitter.emit("toast", {
            color: "error",
            icon: "mdi-alert-circle-outline",
            message: msg,
          });
          throw new Error(msg);
        }
      }
    } else {
      psdLocalPath = await ensureRemotePsd(psdSourcePath);
    }

    emitter.emit("log", {
      level: "info",
      message: `[psd-set] 文件下载完成，贴纸: ${stickerLocalPaths.join(", ")}, PSD: ${psdLocalPath}`,
    });

    // 3. 调用PS服务处理PSD
    emitter.emit("psdSetProgress", {
      psdSetId,
      step: "步骤 3/5: 处理PSD文件",
      message: "正在调用Photoshop服务处理PSD文件，替换智能对象...",
      progress: 3,
      total: 5,
    });
    try {
      if (socket && socket.connected) {
        socket.emit("production-status", {
          psdSetId,
          status: "processing",
          message: "正在处理PSD文件",
          progress: 3,
          total: 5,
        });
      }
    } catch (e) {
      emitter.emit("log", {
        level: "warn",
        message: `[ws] 发送 production-status（处理PSD）失败: ${serializeError(e)}`,
      });
    }
    emitPsAutomationStatus({
      currentPsSetId: psdSetId,
      currentPsSetName: psdSet.name || null,
      progress: 60,
    });
    emitter.emit("log", {
      level: "info",
      message: `[psd-set] 正在调用PS服务处理PSD...`,
    });
    emitter.emit("toast", {
      color: "info",
      icon: "mdi-image-edit-outline",
      message: "正在处理PSD文件...",
    });

    // 获取工作目录用于导出
    const workspaceDir = await (window.api as any).getWorkspaceDirectory();

    // 配置优先级：套图的 stickerPsdSetConfig > PSD模板的 psdTemplateConfig > 默认配置
    const stickerPsdSetConfig = psdSet.stickerPsdSetConfig;
    const psdTemplateConfig = psdSet.psdTemplate?.psdTemplateConfig;
    const config = stickerPsdSetConfig || psdTemplateConfig;
    const useConfig = config && typeof config === "object";
    let processPayload: any;

    if (useConfig) {
      // 确定使用的配置来源
      const configSource = stickerPsdSetConfig
        ? "套图的 stickerPsdSetConfig"
        : psdTemplateConfig
          ? "PSD模板的 psdTemplateConfig"
          : "未知";

      emitter.emit("log", {
        level: "info",
        message: `[psd-set] 检测到配置，使用${configSource}处理PSD`,
      });

      // 检查 smart_objects 数量是否匹配
      const configSmartObjects = Array.isArray(config.smart_objects)
        ? config.smart_objects
        : [];
      if (configSmartObjects.length !== stickerLocalPaths.length) {
        emitter.emit("log", {
          level: "warn",
          message: `[psd-set] config 中的 smart_objects 数量(${configSmartObjects.length}) 与贴纸数量(${stickerLocalPaths.length})不匹配，将使用实际贴纸数量`,
        });
      }

      // 替换 smart_objects 中的 image_path 为实际下载的贴纸路径
      const smartObjects: any[] = [];
      for (let index = 0; index < configSmartObjects.length; index++) {
        const so = configSmartObjects[index];
        // 如果贴纸数量不足，使用最后一个贴纸路径
        const actualIndex = Math.min(index, stickerLocalPaths.length - 1);
        let imagePath = stickerLocalPaths[actualIndex];

        // 处理SVG转PNG转换
        if (actualIndex < stickers.length) {
          imagePath = await processImageToPngIfNeeded(imagePath);
        }

        // 保留 config 中的其他配置，只替换 image_path
        smartObjects.push({
          ...so,
          image_path: imagePath,
        });
      }

      // 如果 config 中的 smart_objects 数量少于贴纸数量，补充剩余的贴纸
      if (configSmartObjects.length < stickerLocalPaths.length) {
        for (
          let i = configSmartObjects.length;
          i < stickerLocalPaths.length;
          i++
        ) {
          let imagePath = stickerLocalPaths[i];

          // 处理SVG转PNG转换
          imagePath = await processImageToPngIfNeeded(imagePath);
          smartObjects.push({
            image_path: imagePath,
            resize_mode: "contain" as const,
          });
        }
      }

      // 构建 processPayload，使用 config 的配置
      processPayload = {
        ...config,
        // psd_path: config.psd_path && config.psd_path.trim() ? normalizeWindowsPath(config.psd_path) : psdLocalPath,
        psd_path: psdLocalPath,
        export_dir:
          config.export_dir && config.export_dir.trim()
            ? config.export_dir
            : workspaceDir,
        smart_objects: smartObjects,
      };

      emitter.emit("log", {
        level: "info",
        message: `[psd-set] 使用套图 config 配置: psd_path=${processPayload.psd_path}, export_dir=${processPayload.export_dir}, smart_objects数量=${smartObjects.length}`,
      });
    } else {
      // 使用默认逻辑（套图没有 config 时）
      emitter.emit("log", {
        level: "info",
        message: `[psd-set] 套图无 config 配置，使用默认方式处理PSD`,
      });

      // 使用新格式：smart_objects 数组
      // 使用 cover 模式：保持宽高比，填充目标区域（可能裁剪）
      // 构建 smart_objects 时，确保每个 image_path 都有正确的后缀名（双重保险）
      const smartObjects: any[] = [];
      for (let index = 0; index < stickers.length; index++) {
        let imagePath = stickerLocalPaths[index];

        // 处理SVG转PNG转换
        imagePath = await processImageToPngIfNeeded(imagePath);
        smartObjects.push({
          image_path: imagePath,
          resize_mode: "contain" as const,
        });
      }

      processPayload = {
        defaults: {
          resize_mode: "contain" as const,
          tile_size: 512,
        },
        psd_path: psdLocalPath,
        smart_objects: smartObjects,
        export_dir: workspaceDir,
      };
    }

    // 打印即将发送给 Photoshop 服务的参数，便于排查多素材 / smart_objects 问题
    // 简化 smart_objects 输出，避免日志过大
    const logSmartObjects = processPayload.smart_objects.map((so: any) => {
      const logSo: any = {
        image_path: so.image_path,
        resize_mode: so.resize_mode,
      };
      // 如果有 custom_options，也显示关键信息
      if (so.custom_options) {
        logSo.custom_options = {
          position: so.custom_options.position,
          size: so.custom_options.size,
        };
      }
      if (so.tile_size) {
        logSo.tile_size = so.tile_size;
      }
      return logSo;
    });

    emitter.emit("log", {
      level: "info",
      message: `[psd-set] 调用 processPsd 参数: ${JSON.stringify(
        {
          ...processPayload,
          smart_objects: logSmartObjects,
        },
        null,
        2,
      )}`,
    });

    const processResult = await photoshopApi.processPsd(processPayload);

    if (!processResult.success || !processResult.data?.export_files) {
      throw new Error(`PS处理失败: ${processResult.message || "未知错误"}`);
    }

    // 过滤出成功导出的文件
    const successfulFiles = processResult.data.export_files.filter(
      (file) => file.success && file.export_path,
    );

    if (successfulFiles.length === 0) {
      throw new Error(`PS处理失败: 所有文件导出失败`);
    }

    emitter.emit("psdSetProgress", {
      psdSetId,
      step: "步骤 3/5: 处理PSD文件",
      message: `PSD处理完成，已生成 ${successfulFiles.length} 个图片文件`,
      progress: 3,
      total: 5,
    });
    emitter.emit("log", {
      level: "info",
      message: `[psd-set] PSD处理完成，生成 ${successfulFiles.length} 个图片文件`,
    });

    // 4. 上传生成的图片到COS（支持多文件）
    emitter.emit("psdSetProgress", {
      psdSetId,
      step: "步骤 4/5: 上传图片",
      message: `正在上传 ${successfulFiles.length} 个图片到云存储...`,
      progress: 4,
      total: 5,
    });
    try {
      if (socket && socket.connected) {
        socket.emit("production-status", {
          psdSetId,
          status: "processing",
          message: "正在上传生成的图片",
          progress: 4,
          total: 5,
        });
      }
    } catch (e) {
      emitter.emit("log", {
        level: "warn",
        message: `[ws] 发送 production-status（上传图片）失败: ${serializeError(e)}`,
      });
    }
    emitPsAutomationStatus({
      currentPsSetId: psdSetId,
      currentPsSetName: psdSet.name || null,
      progress: 80,
    });
    emitter.emit("log", {
      level: "info",
      message: `[psd-set] 正在上传 ${successfulFiles.length} 个图片到COS...`,
    });
    emitter.emit("toast", {
      color: "info",
      icon: "mdi-cloud-upload",
      message: `正在上传 ${successfulFiles.length} 个图片...`,
    });

    // 批量上传所有文件到COS
    const timestamp = Date.now();
    const uploadedImageUrls: string[] = [];
    const uploadErrors: string[] = [];

    for (let i = 0; i < successfulFiles.length; i++) {
      const file = successfulFiles[i];
      if (!file.export_path) continue;

      try {
        const fileName =
          file.export_file ||
          file.export_path.split(/[/\\]/).pop() ||
          `psd-set-${psdSetId}-${timestamp}-${i}.png`;

        // 使用统一的用户目录结构生成路径
        // 路径格式：users/{userId}_{account}/sticker-psd-set/{dateYYYYMMDD}/{psdSetId}/{timestamp}_{filename}
        const keyResult = await (window.api as any).generateCosKey({
          category: "sticker-psd-set",
          filename: fileName,
          entityId: psdSetId,
          timestamp: timestamp + i, // 为每个文件添加索引，确保唯一性
        });

        if (!keyResult.ok || !keyResult.key) {
          throw new Error(`生成COS Key失败: ${keyResult.msg || "未知错误"}`);
        }

        const cosKey = keyResult.key;

        emitter.emit("log", {
          level: "info",
          message: `[psd-set] 正在上传第 ${i + 1}/${successfulFiles.length} 个文件: ${fileName}`,
        });

        const uploadResult = await (window.api as any).uploadFileToCos({
          filePath: file.export_path,
          key: cosKey,
        });

        if (!uploadResult.ok || !uploadResult.url) {
          const errorMsg = `上传第 ${i + 1} 个文件失败: ${uploadResult.msg || "未知错误"}`;
          uploadErrors.push(errorMsg);
          emitter.emit("log", {
            level: "error",
            message: `[psd-set] ${errorMsg}`,
          });
        } else {
          uploadedImageUrls.push(uploadResult.url);
          emitter.emit("log", {
            level: "info",
            message: `[psd-set] 第 ${i + 1}/${successfulFiles.length} 个文件上传成功: ${uploadResult.url}`,
          });
        }
      } catch (error: any) {
        const errorMsg = `上传第 ${i + 1} 个文件时出错: ${error.message || String(error)}`;
        uploadErrors.push(errorMsg);
        emitter.emit("log", {
          level: "error",
          message: `[psd-set] ${errorMsg}`,
        });
      }
    }

    // 检查是否有成功上传的文件
    if (uploadedImageUrls.length === 0) {
      throw new Error(`所有文件上传COS失败: ${uploadErrors.join("; ")}`);
    }

    // 如果有部分失败，记录警告但不中断流程
    if (uploadErrors.length > 0) {
      emitter.emit("log", {
        level: "warn",
        message: `[psd-set] 部分文件上传失败: ${uploadErrors.join("; ")}，已成功上传 ${uploadedImageUrls.length}/${successfulFiles.length} 个文件`,
      });
    }

    emitter.emit("psdSetProgress", {
      psdSetId,
      step: "步骤 4/5: 上传图片",
      message: `已成功上传 ${uploadedImageUrls.length}/${successfulFiles.length} 个图片，正在更新套图信息...`,
      progress: 4,
      total: 5,
    });
    emitter.emit("log", {
      level: "info",
      message: `[psd-set] 图片上传完成，成功: ${uploadedImageUrls.length}/${successfulFiles.length} 个`,
    });

    // 5. 更新套图的images字段和状态
    emitter.emit("psdSetProgress", {
      psdSetId,
      step: "步骤 5/5: 更新套图信息",
      message: "正在保存套图信息到服务器...",
      progress: 5,
      total: 5,
    });
    emitter.emit("log", {
      level: "info",
      message: `[psd-set] 正在更新套图信息...`,
    });

    // 注意：更新时一定是更新所有images，直接使用新图片数组，不追加到旧的
    // 旧的images会在服务端被删除（包括COS文件和数据库记录）
    // 使用所有成功上传的文件URL
    const updatedImages = uploadedImageUrls;

    // 计算制作耗时(秒)
    const productionEndTime = Date.now();
    const processingTime = (productionEndTime - productionStartTime) / 1000;

    await stickerPsdSetApi.update(psdSetId, {
      images: updatedImages,
      processingTime: processingTime,
    });

    // 通知服务器与管理后台：已完成
    try {
      if (socket && socket.connected) {
        socket.emit("production-status", {
          psdSetId,
          status: "completed",
          message: "制作完成",
          progress: 5,
          total: 5,
        });
      }
    } catch (e) {
      emitter.emit("log", {
        level: "warn",
        message: `[ws] 发送 production-status（完成）失败: ${serializeError(e)}`,
      });
    }
    emitPsAutomationStatus({
      running: false,
      currentPsSetId: null,
      currentPsSetName: null,
      progress: 100,
      lastError: null,
    });

    emitter.emit("psdSetProgress", {
      psdSetId,
      step: "步骤 5/5: 更新套图信息",
      message: "套图制作完成！已保存所有信息",
      progress: 5,
      total: 5,
    });
    emitter.emit("log", {
      level: "info",
      message: `[psd-set] 套图制作完成，已更新images字段，共 ${updatedImages.length} 张图片`,
    });

    // 发送完成事件
    emitter.emit("psdSetProgressEnd", {
      psdSetId,
      success: true,
      message: "套图制作完成！已生成并上传图片",
    });

    emitter.emit("toast", {
      color: "success",
      icon: "mdi-check-circle",
      message: `套图制作完成！已生成并上传图片`,
    });
  } catch (error: any) {
    emitter.emit("log", {
      level: "error",
      message: `[psd-set] 套图制作失败: ${error.message || String(error)}`,
    });

    // 通知服务器与管理后台：已失败
    try {
      if (socket && socket.connected) {
        socket.emit("production-status", {
          psdSetId,
          status: "failed",
          message: error.message || "制作失败",
        });
      }
    } catch (e) {
      emitter.emit("log", {
        level: "warn",
        message: `[ws] 发送 production-status（失败）失败: ${serializeError(e)}`,
      });
    }
    emitPsAutomationStatus({
      running: false,
      currentPsSetId: psdSetId,
      progress: null,
      lastError: error.message || "制作失败",
    });

    // 发送失败事件
    emitter.emit("psdSetProgressEnd", {
      psdSetId,
      success: false,
      message: error.message || "制作失败",
    });

    throw error;
  } finally {
    // 清除制作状态
    isProductionInProgress = false;
    currentProductionTaskId = null;
    emitPsAutomationStatus({
      running: false,
      progress: null,
      queueCount: 0,
      currentPsSetId: null,
      currentPsSetName: null,
    });
    void syncServiceRuntime("photoshop");
  }
}

async function getPhotoshopRuntime(): Promise<Partial<ClientServiceStatus>> {
  const lastCheckedAt = new Date().toISOString();
  const isBusy = isProductionInProgress;
  const nativeApi = getNativeApi();

  if (!nativeApi) {
    return {
      label: "Photoshop",
      connected: false,
      available: false,
      status: "disconnected",
      state: "offline",
      busy: isBusy,
      currentTaskId: currentProductionTaskId,
      message: "当前为浏览器环境，未注入桌面端 Photoshop 能力",
      endpoint: "http://localhost:1595",
      lastCheckedAt,
      lastError: null,
      debugAvailable: false,
      supportedCommands: ["refreshRuntime", "health"],
      details: {
        serviceHealthy: false,
        serviceStatus: "offline",
        photoshopRunning: false,
        photoshopReady: false,
        photoshopStatus: "unsupported",
        runtime: "browser",
      },
    };
  }

  try {
    const health = await photoshopApi.checkHealth();
    const psStatus = await photoshopApi.checkPhotoshopStatus(false);
    const photoshopRunning = !!psStatus.is_running;
    const photoshopReady = !!(psStatus.is_available && photoshopRunning);
    const available = !!(photoshopReady && !isBusy);

    return {
      label: "Photoshop",
      connected: true,
      available,
      status: "connected",
      state: isBusy ? "busy" : available ? "idle" : "connected",
      busy: isBusy,
      currentTaskId: currentProductionTaskId,
      message: isBusy
        ? "正在执行 Photoshop 任务"
        : photoshopReady
          ? "PS 服务已连接，Photoshop 可执行"
          : photoshopRunning
            ? "PS 服务已连接，Photoshop 已启动，等待可执行状态"
            : "PS 服务已连接，等待 Photoshop 启动",
      version: health.version || psStatus.connection_test?.version,
      endpoint: "http://localhost:1595",
      lastCheckedAt,
      lastError: null,
      debugAvailable: true,
      supportedCommands: [
        "refreshRuntime",
        "health",
        "startPhotoshop",
        "stopPhotoshop",
        "restartPhotoshop",
        "processPsdSet",
        "analyzePsd",
        "debugProcess",
      ],
      details: {
        serviceHealthy: true,
        serviceStatus: "connected",
        photoshopRunning,
        photoshopReady,
        photoshopStatus: isBusy
          ? "busy"
          : photoshopReady
            ? "ready"
            : photoshopRunning
              ? "starting"
              : "stopped",
        rawStatus: psStatus,
      },
    };
  } catch (error: any) {
    const networkError =
      error?.code === "ECONNREFUSED" ||
      error?.message?.includes("Network Error") ||
      error?.message?.includes("fetch");

    if (networkError) {
      return {
        label: "Photoshop",
        connected: false,
        available: false,
        status: "disconnected",
        state: "offline",
        busy: false,
        currentTaskId: null,
        message: "PS 处理服务未启动",
        endpoint: "http://localhost:1595",
        lastCheckedAt,
        lastError: null,
        debugAvailable: true,
        supportedCommands: ["refreshRuntime", "health"],
        details: {
          serviceHealthy: false,
          serviceStatus: "offline",
          photoshopRunning: false,
          photoshopReady: false,
          photoshopStatus: "unknown",
        },
      };
    }

    return {
      label: "Photoshop",
      connected: false,
      available: false,
      status: "error",
      state: "error",
      busy: false,
      currentTaskId: null,
      message: error?.message || "PS 处理服务异常",
      endpoint: "http://localhost:1595",
      lastCheckedAt,
      lastError: error?.message || "PS 处理服务异常",
      debugAvailable: true,
      supportedCommands: ["refreshRuntime", "health"],
      details: {
        serviceHealthy: false,
        serviceStatus: "error",
        photoshopRunning: false,
        photoshopReady: false,
        photoshopStatus: "unknown",
      },
    };
  }
}

async function getUploaderRuntime(): Promise<Partial<ClientServiceStatus>> {
  const checkedAt = new Date().toISOString();
  const capabilitySummary = buildPublishTaskCapabilitySummary();
  const profilesResponse = await getCachedUploaderProfiles().catch(
    () => EMPTY_UPLOADER_PROFILES_RESPONSE,
  );
  const profileItems = Array.isArray(profilesResponse?.data?.items)
    ? profilesResponse.data.items
    : [];
  const activeProfile =
    profileItems.find(
      (item) =>
        item?.isActive === true ||
        item?.id === profilesResponse?.data?.activeProfileId,
    ) || null;
  const resolveActiveProfile = (profileId?: string | null) => {
    const normalizedProfileId = String(profileId || "").trim();
    return (
      activeProfile ||
      (normalizedProfileId
        ? profileItems.find((item) => item?.id === normalizedProfileId) || null
        : null)
    );
  };
  const executionSnapshot = buildBrowserAutomationExecutionSnapshot();
  const status = await checkUploaderStatus();
  if (!status.connected) {
    const resolvedActiveProfile = resolveActiveProfile(
      profilesResponse?.data?.activeProfileId || null,
    );
    return buildBrowserAutomationRuntimePatch({
      label: "浏览器自动化",
      connected: false,
      available: false,
      status: "disconnected",
      state: "offline",
      busy: false,
      message: "自动化服务未启动",
      version: status.apiInfo?.version,
      endpoint: "ipc://auto-browser",
      lastCheckedAt: checkedAt,
      lastError: status.message ?? null,
      supportedCommands: [
        "refreshRuntime",
        "health",
        "connect",
        "close",
        "forceClose",
        "getPages",
        "listProfiles",
        "getProfileDetail",
        "createProfile",
        "updateProfile",
        "deleteProfile",
        "switchProfile",
        "executePublishTask",
        "stopPublishTask",
        "getEcomCollectCapabilities",
        "ecomSelectionSupplyMatchRun",
        "setAutoDispatch",
      ],
      supportedTaskTypes: capabilitySummary.map((item) => item.taskType),
      autoDispatchEnabled: browserAutomationDispatchState.autoDispatchEnabled,
      details: {
        browserConnected: false,
        pageCount: 0,
        serviceMessage: status.message ?? null,
        autoDispatchEnabled: browserAutomationDispatchState.autoDispatchEnabled,
        capabilities: capabilitySummary,
        profiles: profileItems,
        instances: buildBrowserAutomationProfileInstances(profileItems, null),
        availableProfileIds: [],
        runningProfileIds: executionSnapshot.items
          .filter((item) => item.running && item.profileId)
          .map((item) => String(item.profileId || "").trim())
          .filter(Boolean),
        activeProfileId: profilesResponse?.data?.activeProfileId || null,
        activeProfile: resolvedActiveProfile,
        loginSummary:
          resolvedActiveProfile?.loginSummary &&
          typeof resolvedActiveProfile.loginSummary === "object"
            ? resolvedActiveProfile.loginSummary
            : null,
        activeProfileLoginSummary:
          resolvedActiveProfile?.loginSummary &&
          typeof resolvedActiveProfile.loginSummary === "object"
            ? resolvedActiveProfile.loginSummary
            : null,
        profilesRootDir: profilesResponse?.data?.profilesRootDir || null,
        workspaceDir: profilesResponse?.data?.workspaceDir || null,
        ecomCollect: uploaderEcomCollectCapabilityCache.data
          ? {
              ...uploaderEcomCollectCapabilityCache.data,
              source: "cache",
            }
          : null,
      },
    });
  }

  const ecomCollectCapability =
    await getCachedUploaderEcomCollectCapabilities();
  const browser = await getUploaderBrowserStatus();
  const available = browser.success && isUploaderBrowserReady(browser.data);
  const browserData = browser.data;
  const browserMessage =
    browser.message ||
    browserData?.lastError ||
    browserData?.localBrowser?.message ||
    null;
  const profileInstances = buildBrowserAutomationProfileInstances(
    profileItems,
    (browserData as Record<string, any> | undefined) || null,
  );
  const resolvedActiveProfile = resolveActiveProfile(
    browserData?.connection?.activeProfileId ||
      profilesResponse?.data?.activeProfileId ||
      null,
  );
  return buildBrowserAutomationRuntimePatch({
    label: "浏览器自动化",
    connected: true,
    available,
    status: "connected",
    state: available ? "idle" : browser.success ? "offline" : "error",
    busy: browserAutomationExecutionState.running,
    message: available
      ? "自动化服务与浏览器实例已连接"
      : browserMessage || "自动化服务已启动，但浏览器实例未就绪",
    version: status.apiInfo?.version,
    endpoint: "ipc://auto-browser",
    lastCheckedAt: checkedAt,
    lastError: available ? null : browserMessage,
    supportedCommands: [
      "refreshRuntime",
      "health",
      "connect",
      "close",
      "forceClose",
      "getPages",
      "getTasks",
      "getTaskDetail",
      "getTaskLogs",
      "listProfiles",
      "getProfileDetail",
      "createProfile",
      "updateProfile",
      "deleteProfile",
      "switchProfile",
      "getPlatforms",
      "getEcomCollectCapabilities",
      "getLoginStatus",
      "publish",
      "executePublishTask",
      "stopPublishTask",
      "ecomCollectRun",
      "ecomSelectionSupplyMatchRun",
      "setAutoDispatch",
    ],
    supportedTaskTypes: capabilitySummary.map((item) => item.taskType),
    autoDispatchEnabled: browserAutomationDispatchState.autoDispatchEnabled,
    details: {
      browserConnected: !!browserData?.isConnected,
      hasInstance: !!browserData?.hasInstance,
      pageCount: browserData?.pageCount ?? 0,
      localBrowser: browserData?.localBrowser ?? null,
      lastActivity: browserData?.lastActivity ?? null,
      connection: browserData?.connection ?? null,
      pages: Array.isArray(browserData?.pages) ? browserData?.pages : [],
      profiles: profileItems,
      instances: profileInstances,
      availableProfileIds: profileInstances
        .filter((item) => item.available)
        .map((item) => item.profileId),
      runningProfileIds: profileInstances
        .filter((item) => item.busy)
        .map((item) => item.profileId),
      activeProfileId:
        browserData?.connection?.activeProfileId ||
        profilesResponse?.data?.activeProfileId ||
        null,
      activeProfile: resolvedActiveProfile,
      loginSummary:
        resolvedActiveProfile?.loginSummary &&
        typeof resolvedActiveProfile.loginSummary === "object"
          ? resolvedActiveProfile.loginSummary
          : null,
      activeProfileLoginSummary:
        resolvedActiveProfile?.loginSummary &&
        typeof resolvedActiveProfile.loginSummary === "object"
          ? resolvedActiveProfile.loginSummary
          : null,
      profilesRootDir: profilesResponse?.data?.profilesRootDir || null,
      workspaceDir: profilesResponse?.data?.workspaceDir || null,
      autoDispatchEnabled: browserAutomationDispatchState.autoDispatchEnabled,
      capabilities: capabilitySummary,
      ecomCollect: ecomCollectCapability
        ? {
            ...ecomCollectCapability,
            source: "uploader",
          }
        : null,
    },
  });
}

async function getLocalServiceRuntime(): Promise<Partial<ClientServiceStatus>> {
  const nativeApi = getNativeApi();

  if (!nativeApi?.checkLocalServiceStatus) {
    return {
      label: "本地服务",
      connected: false,
      available: false,
      status: "disconnected",
      state: "offline",
      busy: false,
      message: "当前为浏览器环境，未注入桌面端本地服务能力",
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
      supportedCommands: ["refreshRuntime", "health"],
    };
  }

  const status = await nativeApi.checkLocalServiceStatus();
  return {
    label: "本地服务",
    connected: !!status?.running,
    available: !!status?.running,
    status: status?.running ? "connected" : "disconnected",
    state: status?.running ? "idle" : "offline",
    busy: false,
    message: status?.running ? "1519 本地服务可用" : "1519 本地服务未启动",
    lastCheckedAt: new Date().toISOString(),
    lastError: null,
    supportedCommands: ["refreshRuntime", "health"],
  };
}

async function getGoogleArtRuntime(): Promise<Partial<ClientServiceStatus>> {
  const nativeApi = getNativeApi();

  if (!nativeApi?.getGoogleArtStatus) {
    return {
      label: "Google Art",
      connected: false,
      available: false,
      status: "disconnected",
      state: "offline",
      busy: false,
      message: "当前为浏览器环境，未注入桌面端 Google Art 能力",
      endpoint: "",
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
      supportedCommands: ["refreshRuntime", "health"],
      details: {
        platform: null,
        platformName: null,
        binaryExists: false,
        binaryPath: null,
        siteUrl: null,
        siteAvailable: false,
        siteStatus: null,
        siteLatencyMs: null,
        siteCheckedAt: null,
        siteError: null,
        supported: false,
        runtime: "browser",
      },
    };
  }

  const status = await nativeApi.getGoogleArtStatus();
  const connected = true;
  const siteAvailable = !!status?.siteAvailable;
  const available = siteAvailable;

  return {
    label: "Google Art",
    connected,
    available,
    status: available ? "connected" : "error",
    state: available ? "idle" : "error",
    busy: false,
    message:
      status?.message || (available ? "Google Art 可用" : "Google Art 不可用"),
    endpoint: status?.binaryPath || "",
    lastCheckedAt: new Date().toISOString(),
    lastError: available ? null : status?.message || null,
    supportedCommands: ["refreshRuntime", "health", "getZooms", "sync"],
    details: {
      platform: status?.platform || null,
      platformName: status?.platformName || null,
      binaryExists: !!status?.binaryExists,
      binaryPath: status?.binaryPath || null,
      siteUrl: status?.siteUrl || null,
      siteAvailable,
      siteStatus: status?.siteStatus ?? null,
      siteLatencyMs: status?.siteLatencyMs ?? null,
      siteCheckedAt: status?.siteCheckedAt || null,
      siteError: status?.siteError || null,
      supported: !!status?.supported,
    },
  };
}

function registerBuiltInLocalServices() {
  if (localServiceHandlers.size > 0) {
    return;
  }

  registerLocalService({
    key: "photoshop",
    pluginKey: "ps-automation",
    label: "Photoshop",
    getRuntime: getPhotoshopRuntime,
    execute: async (command) => {
      if (command.action === "processPsdSet") {
        const psdSetId = command.payload?.psdSetId;
        if (!psdSetId) {
          throw new Error("缺少 psdSetId");
        }
        if (isProductionInProgress) {
          if (socket?.connected) {
            socket.emit("production-status", {
              psdSetId,
              status: "pending",
              message: "正在处理中，请稍后重试",
              progress: 0,
              total: 0,
            });
          }

          return {
            success: false,
            message: "正在制作中，请稍后重试",
            data: { psdSetId },
          };
        }
        await handlePsdSetProduction(psdSetId, command.commandId);
        return {
          success: true,
          message: "套图制作完成",
          data: { psdSetId },
        };
      }

      if (command.action === "analyzePsd") {
        const psdPath = command.payload?.psdPath;
        if (!psdPath) {
          throw new Error("缺少 psdPath");
        }
        const data = await photoshopApi.analyzePsd(psdPath);
        return {
          success: true,
          message: "PSD 分析完成",
          data,
        };
      }

      if (command.action === "debugProcess") {
        const request = command.payload?.request;
        if (!request) {
          throw new Error("缺少调试请求参数");
        }
        const data = await photoshopApi.processPsd(request);
        return {
          success: data.success,
          message: data.message,
          data,
        };
      }

      if (command.action === "startPhotoshop") {
        const timeout = Math.max(5, Number(command.payload?.timeout) || 30);
        const result = await photoshopApi.startPhotoshop(timeout);
        const runtime = await syncServiceRuntime("photoshop");
        return {
          success: !!result.success,
          message:
            result.message ||
            (result.success ? "Photoshop 已启动" : "启动 Photoshop 失败"),
          data: {
            result,
            runtime,
          },
        };
      }

      if (command.action === "stopPhotoshop") {
        const force = !!command.payload?.force;
        const result = await photoshopApi.stopPhotoshop(force);
        const runtime = await syncServiceRuntime("photoshop");
        return {
          success: !!result.success,
          message:
            result.message ||
            (result.success ? "Photoshop 已关闭" : "关闭 Photoshop 失败"),
          data: {
            result,
            runtime,
          },
        };
      }

      if (command.action === "restartPhotoshop") {
        const timeout = Math.max(5, Number(command.payload?.timeout) || 30);
        const result = await photoshopApi.restartPhotoshop(timeout);
        const runtime = await syncServiceRuntime("photoshop");
        return {
          success: !!result.success,
          message:
            result.message ||
            (result.success ? "Photoshop 已重启" : "重启 Photoshop 失败"),
          data: {
            result,
            runtime,
          },
        };
      }

      throw new Error(`未实现的 Photoshop 命令: ${command.action}`);
    },
  });

  registerLocalService({
    key: "uploader",
    pluginKey: "browser-automation",
    label: "浏览器自动化",
    getRuntime: getUploaderRuntime,
    execute: async (command) => {
      const action = command.action;

      if (action === "checkStatus") {
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: !!runtime,
          message: runtime?.message || "浏览器自动化状态已刷新",
          data: runtime,
        };
      }

      if (action === "connect") {
        const response = await connectUploaderBrowser(command.payload || {});
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "浏览器实例已连接" : "浏览器连接失败"),
          data: {
            result: response.data ?? null,
            runtime,
          },
        };
      }

      if (action === "close") {
        const response = await closeUploaderBrowser(
          String(command.payload?.profileId || "").trim() || undefined,
        );
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "浏览器实例已关闭" : "关闭浏览器失败"),
          data: {
            runtime,
          },
        };
      }

      if (action === "focus") {
        const response = await focusUploaderBrowser(
          String(command.payload?.profileId || "").trim() || undefined,
        );
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "浏览器窗口已聚焦" : "聚焦浏览器失败"),
          data: {
            result: response.data ?? null,
            runtime,
          },
        };
      }

      if (action === "forceClose") {
        const response = await forceCloseUploaderBrowser(
          Number(command.payload?.port) || 9222,
        );
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "浏览器进程已强制关闭" : "强制关闭浏览器失败"),
          data: {
            result: response.data ?? null,
            runtime,
          },
        };
      }

      if (action === "getPages") {
        const response = await getUploaderBrowserPages(
          String(command.payload?.profileId || "").trim() || undefined,
        );
        let runtime = await syncServiceRuntime("uploader");
        if (response.success) {
          runtime = updateServiceStatus(
            "uploader",
            {
              details: {
                ...(runtime?.details || {}),
                pageCount: Array.isArray(response.data)
                  ? response.data.length
                  : (runtime?.details?.pageCount ?? 0),
              },
            },
            { emitClientInfo: false },
          );
          await emitServiceRuntime("uploader", runtime);
        }
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "页面列表已更新" : "获取页面列表失败"),
          data: {
            pages: response.data ?? [],
            runtime,
            errorDetail: response.errorDetail ?? null,
          },
        };
      }

      if (action === "debug") {
        const response = await executeUploaderBrowserDebug(
          command.payload || {},
        );
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "调试命令已执行" : "调试命令执行失败"),
          data: {
            ...(response.data || {}),
            errorDetail: response.errorDetail ?? null,
            runtime,
          },
        };
      }

      if (action === "openPlatform") {
        const platform = String(command.payload?.platform || "").trim();
        const profileId =
          String(command.payload?.profileId || "").trim() || undefined;
        if (!platform) {
          throw new Error("缺少 platform");
        }
        const response = await openUploaderPlatform(platform, profileId);
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "平台页面已打开" : "打开平台页面失败"),
          data: {
            platform,
            profileId: profileId || null,
          },
        };
      }

      if (action === "openLink") {
        const url = String(command.payload?.url || "").trim();
        if (!url) {
          throw new Error("缺少 url");
        }
        const profileId =
          String(command.payload?.profileId || "").trim() || undefined;
        const response = await openUploaderLink(url, profileId);
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "链接已打开" : "打开链接失败"),
          data: {
            url,
            profileId: profileId || null,
          },
        };
      }

      if (action === "getTasks") {
        const response = await getUploaderTaskList(
          (command.payload || {}) as Record<string, unknown>,
        );
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "任务列表已更新" : "获取任务列表失败"),
          data: response.data || { items: [], total: 0 },
        };
      }

      if (action === "getTaskDetail") {
        const taskId = String(command.payload?.taskId || "").trim();
        if (!taskId) {
          throw new Error("缺少 taskId");
        }
        const response = await getUploaderTaskDetail(taskId);
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "任务详情已加载" : "获取任务详情失败"),
          data: {
            taskId,
            task: response.data || null,
          },
        };
      }

      if (action === "getTaskLogs") {
        const taskId = String(command.payload?.taskId || "").trim();
        if (!taskId) {
          throw new Error("缺少 taskId");
        }
        const response = await getUploaderTaskLogs(taskId);
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "任务日志已加载" : "获取任务日志失败"),
          data: {
            taskId,
            logs: response.data || [],
          },
        };
      }

      if (action === "getPlatforms") {
        const response = await getUploaderPlatforms();
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "平台能力已加载" : "获取平台能力失败"),
          data: response.data || { platforms: [], items: [] },
        };
      }

      if (action === "getEcomCollectPlatforms") {
        const response = await getUploaderEcomCollectPlatforms();
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "电商采集目录已加载" : "获取电商采集目录失败"),
          data: response.data || { platforms: [] },
        };
      }

      if (action === "getEcomCollectCapabilities") {
        const data = await getCachedUploaderEcomCollectCapabilities(true);
        await syncServiceRuntime("uploader");
        return {
          success: !!data,
          message: data ? "电商采集能力已加载" : "获取电商采集能力失败",
          data: data || {
            schemaVersion: 1,
            platforms: [],
          },
        };
      }

      if (action === "listSmallFeatures") {
        const response = await getUploaderBrowserSmallFeatures();
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "工具目录已加载" : "获取工具目录失败"),
          data: {
            items: response.data || [],
          },
        };
      }

      if (action === "runSmallFeature") {
        const featureKey = String(command.payload?.featureKey || "").trim();
        if (!featureKey) {
          throw new Error("缺少 featureKey");
        }
        const response = await runUploaderBrowserSmallFeature(
          featureKey,
          (command.payload || {}) as Record<string, unknown>,
        );
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "工具执行完成" : "工具执行失败"),
          data: {
            featureKey,
            result: response.data || null,
          },
        };
      }

      if (action === "listProfiles") {
        const response = await getCachedUploaderProfiles();
        if (response.success) {
          void queueUploaderRuntimeSync();
        }
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "环境列表已加载" : "获取环境列表失败"),
          data: response.data || {
            activeProfileId: null,
            items: [],
          },
        };
      }

      if (action === "getProfileDetail") {
        const profileId = String(command.payload?.profileId || "").trim();
        if (!profileId) {
          throw new Error("缺少 profileId");
        }
        const response = await getUploaderProfileDetail(profileId);
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "环境详情已加载" : "获取环境详情失败"),
          data: response.data || null,
        };
      }

      if (action === "createProfile") {
        const response = await createUploaderProfile(
          (command.payload || {}) as Record<string, unknown>,
        );
        if (response.success) {
          invalidateUploaderProfilesCache();
        }
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "环境已创建" : "创建环境失败"),
          data: {
            profile: response.data || null,
            runtime,
          },
        };
      }

      if (action === "updateProfile") {
        const profileId = String(command.payload?.profileId || "").trim();
        if (!profileId) {
          throw new Error("缺少 profileId");
        }
        const response = await updateUploaderProfile(
          profileId,
          (command.payload || {}) as Record<string, unknown>,
        );
        if (response.success) {
          invalidateUploaderProfilesCache();
        }
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "环境已更新" : "更新环境失败"),
          data: {
            profile: response.data || null,
            runtime,
          },
        };
      }

      if (action === "deleteProfile") {
        const profileId = String(command.payload?.profileId || "").trim();
        if (!profileId) {
          throw new Error("缺少 profileId");
        }
        const response = await deleteUploaderProfile(profileId);
        if (response.success) {
          invalidateUploaderProfilesCache();
        }
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "环境已删除" : "删除环境失败"),
          data: {
            ...(response.data || {}),
            runtime,
          },
        };
      }

      if (action === "switchProfile") {
        const profileId = String(command.payload?.profileId || "").trim();
        if (!profileId) {
          throw new Error("缺少 profileId");
        }
        const response = await switchUploaderProfile(profileId);
        if (response.success) {
          invalidateUploaderProfilesCache();
        }
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "环境已切换" : "切换环境失败"),
          data: {
            profile: response.data || null,
            runtime,
          },
        };
      }

      if (action === "getLoginStatus") {
        const response = await getUploaderLoginStatus(
          !!command.payload?.refresh,
          String(command.payload?.profileId || "").trim() || undefined,
        );
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "登录状态已加载" : "获取登录状态失败"),
          data: response.data || {},
        };
      }

      if (action === "setAutoDispatch") {
        const enabled = command.payload?.enabled !== false;
        browserAutomationDispatchState.autoDispatchEnabled = enabled;
        persistBrowserAutomationAutoDispatchEnabled(enabled);
        const runtime = await syncUploaderRuntimeFromLocalState({
          autoDispatchEnabled: enabled,
          lastCheckedAt: new Date().toISOString(),
        });
        return {
          success: true,
          message: enabled ? "已开启自动执行接单" : "已关闭自动执行接单",
          data: {
            enabled,
            runtime,
          },
        };
      }

      if (action === "executePublishTask") {
        const taskId = String(command.payload?.taskId || "").trim();
        const taskType = String(command.payload?.taskType || "").trim();
        const queue = String(command.payload?.queue || taskType).trim();
        const profileId =
          String(command.payload?.profileId || "").trim() || undefined;
        const dispatchToken =
          String(command.payload?.dispatchToken || "").trim() || undefined;

        if (!taskId) {
          throw new Error("缺少 taskId");
        }
        if (!taskType) {
          throw new Error("缺少 taskType");
        }
        if (isBrowserAutomationExecutionSlotRunning(profileId, taskType)) {
          const busyMessage = "浏览器自动化节点繁忙，任务已回退待调度";
          await emitPublishTaskRuntime({
            taskId,
            taskType,
            queue,
            dispatchToken,
            profileId: profileId || null,
            status: "pending",
            message: busyMessage,
            currentStep: "节点繁忙，等待重新调度",
            error: busyMessage,
          });
          return {
            success: false,
            message: busyMessage,
            data: {
              taskId,
              taskType,
              queue,
              dispatchToken: dispatchToken || null,
            },
          };
        }

        await executePublishQueueTask(taskId, taskType, queue, {
          onRuntime: emitPublishTaskRuntime,
          profileId,
          dispatchToken,
        });
        return {
          success: true,
          message: "发布任务执行完成",
          data: {
            taskId,
            taskType,
            queue,
            dispatchToken: dispatchToken || null,
          },
        };
      }

      if (action === "stopPublishTask") {
        const taskId = String(command.payload?.taskId || "").trim();
        const taskType = String(command.payload?.taskType || "").trim();
        const queue = String(command.payload?.queue || taskType).trim();
        const profileId =
          String(command.payload?.profileId || "").trim() || undefined;
        const dispatchToken =
          String(command.payload?.dispatchToken || "").trim() || undefined;
        const stopReason =
          String(command.payload?.stopReason || "").trim() || "任务已手动停止";

        if (!taskId) {
          throw new Error("缺少 taskId");
        }

        const result = await stopPublishQueueTaskExecution({
          taskId,
          taskType,
          queue,
          profileId: profileId || null,
          dispatchToken: dispatchToken || null,
          reason: stopReason,
        });

        const slotKey =
          findBrowserAutomationExecutionSlotKeyByTaskId(taskId) ||
          resolveBrowserAutomationExecutionSlotKey(profileId || null, taskType);
        if (slotKey) {
          upsertBrowserAutomationExecutionSlot(slotKey, {
            slotKey,
            running: false,
            taskId,
            taskType,
            queue,
            profileId: result.profileId || profileId || null,
            currentStep: "已手动停止",
            progress: null,
            lastError: stopReason,
            runtime: null,
            finishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          await syncUploaderRuntimeFromLocalState({
            busy: browserAutomationExecutionState.running,
            state: browserAutomationExecutionState.running ? "busy" : undefined,
            currentTaskId: browserAutomationExecutionState.running
              ? browserAutomationExecutionState.taskId
              : null,
            lastError: browserAutomationExecutionState.lastError,
          });
        }

        return {
          success: true,
          message: stopReason,
          data: {
            taskId,
            taskType,
            queue,
            profileId: result.profileId || profileId || null,
            dispatchToken: dispatchToken || null,
          },
        };
      }

      if (action === "ecomCollectRun") {
        if (browserAutomationExecutionState.running) {
          return {
            success: false,
            message: "浏览器自动化节点繁忙，暂时无法执行电商采集",
            data: {
              runId: command.payload?.runId || null,
              taskId: command.payload?.taskId || null,
              status: "skipped",
            },
          };
        }

        return executeEcomCollectCommand(command);
      }

      if (action === "ecomSelectionSupplyMatchRun") {
        if (browserAutomationExecutionState.running) {
          return {
            success: false,
            message: "浏览器自动化节点繁忙，暂时无法执行同款匹配",
            data: {
              runId: command.payload?.runId || null,
              taskId: command.payload?.taskId || null,
              status: "skipped",
            },
          };
        }

        return executeEcomSelectionSupplyMatchCommand(command);
      }

      if (action === "publish") {
        const response = await publishByUploader(
          (command.payload || {}) as Record<string, unknown>,
        );
        await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "发布请求已执行" : "发布请求失败"),
          data: response.data || null,
        };
      }

      throw new Error(`未实现的浏览器自动化命令: ${action}`);
    },
  });

  registerLocalService({
    key: "video-template",
    pluginKey: "video-template",
    label: "Video Template 视频引擎",
    getRuntime: getRemotionRuntime,
    execute: async (command) => {
      if (command.action === "refreshRuntime") {
        const runtime = await syncServiceRuntime("video-template");
        return {
          success: !!runtime?.available,
          message: runtime?.message || "Video Template 运行状态已刷新",
          data: {
            runtime,
          },
        };
      }

      if (command.action === "enqueueRender") {
        const result = await executeRemotionRender(command);
        await syncServiceRuntime("video-template");
        return result;
      }

      throw new Error(`未实现的 Video Template 命令: ${command.action}`);
    },
  });

  registerLocalService({
    key: "image-processing",
    pluginKey: "image-processing",
    label: "Image Tool 图片处理",
    getRuntime: getImageProcessingRuntime,
    execute: async (command) => {
      if (command.action === "refreshRuntime") {
        const runtime = await syncServiceRuntime("image-processing");
        return {
          success: !!runtime?.available,
          message: runtime?.message || "Image Tool 运行状态已刷新",
          data: {
            runtime,
          },
        };
      }

      if (command.action === "createTask") {
        const result = await executeImageProcessingTask(command);
        await syncServiceRuntime("image-processing");
        return result;
      }

      throw new Error(`未实现的 Image Tool 命令: ${command.action}`);
    },
  });

  registerLocalService({
    key: "localService",
    pluginKey: "local-service",
    label: "本地服务",
    getRuntime: getLocalServiceRuntime,
  });

  registerLocalService({
    key: "googleArt",
    pluginKey: "google-art",
    label: "Google Art",
    getRuntime: getGoogleArtRuntime,
    execute: async (command) => {
      if (command.action === "getZooms") {
        const url = command.payload?.url;
        const nativeApi = getNativeApi();
        if (!url) {
          throw new Error("缺少 Google Art 链接");
        }
        if (!nativeApi?.getGoogleArtZooms) {
          throw new Error("当前环境未注入桌面端 Google Art 能力");
        }

        const data = await nativeApi.getGoogleArtZooms(url);
        await syncServiceRuntime("google-art");
        return {
          success: !!data?.ok,
          message: data?.ok
            ? "已获取可用分辨率"
            : data?.msg || "获取分辨率失败",
          data,
        };
      }

      if (command.action === "sync") {
        const url = command.payload?.url;
        const zoomLevel = Number(command.payload?.zoomLevel);
        const nativeApi = getNativeApi();

        if (!url) {
          throw new Error("缺少 Google Art 链接");
        }
        if (!Number.isFinite(zoomLevel)) {
          throw new Error("缺少分辨率参数");
        }
        if (!nativeApi?.syncGoogleArtToMaterialLibrary) {
          throw new Error("当前环境未注入桌面端 Google Art 能力");
        }

        const data = await nativeApi.syncGoogleArtToMaterialLibrary({
          url,
          zoomLevel,
        });
        await syncServiceRuntime("google-art");
        return {
          success: !!data?.ok,
          message: data?.ok
            ? "图片已同步到素材库"
            : data?.msg || "同步到素材库失败",
          data,
        };
      }

      throw new Error(`未实现的 Google Art 命令: ${command.action}`);
    },
  });
}

function emitClientInfo() {
  if (!socket || !socket.connected) return;
  const payload = buildClientInfoPayloadForWs();
  const fingerprint = buildWsFingerprint(payload);
  const now = Date.now();
  if (
    fingerprint === lastClientInfoFingerprint &&
    now - lastClientInfoEmittedAt < WS_CLIENT_INFO_REFRESH_MS
  ) {
    return;
  }
  socket.emit("client-info", payload);
  lastClientInfoFingerprint = fingerprint;
  lastClientInfoEmittedAt = now;
}

async function connect(endpoint?: string) {
  let targetEndpoint = endpoint;
  if (!targetEndpoint) {
    try {
      targetEndpoint = getWsEndpoint();
    } catch {
      targetEndpoint = wsState.endpoint || DEFAULT_WS_ENDPOINT;
    }
  }
  wsState.endpoint = targetEndpoint || DEFAULT_WS_ENDPOINT;
  void fetchNetworkProfile();

  if (socket && socket.connected) {
    return;
  }

  cleanupSocket();
  intentionalDisconnect = false;

  updateState({
    status: "connecting",
    lastError: null,
    retryCount: 0,
  });

  let token: string | undefined;
  try {
    token = await getTokenFromClient();
  } catch (error) {
    // 读取 token 失败不阻塞连接，只记录日志
    emitter.emit("log", {
      level: "warn",
      message: `[ws] 获取 token 失败，将在未认证状态下连接: ${serializeError(error)}`,
    });
  }

  socket = io(targetEndpoint, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 12_000,
    timeout: 8000,
    // WebSocket 握手 query 只保留最小路由字段，避免浏览器环境下 URL 过长导致连接失败。
    // token 通过 auth 传递，完整的 clientInfo 会在 connect 后通过 `client-info` 事件补发。
    query: buildQuery(),
    auth: token
      ? {
          token,
        }
      : undefined,
  });

  bindSocketEvents(socket);
}

function disconnect() {
  intentionalDisconnect = true;
  cleanupSocket();
  updateState({
    status: "disconnected",
    lastError: null,
    retryCount: 0,
    connectedAt: null,
  });
}

function reconnect() {
  intentionalDisconnect = false;
  cleanupSocket();
  void connect();
}

function setEndpoint(endpoint: string) {
  wsState.endpoint = endpoint || DEFAULT_WS_ENDPOINT;
  reconnect();
}

function updateClientInfo(
  payload: Partial<ClientInfoPayload>,
  options?: { emit?: boolean },
) {
  Object.assign(clientInfo, payload);
  if (options?.emit !== false) {
    emitClientInfo();
  }
}

function updateServiceStatus(
  serviceKey: string,
  payload: Partial<ClientServiceStatus>,
  options?: { emitClientInfo?: boolean },
) {
  const pluginKey = normalizePluginKey(serviceKey);
  const previous = clientInfo.services?.[pluginKey];
  const rawKey = String(serviceKey || "").trim();
  const hasCurrentTaskId = Object.prototype.hasOwnProperty.call(
    payload,
    "currentTaskId",
  );
  const hasLastError = Object.prototype.hasOwnProperty.call(
    payload,
    "lastError",
  );
  const next: ClientServiceStatus = {
    key: pluginKey,
    pluginKey,
    label: payload.label || previous?.label || pluginKey,
    connected: payload.connected ?? previous?.connected ?? false,
    available: payload.available ?? previous?.available ?? false,
    status: payload.status || previous?.status || "unknown",
    state: payload.state || previous?.state || "offline",
    busy: payload.busy ?? previous?.busy ?? false,
    message: payload.message ?? previous?.message,
    version: payload.version ?? previous?.version,
    endpoint: payload.endpoint ?? previous?.endpoint,
    lastCheckedAt: payload.lastCheckedAt || new Date().toISOString(),
    currentTaskId: hasCurrentTaskId
      ? (payload.currentTaskId ?? null)
      : (previous?.currentTaskId ?? null),
    lastError: hasLastError
      ? (payload.lastError ?? null)
      : (previous?.lastError ?? null),
    debugAvailable: payload.debugAvailable ?? previous?.debugAvailable ?? false,
    supportedCommands:
      payload.supportedCommands ?? previous?.supportedCommands ?? [],
    supportedTaskTypes:
      payload.supportedTaskTypes ?? previous?.supportedTaskTypes ?? [],
    autoDispatchEnabled:
      payload.autoDispatchEnabled ?? previous?.autoDispatchEnabled ?? true,
    details: payload.details ?? previous?.details ?? {},
  };

  updateClientInfo(
    {
      services: {
        ...(clientInfo.services || {}),
        [pluginKey]: next,
        ...(rawKey && rawKey !== pluginKey
          ? {
              [rawKey]: next,
            }
          : {}),
      },
    },
    {
      emit: options?.emitClientInfo !== false,
    },
  );

  return next;
}

void fetchNetworkProfile();

// 服务切换方法
async function switchService(mode: "local" | "remote") {
  setServiceMode(mode);
  const newEndpoint = getWsEndpoint();
  setEndpoint(newEndpoint); // 这会先断开旧连接，再连接新地址
}

export const websocketClient = {
  state: wsState,
  identity,
  network: networkProfile,
  profile: clientInfo,
  connect,
  disconnect,
  reconnect,
  setEndpoint,
  switchService,
  updateClientInfo,
  updateServiceStatus,
  syncServiceRuntime,
  events: emitter,
  refreshLocation: fetchNetworkProfile,
};

// 导出制作入口，便于界面直接触发套图制作
export async function startPsdSetProduction(psdSetId: string) {
  return handlePsdSetProduction(psdSetId);
}

// 查询制作中的状态，避免并发制作
export function isPsdSetProductionInProgress() {
  return isProductionInProgress;
}

export function getCurrentPsdSetProductionTaskId() {
  return currentProductionTaskId;
}

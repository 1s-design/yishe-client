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
  executeUploaderBrowserDebug,
  forceCloseUploaderBrowser,
  getUploaderLoginStatus,
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
  runUploaderEcomCollect,
  type UploaderEcomCollectCapabilitySchema,
} from "../api/uploader";
import { AUTO_PROCESS_TIMING } from "../config/autoProcessTiming";
import {
  buildPublishTaskCapabilitySummary,
  executePublishQueueTask,
  type PublishTaskRuntimeSnapshot,
} from "./publishTaskDispatch";
import { executeEcomSelectionSupplyMatchTask } from "./ecomSelectionSupplyMatch";

type WsStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

const CLIENT_SOURCE = "客户端";
const HEARTBEAT_INTERVAL = 15_000;
const HEARTBEAT_TIMEOUT = 10_000;
const UPLOADER_RUNTIME_SYNC_INTERVAL = 5_000;
const PHOTOSHOP_RUNTIME_SYNC_INTERVAL = 8_000;
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
};
const LEGACY_SERVICE_KEYS: Record<string, string> = {
  "ps-automation": "photoshop",
  "browser-automation": "uploader",
  "local-service": "localService",
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
  platform?: string;
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

function buildPluginRegistrySnapshot() {
  return Array.from(localServiceHandlers.values()).map((handler) => ({
    key: handler.key,
    pluginKey: handler.pluginKey || handler.key,
    label: handler.label,
    channel: handler.channel || "client-bridge",
    supportedCommands:
      clientInfo.services?.[handler.key]?.supportedCommands || [],
  }));
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

let socket: Socket | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
let uploaderRuntimeSyncInterval: ReturnType<typeof setInterval> | null = null;
let photoshopRuntimeSyncInterval: ReturnType<typeof setInterval> | null = null;
let lastPingTimestamp: number | null = null;
let intentionalDisconnect = false;
let networkFetchPromise: Promise<void> | null = null;
// 跟踪是否正在制作中
let isProductionInProgress = false;
let currentProductionTaskId: string | null = null;
const psAutomationControlState = reactive({
  enabled: null as boolean | null,
  autoDispatchEnabled: null as boolean | null,
});

// 供全局展示的自动批处理状态（由前端控制）
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
  currentStep: null as string | null,
  progress: null as number | null,
  lastError: null as string | null,
  runtime: null as Record<string, any> | null,
  startedAt: null as string | null,
  finishedAt: null as string | null,
  updatedAt: null as string | null,
});

const uploaderEcomCollectCapabilityCache = {
  fetchedAt: 0,
  data: null as UploaderEcomCollectCapabilitySchema | null,
};

const UPLOADER_ECOM_CAPABILITY_CACHE_TTL = 60_000;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

  emitClientInfo();
  if (!socket?.connected) {
    return;
  }

  socket.emit("ps-automation-status", buildPsAutomationSnapshot());
}

function buildBrowserAutomationExecutionSnapshot() {
  return {
    running: browserAutomationExecutionState.running,
    taskId: browserAutomationExecutionState.taskId,
    taskType: browserAutomationExecutionState.taskType,
    queue: browserAutomationExecutionState.queue,
    currentStep: browserAutomationExecutionState.currentStep,
    progress: browserAutomationExecutionState.progress,
    lastError: browserAutomationExecutionState.lastError,
    runtime: browserAutomationExecutionState.runtime,
    startedAt: browserAutomationExecutionState.startedAt,
    finishedAt: browserAutomationExecutionState.finishedAt,
    updatedAt: browserAutomationExecutionState.updatedAt,
  };
}

function buildBrowserAutomationRuntimePatch(
  payload: Partial<ClientServiceStatus> = {},
): Partial<ClientServiceStatus> {
  const previous: Record<string, any> =
    clientInfo.services?.["browser-automation"] ||
    clientInfo.services?.uploader ||
    {};
  const executionSnapshot = buildBrowserAutomationExecutionSnapshot();

  return {
    ...payload,
    busy:
      browserAutomationExecutionState.running ||
      payload.busy ||
      previous?.busy ||
      false,
    state: browserAutomationExecutionState.running
      ? "busy"
      : payload.state || previous?.state || "offline",
    currentTaskId:
      browserAutomationExecutionState.taskId ||
      payload.currentTaskId ||
      previous?.currentTaskId ||
      null,
    autoDispatchEnabled: browserAutomationDispatchState.autoDispatchEnabled,
    supportedTaskTypes: buildPublishTaskCapabilitySummary().map(
      (item) => item.taskType,
    ),
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
      ...(previous?.details || {}),
      ...(payload.details || {}),
      autoDispatchEnabled: browserAutomationDispatchState.autoDispatchEnabled,
      executableTaskTypes: buildPublishTaskCapabilitySummary().map(
        (item) => item.taskType,
      ),
      executableTaskLabels: buildPublishTaskCapabilitySummary(),
      currentExecution: executionSnapshot,
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
  );
  await emitServiceRuntime("uploader", nextRuntime);
  return nextRuntime;
}

async function emitPublishTaskRuntime(snapshot: PublishTaskRuntimeSnapshot) {
  const now = new Date().toISOString();
  const currentStatus =
    snapshot.status === "pending" ? "pending" : snapshot.status;
  const running = currentStatus === "assigned" || currentStatus === "running";

  Object.assign(browserAutomationExecutionState, {
    running,
    taskId: snapshot.taskId,
    taskType: snapshot.taskType,
    queue: snapshot.queue,
    currentStep: snapshot.currentStep ?? snapshot.message ?? null,
    progress: snapshot.progress ?? null,
    lastError: snapshot.error ?? null,
    runtime: snapshot.runtime ?? null,
    startedAt: running
      ? browserAutomationExecutionState.startedAt || now
      : browserAutomationExecutionState.startedAt || now,
    finishedAt: running ? null : now,
    updatedAt: now,
  });

  if (
    currentStatus === "completed" ||
    currentStatus === "failed" ||
    currentStatus === "pending"
  ) {
    browserAutomationExecutionState.running = false;
    if (currentStatus === "pending") {
      browserAutomationExecutionState.taskId = null;
      browserAutomationExecutionState.taskType = null;
      browserAutomationExecutionState.queue = null;
      browserAutomationExecutionState.runtime = null;
      browserAutomationExecutionState.progress = null;
      browserAutomationExecutionState.currentStep =
        snapshot.currentStep ?? snapshot.message ?? null;
    }
  }

  emitter.emit("publishTaskRuntime", snapshot);
  socket?.emit("publish-task-runtime", snapshot);
  await syncUploaderRuntimeFromLocalState({
    busy: browserAutomationExecutionState.running,
    state: browserAutomationExecutionState.running ? "busy" : undefined,
    currentTaskId: browserAutomationExecutionState.taskId,
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
  const collectScene = String(command.payload?.collectScene || "").trim();
  const timeoutMs = Number(command.payload?.timeoutMs) || 20 * 60 * 1000;

  if (!runId) {
    throw new Error("缺少 runId");
  }
  if (!platform) {
    throw new Error("缺少 platform");
  }
  if (!collectScene) {
    throw new Error("缺少 collectScene");
  }

  const now = new Date().toISOString();
  Object.assign(browserAutomationExecutionState, {
    running: true,
    taskId: runId,
    taskType: "ecom-collect",
    queue: platform,
    currentStep: `执行电商采集：${platform}/${collectScene}`,
    progress: null,
    lastError: null,
    runtime: {
      runId,
      taskId,
      platform,
      collectScene,
    },
    startedAt: now,
    finishedAt: null,
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
    collectScene,
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
  Object.assign(browserAutomationExecutionState, {
    running: false,
    taskId: runId,
    taskType: "ecom-collect",
    queue: platform,
    currentStep: response.success ? "电商采集完成" : "电商采集失败",
    progress: response.success ? 100 : null,
    lastError: response.success ? null : response.message || "电商采集失败",
    runtime: {
      runId,
      taskId,
      platform,
      collectScene,
      status: response.status || (response.success ? "success" : "failed"),
      summary: response.data?.summary || null,
    },
    finishedAt,
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
      collectScene,
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
  Object.assign(browserAutomationExecutionState, {
    running: true,
    taskId: runId,
    taskType: "ecom-selection-supply-match",
    queue: queueLabel,
    currentStep: `执行找同款：${queueLabel}`,
    progress: null,
    lastError: null,
    runtime: {
      runId,
      taskId,
      matchType,
      supplierPlatforms,
      sourceCount: sourceProducts.length,
    },
    startedAt: now,
    finishedAt: null,
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
    Object.assign(browserAutomationExecutionState, {
      running: false,
      taskId: runId,
      taskType: "ecom-selection-supply-match",
      queue: queueLabel,
      currentStep: response.success ? "找同款完成" : "找同款失败",
      progress: response.success ? 100 : null,
      lastError: response.success ? null : response.message || "找同款失败",
      runtime: {
        runId,
        taskId,
        matchType,
        supplierPlatforms,
        status: response.status || (response.success ? "success" : "failed"),
        summary: response.data?.summary || null,
      },
      finishedAt,
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

    Object.assign(browserAutomationExecutionState, {
      running: false,
      taskId: runId,
      taskType: "ecom-selection-supply-match",
      queue: queueLabel,
      currentStep: "找同款失败",
      progress: null,
      lastError: errorMessage,
      runtime: {
        runId,
        taskId,
        matchType,
        supplierPlatforms,
        status: "failed",
      },
      finishedAt,
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

async function fetchPendingBatch() {
  return stickerPsdSetApi.claimBatch({
    limit: 10,
    includeDetails: false,
  });
}

async function runAutoPsdBatchLoop() {
  if (autoPsdBatchState.running) {
    return;
  }

  autoPsdBatchState.running = true;
  emitPsAutomationStatus({
    running: true,
    lastError: null,
  });

  while (autoPsdBatchState.active) {
    try {
      if (isProductionInProgress) {
        await sleep(AUTO_PROCESS_TIMING.WAIT_WHEN_BUSY_MS);
        continue;
      }

      const res = await fetchPendingBatch();
      const pendingList = res.list || [];
      emitPsAutomationStatus({
        queueCount: pendingList.length,
        running: false,
        progress: null,
      });

      if (!pendingList.length) {
        await sleep(AUTO_PROCESS_TIMING.IDLE_POLL_INTERVAL_MS);
        continue;
      }

      for (const item of pendingList) {
        if (!autoPsdBatchState.active) {
          break;
        }

        emitPsAutomationStatus({
          queueCount: Math.max(pendingList.length - 1, 0),
          currentPsSetId: item.id,
          currentPsSetName: item.name || null,
          running: true,
          progress: 0,
          lastError: null,
        });

        try {
          await startPsdSetProduction(item.id);
        } catch (error: any) {
          emitPsAutomationStatus({
            running: false,
            lastError: error?.message || "自动制作失败",
          });
        }

        if (!autoPsdBatchState.active) {
          break;
        }

        await sleep(AUTO_PROCESS_TIMING.TASK_INTERVAL_MS);
      }
    } catch (error: any) {
      emitPsAutomationStatus({
        running: false,
        lastError: error?.message || "自动制作循环异常",
      });
      await sleep(AUTO_PROCESS_TIMING.ERROR_RETRY_MS);
    }
  }

  autoPsdBatchState.running = false;
  autoPsdBatchState.stopping = false;
  emitPsAutomationStatus({
    running: false,
    queueCount: 0,
    progress: null,
    currentPsSetId: isProductionInProgress
      ? autoPsdBatchState.currentPsSetId
      : null,
    currentPsSetName: isProductionInProgress
      ? autoPsdBatchState.currentPsSetName
      : null,
  });
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
  const normalizedRuntime: ClientServiceStatus = {
    ...runtime,
    key: pluginKey,
    pluginKey,
  };
  emitter.emit("serviceRuntime", {
    service: legacyServiceKey,
    pluginKey,
    runtime: normalizedRuntime,
  });
  if (!socket?.connected) {
    return;
  }
  socket.emit("service-runtime", {
    service: legacyServiceKey,
    pluginKey,
    runtime: normalizedRuntime,
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
    const nextRuntime = updateServiceStatus(pluginKey, runtimePatch);
    await emitServiceRuntime(pluginKey, nextRuntime);
    return nextRuntime;
  } catch (error) {
    const failedRuntime = updateServiceStatus(pluginKey, {
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
    });
    await emitServiceRuntime(pluginKey, failedRuntime);
    return failedRuntime;
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

function stopHeartbeat() {
  clearHeartbeatInterval();
  clearHeartbeatTimeout();
  clearUploaderRuntimeSyncInterval();
  clearPhotoshopRuntimeSyncInterval();
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

function scheduleHeartbeatTimeout() {
  clearHeartbeatTimeout();
  heartbeatTimeout = setTimeout(() => {
    updateState({
      status: "error",
      lastError: "Heartbeat timeout",
    });
    emitter.emit("log", {
      level: "warn",
      message: "[ws] heartbeat timeout, reconnecting",
    });
    emitter.emit("toast", {
      color: "warning",
      icon: "mdi-heart-broken",
      message: "实时通道心跳异常，正在重连...",
    });
    reconnect();
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
  stopHeartbeat();
}

function buildQuery(token?: string | null) {
  const payload: Record<string, string> = {
    clientSource: CLIENT_SOURCE,
    clientId: identity.clientId,
    machineCode: identity.machineCode,
  };

  if (token) {
    payload.token = token;
  }

  try {
    payload.clientInfo = JSON.stringify(clientInfo);
  } catch {
    // ignore serialization errors
  }

  return payload;
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
    startHeartbeatLoop();
  });

  currentSocket.on("disconnect", (reason) => {
    emitter.emit("log", {
      level: "warn",
      message: `[ws] disconnected: ${reason}`,
    });
    emitter.emit("toast", {
      color: "warning",
      icon: "mdi-plug",
      message: `通道断开：${reason || "未知原因"}`,
    });
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
    emitter.emit("log", {
      level: "error",
      message: `[ws] connect_error: ${serializeError(error)}`,
    });
    emitter.emit("toast", {
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "服务连接错误",
    });
    updateState({
      status: "error",
      lastError: serializeError(error),
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
    emitter.emit("toast", {
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

    // 处理特定的命令
    if (data?.command === "start-psd-set-production") {
      const psdSetId = data?.params?.psdSetId;
      if (psdSetId) {
        // 检查是否正在制作中
        if (isProductionInProgress) {
          emitter.emit("log", {
            level: "warn",
            message: `[ws] 收到制作请求，但正在制作中，拒绝新请求: ${psdSetId}`,
          });

          // 如果服务端已经把该套图状态改成「处理中」，这里尝试回退为「待处理」
          try {
            await stickerPsdSetApi.update(psdSetId, {
              status: "pending",
              statusMessage: "客户端正在制作其他套图，请稍后重试",
            });
          } catch (e) {
            emitter.emit("log", {
              level: "warn",
              message: `[ws] 回退套图状态为待处理失败: ${serializeError(e)}`,
            });
          }

          // 同步告知管理后台：保持为待处理
          try {
            if (socket && socket.connected) {
              socket.emit("production-status", {
                psdSetId,
                status: "pending",
                message: "正在处理中，请稍后重试",
                progress: 0,
                total: 0,
              });
            }
          } catch (e) {
            emitter.emit("log", {
              level: "warn",
              message: `[ws] 发送 production-status（保持待处理）失败: ${serializeError(e)}`,
            });
          }

          // 通过 WebSocket 发送响应给前端，告知正在制作中
          if (socket && socket.connected) {
            const responseData = {
              success: false,
              message: "正在制作中，请稍后重试",
              psdSetId: psdSetId,
            };
            emitter.emit("log", {
              level: "info",
              message: `[ws] 发送制作响应（正在制作中）: ${JSON.stringify(responseData)}`,
            });
            socket.emit("start-psd-set-production-response", responseData);
          } else {
            emitter.emit("log", {
              level: "warn",
              message: "[ws] WebSocket 未连接，无法发送制作响应",
            });
          }
          // 同时通过 toast 事件显示提示（如果前端监听了）
          emitter.emit("toast", {
            color: "warning",
            icon: "mdi-clock-outline",
            message: "正在制作中，请稍后重试",
          });
          return;
        }
        // 开始处理套图制作
        handlePsdSetProduction(psdSetId).catch((error) => {
          emitter.emit("log", {
            level: "error",
            message: `[ws] 处理套图制作失败: ${error.message || String(error)}`,
          });
          emitter.emit("toast", {
            color: "error",
            icon: "mdi-alert-circle",
            message: `套图制作失败: ${error.message || "未知错误"}`,
          });
        });
      } else {
        emitter.emit("toast", {
          color: "warning",
          icon: "mdi-alert",
          message: "收到制作请求，但缺少套图ID",
        });
      }
      return;
    }

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
      // 也尝试更新服务端状态，方便管理后台查看（如果有权限）
      try {
        await stickerPsdSetApi.update(psdSetId, {
          status: "failed",
          statusMessage: errorMessage,
        });
      } catch (e) {
        emitter.emit("log", {
          level: "warn",
          message: `[psd-set] 更新失败状态失败: ${serializeError(e)}`,
        });
      }
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

    // 更新状态为处理中
    try {
      await stickerPsdSetApi.update(psdSetId, {
        status: "processing",
        statusMessage: "正在处理中...",
      });
    } catch (updateError) {
      emitter.emit("log", {
        level: "warn",
        message: `[psd-set] 更新处理中状态失败: ${updateError}，继续处理`,
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
        try {
          await stickerPsdSetApi.update(psdSetId, {
            status: "failed",
            statusMessage: msg,
          });
        } catch (e) {
          emitter.emit("log", {
            level: "warn",
            message: `[psd-set] 更新失败状态失败: ${serializeError(e)}`,
          });
        }
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
            try {
              await stickerPsdSetApi.update(psdSetId, {
                status: "failed",
                statusMessage: msg,
              });
            } catch (e) {
              emitter.emit("log", {
                level: "warn",
                message: `[psd-set] 更新失败状态失败: ${serializeError(e)}`,
              });
            }
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
          try {
            await stickerPsdSetApi.update(psdSetId, {
              status: "failed",
              statusMessage: msg,
            });
          } catch (e) {
            emitter.emit("log", {
              level: "warn",
              message: `[psd-set] 更新失败状态失败: ${serializeError(e)}`,
            });
          }
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
      status: "completed",
      statusMessage: "制作完成",
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

    // 尝试更新套图状态为失败
    try {
      await stickerPsdSetApi.update(psdSetId, {
        status: "failed",
        statusMessage: error.message || "制作失败",
      });
    } catch (updateError) {
      emitter.emit("log", {
        level: "error",
        message: `[psd-set] 更新失败状态也失败: ${updateError}`,
      });
    }

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
      currentPsSetId: autoPsdBatchState.active
        ? autoPsdBatchState.currentPsSetId
        : null,
      currentPsSetName: autoPsdBatchState.active
        ? autoPsdBatchState.currentPsSetName
        : null,
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
  const status = await checkUploaderStatus();
  if (!status.connected) {
    return buildBrowserAutomationRuntimePatch({
      label: "浏览器自动化",
      connected: false,
      available: false,
      status: "disconnected",
      state: "offline",
      busy: false,
      message: "自动化服务未启动",
      version: status.apiInfo?.version,
      endpoint: "http://localhost:7010",
      lastCheckedAt: checkedAt,
      lastError: status.message ?? null,
      supportedCommands: [
        "refreshRuntime",
        "health",
        "connect",
        "close",
        "forceClose",
        "getPages",
        "executePublishTask",
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
  return buildBrowserAutomationRuntimePatch({
    label: "浏览器自动化",
    connected: true,
    available,
    status: "connected",
    state: available ? "idle" : browser.success ? "offline" : "error",
    busy: browserAutomationExecutionState.running,
    message: available
      ? "自动化服务与浏览器实例已连接"
      : browser.message || "自动化服务已启动，但浏览器实例未就绪",
    version: status.apiInfo?.version,
    endpoint: "http://localhost:7010",
    lastCheckedAt: checkedAt,
    lastError: browser.success ? null : (browser.message ?? null),
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
      "getPlatforms",
      "getEcomCollectCapabilities",
      "getLoginStatus",
      "publish",
      "executePublishTask",
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
      lastActivity: browserData?.lastActivity ?? null,
      connection: browserData?.connection ?? null,
      pages: Array.isArray(browserData?.pages) ? browserData?.pages : [],
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
          try {
            await stickerPsdSetApi.update(psdSetId, {
              status: "pending",
              statusMessage: "客户端正在制作其他套图，请稍后重试",
            });
          } catch (error) {
            emitter.emit("log", {
              level: "warn",
              message: `[service-command] 回退套图状态失败: ${serializeError(error)}`,
            });
          }

          if (socket?.connected) {
            socket.emit("production-status", {
              psdSetId,
              status: "pending",
              message: "正在处理中，请稍后重试",
              progress: 0,
              total: 0,
            });
            socket.emit("start-psd-set-production-response", {
              success: false,
              message: "正在制作中，请稍后重试",
              psdSetId,
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
        const response = await closeUploaderBrowser();
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
        const response = await getUploaderBrowserPages();
        let runtime = await syncServiceRuntime("uploader");
        if (response.success) {
          runtime = updateServiceStatus("uploader", {
            details: {
              ...(runtime?.details || {}),
              pages: response.data ?? [],
              pageCount: Array.isArray(response.data)
                ? response.data.length
                : (runtime?.details?.pageCount ?? 0),
            },
          });
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
        if (!platform) {
          throw new Error("缺少 platform");
        }
        const response = await openUploaderPlatform(platform);
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "平台页面已打开" : "打开平台页面失败"),
          data: {
            platform,
            runtime,
          },
        };
      }

      if (action === "openLink") {
        const url = String(command.payload?.url || "").trim();
        if (!url) {
          throw new Error("缺少 url");
        }
        const response = await openUploaderLink(url);
        const runtime = await syncServiceRuntime("uploader");
        return {
          success: response.success,
          message:
            response.message ||
            (response.success ? "链接已打开" : "打开链接失败"),
          data: {
            url,
            runtime,
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

      if (action === "getLoginStatus") {
        const response = await getUploaderLoginStatus(
          !!command.payload?.refresh,
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

        if (!taskId) {
          throw new Error("缺少 taskId");
        }
        if (!taskType) {
          throw new Error("缺少 taskType");
        }
        if (browserAutomationExecutionState.running) {
          const busyMessage = "浏览器自动化节点繁忙，任务已回退待调度";
          await emitPublishTaskRuntime({
            taskId,
            taskType,
            queue,
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
            },
          };
        }

        await executePublishQueueTask(taskId, taskType, queue, {
          onRuntime: emitPublishTaskRuntime,
        });
        return {
          success: true,
          message: "发布任务执行完成",
          data: {
            taskId,
            taskType,
            queue,
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
  socket.emit("client-info", {
    ...clientInfo,
    notes: {
      ...(clientInfo.notes || {}),
      pluginRegistry: buildPluginRegistrySnapshot(),
      pluginProtocolVersion: 1,
    },
  });
}

async function connect(endpoint?: string) {
  // 如果没有指定endpoint，优先从配置管理模块动态获取
  let targetEndpoint = endpoint;
  if (!targetEndpoint) {
    try {
      const { getWsEndpoint } = await import("../config/api");
      targetEndpoint = getWsEndpoint();
    } catch {
      // 如果获取失败，使用 wsState.endpoint 或默认值
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
    query: buildQuery(token),
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
  connect();
}

function setEndpoint(endpoint: string) {
  wsState.endpoint = endpoint || DEFAULT_WS_ENDPOINT;
  reconnect();
}

function updateClientInfo(payload: Partial<ClientInfoPayload>) {
  Object.assign(clientInfo, payload);
  emitClientInfo();
}

function updateServiceStatus(
  serviceKey: string,
  payload: Partial<ClientServiceStatus>,
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

  updateClientInfo({
    services: {
      ...(clientInfo.services || {}),
      [pluginKey]: next,
      ...(rawKey && rawKey !== pluginKey
        ? {
            [rawKey]: next,
          }
        : {}),
    },
  });

  return next;
}

void fetchNetworkProfile();

// 服务切换方法
async function switchService(mode: "local" | "remote") {
  // 动态导入避免循环依赖
  const { setServiceMode, getWsEndpoint } = await import("../config/api");
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

// 设置自动批处理状态，便于头部显示同步
export function setAutoPsdBatchActive(active: boolean) {
  autoPsdBatchState.active = active;
  autoPsdBatchState.stopping = false;
  emitPsAutomationStatus({
    running: active ? autoPsdBatchState.running : false,
    lastError: active ? autoPsdBatchState.lastError : null,
  });
}

export async function startAutoPsdBatchProcessing(fromRemote = false) {
  if (autoPsdBatchState.active && autoPsdBatchState.running) {
    return;
  }

  autoPsdBatchState.active = true;
  psAutomationControlState.enabled = true;
  autoPsdBatchState.stopping = false;
  emitPsAutomationStatus({
    lastError: null,
  });

  emitter.emit("toast", {
    color: "info",
    icon: "mdi-play-circle-outline",
    message: fromRemote
      ? "已通过远程指令开启自动制作"
      : "已开启自动制作待处理套图",
  });

  void runAutoPsdBatchLoop();
}

export function stopAutoPsdBatchProcessing(fromRemote = false) {
  if (!autoPsdBatchState.active && !autoPsdBatchState.running) {
    return;
  }

  autoPsdBatchState.active = false;
  psAutomationControlState.enabled = false;
  autoPsdBatchState.stopping = true;
  emitPsAutomationStatus({
    running: false,
    queueCount: 0,
  });

  emitter.emit("toast", {
    color: "warning",
    icon: "mdi-stop-circle-outline",
    message: fromRemote ? "已通过远程指令关闭自动制作" : "已停止自动制作",
  });
}

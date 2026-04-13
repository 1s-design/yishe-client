/**
 * 浏览器自动化服务（yishe-uploader）API
 * 用于检测自动操作服务状态及后续调用其接口完成自动化任务
 */

import { UPLOADER_API_BASE } from "../config/api";
import type {
  EcomCollectDocsSchema,
  EcomCollectRunResult,
} from "../types/ecomCollect";

export interface UploaderStatus {
  connected: boolean;
  message?: string;
  apiInfo?: { name: string; version?: string };
}

export interface UploaderBrowserStatus {
  hasInstance: boolean;
  isConnected: boolean;
  pageCount: number;
  lastActivity: string | null;
  connection?: {
    port?: number | null;
    mode?: string;
    profileId?: string | null;
    activeProfileId?: string | null;
    browserName?: string;
    browserVersion?: string;
    userDataDir?: string;
    activeProfile?: UploaderBrowserProfileSummary | null;
  };
  timestamp?: string;
  pages?: UploaderBrowserPage[];
  profiles?: UploaderBrowserProfileSummary[];
  instances?: UploaderBrowserInstanceSummary[];
}

export interface UploaderBrowserPage {
  id?: string;
  index?: number;
  pageIndex?: number;
  title?: string;
  url?: string;
  type?: string;
  isActive?: boolean;
  profileId?: string;
  profileName?: string;
}

export interface UploaderBrowserInstanceSummary {
  profileId: string;
  profileName?: string;
  port?: number | null;
  hasInstance?: boolean;
  isConnected?: boolean;
  connecting?: boolean;
  pageCount?: number;
  lastActivity?: string | null;
  lastError?: string | null;
  browserVersion?: string;
  userDataDir?: string;
  pages?: UploaderBrowserPage[];
  isActiveProfile?: boolean;
}

export interface UploaderBrowserProfileSummary {
  id: string;
  name: string;
  remark?: string;
  account?: string;
  platforms?: string[];
  browserVersion?: string;
  loginSummary?: Record<string, any>;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastUsedAt?: string | null;
  userDataDir?: string;
  exists?: boolean;
  isActive?: boolean;
}

export type BrowserAutomationErrorKind =
  | "timeout"
  | "not-logged-in"
  | "network"
  | "browser-missing"
  | "selector-not-found"
  | "page-missing"
  | "invalid-argument"
  | "unknown";

export interface BrowserAutomationErrorDetail {
  code: string;
  kind: BrowserAutomationErrorKind;
  action?: string | null;
  step?: string | null;
  userMessage: string;
  rawMessage?: string | null;
  suggestion?: string | null;
  timeout?: boolean;
  retryable?: boolean;
  requiresLogin?: boolean;
  browserMissing?: boolean;
  pageIndex?: number | null;
  selector?: string | null;
  url?: string | null;
  httpStatus?: number | null;
  timestamp: string;
  details?: Record<string, any> | null;
}

type BrowserAutomationErrorContext = {
  action: string;
  pageIndex?: number | null;
  selector?: string | null;
  url?: string | null;
  timeout?: number | null;
  httpStatus?: number | null;
  raw?: any;
};

function normalizeBrowserPageIndex(value: unknown, fallbackIndex: number) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallbackIndex;
}

function normalizeUploaderBrowserPages(data: unknown): UploaderBrowserPage[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((page, index) => {
    const source =
      page && typeof page === "object" ? (page as Record<string, any>) : {};
    const pageIndex = normalizeBrowserPageIndex(
      source.index ?? source.pageIndex ?? source.tabIndex,
      index,
    );

    return {
      ...source,
      id:
        typeof source.id === "string" && source.id.trim()
          ? source.id.trim()
          : `page-${pageIndex}`,
      index: pageIndex,
      pageIndex,
      title:
        typeof source.title === "string" && source.title.trim()
          ? source.title.trim()
          : typeof source.name === "string" && source.name.trim()
            ? source.name.trim()
            : `页面 ${pageIndex}`,
      url:
        typeof source.url === "string" && source.url.trim()
          ? source.url.trim()
          : typeof source.href === "string" && source.href.trim()
            ? source.href.trim()
            : "",
      type:
        typeof source.type === "string" && source.type.trim()
          ? source.type.trim()
          : "page",
      isActive:
        source.isActive === true ||
        source.active === true ||
        source.current === true ||
        source.selected === true,
    };
  });
}

function resolveUploaderBrowserConnectionFlag(source: Record<string, any>) {
  const candidates = [
    source.isConnected,
    source.connected,
    source.browserConnected,
    source.ready,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  return true;
}

function hasMeaningfulBrowserConnectionInfo(connection: unknown) {
  if (!connection || typeof connection !== "object") {
    return false;
  }

  return [
    "mode",
    "cdpEndpoint",
    "browserName",
    "executablePath",
    "userDataDir",
  ].some((key) => {
    const value = (connection as Record<string, any>)[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function normalizeUploaderBrowserStatus(data: unknown): UploaderBrowserStatus {
  const source =
    data && typeof data === "object" ? (data as Record<string, any>) : {};
  const pages = normalizeUploaderBrowserPages(source.pages);
  const profiles = Array.isArray(source.profiles) ? source.profiles : [];
  const instances = Array.isArray(source.instances) ? source.instances : [];
  const connection =
    source.connection && typeof source.connection === "object"
      ? source.connection
      : undefined;
  const normalizedLastActivity =
    typeof source.lastActivity === "string" && source.lastActivity.trim()
      ? source.lastActivity
      : typeof source.lastActivity === "number" &&
          Number.isFinite(source.lastActivity)
        ? new Date(source.lastActivity).toISOString()
        : null;
  const isConnected = resolveUploaderBrowserConnectionFlag(source);
  const hasInstance =
    source.hasInstance === true ||
    source.hasBrowser === true ||
    source.browserReady === true ||
    source.browserStarted === true ||
    source.instanceReady === true ||
    (typeof source.pageCount === "number" && source.pageCount > 0) ||
    pages.length > 0 ||
    (isConnected && hasMeaningfulBrowserConnectionInfo(connection));

  return {
    hasInstance,
    isConnected,
    pageCount:
      typeof source.pageCount === "number" ? source.pageCount : pages.length,
    lastActivity: normalizedLastActivity,
    connection,
    timestamp:
      typeof source.timestamp === "string" && source.timestamp.trim()
        ? source.timestamp
        : undefined,
    pages,
    profiles,
    instances: instances as UploaderBrowserInstanceSummary[],
  };
}

export function isUploaderBrowserReady(
  status?: Partial<UploaderBrowserStatus> | null,
) {
  return !!(status?.hasInstance && status?.isConnected !== false);
}

function resolveBrowserAutomationMessage(
  payload: any,
  fallbackMessage: string,
  httpStatus?: number | null,
) {
  const candidates = [
    payload?.message,
    payload?.error,
    payload?.data?.message,
    payload?.data?.error,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (httpStatus) {
    return `${fallbackMessage}: ${httpStatus}`;
  }

  return fallbackMessage;
}

function getBrowserAutomationStepLabel(action: string) {
  const map: Record<string, string> = {
    getPages: "获取页面列表",
    debug: "执行调试动作",
    goto: "打开目标链接",
    click: "点击元素",
    fill: "填充输入框",
    type: "输入文本",
    press: "键盘输入",
    wait: "等待页面稳定",
    screenshot: "截图",
    text: "读取文本",
    html: "读取页面结构",
    eval: "执行页面脚本",
    playwright: "执行 Playwright 脚本",
  };

  return map[action] || "执行浏览器自动化命令";
}

function buildBrowserAutomationErrorDetail(
  message: string,
  context: BrowserAutomationErrorContext,
): BrowserAutomationErrorDetail {
  const rawMessage = String(message || "").trim() || "浏览器自动化执行失败";
  const normalizedMessage = rawMessage.toLowerCase();

  let kind: BrowserAutomationErrorKind = "unknown";
  if (
    normalizedMessage.includes("aborterror") ||
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("timed out") ||
    rawMessage.includes("超时")
  ) {
    kind = "timeout";
  } else if (
    normalizedMessage.includes("未登录") ||
    normalizedMessage.includes("not logged") ||
    normalizedMessage.includes("login required") ||
    normalizedMessage.includes("need login") ||
    normalizedMessage.includes("auth")
  ) {
    kind = "not-logged-in";
  } else if (
    normalizedMessage.includes("econnrefused") ||
    normalizedMessage.includes("econnreset") ||
    normalizedMessage.includes("enotfound") ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("failed to fetch") ||
    rawMessage.includes("无法连接")
  ) {
    kind = "network";
  } else if (
    normalizedMessage.includes("browser") &&
    (normalizedMessage.includes("not connected") ||
      normalizedMessage.includes("not ready") ||
      normalizedMessage.includes("has been closed") ||
      normalizedMessage.includes("not found") ||
      rawMessage.includes("实例"))
  ) {
    kind = "browser-missing";
  } else if (
    normalizedMessage.includes("selector") ||
    normalizedMessage.includes("locator") ||
    normalizedMessage.includes("element") ||
    rawMessage.includes("未找到元素") ||
    rawMessage.includes("未找到选择器")
  ) {
    kind = "selector-not-found";
  } else if (
    normalizedMessage.includes("pageindex") ||
    normalizedMessage.includes("page index") ||
    normalizedMessage.includes("tab") ||
    normalizedMessage.includes("page not found") ||
    rawMessage.includes("页面不存在") ||
    rawMessage.includes("页签")
  ) {
    kind = "page-missing";
  } else if (
    normalizedMessage.includes("missing") ||
    normalizedMessage.includes("invalid") ||
    normalizedMessage.includes("required") ||
    rawMessage.includes("缺少") ||
    rawMessage.includes("参数")
  ) {
    kind = "invalid-argument";
  }

  const detailMap: Record<
    BrowserAutomationErrorKind,
    Pick<
      BrowserAutomationErrorDetail,
      | "code"
      | "userMessage"
      | "suggestion"
      | "retryable"
      | "timeout"
      | "requiresLogin"
      | "browserMissing"
    >
  > = {
    timeout: {
      code: "BROWSER_AUTOMATION_TIMEOUT",
      userMessage: "执行超时，请确认页面已加载完成后重试",
      suggestion: "可以先刷新页面列表，确认调试页已稳定，再适当增加 timeout",
      retryable: true,
      timeout: true,
    },
    "not-logged-in": {
      code: "BROWSER_AUTOMATION_LOGIN_REQUIRED",
      userMessage: "目标站点尚未登录，请先在浏览器中完成登录后重试",
      suggestion: "先切到对应页面确认登录状态，再重新执行调试动作",
      retryable: true,
      requiresLogin: true,
    },
    network: {
      code: "BROWSER_AUTOMATION_NETWORK_ERROR",
      userMessage: "无法连接浏览器自动化服务，请检查客户端本地服务和网络状态",
      suggestion: "确认自动化服务仍在线，必要时重新连接浏览器实例",
      retryable: true,
    },
    "browser-missing": {
      code: "BROWSER_AUTOMATION_BROWSER_MISSING",
      userMessage: "浏览器实例不存在或连接已断开，请先执行连接",
      suggestion: "回到连接控制页，先连接或重新连接浏览器实例",
      retryable: true,
      browserMissing: true,
    },
    "selector-not-found": {
      code: "BROWSER_AUTOMATION_SELECTOR_NOT_FOUND",
      userMessage: "未找到目标元素，请确认当前页面和 selector 是否正确",
      suggestion:
        "建议先刷新页面列表并确认当前调试页，再检查 selector 是否变化",
      retryable: true,
    },
    "page-missing": {
      code: "BROWSER_AUTOMATION_PAGE_NOT_FOUND",
      userMessage: "当前调试页面不存在或索引失效，请先刷新页面列表后重试",
      suggestion: "重新获取页面列表，并确认 pageIndex 指向的是当前目标页签",
      retryable: true,
    },
    "invalid-argument": {
      code: "BROWSER_AUTOMATION_INVALID_ARGUMENT",
      userMessage: "调试参数不完整或无效，请检查输入内容",
      suggestion: "确认 action、pageIndex、selector、url 等参数是否填写正确",
      retryable: false,
    },
    unknown: {
      code: "BROWSER_AUTOMATION_UNKNOWN_ERROR",
      userMessage: "浏览器自动化执行失败，请结合原始错误继续排查",
      suggestion: "可先刷新状态和页面列表，确认节点与浏览器实例都正常",
      retryable: false,
    },
  };

  const preset = detailMap[kind];
  return {
    ...preset,
    kind,
    action: context.action || null,
    step: getBrowserAutomationStepLabel(context.action),
    rawMessage,
    pageIndex:
      typeof context.pageIndex === "number" &&
      Number.isFinite(context.pageIndex)
        ? context.pageIndex
        : null,
    selector: context.selector || null,
    url: context.url || null,
    httpStatus:
      typeof context.httpStatus === "number" &&
      Number.isFinite(context.httpStatus)
        ? context.httpStatus
        : null,
    timestamp: new Date().toISOString(),
    details:
      context.raw && typeof context.raw === "object"
        ? { raw: context.raw }
        : null,
  };
}

export interface UploaderTaskSource {
  system: string;
  module?: string;
  kind?: string;
  id?: string;
  traceId?: string;
  createdAt?: string;
}

export type UploaderTaskSourceId = string;

export interface UploaderTaskSummary {
  id: string;
  kind: string;
  action: string;
  platform?: string;
  platforms?: string[];
  status: string;
  step: string;
  source?: UploaderTaskSource;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  progress?: Record<string, any> | null;
  result?: any;
  error?: any;
  logInfo?: {
    count?: number;
    last?: {
      id?: string;
      level?: string;
      message?: string;
      timestamp?: string;
      data?: any;
    } | null;
    items?: Array<{
      id?: string;
      level?: string;
      message?: string;
      timestamp?: string;
      data?: any;
    }>;
  };
}

export interface UploaderTaskLogItem {
  id?: string;
  taskId?: string;
  level?: string;
  message?: string;
  data?: any;
  timestamp?: string;
}

export interface UploaderTaskListResponse {
  success: boolean;
  data?: {
    items?: UploaderTaskSummary[];
    total?: number;
  };
  message?: string;
}

export interface UploaderTaskDetailResponse {
  success: boolean;
  data?: UploaderTaskSummary | null;
  message?: string;
}

export interface UploaderTaskLogsResponse {
  success: boolean;
  data?: UploaderTaskLogItem[];
  message?: string;
}

export interface UploaderEcomCollectPlatformItem {
  value: string;
  platform: string;
  label: string;
  status?: string;
  statusLabel?: string;
  runnable?: boolean;
  reason?: string | null;
  access?: UploaderEcomCollectAccessSchema;
  regions?: string[];
  supportedScenes?: string[];
  supportedTaskTypes?: string[];
  scenes?: UploaderEcomCollectSceneSchema[];
  taskTypes?: UploaderEcomCollectTaskTypeSchema[];
  docs?: Record<string, any>;
  maintenance?: Record<string, any>;
}

export interface UploaderEcomCollectFieldOption {
  label: string;
  value: string | number | boolean;
  description?: string;
}

export interface UploaderEcomCollectFieldSchema {
  key: string;
  label: string;
  component:
    | "input"
    | "textarea"
    | "input-number"
    | "url"
    | "select"
    | "switch"
    | "json"
    | "array-text";
  valueType?: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: any;
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  examples?: any[];
  options?: UploaderEcomCollectFieldOption[];
}

export interface UploaderEcomCollectAccessSchema {
  login?: string;
  loginLabel?: string;
  requiresLogin?: boolean;
  canRunWithoutLogin?: boolean;
  captcha?: string;
  captchaLabel?: string;
  antiBot?: string;
  antiBotLabel?: string;
  notes?: string[];
}

export interface UploaderEcomCollectSceneSchema {
  value: string;
  label: string;
  description?: string;
  availability?: string;
  availabilityLabel?: string;
  runnable?: boolean;
  verification?: string;
  verificationLabel?: string;
  reason?: string | null;
  access?: UploaderEcomCollectAccessSchema;
  fields?: UploaderEcomCollectFieldSchema[];
  docs?: EcomCollectDocsSchema;
}

export interface UploaderEcomCollectTaskTypeSchema {
  value: string;
  taskType?: string;
  label: string;
  description?: string;
  platform?: string;
  collectScene?: string;
  entityType?: string;
  availability?: string;
  availabilityLabel?: string;
  runnable?: boolean;
  verification?: string;
  verificationLabel?: string;
  reason?: string | null;
  access?: UploaderEcomCollectAccessSchema;
  fields?: UploaderEcomCollectFieldSchema[];
  docs?: EcomCollectDocsSchema;
}

export interface UploaderEcomCollectCapabilitySchema {
  schemaVersion?: number;
  generatedAt?: string;
  platforms?: UploaderEcomCollectPlatformItem[];
}

export interface UploaderEcomCollectResult extends EcomCollectRunResult {}

export interface UploaderBrowserSmallFeatureFieldOption {
  label?: string;
  value?: string | number | boolean;
}

export interface UploaderBrowserSmallFeatureFieldSchema {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: unknown;
  options?: UploaderBrowserSmallFeatureFieldOption[];
}

export interface UploaderBrowserSmallFeatureItem {
  key: string;
  name: string;
  platform?: string;
  category?: string;
  description?: string;
  tips?: string[];
  fields?: UploaderBrowserSmallFeatureFieldSchema[];
}

/**
 * 检测 yishe-uploader 服务是否已启动（可连接）
 */
export async function checkUploaderStatus(): Promise<UploaderStatus> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return {
        connected: false,
        message: `服务响应异常: ${res.status}`,
      };
    }
    const data = await res.json().catch(() => ({}));
    return {
      connected: true,
      apiInfo: {
        name: data?.name ?? "Yishe Uploader API",
        version: data?.version,
      },
    };
  } catch (e: unknown) {
    const err = e as Error & { code?: string };
    const message =
      err?.code === "ECONNREFUSED" || err?.message?.includes("fetch")
        ? "无法连接，请先启动浏览器自动化服务"
        : (err?.message ?? "检测失败");
    return {
      connected: false,
      message,
    };
  }
}

/**
 * 获取 uploader 侧浏览器连接状态（需 uploader 服务已启动）
 */
export async function getUploaderBrowserStatus(): Promise<{
  success: boolean;
  data?: UploaderBrowserStatus;
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/status`, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      return {
        success: false,
        message: json?.message ?? "获取浏览器状态失败",
      };
    }
    return {
      success: true,
      data: normalizeUploaderBrowserStatus(json.data),
    };
  } catch (e: unknown) {
    const err = e as Error;
    return {
      success: false,
      message: err?.message ?? "请求失败",
    };
  }
}

/**
 * 请求浏览器自动化服务连接/启动浏览器实例（获取或创建浏览器，方便随时执行自动化任务）
 */
export async function connectUploaderBrowser(
  options?: Record<string, unknown>,
): Promise<{
  success: boolean;
  message?: string;
  data?: unknown;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: options ? JSON.stringify(options) : "{}",
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        message: json?.message ?? json?.error ?? `请求失败: ${res.status}`,
      };
    }
    if (json?.success === false) {
      return {
        success: false,
        message: json?.message ?? json?.error ?? "连接失败",
      };
    }
    return {
      success: true,
      data: json?.data,
    };
  } catch (e: unknown) {
    const err = e as Error & { code?: string };
    const message =
      err?.code === "ECONNREFUSED" || err?.message?.includes("fetch")
        ? "无法连接自动操作服务，请先启动浏览器自动化服务"
        : (err?.message ?? "连接浏览器失败");
    return { success: false, message };
  }
}

/**
 * 请求浏览器自动化服务关闭浏览器实例
 */
export async function closeUploaderBrowser(
  profileId?: string,
): Promise<{
  success: boolean;
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        String(profileId || "").trim()
          ? { profileId: String(profileId || "").trim() }
          : {},
      ),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        message: json?.message ?? json?.error ?? `请求失败: ${res.status}`,
      };
    }
    if (json?.success === false) {
      return {
        success: false,
        message: json?.message ?? json?.error ?? "关闭浏览器失败",
      };
    }
    return { success: true };
  } catch (e: unknown) {
    const err = e as Error & { code?: string };
    const message =
      err?.code === "ECONNREFUSED" || err?.message?.includes("fetch")
        ? "无法连接自动操作服务，请先启动浏览器自动化服务"
        : (err?.message ?? "关闭浏览器失败");
    return { success: false, message };
  }
}

export async function focusUploaderBrowser(
  profileId?: string,
): Promise<{
  success: boolean;
  message?: string;
  data?: unknown;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/focus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        String(profileId || "").trim()
          ? { profileId: String(profileId || "").trim() }
          : {},
      ),
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? json?.error ?? `请求失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json?.data,
    };
  } catch (e: unknown) {
    const err = e as Error & { code?: string };
    const message =
      err?.code === "ECONNREFUSED" || err?.message?.includes("fetch")
        ? "无法连接自动操作服务，请先启动浏览器自动化服务"
        : (err?.message ?? "聚焦浏览器失败");
    return { success: false, message };
  }
}

export async function forceCloseUploaderBrowser(port = 9222): Promise<{
  success: boolean;
  message?: string;
  data?: unknown;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/force-close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port }),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? json?.error ?? `请求失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json?.data,
    };
  } catch (e: unknown) {
    const err = e as Error;
    return {
      success: false,
      message: err?.message ?? "强制关闭浏览器失败",
    };
  }
}

/**
 * 让浏览器打开指定平台的发布页
 */
export async function openPlatform(
  platform: string,
  profileId?: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/open-platform`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        ...(String(profileId || "").trim()
          ? { profileId: String(profileId || "").trim() }
          : {}),
      }),
      signal: AbortSignal.timeout(30000), // 打开页面可能较慢
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      return {
        success: false,
        message: json?.message ?? `打开失败: ${res.status}`,
      };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e?.message || "请求失败" };
  }
}

/**
 * 让已启动浏览器实例打开任意链接
 */
export async function openLink(
  url: string,
  profileId?: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/open-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        ...(String(profileId || "").trim()
          ? { profileId: String(profileId || "").trim() }
          : {}),
      }),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      return {
        success: false,
        message: json?.message ?? `打开失败: ${res.status}`,
      };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e?.message || "请求失败" };
  }
}

export async function getUploaderBrowserPages(
  profileId?: string,
): Promise<{
  success: boolean;
  data?: UploaderBrowserPage[];
  message?: string;
  errorDetail?: BrowserAutomationErrorDetail;
}> {
  try {
    const query = new URLSearchParams();
    if (String(profileId || "").trim()) {
      query.set("profileId", String(profileId || "").trim());
    }
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/browser/pages${query.toString() ? `?${query.toString()}` : ""}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(15000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      const errorDetail = buildBrowserAutomationErrorDetail(
        resolveBrowserAutomationMessage(json, "获取页面列表失败", res.status),
        {
          action: "getPages",
          httpStatus: res.status,
          raw: json,
        },
      );
      return {
        success: false,
        message: errorDetail.userMessage,
        errorDetail,
      };
    }
    return {
      success: true,
      data: normalizeUploaderBrowserPages(json?.data),
    };
  } catch (e: unknown) {
    const err = e as Error;
    const errorDetail = buildBrowserAutomationErrorDetail(
      err?.message ?? "获取页面列表失败",
      {
        action: "getPages",
        raw: {
          name: err?.name,
          message: err?.message,
        },
      },
    );
    return {
      success: false,
      message: errorDetail.userMessage,
      errorDetail,
    };
  }
}

export async function executeUploaderBrowserDebug(
  data: Record<string, unknown>,
): Promise<{
  success: boolean;
  data?: Record<string, any>;
  message?: string;
  errorDetail?: BrowserAutomationErrorDetail;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      const errorDetail = buildBrowserAutomationErrorDetail(
        resolveBrowserAutomationMessage(json, "页面调试失败", res.status),
        {
          action: String(data?.action || "debug"),
          pageIndex:
            typeof data?.pageIndex === "number" &&
            Number.isFinite(data.pageIndex)
              ? data.pageIndex
              : null,
          selector:
            typeof data?.selector === "string" && data.selector.trim()
              ? data.selector.trim()
              : null,
          url:
            typeof data?.url === "string" && data.url.trim()
              ? data.url.trim()
              : null,
          timeout:
            typeof data?.timeout === "number" && Number.isFinite(data.timeout)
              ? data.timeout
              : null,
          httpStatus: res.status,
          raw: json,
        },
      );
      return {
        success: false,
        message: errorDetail.userMessage,
        errorDetail,
      };
    }
    const normalizedResult =
      json?.data && typeof json.data === "object" && !Array.isArray(json.data)
        ? { ...json.data }
        : { value: json?.data ?? null };

    const debugPageIndex =
      typeof data?.pageIndex === "number" && Number.isFinite(data.pageIndex)
        ? data.pageIndex
        : undefined;
    if (
      typeof normalizedResult.pageIndex !== "number" &&
      debugPageIndex !== undefined
    ) {
      normalizedResult.pageIndex = debugPageIndex;
    }

    return {
      success: true,
      data: normalizedResult,
    };
  } catch (e: any) {
    const errorDetail = buildBrowserAutomationErrorDetail(
      e?.message || "页面调试失败",
      {
        action: String(data?.action || "debug"),
        pageIndex:
          typeof data?.pageIndex === "number" && Number.isFinite(data.pageIndex)
            ? data.pageIndex
            : null,
        selector:
          typeof data?.selector === "string" && data.selector.trim()
            ? data.selector.trim()
            : null,
        url:
          typeof data?.url === "string" && data.url.trim()
            ? data.url.trim()
            : null,
        timeout:
          typeof data?.timeout === "number" && Number.isFinite(data.timeout)
            ? data.timeout
            : null,
        raw: {
          name: e?.name,
          message: e?.message,
          code: e?.code,
        },
      },
    );
    return {
      success: false,
      message: errorDetail.userMessage,
      errorDetail,
    };
  }
}

export async function openUploaderPlatform(
  platform: string,
  profileId?: string,
): Promise<{ success: boolean; message?: string }> {
  return openPlatform(platform, profileId);
}

export async function openUploaderLink(
  url: string,
  profileId?: string,
): Promise<{ success: boolean; message?: string }> {
  return openLink(url, profileId);
}

export async function getUploaderTaskList(
  params: Record<string, unknown> = {},
): Promise<UploaderTaskListResponse> {
  try {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      const normalized = String(value ?? "").trim();
      if (normalized) {
        query.set(key, normalized);
      }
    });
    const qs = query.toString();
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/tasks${qs ? `?${qs}` : ""}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(15000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `获取任务列表失败: ${res.status}`,
      };
    }
    const items = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.items)
        ? json.items
        : [];
    return {
      success: true,
      data: {
        items,
        total: Number(json?.total ?? items.length ?? 0),
      },
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "获取任务列表失败" };
  }
}

export async function getUploaderTaskDetail(
  taskId: string,
): Promise<UploaderTaskDetailResponse> {
  try {
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(15000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `获取任务详情失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json?.data ?? null,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "获取任务详情失败" };
  }
}

export async function getUploaderTaskLogs(
  taskId: string,
): Promise<UploaderTaskLogsResponse> {
  try {
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/tasks/${encodeURIComponent(taskId)}/logs`,
      {
        method: "GET",
        signal: AbortSignal.timeout(15000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `获取任务日志失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: Array.isArray(json?.data) ? json.data : [],
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "获取任务日志失败" };
  }
}

export async function getUploaderPlatforms(): Promise<{
  success: boolean;
  data?: {
    platforms?: string[];
    items?: Record<string, any>[];
  };
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/platforms`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        message: json?.message ?? `获取平台列表失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: {
        platforms: Array.isArray(json?.platforms) ? json.platforms : [],
        items: Array.isArray(json?.items) ? json.items : [],
      },
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "获取平台列表失败" };
  }
}

export async function getUploaderEcomCollectPlatforms(): Promise<{
  success: boolean;
  data?: {
    platforms?: UploaderEcomCollectPlatformItem[];
  };
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/ecom-collect/platforms`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `获取电商采集目录失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: {
        platforms: Array.isArray(json?.data?.platforms)
          ? json.data.platforms
          : [],
      },
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "获取电商采集目录失败" };
  }
}

export async function getUploaderBrowserSmallFeatures(): Promise<{
  success: boolean;
  data?: UploaderBrowserSmallFeatureItem[];
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/small-features`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `获取工具目录失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: Array.isArray(json?.data) ? json.data : [],
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "获取工具目录失败" };
  }
}

export async function getUploaderEcomCollectCapabilities(): Promise<{
  success: boolean;
  data?: UploaderEcomCollectCapabilitySchema;
  message?: string;
}> {
  try {
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/ecom-collect/capabilities`,
      {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `获取电商采集能力失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: {
        schemaVersion:
          typeof json?.data?.schemaVersion === "number"
            ? json.data.schemaVersion
            : undefined,
        generatedAt:
          typeof json?.data?.generatedAt === "string"
            ? json.data.generatedAt
            : undefined,
        platforms: Array.isArray(json?.data?.platforms)
          ? json.data.platforms
          : [],
      },
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "获取电商采集能力失败" };
  }
}

export async function runUploaderEcomCollect(
  data: Record<string, unknown>,
): Promise<{
  success: boolean;
  status?: string;
  data?: UploaderEcomCollectResult;
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/ecom-collect/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
      signal: AbortSignal.timeout(
        typeof data?.timeoutMs === "number" && Number.isFinite(data.timeoutMs)
          ? Math.max(60_000, Number(data.timeoutMs) + 60_000)
          : 21 * 60 * 1000,
      ),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        status: json?.status || "failed",
        message: json?.message ?? `执行电商采集失败: ${res.status}`,
        data: json?.data,
      };
    }
    return {
      success: !!json?.success,
      status: json?.status || (json?.success ? "success" : "failed"),
      message: json?.message,
      data: json?.data,
    };
  } catch (e: any) {
    return {
      success: false,
      status: "failed",
      message: e?.message || "执行电商采集失败",
    };
  }
}

export async function runUploaderBrowserSmallFeature(
  featureKey: string,
  data: Record<string, unknown> = {},
): Promise<{
  success: boolean;
  data?: Record<string, any>;
  message?: string;
}> {
  try {
    const normalizedFeatureKey = String(featureKey || "").trim();
    if (!normalizedFeatureKey) {
      return {
        success: false,
        message: "缺少 featureKey",
      };
    }

    const timeoutMs =
      typeof data?.timeoutMs === "number" && Number.isFinite(data.timeoutMs)
        ? Math.max(60_000, Number(data.timeoutMs) + 60_000)
        : 10 * 60 * 1000;
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/small-features/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        featureKey: normalizedFeatureKey,
        ...(data || {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `执行工具失败: ${res.status}`,
        data: json?.data,
      };
    }
    return {
      success: !!json?.success,
      message: json?.message,
      data: json?.data,
    };
  } catch (e: any) {
    return {
      success: false,
      message: e?.message || "执行工具失败",
    };
  }
}

export async function getUploaderLoginStatus(
  refresh = false,
  profileId?: string,
): Promise<{
  success: boolean;
  data?: Record<string, any>;
  message?: string;
}> {
  try {
    const query = new URLSearchParams();
    if (refresh) {
      query.set("refresh", "1");
    }
    const normalizedProfileId = String(profileId || "").trim();
    if (normalizedProfileId) {
      query.set("profileId", normalizedProfileId);
    }
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/login-status${query.toString() ? `?${query.toString()}` : ""}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(20000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `获取登录状态失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json?.data || {},
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "获取登录状态失败" };
  }
}

export async function publishByUploader(
  data: Record<string, unknown>,
): Promise<{
  success: boolean;
  data?: Record<string, any>;
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? json?.error ?? `发布失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "发布失败" };
  }
}

export async function createUploaderExecutionTask(
  data: Record<string, unknown>,
): Promise<{
  success: boolean;
  data?: {
    taskId: string;
    status: string;
    source?: UploaderTaskSource;
    createdAt?: string;
  };
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/tasks/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      return {
        success: false,
        message: json?.message ?? `创建任务失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json.data,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "请求失败" };
  }
}

export async function getUploaderProfiles(): Promise<{
  success: boolean;
  data?: {
    activeProfileId?: string | null;
    workspaceDir?: string;
    profilesRootDir?: string;
    items: UploaderBrowserProfileSummary[];
  };
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/profiles`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `获取环境列表失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: {
        activeProfileId:
          typeof json?.data?.activeProfileId === "string"
            ? json.data.activeProfileId
            : null,
        workspaceDir:
          typeof json?.data?.workspaceDir === "string"
            ? json.data.workspaceDir
            : undefined,
        profilesRootDir:
          typeof json?.data?.profilesRootDir === "string"
            ? json.data.profilesRootDir
            : undefined,
        items: Array.isArray(json?.data?.items) ? json.data.items : [],
      },
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "获取环境列表失败" };
  }
}

export async function getUploaderProfileDetail(profileId: string): Promise<{
  success: boolean;
  data?: UploaderBrowserProfileSummary | null;
  message?: string;
}> {
  try {
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/browser/profiles/${encodeURIComponent(profileId)}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `获取环境详情失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json?.data || null,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "获取环境详情失败" };
  }
}

export async function createUploaderProfile(
  data: Record<string, unknown>,
): Promise<{
  success: boolean;
  data?: UploaderBrowserProfileSummary | null;
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/browser/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `创建环境失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json?.data || null,
      message: json?.message,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "创建环境失败" };
  }
}

export async function updateUploaderProfile(
  profileId: string,
  data: Record<string, unknown>,
): Promise<{
  success: boolean;
  data?: UploaderBrowserProfileSummary | null;
  message?: string;
}> {
  try {
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/browser/profiles/${encodeURIComponent(profileId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {}),
        signal: AbortSignal.timeout(10000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `更新环境失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json?.data || null,
      message: json?.message,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "更新环境失败" };
  }
}

export async function deleteUploaderProfile(profileId: string): Promise<{
  success: boolean;
  data?: Record<string, any>;
  message?: string;
}> {
  try {
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/browser/profiles/${encodeURIComponent(profileId)}`,
      {
        method: "DELETE",
        signal: AbortSignal.timeout(10000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `删除环境失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json?.data || null,
      message: json?.message,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "删除环境失败" };
  }
}

export async function switchUploaderProfile(profileId: string): Promise<{
  success: boolean;
  data?: UploaderBrowserProfileSummary | null;
  message?: string;
}> {
  try {
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/browser/profiles/${encodeURIComponent(profileId)}/switch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(10000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message ?? `切换环境失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: json?.data || null,
      message: json?.message,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "切换环境失败" };
  }
}

export async function queryUploaderTasksBySource(
  sourceIds: UploaderTaskSourceId[],
): Promise<{
  success: boolean;
  data?: Array<{
    source: UploaderTaskSource;
    exists: boolean;
    task?: UploaderTaskSummary;
  }>;
  message?: string;
}> {
  try {
    const res = await fetch(`${UPLOADER_API_BASE}/api/tasks/query-by-source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceIds }),
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      return {
        success: false,
        message: json?.message ?? `查询任务失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: Array.isArray(json.data) ? json.data : [],
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "请求失败" };
  }
}

export async function queryUploaderTaskLogsBySource(
  sourceIds: UploaderTaskSourceId[],
): Promise<{
  success: boolean;
  data?: Array<{
    source: UploaderTaskSource;
    exists: boolean;
    logs: UploaderTaskLogItem[];
  }>;
  message?: string;
}> {
  try {
    const res = await fetch(
      `${UPLOADER_API_BASE}/api/tasks/logs/query-by-source`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      return {
        success: false,
        message: json?.message ?? `查询任务日志失败: ${res.status}`,
      };
    }
    return {
      success: true,
      data: Array.isArray(json.data) ? json.data : [],
    };
  } catch (e: any) {
    return { success: false, message: e?.message || "请求失败" };
  }
}

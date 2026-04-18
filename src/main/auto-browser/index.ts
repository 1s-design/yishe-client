/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import fs from "fs";
import http from "http";
import path from "path";
import { app, shell } from "electron";

import publishService from "./legacy/api/publishService.js";
import crawlerService from "./legacy/api/crawlerService.js";
import {
  checkAndReconnectBrowser,
  cleanup as cleanupBrowserService,
  closeBrowser,
  createBrowserPage,
  createManagedBrowserProfile,
  deleteManagedBrowserProfile,
  exportUserData,
  focusBrowser,
  forceCloseBrowserByPort,
  getBrowserPage,
  getBrowserStatus,
  getManagedBrowserProfile,
  getOrCreateBrowser,
  launchWithDebugPort,
  listBrowserPages,
  listManagedBrowserProfiles,
  switchManagedBrowserProfile,
  updateManagedBrowserProfile,
} from "./legacy/services/BrowserService.js";
import { PlatformLoginService } from "./legacy/services/PlatformLoginService.js";
import {
  buildMissingLocalChromeMessage,
  getDefaultChromeExecutableInfo,
} from "./legacy/utils/playwrightRuntime.js";
import {
  listBrowserAutomationSmallFeatures,
  runBrowserAutomationSmallFeature,
} from "./legacy/services/BrowserAutomationSmallFeatureService.js";
import taskManager from "./legacy/services/TaskManager.js";
import { PLATFORM_CONFIGS } from "./legacy/config/platforms.js";
import {
  getEcomCollectCapabilities,
  getEcomPlatformCatalog,
  runEcomCollectTask,
} from "./legacy/ecom-collect/ecomCollectService.js";
import { getAutoBrowserTempDir } from "./legacy/utils/workspacePaths.js";

export interface AutoBrowserInvokeRequest {
  method?: string;
  path: string;
  query?: Record<string, any>;
  body?: any;
}

export interface AutoBrowserInvokeResponse {
  status: number;
  ok: boolean;
  body: any;
  headers?: Record<string, string>;
}

function normalizeRequestMethod(value: unknown) {
  const method = String(value || "GET")
    .trim()
    .toUpperCase();
  return method || "GET";
}

function normalizeRequestPath(value: unknown) {
  const rawPath = String(value || "").trim();
  if (!rawPath) {
    return "/";
  }
  return rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
}

function normalizeString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || "";
}

function getLocalBrowserRequirementStatus() {
  const chromeInfo = getDefaultChromeExecutableInfo();
  const executablePath = String(chromeInfo?.executablePath || "").trim();
  const checkedPaths = Array.isArray(chromeInfo?.checkedPaths)
    ? chromeInfo.checkedPaths.filter(Boolean)
    : [];
  const available =
    !!chromeInfo?.exists &&
    !!executablePath &&
    fs.existsSync(executablePath);

  return {
    available,
    source: chromeInfo?.source || "system",
    configuredBy: chromeInfo?.configuredBy || null,
    executablePath: available ? executablePath : null,
    checkedPath: executablePath || null,
    checkedPaths,
    message: available ? null : buildMissingLocalChromeMessage(chromeInfo),
  };
}

function normalizeQueryValue(
  source: Record<string, any> | undefined,
  key: string,
): string | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }
  const value = source[key];
  if (Array.isArray(value)) {
    const first = String(value[0] ?? "").trim();
    return first || undefined;
  }
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function normalizeSourceId(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function buildTaskSource(input: Record<string, any> = {}) {
  const sourceId = normalizeSourceId(input.sourceId || input.id);
  const source =
    input.source && typeof input.source === "object" ? { ...input.source } : {};

  return {
    system: String(source.system || "yishe-client").trim() || "yishe-client",
    module:
      String(source.module || "queue-executor").trim() || "queue-executor",
    kind: String(source.kind || input.kind || "generic").trim() || "generic",
    id: normalizeSourceId(source.id || sourceId),
    traceId: normalizeSourceId(source.traceId),
    createdAt: source.createdAt,
  };
}

function buildSourcesFromQueryBody(body: Record<string, any> = {}) {
  const sourceIds = Array.isArray(body?.sourceIds)
    ? body.sourceIds
        .map((item) => normalizeSourceId(item))
        .filter((item): item is string => !!item)
    : [];

  if (sourceIds.length > 0) {
    return sourceIds.map((sourceId) => buildTaskSource({ sourceId }));
  }

  const sources = Array.isArray(body?.sources) ? body.sources : [];
  if (sources.length > 0) {
    return sources.map((source) => buildTaskSource(source));
  }

  const singleSourceId = normalizeSourceId(body?.sourceId);
  if (singleSourceId) {
    return [buildTaskSource({ sourceId: singleSourceId })];
  }

  return [];
}

function normalizeTags(input: unknown) {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(input || "")
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMediaList(list: unknown, fallbackKind: string) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((item) => {
      if (typeof item === "string" && item.trim()) {
        return { source: item.trim(), kind: fallbackKind };
      }
      if (
        item &&
        typeof item === "object" &&
        typeof item.source === "string" &&
        item.source.trim()
      ) {
        return {
          source: item.source.trim(),
          kind: item.kind || fallbackKind,
        };
      }
      return null;
    })
    .filter(Boolean);
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function normalizeDebugValue(value: any, depth = 0): any {
  if (depth > 4) {
    return "[MaxDepth]";
  }
  if (value === undefined) {
    return "[undefined]";
  }
  if (value === null) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDebugValue(item, depth + 1));
  }
  if (typeof value === "object") {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      const plain: Record<string, any> = {};
      Object.entries(value).forEach(([key, val]) => {
        plain[key] = normalizeDebugValue(val, depth + 1);
      });
      return plain;
    }
  }
  return String(value);
}

async function executePlaywrightScript(page: any, script: string) {
  const logs: Array<{ level: string; args: any[] }> = [];
  const scriptConsole = {
    log: (...args: any[]) =>
      logs.push({ level: "log", args: args.map((item) => normalizeDebugValue(item)) }),
    info: (...args: any[]) =>
      logs.push({ level: "info", args: args.map((item) => normalizeDebugValue(item)) }),
    warn: (...args: any[]) =>
      logs.push({ level: "warn", args: args.map((item) => normalizeDebugValue(item)) }),
    error: (...args: any[]) =>
      logs.push({ level: "error", args: args.map((item) => normalizeDebugValue(item)) }),
  };

  const wrapped = `
    "use strict";
    return await (async () => {
      ${script}
    })();
  `;

  const runner = new AsyncFunction("page", "context", "locator", "console", wrapped);
  const value = await runner(
    page,
    page.context(),
    (selector: string) => page.locator(selector),
    scriptConsole,
  );

  return {
    value: normalizeDebugValue(value),
    logs,
  };
}

function normalizePublishInfo(
  publishInfo: Record<string, any> = {},
  platforms: string[] = [],
) {
  const normalized = { ...(publishInfo || {}) };
  const primaryPlatform =
    platforms.find(Boolean) || normalizeString(normalized.platform);

  if (!normalized.post && !normalized.assets && !normalized.options) {
    const flatImageSources = Array.isArray(normalized.imageSources)
      ? normalized.imageSources
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [];
    const flatVideoSource =
      typeof normalized.videoSource === "string" &&
      normalized.videoSource.trim()
        ? normalized.videoSource.trim()
        : "";

    if (
      (!normalized.images || normalized.images.length === 0) &&
      flatImageSources.length > 0
    ) {
      normalized.images = [...flatImageSources];
    }
    if (
      (!normalized.imageUrls || normalized.imageUrls.length === 0) &&
      flatImageSources.length > 0
    ) {
      normalized.imageUrls = [...flatImageSources];
    }
    if (!normalized.videoUrl && flatVideoSource) {
      normalized.videoUrl = flatVideoSource;
    }
    if (
      (!normalized.videos || normalized.videos.length === 0) &&
      flatVideoSource
    ) {
      normalized.videos = [flatVideoSource];
    }
    if (!normalized.filePathSource) {
      normalized.filePathSource =
        flatVideoSource || flatImageSources[0] || "";
    }
    if (!normalized.filePath) {
      normalized.filePath =
        normalized.filePathSource || flatVideoSource || flatImageSources[0] || "";
    }
    if (!normalized.mediaType) {
      normalized.mediaType = flatVideoSource
        ? "video"
        : flatImageSources.length > 0
          ? "image"
          : undefined;
    }
    if (normalized.isVideo === undefined && normalized.mediaType) {
      normalized.isVideo = normalized.mediaType === "video";
    }
  }

  if (
    normalized.contractType === "yishe.publish.payload" ||
    normalized.text ||
    normalized.media
  ) {
    const text =
      normalized.text && typeof normalized.text === "object"
        ? normalized.text
        : {};
    const media =
      normalized.media && typeof normalized.media === "object"
        ? normalized.media
        : {};
    const primary =
      media.primary && typeof media.primary === "object" ? media.primary : null;
    const images = normalizeMediaList(media.images, "image");
    const videos = normalizeMediaList(media.videos, "video");

    if (!normalized.title && text.title) {
      normalized.title = String(text.title).trim();
    }
    if (!normalized.description && text.description) {
      normalized.description = String(text.description).trim();
    }
    if (!normalized.content && text.content) {
      normalized.content = String(text.content).trim();
    }
    normalized.tags = normalizeTags(normalized.tags || text.tags);

    if (!normalized.imageUrls || normalized.imageUrls.length === 0) {
      normalized.imageUrls = images.map((item) => item.source);
    }
    if (!normalized.images || normalized.images.length === 0) {
      normalized.images = [...normalized.imageUrls];
    }

    if (!normalized.videoUrl && videos.length > 0) {
      normalized.videoUrl = videos[0].source;
    }
    if (!Array.isArray(normalized.videos) || normalized.videos.length === 0) {
      normalized.videos = videos.map((item) => item.source);
    }

    if (!normalized.filePathSource && primary?.source) {
      normalized.filePathSource = primary.source;
    }
    if (!normalized.mediaType && primary?.kind) {
      normalized.mediaType = primary.kind;
    }
    if (normalized.isVideo === undefined && normalized.mediaType) {
      normalized.isVideo = normalized.mediaType === "video";
    }

    if (
      !normalized.platformOptions ||
      typeof normalized.platformOptions !== "object"
    ) {
      normalized.platformOptions = {};
    }
    if (
      (!normalized.platformOptions ||
        Object.keys(normalized.platformOptions).length === 0) &&
      normalized.publishOptions &&
      typeof normalized.publishOptions === "object"
    ) {
      normalized.platformOptions = { ...normalized.publishOptions };
    }
  }

  if (normalized.post || normalized.assets || normalized.options) {
    const post =
      normalized.post && typeof normalized.post === "object"
        ? normalized.post
        : {};
    const assets =
      normalized.assets && typeof normalized.assets === "object"
        ? normalized.assets
        : {};
    const primary =
      assets.primary && typeof assets.primary === "object"
        ? assets.primary
        : null;
    const assetImages = Array.isArray(assets.images)
      ? assets.images.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const assetVideos = Array.isArray(assets.videos)
      ? assets.videos.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const optionBag =
      normalized.options && typeof normalized.options === "object"
        ? normalized.options
        : {};

    if (!normalized.title && post.title) {
      normalized.title = String(post.title).trim();
    }
    if (!normalized.description && post.description) {
      normalized.description = String(post.description).trim();
    }
    if (!normalized.content && post.content) {
      normalized.content = String(post.content).trim();
    }
    if ((!normalized.tags || normalized.tags.length === 0) && post.tags) {
      normalized.tags = normalizeTags(post.tags);
    }

    if (
      (!normalized.imageUrls || normalized.imageUrls.length === 0) &&
      assetImages.length > 0
    ) {
      normalized.imageUrls = assetImages;
    }
    if (
      (!normalized.images || normalized.images.length === 0) &&
      assetImages.length > 0
    ) {
      normalized.images = [...assetImages];
    }
    if (!normalized.videoUrl && assetVideos.length > 0) {
      normalized.videoUrl = assetVideos[0];
    }
    if (
      (!normalized.videos || normalized.videos.length === 0) &&
      assetVideos.length > 0
    ) {
      normalized.videos = [...assetVideos];
    }
    if (!normalized.filePathSource && primary?.source) {
      normalized.filePathSource = String(primary.source).trim();
    }
    if (!normalized.mediaType && primary?.kind) {
      normalized.mediaType = primary.kind;
    }
    if (normalized.isVideo === undefined && normalized.mediaType) {
      normalized.isVideo = normalized.mediaType === "video";
    }
    if (
      !normalized.platformOptions ||
      typeof normalized.platformOptions !== "object" ||
      Object.keys(normalized.platformOptions).length === 0
    ) {
      normalized.platformOptions = { ...optionBag };
    }
    if (
      !normalized.publishOptions ||
      typeof normalized.publishOptions !== "object" ||
      Object.keys(normalized.publishOptions).length === 0
    ) {
      normalized.publishOptions = { ...optionBag };
    }
  }

  if (!normalized.content && normalized.description) {
    normalized.content = normalized.description;
  }
  if (!normalized.description && normalized.content) {
    normalized.description = normalized.content;
  }

  if (
    (!normalized.description || !String(normalized.description).trim()) &&
    typeof normalized.title === "string"
  ) {
    normalized.description = normalized.description || normalized.title;
  }

  normalized.tags = normalizeTags(normalized.tags);

  if (
    (!Array.isArray(normalized.images) || normalized.images.length === 0) &&
    Array.isArray(normalized.imageUrls) &&
    normalized.imageUrls.length > 0
  ) {
    normalized.images = [...normalized.imageUrls];
  }

  if (!Array.isArray(normalized.videos)) {
    normalized.videos = [];
  }
  if (normalized.videoUrl && normalized.videos.length === 0) {
    normalized.videos = [normalized.videoUrl];
  }

  if (!normalized.filePath) {
    normalized.filePath =
      normalized.filePathSource ||
      normalized.videoUrl ||
      normalized.videos[0] ||
      normalized.images?.[0] ||
      "";
  }

  const optionsFromPlatformSettings =
    primaryPlatform &&
    normalized.platformSettings?.[primaryPlatform] &&
    typeof normalized.platformSettings[primaryPlatform] === "object"
      ? normalized.platformSettings[primaryPlatform]
      : {};
  const platformOptions =
    normalized.platformOptions && typeof normalized.platformOptions === "object"
      ? normalized.platformOptions
      : {};
  const publishOptions =
    normalized.publishOptions && typeof normalized.publishOptions === "object"
      ? normalized.publishOptions
      : {};
  const reservedKeys = new Set([
    "platforms",
    "platform",
    "title",
    "description",
    "content",
    "tags",
    "keywords",
    "images",
    "imageUrls",
    "imageSources",
    "videos",
    "videoUrl",
    "videoSource",
    "filePath",
    "filePathSource",
    "mediaType",
    "isVideo",
    "publishOptions",
    "platformOptions",
    "platformSettings",
    "post",
    "assets",
    "options",
    "processing",
    "contractType",
    "contractVersion",
    "taskKind",
    "text",
    "media",
    "executionHints",
  ]);
  const flatOptions = Object.keys(normalized).reduce<Record<string, any>>(
    (acc, key) => {
      if (reservedKeys.has(key)) {
        return acc;
      }
      acc[key] = normalized[key];
      return acc;
    },
    {},
  );
  const mergedOptions = {
    ...optionsFromPlatformSettings,
    ...publishOptions,
    ...platformOptions,
    ...flatOptions,
  };

  normalized.platformOptions = mergedOptions;
  normalized.publishOptions = mergedOptions;

  if (
    !normalized.platformSettings ||
    typeof normalized.platformSettings !== "object"
  ) {
    normalized.platformSettings = {};
  }

  for (const platform of platforms) {
    if (!platform) {
      continue;
    }
    const current =
      normalized.platformSettings[platform] &&
      typeof normalized.platformSettings[platform] === "object"
        ? normalized.platformSettings[platform]
        : {};
    normalized.platformSettings[platform] = {
      ...current,
      ...mergedOptions,
    };
  }

  Object.keys(mergedOptions).forEach((key) => {
    if (normalized[key] === undefined) {
      normalized[key] = mergedOptions[key];
    }
  });

  return normalized;
}

let legacyEnvReady = false;

function ensureLegacyEnv() {
  if (legacyEnvReady) {
    return;
  }

  const appRoot = app.isPackaged
    ? app.getAppPath()
    : path.resolve(__dirname, "../../..");

  process.env.YISHE_OPEN_BROWSER_ON_START = "0";
  process.env.UPLOADER_OPEN_BROWSER_ON_START = "0";
  process.env.YISHE_APP_ROOT_DIR =
    process.env.YISHE_APP_ROOT_DIR || appRoot;
  process.env.UPLOADER_APP_ROOT_DIR =
    process.env.UPLOADER_APP_ROOT_DIR || appRoot;

  legacyEnvReady = true;
}

function getTempDir() {
  return getAutoBrowserTempDir();
}

class AutoBrowserService {
  private started = false;

  private ensureStarted() {
    ensureLegacyEnv();
    if (this.started) {
      return;
    }
    taskManager.start();
    this.started = true;
  }

  async shutdown() {
    if (!this.started) {
      return;
    }
    taskManager.stop();
    await cleanupBrowserService().catch(() => undefined);
    this.started = false;
  }

  private createResponse(
    status: number,
    body: any,
    headers: Record<string, string> = {
      "content-type": "application/json",
    },
  ): AutoBrowserInvokeResponse {
    return {
      status,
      ok: status >= 200 && status < 300,
      body,
      headers,
    };
  }

  private ok(body: any, status = 200) {
    return this.createResponse(status, body);
  }

  private fail(status: number, message: string, extras: Record<string, any> = {}) {
    return this.createResponse(status, {
      success: false,
      message,
      ...extras,
    });
  }

  private extractProfileIdFromPath(reqPath: string, suffix = "") {
    const prefix = "/api/browser/profiles/";
    if (!reqPath.startsWith(prefix)) {
      return "";
    }

    const remainder = reqPath.slice(prefix.length);
    const normalized =
      suffix && remainder.endsWith(suffix)
        ? remainder.slice(0, -suffix.length)
        : remainder;
    return decodeURIComponent(String(normalized || "").replace(/\/+$/g, "").trim());
  }

  private async handleApiIndex() {
    return this.ok({
      name: "Yishe Auto Browser API",
      version: "2.0-client",
      mode: "embedded",
      transport: "ipc",
      endpoints: [
        { method: "GET", path: "/api" },
        { method: "POST", path: "/api/publish" },
        { method: "POST", path: "/api/tasks/execute" },
        { method: "GET", path: "/api/tasks" },
        { method: "GET", path: "/api/browser/status" },
        { method: "POST", path: "/api/browser/connect" },
        { method: "POST", path: "/api/browser/small-features/run" },
        { method: "POST", path: "/api/ecom-collect/run" },
      ],
    });
  }

  private createRuntimeTask(payload: Record<string, any> = {}) {
    const {
      kind = "publish",
      action = "publish",
      source = {},
      sourceId,
      metadata = {},
      concurrent = false,
      platforms = [],
      publishInfo = {},
    } = payload;
    const taskSource = buildTaskSource({ source, sourceId, kind });

    return taskManager.createTask(
      {
        kind,
        action,
        platform: platforms[0],
        platforms,
        source: taskSource,
        metadata,
        request: {
          action,
          concurrent: !!concurrent,
          platforms,
          payload: publishInfo,
        },
      },
      async (taskContext: any) => {
        taskContext.setStep("dispatch", {
          current: 0,
          total: platforms.length,
          message: `准备执行 ${platforms.length} 个平台任务`,
        });
        taskContext.log("info", "开始执行任务", {
          action,
          platforms,
          source: taskSource,
        });

        const result = await publishService.batchPublish(
          platforms,
          { ...publishInfo, action },
          {
            concurrent: !!concurrent,
            taskLogHandler: (entry: any) => {
              if (!entry?.message) {
                return;
              }
              taskContext.log(entry.level || "info", entry.message, entry.data);
            },
          },
        );

        taskContext.setStep(result?.success ? "completed" : "failed", {
          current: platforms.length,
          total: platforms.length,
          message: result?.success
            ? "任务执行完成"
            : "任务执行结束，存在失败平台",
        });
        taskContext.log(
          result?.success ? "info" : "warn",
          "任务执行返回结果",
          result,
        );
        return result;
      },
    );
  }

  private async handlePublishUnified(body: Record<string, any>) {
    const {
      platforms,
      concurrent = false,
      action = "publish",
      asyncTask = false,
      taskMode,
      source,
      sourceId,
      metadata,
      ...publishInfo
    } = body || {};

    if (!Array.isArray(platforms) || platforms.length === 0) {
      return this.fail(
        400,
        '请传 platforms（数组），单平台如 ["douyin"]，多平台如 ["douyin", "xiaohongshu"]',
      );
    }

    const normalizedPublish = normalizePublishInfo(publishInfo, platforms);
    if (asyncTask === true || taskMode === "task") {
      const task = this.createRuntimeTask({
        kind: "publish",
        action,
        source,
        sourceId,
        metadata,
        concurrent,
        platforms,
        publishInfo: normalizedPublish,
      });

      return this.ok({
        success: true,
        data: {
          taskId: task.id,
          status: task.status,
          source: task.source,
          createdAt: task.createdAt,
        },
        message: "发布任务已创建",
      });
    }

    const result = await publishService.batchPublish(
      platforms,
      { ...normalizedPublish, action },
      { concurrent: !!concurrent },
    );
    return this.ok(result);
  }

  private async handleCreateExecutionTask(body: Record<string, any>) {
    const {
      kind = "publish",
      action = "publish",
      source = {},
      sourceId,
      metadata = {},
      concurrent = false,
      platforms,
      platform,
      ...publishInfo
    } = body || {};

    const resolvedPlatforms =
      Array.isArray(platforms) && platforms.length > 0
        ? platforms.map((item) => String(item || "").trim()).filter(Boolean)
        : platform
          ? [String(platform).trim()]
          : [];

    if (resolvedPlatforms.length === 0) {
      return this.fail(400, "缺少平台信息，请传 platform 或 platforms");
    }

    const normalizedPublish = normalizePublishInfo(
      publishInfo,
      resolvedPlatforms,
    );
    const task = this.createRuntimeTask({
      kind,
      action,
      source,
      sourceId,
      metadata,
      concurrent,
      platforms: resolvedPlatforms,
      publishInfo: normalizedPublish,
    });

    return this.ok({
      success: true,
      data: {
        taskId: task.id,
        status: task.status,
        source: task.source,
        createdAt: task.createdAt,
      },
      message: "任务已创建",
    });
  }

  private async handleListTasks(query: Record<string, any>) {
    const tasks = taskManager.listTasks({
      status: normalizeQueryValue(query, "status"),
      kind: normalizeQueryValue(query, "kind"),
      platform: normalizeQueryValue(query, "platform"),
      sourceId: normalizeQueryValue(query, "sourceId"),
    });

    return this.ok({
      success: true,
      data: tasks,
      total: tasks.length,
    });
  }

  private async handleGetTask(taskId: string) {
    const task = taskManager.getTask(taskId);
    if (!task) {
      return this.fail(404, "任务不存在");
    }
    return this.ok({ success: true, data: task });
  }

  private async handleGetTaskLogs(taskId: string) {
    const logs = taskManager.getTaskLogs(taskId);
    if (!logs) {
      return this.fail(404, "任务不存在");
    }
    return this.ok({
      success: true,
      data: logs,
      total: logs.length,
    });
  }

  private async handleQueryTasksBySource(body: Record<string, any>) {
    const sources = buildSourcesFromQueryBody(body);
    const detail = body?.detail === true;
    const data = taskManager.queryTasksBySourceList(sources, { detail });

    return this.ok({
      success: true,
      data,
      total: data.length,
    });
  }

  private async handleCancelTasksBySource(body: Record<string, any>) {
    const sources = buildSourcesFromQueryBody(body);
    const reason = String(body?.reason || "").trim() || "任务已取消";

    if (sources.length === 0) {
      return this.fail(400, "请传 sourceId/sourceIds 或 sources");
    }

    const data = sources.map((source) => {
      const task = taskManager.cancelTaskBySource(source, reason);
      return {
        source,
        exists: !!task,
        cancelled: !!task,
        task: task || null,
      };
    });

    return this.ok({
      success: true,
      data,
      total: data.length,
      message: "取消指令已处理",
    });
  }

  private async handleQueryTaskLogsBySource(body: Record<string, any>) {
    const sources = buildSourcesFromQueryBody(body);
    const afterIds =
      body?.afterIds && typeof body.afterIds === "object" ? body.afterIds : {};

    const data = sources.map((source) => {
      const sourceId = String(source?.id || "").trim();
      const afterId = sourceId
        ? String(afterIds[sourceId] || "").trim() || undefined
        : undefined;
      const task = taskManager.findTaskSummaryBySource(source);
      const logs = taskManager.findTaskLogsBySource(source, { afterId });
      return {
        source,
        exists: !!task,
        logs: logs || [],
        total: Number(task?.logInfo?.count) || 0,
        lastLogId: task?.logInfo?.last?.id || null,
      };
    });

    return this.ok({
      success: true,
      data,
      total: data.length,
    });
  }

  private async handleGetPlatforms() {
    const platforms = publishService.getSupportedPlatforms();
    const catalog =
      typeof publishService.getPlatformCatalog === "function"
        ? publishService.getPlatformCatalog()
        : [];

    return this.ok({ platforms, items: catalog });
  }

  private async handleBrowserStatus(query: Record<string, any>) {
    const profileId = normalizeQueryValue(query, "profileId");
    const status = await getBrowserStatus({
      profileId,
      lightweight: true,
      includePages: false,
    });
    const localBrowser = getLocalBrowserRequirementStatus();
    const message =
      (!status?.hasInstance && !localBrowser.available && localBrowser.message) ||
      (typeof status?.lastError === "string" && status.lastError.trim()
        ? status.lastError.trim()
        : undefined);

    return this.ok({
      success: true,
      data: {
        ...status,
        localBrowser,
      },
      ...(message ? { message } : {}),
    });
  }

  private async handleBrowserConnect(body: Record<string, any>) {
    const requestedMode = String(body?.mode || "").trim().toLowerCase();
    const headless =
      body?.headless === true ? true : body?.headless === false ? false : undefined;
    const explicitProfileId = normalizeString(body?.profileId) || undefined;
    const activeProfileId =
      normalizeString(listManagedBrowserProfiles()?.activeProfileId) || undefined;
    const profileId = explicitProfileId || activeProfileId;

    if (requestedMode && requestedMode !== "cdp") {
      console.warn(
        `[auto-browser] 收到已废弃浏览器模式 "${requestedMode}"，已统一改为 cdp`,
      );
    }

    await checkAndReconnectBrowser({ reconnect: false, profileId });
    const statusBefore = await getBrowserStatus({ profileId });
    if (
      statusBefore.hasInstance &&
      statusBefore.isConnected &&
      Object.keys(body || {}).length === 0
    ) {
      return this.ok({ success: true, data: statusBefore });
    }

    await getOrCreateBrowser({
      ...body,
      mode: "cdp",
      profileId,
      headless,
    });
    const status = await getBrowserStatus({ profileId });
    return this.ok({ success: true, data: status });
  }

  private async handleBrowserProfilesList() {
    return this.ok({
      success: true,
      data: listManagedBrowserProfiles(),
    });
  }

  private async handleBrowserProfilesCreate(body: Record<string, any>) {
    const created = createManagedBrowserProfile(body || {});
    return this.ok({
      success: true,
      data: created,
      message: "环境已创建",
    });
  }

  private async handleBrowserProfileDetail(reqPath: string) {
    const profileId = this.extractProfileIdFromPath(reqPath);
    const profile = getManagedBrowserProfile(profileId);
    if (!profile) {
      return this.fail(404, "环境不存在");
    }
    return this.ok({ success: true, data: profile });
  }

  private async handleBrowserProfileUpdate(
    reqPath: string,
    body: Record<string, any>,
  ) {
    const profileId = this.extractProfileIdFromPath(reqPath);
    const profile = updateManagedBrowserProfile(profileId, body || {});
    return this.ok({
      success: true,
      data: profile,
      message: "环境已更新",
    });
  }

  private async handleBrowserProfileDelete(reqPath: string) {
    const profileId = this.extractProfileIdFromPath(reqPath);
    const result = await deleteManagedBrowserProfile(profileId);
    return this.ok({
      success: true,
      data: result,
      message: "环境已删除",
    });
  }

  private async handleBrowserProfileSwitch(reqPath: string) {
    const profileId = this.extractProfileIdFromPath(reqPath, "/switch");
    const profile = switchManagedBrowserProfile(profileId);
    return this.ok({
      success: true,
      data: profile,
      message: "环境已切换",
    });
  }

  private async handleBrowserOpenUserDataDir(body: Record<string, any>) {
    const rawDirPath = String(body?.dirPath || "").trim();
    const ensureExists = body?.ensureExists !== false;

    if (!rawDirPath) {
      return this.fail(400, "缺少 dirPath");
    }

    const dirPath = path.resolve(rawDirPath);
    if (ensureExists && !fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    if (!fs.existsSync(dirPath)) {
      return this.fail(404, "目录不存在");
    }

    const errorMessage = await shell.openPath(dirPath);
    if (errorMessage) {
      return this.fail(500, errorMessage || "打开目录失败");
    }

    return this.ok({
      success: true,
      message: "目录已打开",
      data: { dirPath },
    });
  }

  private async handleBrowserClose(body: Record<string, any>) {
    const profileId = normalizeString(body?.profileId) || undefined;
    await closeBrowser({ profileId });
    const status = await getBrowserStatus({ profileId });
    return this.ok({ success: true, data: status });
  }

  private async handleBrowserFocus(body: Record<string, any>) {
    const profileId = normalizeString(body?.profileId) || undefined;
    const result = await focusBrowser({ profileId });
    const status = await getBrowserStatus({ profileId });
    return this.ok({
      success: true,
      message: "浏览器窗口已聚焦",
      data: {
        ...(result || {}),
        status,
      },
    });
  }

  private async handleBrowserForceClose(body: Record<string, any>) {
    const port = Number(body?.port || 9222);
    const result = await forceCloseBrowserByPort({ port });
    return this.ok({ success: true, data: result });
  }

  private async handleBrowserLaunchDebug(body: Record<string, any>) {
    const result = launchWithDebugPort(body || {});
    return this.ok({ success: true, data: result });
  }

  private async handleBrowserCheckPort(body: Record<string, any>) {
    const port = Number(body?.port || 9222);
    const response = await new Promise<Record<string, any>>((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${port}/json/version`,
        { timeout: 3000 },
        (resp: any) => {
          let data = "";
          resp.on("data", (chunk: Buffer | string) => {
            data += chunk.toString();
          });
          resp.on("end", () => {
            try {
              const json = JSON.parse(data);
              resolve({
                ok: true,
                port,
                browser: json.Browser || json.browser,
              });
            } catch {
              resolve({
                ok: true,
                port,
                raw: data?.slice(0, 200),
              });
            }
          });
        },
      );
      req.on("error", (error: Error) =>
        resolve({ ok: false, port, error: error.message }),
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, port, error: "连接超时" });
      });
    });

    return this.ok({ success: true, data: response });
  }

  private async ensureBrowserReady(profileId?: string) {
    const browserStatus = await getBrowserStatus({ profileId });
    if (!browserStatus?.hasInstance || !browserStatus?.isConnected) {
      return {
        ok: false,
        response: this.fail(400, "浏览器实例未启动或未连接，请先连接浏览器"),
      };
    }
    return { ok: true, browserStatus };
  }

  private async handleBrowserOpenPlatform(body: Record<string, any>) {
    const platform = normalizeString(body?.platform);
    const profileId = normalizeString(body?.profileId) || undefined;

    if (!platform) {
      return this.fail(
        400,
        "请传 platform（如 douyin、xiaohongshu、weibo、kuaishou、doudian、kuaishou_shop、temu）",
      );
    }

    const config = PLATFORM_CONFIGS[platform];
    if (!config || !config.uploadUrl) {
      return this.fail(400, `不支持的平台: ${platform}`);
    }

    const ready = await this.ensureBrowserReady(profileId);
    if (!ready.ok) {
      return ready.response;
    }

    const browser = await getOrCreateBrowser({ profileId });
    const page = await browser.newPage({ foreground: true });
    await page.goto(config.uploadUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    return this.ok({
      success: true,
      data: {
        platform,
        name: config.name,
        url: config.uploadUrl,
      },
    });
  }

  private async handleBrowserOpenLink(body: Record<string, any>) {
    const targetUrl = normalizeString(body?.url);
    const profileId = normalizeString(body?.profileId) || undefined;

    if (!targetUrl) {
      return this.fail(400, "请传 url");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return this.fail(400, "url 格式不正确");
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return this.fail(400, "仅支持 http/https 链接");
    }

    const ready = await this.ensureBrowserReady(profileId);
    if (!ready.ok) {
      return ready.response;
    }

    const browser = await getOrCreateBrowser({ profileId });
    const page = await browser.newPage({ foreground: true });
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    return this.ok({
      success: true,
      data: {
        url: targetUrl,
        title: await page.title().catch(() => ""),
      },
    });
  }

  private async handleBrowserSmallFeatures() {
    return this.ok({
      success: true,
      data: listBrowserAutomationSmallFeatures(),
    });
  }

  private async handleBrowserRunSmallFeature(body: Record<string, any>) {
    const featureKey = normalizeString(body?.featureKey);
    if (!featureKey) {
      return this.fail(400, "缺少 featureKey");
    }

    const { featureKey: _ignored, ...payload } = body || {};
    const result = await runBrowserAutomationSmallFeature(featureKey, payload);
    return this.ok(result);
  }

  private async handleBrowserPages(query: Record<string, any>) {
    const profileId = normalizeQueryValue(query, "profileId");
    const ready = await this.ensureBrowserReady(profileId);
    if (!ready.ok) {
      return ready.response;
    }

    const pages = await listBrowserPages({ profileId });
    return this.ok({ success: true, data: pages });
  }

  private async handleBrowserDebug(body: Record<string, any>) {
    const action = normalizeString(body?.action);
    const profileId = normalizeString(body?.profileId) || undefined;

    const ready = await this.ensureBrowserReady(profileId);
    if (!ready.ok) {
      return ready.response;
    }

    const pageIndexValue = body?.pageIndex;
    const pageIndex =
      pageIndexValue === "" ||
      pageIndexValue === undefined ||
      pageIndexValue === null
        ? undefined
        : Number(pageIndexValue);

    if (!action) {
      return this.fail(400, "缺少 action");
    }

    const resolvePage = async () => {
      if (action === "newPage") {
        return createBrowserPage({ profileId });
      }
      if (pageIndex !== undefined && !Number.isNaN(pageIndex)) {
        return getBrowserPage(pageIndex, { profileId });
      }
      return getBrowserPage(0, { profileId });
    };

    const page = await resolvePage();
    const timeout =
      Number(body?.timeout) > 0 ? Number(body.timeout) : 30000;
    let result: Record<string, any> | null = null;

    switch (action) {
      case "newPage":
        result = { url: page.url(), title: await page.title().catch(() => "") };
        break;
      case "goto": {
        const targetUrl = normalizeString(body?.url);
        if (!targetUrl) {
          throw new Error("缺少 url");
        }
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout,
        });
        result = { url: page.url(), title: await page.title().catch(() => "") };
        break;
      }
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded", timeout });
        result = { url: page.url(), title: await page.title().catch(() => "") };
        break;
      case "bringToFront":
        await page.bringToFront();
        result = { focused: true };
        break;
      case "closePage": {
        await page.close({ runBeforeUnload: true });
        const pagesAfterClose = await listBrowserPages({ profileId });
        return this.ok({
          success: true,
          data: {
            action,
            page: null,
            result: { closed: true },
            pages: pagesAfterClose,
          },
        });
      }
      case "click": {
        const selector = normalizeString(body?.selector);
        if (!selector) {
          throw new Error("缺少 selector");
        }
        await page.locator(selector).first().click({ timeout });
        result = { clicked: true };
        break;
      }
      case "fill": {
        const selector = normalizeString(body?.selector);
        if (!selector) {
          throw new Error("缺少 selector");
        }
        await page.locator(selector).first().fill(String(body?.text || ""), {
          timeout,
        });
        result = { filled: true };
        break;
      }
      case "type": {
        const selector = normalizeString(body?.selector);
        if (!selector) {
          throw new Error("缺少 selector");
        }
        await page
          .locator(selector)
          .first()
          .pressSequentially(String(body?.text || ""), { timeout });
        result = { typed: true };
        break;
      }
      case "press": {
        const selector = normalizeString(body?.selector);
        const key = normalizeString(body?.key);
        if (!selector) {
          throw new Error("缺少 selector");
        }
        if (!key) {
          throw new Error("缺少 key");
        }
        await page.locator(selector).first().press(key, { timeout });
        result = { pressed: key };
        break;
      }
      case "text": {
        const selector = normalizeString(body?.selector);
        if (!selector) {
          throw new Error("缺少 selector");
        }
        result = {
          text: await page.locator(selector).first().textContent({ timeout }),
        };
        break;
      }
      case "html": {
        const selector = normalizeString(body?.selector);
        if (!selector) {
          throw new Error("缺少 selector");
        }
        result = {
          html: await page.locator(selector).first().innerHTML({ timeout }),
        };
        break;
      }
      case "count": {
        const selector = normalizeString(body?.selector);
        if (!selector) {
          throw new Error("缺少 selector");
        }
        result = {
          count: await page.locator(selector).count(),
        };
        break;
      }
      case "eval": {
        const expression = normalizeString(body?.expression);
        if (!expression) {
          throw new Error("缺少 expression");
        }
        result = {
          value: await page.evaluate((expr: string) => globalThis.eval(expr), expression),
        };
        break;
      }
      case "playwright": {
        const script = normalizeString(body?.expression);
        if (!script) {
          throw new Error("缺少 expression");
        }
        result = await executePlaywrightScript(page, script);
        break;
      }
      case "wait": {
        const ms = Number(body?.ms) || 1000;
        await page.waitForTimeout(ms);
        result = { waited: ms };
        break;
      }
      case "screenshot": {
        const filename = `browser-debug-${Date.now()}.png`;
        const tempDir = getTempDir();
        const savePath = path.resolve(tempDir, filename);
        fs.mkdirSync(tempDir, { recursive: true });
        await page.screenshot({ path: savePath, fullPage: true });
        result = { path: savePath, filename };
        break;
      }
      default:
        throw new Error(`不支持的 action: ${action}`);
    }

    const currentUrl = page.url();
    const currentTitle = await page.title().catch(() => "");
    const pages = await listBrowserPages({ profileId });
    return this.ok({
      success: true,
      data: {
        action,
        page: {
          url: currentUrl,
          title: currentTitle,
          index: pages.findIndex(
            (item: any) => item.url === currentUrl && item.title === currentTitle,
          ),
        },
        result,
        pages,
      },
    });
  }

  private async handleBrowserCheckAndReconnect(
    method: string,
    query: Record<string, any>,
    body: Record<string, any>,
  ) {
    let reconnect = false;
    let profileId: string | undefined;
    if (method === "POST") {
      reconnect = !!body?.reconnect;
      profileId = normalizeString(body?.profileId) || undefined;
    } else {
      profileId = normalizeQueryValue(query, "profileId");
    }

    const result = await checkAndReconnectBrowser({ reconnect, profileId });
    return this.ok({
      success: true,
      available: result.available,
      reconnected: result.reconnected || false,
      message: result.message,
      status: result.status,
    });
  }

  private async handleExportUserData(query: Record<string, any>) {
    const userDataDir = normalizeQueryValue(query, "userDataDir");
    const buffer = await exportUserData(userDataDir);
    return this.ok({
      success: true,
      data: {
        encoding: "base64",
        filename: `yishe-auto-browser-userdata-${new Date().toISOString().split("T")[0]}.zip`,
        buffer: buffer.toString("base64"),
      },
    });
  }

  private async handleLoginStatus(query: Record<string, any>) {
    const forceRefresh = normalizeQueryValue(query, "refresh") === "1";
    const profileId = normalizeQueryValue(query, "profileId");
    const loginStatus = await PlatformLoginService.checkSocialMediaLoginStatus(
      forceRefresh,
      { profileId },
    );

    if (profileId) {
      try {
        updateManagedBrowserProfile(profileId, {
          loginSummary: loginStatus,
        });
      } catch {
        // ignore
      }
    }

    return this.ok({
      success: true,
      data: loginStatus,
    });
  }

  private async handleCrawlerHealth() {
    const result = await crawlerService.checkCrawlerHealth();
    return this.ok(result);
  }

  private async handleCrawlerSites() {
    const sites = crawlerService.getSupportedSites();
    return this.ok({ success: true, sites });
  }

  private async handleCrawlUrl(body: Record<string, any>) {
    try {
      const result = await crawlerService.crawlUrl(body || {});
      return this.ok(result);
    } catch (error: any) {
      const statusCode = error?.message?.includes("缺少 url 参数") ? 400 : 500;
      return this.fail(statusCode, error?.message || "抓取失败");
    }
  }

  private async handleCrawlerRun(body: Record<string, any>) {
    try {
      const { site, params = {} } = body || {};
      const result = await crawlerService.runSiteCrawler(site, params);
      return this.ok(result);
    } catch (error: any) {
      const isBadRequest =
        error?.message?.includes("缺少 site 参数") ||
        error?.message?.includes("不支持的 site");
      return this.fail(
        isBadRequest ? 400 : 500,
        error?.message || "执行爬虫任务失败",
      );
    }
  }

  private async handleEcomCollectPlatforms() {
    const result = await getEcomPlatformCatalog();
    return this.ok({
      success: true,
      data: result,
    });
  }

  private async handleEcomCollectCapabilities() {
    const result = await getEcomCollectCapabilities();
    return this.ok({
      success: true,
      data: result,
    });
  }

  private async handleEcomCollectRun(body: Record<string, any>) {
    const result = await runEcomCollectTask(body || {});
    return this.ok(result);
  }

  async invoke(request: AutoBrowserInvokeRequest): Promise<AutoBrowserInvokeResponse> {
    this.ensureStarted();

    const method = normalizeRequestMethod(request?.method);
    const reqPath = normalizeRequestPath(request?.path);
    const query =
      request?.query && typeof request.query === "object" ? request.query : {};
    const body =
      request?.body && typeof request.body === "object"
        ? request.body
        : request?.body || {};

    try {
      if (reqPath === "/api" && method === "GET") {
        return this.handleApiIndex();
      }
      if (reqPath === "/api/publish" && method === "POST") {
        return this.handlePublishUnified(body);
      }
      if (reqPath === "/api/tasks/execute" && method === "POST") {
        return this.handleCreateExecutionTask(body);
      }
      if (reqPath === "/api/tasks" && method === "GET") {
        return this.handleListTasks(query);
      }
      if (reqPath === "/api/tasks/query-by-source" && method === "POST") {
        return this.handleQueryTasksBySource(body);
      }
      if (reqPath === "/api/tasks/cancel-by-source" && method === "POST") {
        return this.handleCancelTasksBySource(body);
      }
      if (reqPath === "/api/tasks/logs/query-by-source" && method === "POST") {
        return this.handleQueryTaskLogsBySource(body);
      }
      if (reqPath.startsWith("/api/tasks/") && reqPath.endsWith("/logs") && method === "GET") {
        const taskId = decodeURIComponent(
          reqPath.replace("/api/tasks/", "").replace("/logs", "").trim(),
        );
        return this.handleGetTaskLogs(taskId);
      }
      if (reqPath.startsWith("/api/tasks/") && method === "GET") {
        const taskId = decodeURIComponent(reqPath.replace("/api/tasks/", "").trim());
        return this.handleGetTask(taskId);
      }
      if (reqPath === "/api/platforms" && method === "GET") {
        return this.handleGetPlatforms();
      }
      if (reqPath === "/api/browser/status" && method === "GET") {
        return this.handleBrowserStatus(query);
      }
      if (reqPath === "/api/browser/connect" && method === "POST") {
        return this.handleBrowserConnect(body);
      }
      if (reqPath === "/api/browser/close" && method === "POST") {
        return this.handleBrowserClose(body);
      }
      if (reqPath === "/api/browser/focus" && method === "POST") {
        return this.handleBrowserFocus(body);
      }
      if (reqPath === "/api/browser/force-close" && method === "POST") {
        return this.handleBrowserForceClose(body);
      }
      if (reqPath === "/api/browser/launch-with-debug" && method === "POST") {
        return this.handleBrowserLaunchDebug(body);
      }
      if (reqPath === "/api/browser/check-port" && method === "POST") {
        return this.handleBrowserCheckPort(body);
      }
      if (reqPath === "/api/browser/open-platform" && method === "POST") {
        return this.handleBrowserOpenPlatform(body);
      }
      if (reqPath === "/api/browser/open-link" && method === "POST") {
        return this.handleBrowserOpenLink(body);
      }
      if (reqPath === "/api/browser/small-features" && method === "GET") {
        return this.handleBrowserSmallFeatures();
      }
      if (reqPath === "/api/browser/small-features/run" && method === "POST") {
        return this.handleBrowserRunSmallFeature(body);
      }
      if (reqPath === "/api/browser/open-user-data-dir" && method === "POST") {
        return this.handleBrowserOpenUserDataDir(body);
      }
      if (reqPath === "/api/browser/pages" && method === "GET") {
        return this.handleBrowserPages(query);
      }
      if (reqPath === "/api/browser/debug" && method === "POST") {
        return this.handleBrowserDebug(body);
      }
      if (reqPath === "/api/browser/profiles" && method === "GET") {
        return this.handleBrowserProfilesList();
      }
      if (reqPath === "/api/browser/profiles" && method === "POST") {
        return this.handleBrowserProfilesCreate(body);
      }
      if (
        reqPath.startsWith("/api/browser/profiles/") &&
        reqPath.endsWith("/switch") &&
        method === "POST"
      ) {
        return this.handleBrowserProfileSwitch(reqPath);
      }
      if (reqPath.startsWith("/api/browser/profiles/") && method === "GET") {
        return this.handleBrowserProfileDetail(reqPath);
      }
      if (reqPath.startsWith("/api/browser/profiles/") && method === "PUT") {
        return this.handleBrowserProfileUpdate(reqPath, body);
      }
      if (reqPath.startsWith("/api/browser/profiles/") && method === "DELETE") {
        return this.handleBrowserProfileDelete(reqPath);
      }
      if (
        (reqPath === "/api/browser/check-and-reconnect" ||
          reqPath === "/api/browser/check") &&
        (method === "GET" || method === "POST")
      ) {
        return this.handleBrowserCheckAndReconnect(method, query, body);
      }
      if (reqPath === "/api/browser/export-user-data" && method === "GET") {
        return this.handleExportUserData(query);
      }
      if (reqPath === "/api/login-status" && method === "GET") {
        return this.handleLoginStatus(query);
      }
      if (reqPath === "/api/crawler/health" && method === "GET") {
        return this.handleCrawlerHealth();
      }
      if (reqPath === "/api/crawler/sites" && method === "GET") {
        return this.handleCrawlerSites();
      }
      if (reqPath === "/api/crawler/url" && method === "POST") {
        return this.handleCrawlUrl(body);
      }
      if (reqPath === "/api/crawler/run" && method === "POST") {
        return this.handleCrawlerRun(body);
      }
      if (reqPath === "/api/ecom-collect/platforms" && method === "GET") {
        return this.handleEcomCollectPlatforms();
      }
      if (reqPath === "/api/ecom-collect/capabilities" && method === "GET") {
        return this.handleEcomCollectCapabilities();
      }
      if (reqPath === "/api/ecom-collect/run" && method === "POST") {
        return this.handleEcomCollectRun(body);
      }
      if (reqPath === "/api/docs" && method === "GET") {
        return this.ok({
          success: true,
          mode: "embedded",
          message: "嵌入式模式不再提供独立 Swagger 页面，请直接通过 IPC 调用。",
        });
      }
      if (reqPath === "/api/swagger" && method === "GET") {
        return this.ok({
          success: true,
          mode: "embedded",
          message: "嵌入式模式不再提供独立 Swagger UI。",
        });
      }

      return this.fail(404, "Not Found", { error: "Not Found" });
    } catch (error: any) {
      return this.fail(500, error?.message || "请求处理失败");
    }
  }
}

const autoBrowserService = new AutoBrowserService();

export async function invokeAutoBrowserRoute(
  request: AutoBrowserInvokeRequest,
) {
  return autoBrowserService.invoke(request);
}

export async function shutdownAutoBrowserService() {
  return autoBrowserService.shutdown();
}

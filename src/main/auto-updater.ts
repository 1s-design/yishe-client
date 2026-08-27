/**
 * 自动更新模块
 *
 * 流程：
 * 1. 启动时检查更新（静默，不打扰用户）
 * 2. 发现新版本 → 通知用户（IPC → 渲染进程）
 * 3. 用户点击"更新" → 开始下载（显示进度）
 * 4. 下载完成 → 提示用户重启安装
 */

import { autoUpdater, type UpdateCheckResult, type ProgressInfo } from "electron-updater";
import { BrowserWindow, app, dialog } from "electron";

// 更新状态
export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateInfo {
  state: UpdateState;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  progress?: number; // 0-100
  error?: string;
}

let mainWindow: BrowserWindow | null = null;
let currentUpdateInfo: UpdateInfo = { state: "idle" };
let isAutoCheckEnabled = true;

/**
 * 初始化自动更新
 */
export function initAutoUpdater(window: BrowserWindow): void {
  mainWindow = window;

  // 配置：启动时自动检查
  autoUpdater.autoDownload = false; // 不自动下载，等用户确认
  autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装（下载完成后）
  autoUpdater.allowDowngrade = false;

  // 检查到更新可用
  autoUpdater.on("update-available", (info) => {
    currentUpdateInfo = {
      state: "available",
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    };
    sendUpdateToRenderer(currentUpdateInfo);
  });

  // 没有可用更新
  autoUpdater.on("update-not-available", () => {
    currentUpdateInfo = { state: "not-available" };
    sendUpdateToRenderer(currentUpdateInfo);
  });

  // 开始下载
  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    currentUpdateInfo = {
      ...currentUpdateInfo,
      state: "downloading",
      progress: Math.round(progress.percent),
    };
    sendUpdateToRenderer(currentUpdateInfo);
  });

  // 下载完成
  autoUpdater.on("update-downloaded", (info) => {
    currentUpdateInfo = {
      ...currentUpdateInfo,
      state: "downloaded",
      progress: 100,
    };
    sendUpdateToRenderer(currentUpdateInfo);
    // 提示用户重启
    showRestartDialog();
  });

  // 错误
  autoUpdater.on("error", (error) => {
    currentUpdateInfo = {
      state: "error",
      error: error?.message || "更新出错",
    };
    sendUpdateToRenderer(currentUpdateInfo);
  });
}

/**
 * 检查更新（启动时调用，仅生产环境）
 */
export async function checkForUpdates(): Promise<void> {
  if (!isAutoCheckEnabled) return;
  // 开发环境不检查更新
  if (!app.isPackaged) {
    currentUpdateInfo = { state: "not-available" };
    return;
  }
  try {
    currentUpdateInfo = { state: "checking" };
    sendUpdateToRenderer(currentUpdateInfo);
    await autoUpdater.checkForUpdates();
  } catch (error) {
    currentUpdateInfo = {
      state: "error",
      error: error instanceof Error ? error.message : "检查更新失败",
    };
    sendUpdateToRenderer(currentUpdateInfo);
  }
}

/**
 * 用户确认后开始下载
 */
export async function startDownload(): Promise<void> {
  if (currentUpdateInfo.state !== "available") return;
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    currentUpdateInfo = {
      state: "error",
      error: error instanceof Error ? error.message : "下载失败",
    };
    sendUpdateToRenderer(currentUpdateInfo);
  }
}

/**
 * 退出并安装更新
 */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall(false, true);
}

/**
 * 获取当前更新状态
 */
export function getUpdateInfo(): UpdateInfo {
  return currentUpdateInfo;
}

/**
 * 发送更新状态到渲染进程
 */
function sendUpdateToRenderer(info: UpdateInfo): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:update-status", info);
  }
}

/**
 * 显示重启对话框
 */
function showRestartDialog(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  dialog
    .showMessageBox(mainWindow, {
      type: "info",
      title: "更新已就绪",
      message: `新版本 ${currentUpdateInfo.version} 已下载完成`,
      detail: "是否立即重启应用以安装更新？",
      buttons: ["稍后重启", "立即重启"],
      defaultId: 1,
      cancelId: 0,
    })
    .then(({ response }) => {
      if (response === 1) {
        quitAndInstall();
      }
    });
}

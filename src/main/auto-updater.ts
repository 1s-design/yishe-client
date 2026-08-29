/**
 * 自动更新模块
 *
 * 流程：
 * 1. 启动时检查更新（静默，不打扰用户）
 * 2. 发现新版本 → 通知用户（IPC → 渲染进程）
 * 3. 用户点击"更新" → 开始下载（显示进度）
 * 4. 下载完成 → 提示用户重启安装
 */

import { autoUpdater, type ProgressInfo } from "electron-updater";
import { BrowserWindow, app, dialog, shell } from "electron";
import axios from "axios";

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
  currentVersion?: string;
  releaseDate?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  progress?: number; // 0-100
  error?: string;
  isDev?: boolean;
}

export interface RemoteReleaseInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  downloadUrl?: string;
}

let mainWindow: BrowserWindow | null = null;
let currentUpdateInfo: UpdateInfo = { state: "idle" };
let isAutoCheckEnabled = true;

/** 检查更新超时时间（毫秒） */
const CHECK_TIMEOUT = 30000;

/** 语义化版本比对: v1 > v2 返回 1, v1 < v2 返回 -1, 相等返回 0 */
function compareSemver(v1: string, v2: string): number {
  const clean1 = (v1 || "").replace(/^v/, "").trim();
  const clean2 = (v2 || "").replace(/^v/, "").trim();
  const p1 = clean1.split(".").map((n) => parseInt(n, 10) || 0);
  const p2 = clean2.split(".").map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(p1.length, p2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * 多源并发/回退查询线上最新版本信息（防代理与CDN强缓存）
 */
export async function fetchRemoteLatestRelease(): Promise<RemoteReleaseInfo | null> {
  const timestamp = Date.now();
  const headers = {
    "User-Agent": "yishe-client-updater",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
  };

  // 1. 尝试直接请求 GitHub Releases API
  try {
    const res = await axios.get(
      `https://api.github.com/repos/1s-design/yishe-client/releases/latest?_t=${timestamp}`,
      { headers, timeout: 6000 }
    );
    if (res.data && res.data.tag_name) {
      const version = String(res.data.tag_name).replace(/^v/, "");
      return {
        version,
        releaseDate: res.data.published_at,
        releaseNotes: typeof res.data.body === "string" ? res.data.body : undefined,
        releaseUrl: res.data.html_url || "https://github.com/1s-design/yishe-client/releases/latest",
      };
    }
  } catch (e) {
    console.warn("[AutoUpdater] GitHub API 查询失败，尝试备用源:", (e as Error).message);
  }

  // 2. 尝试备用镜像源（gh-proxy 代理及 raw 文件，带防缓存时间戳）
  const channelFile = process.platform === "darwin" ? "latest-mac.yml" : "latest.yml";
  const candidateUrls = [
    `https://gh-proxy.com/https://github.com/1s-design/yishe-client/releases/latest/download/${channelFile}?_t=${timestamp}`,
    `https://raw.githubusercontent.com/1s-design/yishe-client/main/package.json?_t=${timestamp}`,
    `https://gh-proxy.com/https://raw.githubusercontent.com/1s-design/yishe-client/main/package.json?_t=${timestamp}`,
  ];

  for (const url of candidateUrls) {
    try {
      const res = await axios.get(url, { headers, timeout: 6000 });
      if (typeof res.data === "string" && res.data.includes("version:")) {
        const match = res.data.match(/version:\s*([^\s\r\n]+)/);
        if (match && match[1]) {
          const version = match[1].replace(/['"]/g, "").trim();
          return {
            version,
            releaseUrl: "https://github.com/1s-design/yishe-client/releases/latest",
          };
        }
      } else if (res.data && typeof res.data === "object" && res.data.version) {
        return {
          version: String(res.data.version).replace(/^v/, "").trim(),
          releaseUrl: "https://github.com/1s-design/yishe-client/releases/latest",
        };
      }
    } catch {
      // 继续尝试下一个候选地址
    }
  }

  return null;
}

/**
 * 初始化自动更新
 */
export function initAutoUpdater(window: BrowserWindow): void {
  mainWindow = window;

  // 设置 logger 方便排查
  autoUpdater.logger = console;

  // 启用 electron-updater 内置防缓存查询
  (autoUpdater as any).isAddNoCacheQuery = true;

  // 配置更新源：使用 generic 模式 + gh-proxy.com 加速
  autoUpdater.setFeedURL({
    provider: "generic",
    url: "https://gh-proxy.com/https://github.com/1s-design/yishe-client/releases/latest/download/",
  });

  // 配置：启动时不自动下载，等用户确认
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装（下载完成后）
  autoUpdater.allowDowngrade = false;

  // 检查到更新可用
  autoUpdater.on("update-available", (info) => {
    console.log("[AutoUpdater] 发现新版本:", info.version);
    currentUpdateInfo = {
      state: "available",
      version: info.version,
      currentVersion: app.getVersion(),
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
      releaseUrl: "https://github.com/1s-design/yishe-client/releases/latest",
      isDev: false,
    };
    sendUpdateToRenderer(currentUpdateInfo);
  });

  // 没有可用更新
  autoUpdater.on("update-not-available", (info) => {
    console.log("[AutoUpdater] 已是最新版本:", info?.version || "");
    currentUpdateInfo = {
      state: "not-available",
      version: info?.version || app.getVersion(),
      currentVersion: app.getVersion(),
      isDev: false,
    };
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
    console.log("[AutoUpdater] 更新下载完成:", info.version);
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
    console.error("[AutoUpdater] 更新过程出错:", error);
    currentUpdateInfo = {
      state: "error",
      error: error?.message || "更新出错",
      currentVersion: app.getVersion(),
      releaseUrl: "https://github.com/1s-design/yishe-client/releases/latest",
    };
    sendUpdateToRenderer(currentUpdateInfo);
  });
}

/**
 * 检查更新（启动或用户手动点击时调用）
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  if (!isAutoCheckEnabled) return currentUpdateInfo;

  currentUpdateInfo = {
    state: "checking",
    currentVersion: app.getVersion(),
  };
  sendUpdateToRenderer(currentUpdateInfo);

  const localVersion = app.getVersion();

  // 1. 开发环境：查询远程最新版本并比对
  if (!app.isPackaged) {
    console.log("[AutoUpdater] 当前为开发环境，正在远程查询最新版本...");
    try {
      const remoteInfo = await fetchRemoteLatestRelease();
      if (remoteInfo && compareSemver(remoteInfo.version, localVersion) > 0) {
        currentUpdateInfo = {
          state: "available",
          version: remoteInfo.version,
          currentVersion: localVersion,
          releaseDate: remoteInfo.releaseDate,
          releaseNotes: remoteInfo.releaseNotes,
          releaseUrl: remoteInfo.releaseUrl || "https://github.com/1s-design/yishe-client/releases/latest",
          isDev: true,
        };
      } else {
        currentUpdateInfo = {
          state: "not-available",
          version: remoteInfo?.version || localVersion,
          currentVersion: localVersion,
          isDev: true,
        };
      }
    } catch (error) {
      currentUpdateInfo = {
        state: "error",
        error: error instanceof Error ? error.message : "远程查询失败",
        currentVersion: localVersion,
        isDev: true,
      };
    }
    sendUpdateToRenderer(currentUpdateInfo);
    return currentUpdateInfo;
  }

  // 2. 打包生产环境：执行 electron-updater 检查
  try {
    console.log("[AutoUpdater] 生产环境开始检查更新...");
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT);
    });
    await Promise.race([autoUpdater.checkForUpdates(), timeoutPromise]);
  } catch (error) {
    console.error("[AutoUpdater] 检查更新异常:", error);

    // 如果 electron-updater 发生异常（如由于代理连接超时），通过 HTTP 兜底查询远程版本
    try {
      const remoteInfo = await fetchRemoteLatestRelease();
      if (remoteInfo && compareSemver(remoteInfo.version, localVersion) > 0) {
        currentUpdateInfo = {
          state: "available",
          version: remoteInfo.version,
          currentVersion: localVersion,
          releaseDate: remoteInfo.releaseDate,
          releaseNotes: remoteInfo.releaseNotes,
          releaseUrl: remoteInfo.releaseUrl || "https://github.com/1s-design/yishe-client/releases/latest",
          isDev: false,
        };
        sendUpdateToRenderer(currentUpdateInfo);
        return currentUpdateInfo;
      }
    } catch {
      // 忽略兜底查询错误
    }

    if ((error as Error)?.message === "timeout") {
      currentUpdateInfo = {
        state: "error",
        error: "检查超时，请检查网络连接",
        currentVersion: localVersion,
        releaseUrl: "https://github.com/1s-design/yishe-client/releases/latest",
      };
    } else {
      currentUpdateInfo = {
        state: "error",
        error: error instanceof Error ? error.message : "检查更新失败",
        currentVersion: localVersion,
        releaseUrl: "https://github.com/1s-design/yishe-client/releases/latest",
      };
    }
    sendUpdateToRenderer(currentUpdateInfo);
  }
  return currentUpdateInfo;
}

/**
 * 用户确认后开始下载
 */
export async function startDownload(): Promise<void> {
  if (currentUpdateInfo.state !== "available") return;

  // 开发环境直接在浏览器中打开下载地址
  if (!app.isPackaged || currentUpdateInfo.isDev) {
    const targetUrl = currentUpdateInfo.releaseUrl || "https://github.com/1s-design/yishe-client/releases/latest";
    await shell.openExternal(targetUrl);
    return;
  }

  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    console.error("[AutoUpdater] 自动下载失败:", error);
    currentUpdateInfo = {
      state: "error",
      error: error instanceof Error ? error.message : "下载失败，请手动前往下载",
      currentVersion: app.getVersion(),
      releaseUrl: currentUpdateInfo.releaseUrl || "https://github.com/1s-design/yishe-client/releases/latest",
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

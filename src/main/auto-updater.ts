/**
 * 客户端自更新模块 (Auto Updater)
 *
 * 核心设计：
 * 1. 极速多源版本检测：优先请求腾讯云 COS latest.yml（毫秒级直连返回最新版本），备选后台接口与 GitHub 镜像。
 * 2. Windows 平台：基于 electron-updater NSIS 机制直连腾讯云 COS，实现后台静默下载、进度条、一键重启更新。
 * 3. macOS 平台：绕开苹果 99 美元开发者证书与公证限制，内置原生热更新流水线（应用内后台流式下载 DMG -> 静默挂载 -> 覆盖替换 /Applications/yishe-client.app -> 清除隔离属性 -> 自动重启）。
 * 4. 健壮容错：所有 IPC 操作受严格 try-catch 保护，永不向上抛出导致渲染层 invoke 拒绝的未捕获异常。
 */

import { BrowserWindow, app, dialog, shell } from "electron";
import axios from "axios";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
interface ProgressInfo {
  percent: number;
  bytesPerSecond: number;
  transferred?: number;
  total?: number;
}

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
  speed?: number; // 字节/秒
  error?: string;
  isDev?: boolean;
  isManualDownload?: boolean;
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
const isAutoCheckEnabled = true;

// 腾讯云 COS 资源发布地址（国内高带宽直连）
const COS_BASE_URL =
  "https://yishe-storage-1257307499.cos.ap-beijing.myqcloud.com/yishe-client/";
const COS_LATEST_YML_URL =
  process.platform === "darwin"
    ? `${COS_BASE_URL}latest-mac.yml`
    : `${COS_BASE_URL}latest.yml`;
const COS_WIN_URL = `${COS_BASE_URL}yishe-client.exe`;
const COS_MAC_URL = `${COS_BASE_URL}yishe-client.dmg`;
const BACKEND_DOWNLOAD_API = "https://api.1s.design/api/system-config/downloads";
const GITHUB_REPO = "1s-design/yishe-client";
const RELEASE_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

let downloadedPackagePath: string | null = null;
let isDownloading = false;
let downloadAbortController: AbortController | null = null;

// 动态载入 electron-updater（仅 Windows 平台按需加载，避免在 macOS 环境触发 Squirrel.Mac 初始化异常）
let electronUpdaterModule: typeof import("electron-updater") | null = null;
function getElectronUpdater(): typeof import("electron-updater") | null {
  if (!electronUpdaterModule && process.platform === "win32") {
    try {
      electronUpdaterModule = require("electron-updater");
    } catch (e) {
      console.warn("[AutoUpdater] 加载 electron-updater 模块失败:", e);
    }
  }
  return electronUpdaterModule;
}

/**
 * 语义化版本比对: v1 > v2 返回 1, v1 < v2 返回 -1, 相等返回 0
 */
export function compareSemver(v1: string, v2: string): number {
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
 * 多源并发/回退查询线上最新版本信息
 */
export async function fetchRemoteLatestRelease(): Promise<RemoteReleaseInfo | null> {
  const timestamp = Date.now();
  const headers = {
    "User-Agent": "yishe-client-updater",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
  };

  // 1. 优先尝试腾讯云 COS latest.yml（国内毫秒级响应，与发布产物严格对齐）
  try {
    const res = await axios.get(`${COS_LATEST_YML_URL}?_t=${timestamp}`, {
      headers,
      timeout: 3500,
    });
    if (typeof res.data === "string" && res.data.includes("version:")) {
      const match = res.data.match(/version:\s*([^\s\r\n]+)/);
      if (match && match[1]) {
        const version = match[1].replace(/['"]/g, "").trim();
        const dateMatch = res.data.match(/releaseDate:\s*['"]?([^'"\r\n]+)/);
        const downloadUrl =
          process.platform === "darwin" ? COS_MAC_URL : COS_WIN_URL;
        return {
          version,
          releaseDate: dateMatch ? dateMatch[1].replace(/['"]/g, "").trim() : undefined,
          releaseUrl: RELEASE_PAGE_URL,
          downloadUrl,
        };
      }
    }
  } catch (e) {
    console.warn("[AutoUpdater] 腾讯云 COS latest.yml 查询失败，尝试备用源:", (e as Error).message);
  }

  // 2. 备选源：GitHub 镜像 / API
  const candidateUrls = [
    `https://ghproxy.net/https://github.com/${GITHUB_REPO}/releases/latest/download/latest.yml?_t=${timestamp}`,
    `https://gh-proxy.com/https://github.com/${GITHUB_REPO}/releases/latest/download/latest.yml?_t=${timestamp}`,
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest?_t=${timestamp}`,
    `https://ghproxy.net/https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json?_t=${timestamp}`,
    `https://gh-proxy.com/https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json?_t=${timestamp}`,
  ];

  for (const url of candidateUrls) {
    try {
      const res = await axios.get(url, { headers, timeout: 4000 });
      if (typeof res.data === "string" && res.data.includes("version:")) {
        const match = res.data.match(/version:\s*([^\s\r\n]+)/);
        if (match && match[1]) {
          return {
            version: match[1].replace(/['"]/g, "").trim(),
            releaseUrl: RELEASE_PAGE_URL,
            downloadUrl: process.platform === "darwin" ? COS_MAC_URL : COS_WIN_URL,
          };
        }
      } else if (res.data && res.data.tag_name) {
        return {
          version: String(res.data.tag_name).replace(/^v/, "").trim(),
          releaseDate: res.data.published_at,
          releaseNotes: typeof res.data.body === "string" ? res.data.body : undefined,
          releaseUrl: res.data.html_url || RELEASE_PAGE_URL,
          downloadUrl: process.platform === "darwin" ? COS_MAC_URL : COS_WIN_URL,
        };
      } else if (res.data && typeof res.data === "object" && res.data.version) {
        return {
          version: String(res.data.version).replace(/^v/, "").trim(),
          releaseUrl: RELEASE_PAGE_URL,
          downloadUrl: process.platform === "darwin" ? COS_MAC_URL : COS_WIN_URL,
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

  // 仅在 Windows 生产环境初始化 electron-updater 的原生监听
  if (process.platform === "win32" && app.isPackaged) {
    try {
      const updater = getElectronUpdater()?.autoUpdater;
      if (updater) {
        updater.logger = console;
        (updater as any).isAddNoCacheQuery = true;
        updater.setFeedURL({
          provider: "generic",
          url: COS_BASE_URL,
        });
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = true;
        updater.allowDowngrade = false;

        updater.on("update-available", (info) => {
          console.log("[AutoUpdater] Windows electron-updater 发现新版本:", info.version);
          currentUpdateInfo = {
            state: "available",
            version: info.version,
            currentVersion: app.getVersion(),
            releaseDate: info.releaseDate,
            releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
            releaseUrl: RELEASE_PAGE_URL,
            downloadUrl: COS_WIN_URL,
            isDev: false,
            isManualDownload: false,
          };
          sendUpdateToRenderer(currentUpdateInfo);
        });

        updater.on("update-not-available", (info) => {
          console.log("[AutoUpdater] Windows electron-updater 已是最新版本:", info?.version || "");
          currentUpdateInfo = {
            state: "not-available",
            version: info?.version || app.getVersion(),
            currentVersion: app.getVersion(),
            isDev: false,
            isManualDownload: false,
          };
          sendUpdateToRenderer(currentUpdateInfo);
        });

        updater.on("download-progress", (progress: ProgressInfo) => {
          currentUpdateInfo = {
            ...currentUpdateInfo,
            state: "downloading",
            progress: Math.round(progress.percent),
            speed: progress.bytesPerSecond,
          };
          sendUpdateToRenderer(currentUpdateInfo);
        });

        updater.on("update-downloaded", (info) => {
          console.log("[AutoUpdater] Windows electron-updater 下载完成:", info.version);
          currentUpdateInfo = {
            ...currentUpdateInfo,
            state: "downloaded",
            progress: 100,
          };
          sendUpdateToRenderer(currentUpdateInfo);
          showRestartDialog();
        });

        updater.on("error", (error) => {
          console.warn("[AutoUpdater] Windows electron-updater 告警:", error?.message);
        });
      }
    } catch (err) {
      console.warn("[AutoUpdater] 初始化 Windows autoUpdater 异常:", err);
    }
  }
}

/**
 * 检查更新（供启动自动触发或渲染进程手动点击触发）
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  if (!isAutoCheckEnabled) return currentUpdateInfo;

  const localVersion = app.getVersion();
  currentUpdateInfo = {
    state: "checking",
    currentVersion: localVersion,
  };
  sendUpdateToRenderer(currentUpdateInfo);

  try {
    const remoteInfo = await fetchRemoteLatestRelease();

    if (remoteInfo && compareSemver(remoteInfo.version, localVersion) > 0) {
      console.log(`[AutoUpdater] 发现新版本: 本地=${localVersion}, 远程=${remoteInfo.version}`);
      currentUpdateInfo = {
        state: "available",
        version: remoteInfo.version,
        currentVersion: localVersion,
        releaseDate: remoteInfo.releaseDate,
        releaseNotes: remoteInfo.releaseNotes,
        releaseUrl: remoteInfo.releaseUrl || RELEASE_PAGE_URL,
        downloadUrl: remoteInfo.downloadUrl || (process.platform === "darwin" ? COS_MAC_URL : COS_WIN_URL),
        isDev: !app.isPackaged,
        isManualDownload: false,
      };
    } else {
      console.log(`[AutoUpdater] 已是最新版本: ${localVersion}`);
      currentUpdateInfo = {
        state: "not-available",
        version: remoteInfo?.version || localVersion,
        currentVersion: localVersion,
        isDev: !app.isPackaged,
        isManualDownload: false,
      };
    }
  } catch (error) {
    console.error("[AutoUpdater] 检查更新失败:", error);
    currentUpdateInfo = {
      state: "error",
      error: error instanceof Error ? error.message : "检查更新失败，请重试",
      currentVersion: localVersion,
      releaseUrl: RELEASE_PAGE_URL,
      isManualDownload: true,
    };
  }

  sendUpdateToRenderer(currentUpdateInfo);
  return currentUpdateInfo;
}

/**
 * 流式下载大文件并提供平滑进度
 */
async function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress: (percent: number, speedBytesPerSec: number) => void
): Promise<void> {
  downloadAbortController = new AbortController();
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
    signal: downloadAbortController.signal,
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  const totalLength = parseInt(response.headers["content-length"] || "0", 10);
  let downloadedLength = 0;
  let lastTime = Date.now();
  let lastDownloaded = 0;

  const writer = fs.createWriteStream(destPath);

  response.data.on("data", (chunk: Buffer) => {
    downloadedLength += chunk.length;
    const now = Date.now();
    if (now - lastTime >= 200 || downloadedLength === totalLength) {
      const percent = totalLength > 0 ? Math.round((downloadedLength / totalLength) * 100) : 0;
      const speed = ((downloadedLength - lastDownloaded) / ((now - lastTime) / 1000)) || 0;
      lastTime = now;
      lastDownloaded = downloadedLength;
      onProgress(Math.min(percent, 100), Math.round(speed));
    }
  });

  return new Promise<void>((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", () => {
      writer.close();
      resolve();
    });
    writer.on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
    response.data.on("error", (err: any) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * 用户确认后开始下载
 */
export async function startDownload(): Promise<void> {
  if (currentUpdateInfo.state !== "available" && currentUpdateInfo.state !== "error") {
    return;
  }
  if (isDownloading) return;

  const targetUrl =
    currentUpdateInfo.downloadUrl ||
    (process.platform === "darwin" ? COS_MAC_URL : COS_WIN_URL);

  // 1. Windows 生产打包环境优先尝试 electron-updater
  if (process.platform === "win32" && app.isPackaged) {
    const updater = getElectronUpdater()?.autoUpdater;
    if (updater) {
      try {
        isDownloading = true;
        currentUpdateInfo = {
          ...currentUpdateInfo,
          state: "downloading",
          progress: 0,
        };
        sendUpdateToRenderer(currentUpdateInfo);
        await updater.downloadUpdate();
        return;
      } catch (err) {
        console.warn("[AutoUpdater] electron-updater 下载失败，降级使用内置流式下载:", err);
      }
    }
  }

  // 2. macOS 生产环境 / 开发环境 / Windows 降级下载：流式下载至本地临时目录
  try {
    isDownloading = true;
    currentUpdateInfo = {
      ...currentUpdateInfo,
      state: "downloading",
      progress: 0,
    };
    sendUpdateToRenderer(currentUpdateInfo);

    const ext = process.platform === "darwin" ? ".dmg" : ".exe";
    const tempDir = app.getPath("temp");
    const targetFile = path.join(tempDir, `yishe-update-${Date.now()}${ext}`);

    console.log(`[AutoUpdater] 开始从 ${targetUrl} 下载更新包至 ${targetFile}...`);

    await downloadFileWithProgress(targetUrl, targetFile, (percent, speed) => {
      currentUpdateInfo = {
        ...currentUpdateInfo,
        state: "downloading",
        progress: percent,
        speed,
      };
      sendUpdateToRenderer(currentUpdateInfo);
    });

    downloadedPackagePath = targetFile;
    isDownloading = false;

    console.log(`[AutoUpdater] 更新包下载成功: ${targetFile}`);

    currentUpdateInfo = {
      ...currentUpdateInfo,
      state: "downloaded",
      progress: 100,
    };
    sendUpdateToRenderer(currentUpdateInfo);

    showRestartDialog();
  } catch (error) {
    isDownloading = false;
    console.error("[AutoUpdater] 下载更新包异常:", error);
    currentUpdateInfo = {
      ...currentUpdateInfo,
      state: "error",
      error: error instanceof Error ? error.message : "下载失败，请检查网络后重试",
      isManualDownload: true,
    };
    sendUpdateToRenderer(currentUpdateInfo);
  }
}

/**
 * Windows 平台：执行静默热更新安装并自动拉起新版本
 */
function installWinUpdateAndRestart(exePath: string): void {
  const currentExePath = process.execPath;
  const currentExeDir = path.dirname(currentExePath);
  const pid = process.pid;

  const winExePath = exePath.replace(/\//g, "\\");
  const winExeDir = currentExeDir.replace(/\//g, "\\");
  const winExeBin = currentExePath.replace(/\//g, "\\");

  console.log(`[AutoUpdater] 准备执行 Windows 自动静默更新: installDir=${winExeDir}, exePath=${winExePath}`);

  // 编写批处理脚本：
  // 1. 等待当前主进程退出
  // 2. 清理残余子进程并释放文件占用锁
  // 3. 执行 NSIS 静默更新安装 (/S --updated --force-run /D=...)
  // 4. 若未自动拉起则手动拉起新版
  // 5. 清理临时安装包
  const batScript = `@echo off
chcp 65001 >nul
set LOG_FILE=%TEMP%\\yishe_win_updater.log
echo [%date% %time%] 开始执行 yishe-client 自动静默更新 > "%LOG_FILE%"
echo [INFO] 主进程PID: ${pid} >> "%LOG_FILE%"
echo [INFO] 安装目录: "${winExeDir}" >> "%LOG_FILE%"
echo [INFO] 安装包: "${winExePath}" >> "%LOG_FILE%"

:: 1. 等待主进程完全退出
echo [INFO] 等待主进程 (PID: ${pid}) 完全退出... >> "%LOG_FILE%"
:wait_pid
tasklist /fi "PID eq ${pid}" 2>nul | findstr /i "${pid}" >nul
if not errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_pid
)
echo [INFO] 主进程已退出 >> "%LOG_FILE%"

:: 2. 缓冲 2 秒并清理可能残余的辅助进程，彻底释放文件锁
timeout /t 2 /nobreak >nul
taskkill /f /im yishe-client.exe 2>nul
taskkill /f /im yishe-browser-agent.exe 2>nul
taskkill /f /im dezoomify-rs-win.exe 2>nul
timeout /t 1 /nobreak >nul

:: 3. 运行 NSIS 静默更新
:: 注意：NSIS 规范中，/D 参数必须作为最后一项，且路径绝对不能加引号，即使路径包含空格
echo [INFO] 正在执行静默覆盖安装... >> "%LOG_FILE%"
"${winExePath}" /S --updated --force-run /D=${winExeDir} >> "%LOG_FILE%" 2>&1
set INSTALL_EXIT_CODE=%errorlevel%
echo [INFO] 安装程序执行完毕，退出码: %INSTALL_EXIT_CODE% >> "%LOG_FILE%"

:: 4. 检查客户端是否已由安装程序自动拉起，若未运行则手动拉起
timeout /t 2 /nobreak >nul
tasklist /fi "IMAGENAME eq yishe-client.exe" 2>nul | findstr /i "yishe-client.exe" >nul
if errorlevel 1 (
    echo [INFO] 客户端未自动启动，正在手动启动: "${winExeBin}" >> "%LOG_FILE%"
    start "" "${winExeBin}"
) else (
    echo [INFO] 客户端新版本已成功运行 >> "%LOG_FILE%"
)

:: 5. 清理临时安装包
timeout /t 3 /nobreak >nul
del /f /q "${winExePath}" 2>nul
exit
`;

  const batPath = path.join(app.getPath("temp"), `yishe_win_updater_${Date.now()}.bat`);
  fs.writeFileSync(batPath, batScript, { encoding: "utf8" });

  const child = spawn("cmd.exe", ["/c", batPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  // 退出当前应用，由后台批处理完成替换并重启
  app.exit(0);
}

/**
 * macOS 平台：执行静默热更新替换并自动重启新版
 */
function installMacUpdateAndRestart(dmgPath: string): void {
  // 获取当前正在运行的 .app 路径（例如 /Applications/yishe-client.app）
  const appPath = process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, "");
  const pid = process.pid;

  console.log(`[AutoUpdater] 准备执行 macOS 自动热更新: appPath=${appPath}, dmgPath=${dmgPath}`);

  const scriptContent = `#!/bin/bash
LOG_FILE="/tmp/yishe_mac_updater.log"
echo "$(date) 开始执行 macOS 客户端更新: appPath=${appPath}, dmgPath=${dmgPath}" > "$LOG_FILE"

# 1. 等待当前主进程及清理 Helper 子进程，释放二进制锁
while kill -0 ${pid} 2>/dev/null; do
  sleep 0.5
done
killall -9 "yishe-client Helper" 2>/dev/null || true
killall -9 "yishe-client Helper (Renderer)" 2>/dev/null || true
killall -9 "yishe-client Helper (GPU)" 2>/dev/null || true
sleep 1

# 2. 创建临时挂载目录并静默挂载 DMG
MOUNT_DIR=$(mktemp -d /tmp/yishe_dmg_XXXXXX)
hdiutil attach "${dmgPath}" -mountpoint "$MOUNT_DIR" -nobrowse -quiet >> "$LOG_FILE" 2>&1

# 3. 查找挂载盘里的新应用
NEW_APP=$(find "$MOUNT_DIR" -maxdepth 1 -name "*.app" -print -quit)
if [ -z "$NEW_APP" ]; then
  # 备选：查找 /Volumes 目录中的挂载项
  NEW_APP=$(find /Volumes/yishe-client* -maxdepth 1 -name "*.app" 2>/dev/null | head -n 1)
fi

echo "$(date) 找到新版本 App: $NEW_APP" >> "$LOG_FILE"

if [ -n "$NEW_APP" ] && [ -d "$NEW_APP" ]; then
  # 替换目标 app
  rm -rf "${appPath}" >> "$LOG_FILE" 2>&1
  cp -R "$NEW_APP" "${appPath}" >> "$LOG_FILE" 2>&1
  # 移除 Mac 隔离属性（杜绝出现"文件已损坏"提示）
  xattr -cr "${appPath}" 2>/dev/null || true
  echo "$(date) 覆盖完成并清除隔离属性" >> "$LOG_FILE"
fi

# 4. 卸载 DMG 并清理临时文件
hdiutil detach "$MOUNT_DIR" -force -quiet || true
rm -rf "$MOUNT_DIR" 2>/dev/null || true
rm -f "${dmgPath}" 2>/dev/null || true

# 5. 重新启动新版本客户端
echo "$(date) 正在启动新版本客户端..." >> "$LOG_FILE"
open -n "${appPath}"
`;

  const scriptPath = path.join(app.getPath("temp"), `yishe_mac_updater_${Date.now()}.sh`);
  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

  const child = spawn("/bin/bash", [scriptPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // 退出当前应用，由后台脚本完成替换并重启
  app.exit(0);
}

/**
 * 退出并安装更新
 */
export function quitAndInstall(): void {
  // 开发环境下保护：不执行实际文件替换，避免污染源码开发工程
  if (!app.isPackaged) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "开发环境更新提示",
        message: `更新包已成功下载至:\n${downloadedPackagePath || "本地临时目录"}`,
        detail: "开发环境下不执行实际应用覆盖替换。在打包生成的正式安装包（.exe / .app）中，点击重启将自动静默安装并拉起新版本。",
        buttons: ["好的"],
      });
    }
    return;
  }

  // 1. Windows 生产环境：优先通过我们的静默更新批处理完成精确覆盖与自动重启
  if (process.platform === "win32") {
    if (downloadedPackagePath && fs.existsSync(downloadedPackagePath)) {
      installWinUpdateAndRestart(downloadedPackagePath);
      return;
    }

    // 若是通过 electron-updater 自带机制下载
    const updater = getElectronUpdater()?.autoUpdater;
    if (updater && currentUpdateInfo.state === "downloaded") {
      try {
        updater.quitAndInstall(false, true);
        return;
      } catch (e) {
        console.warn("[AutoUpdater] autoUpdater.quitAndInstall 失败:", e);
      }
    }
  }

  // 2. macOS 生产环境：执行静默挂载、应用替换并自动重启
  if (process.platform === "darwin" && downloadedPackagePath && fs.existsSync(downloadedPackagePath)) {
    installMacUpdateAndRestart(downloadedPackagePath);
    return;
  }

  // 兜底提示
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "更新提示",
      message: "未检测到可安装的离线更新包，请重新点击下载更新。",
      buttons: ["确定"],
    });
  }
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
 * 显示重启对话框（主进程原生对话框）
 */
function showRestartDialog(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  dialog
    .showMessageBox(mainWindow, {
      type: "info",
      title: "更新已就绪",
      message: `新版本 ${currentUpdateInfo.version || ""} 已下载完成`,
      detail: "是否立即重启应用以完成更新？",
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

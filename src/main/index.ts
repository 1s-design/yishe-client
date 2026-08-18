// Yishe Client Main Process - Pure Direct Image Download 2026-08-01
import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  dialog,
  session,
  powerSaveBlocker,
  powerMonitor,
} from "electron";
import { join } from "path";
import { resolve, dirname, extname, basename } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/favicon.png?asset";
// 暂时注释掉发布服务相关引用，代码保留但不使用
// import { publishToXiaohongshu } from './xiaohongshu'
// import { publishToDouyin } from './douyin'
// import { publishToKuaishou } from './kuaishou'
import { homedir, platform } from "os";
import { join as pathJoin } from "path";
import fs from "fs";
import http from "http";
import { URL } from "url";
import { setupAgentIpc } from "./agent/agent-ipc";
import { clearActiveAgentConfig } from "./agent/agent-config";
import {
  getGoogleArtZooms,
  syncGoogleArtToMaterialLibrary,
  getGoogleArtStatus,
  searchGoogleArts,
} from "./googleArt";
import {
  searchPinterest,
  getPinterestStatus,
  syncPinterestToMaterialLibrary,
  PinterestClient,
} from "./pinterest";
import {
  searchWikimedia,
  getWikimediaStatus,
  syncWikimediaToMaterialLibrary,
  downloadWikimediaImage,
} from "./wikimedia";
import {
  searchPexels,
  getPexelsStatus,
  syncPexelsToMaterialLibrary,
  downloadPexelsImage,
} from "./pexels";
import {
  searchPixabay,
  getPixabayStatus,
  syncPixabayToMaterialLibrary,
  downloadPixabayImage,
} from "./pixabay";
import {
  searchRawpixel,
  getRawpixelStatus,
  syncRawpixelToMaterialLibrary,
  downloadRawpixelImage,
} from "./rawpixel";
import {
  searchStockSnap,
  getStockSnapStatus,
  syncStockSnapToMaterialLibrary,
  downloadStockSnapImage,
} from "./stocksnap";
import {
  searchOpenverse,
  getOpenverseStatus,
  syncOpenverseToMaterialLibrary,
  downloadOpenverseImage,
} from "./openverse";
import {
  searchKaboompics,
  getKaboompicsStatus,
  syncKaboompicsToMaterialLibrary,
  downloadKaboompicsImage,
} from "./kaboompics";
import {
  searchOpenclipart,
  getOpenclipartStatus,
  syncOpenclipartToMaterialLibrary,
  downloadOpenclipartImage,
} from "./openclipart";
import {
  searchUndraw,
  getUndrawStatus,
  syncUndrawToMaterialLibrary,
  downloadUndrawImage,
} from "./undraw";
import {
  searchVecteezy,
  getVecteezyStatus,
  syncVecteezyToMaterialLibrary,
  downloadVecteezyAsset,
} from "./vecteezy";
import {
  searchOpenMoji,
  getOpenMojiStatus,
  syncOpenMojiToMaterialLibrary,
  downloadOpenMojiEmoji,
} from "./openmoji";
import {
  searchGoogleIcons,
  getGoogleIconsStatus,
  syncGoogleIconsToMaterialLibrary,
  downloadGoogleIcon,
} from "./googleicons";
import {
  searchEmojipedia,
  getEmojipediaStatus,
  syncEmojipediaToMaterialLibrary,
  downloadEmojipediaItem,
} from "./emojipedia";
import { searchHN, getHNStatus, syncHNToLibrary } from "./hackernews";
import { searchArxiv, getArxivStatus, syncArxivToLibrary } from "./arxiv";
import {
  searchGithubRepos,
  getGithubStatus,
  syncGithubToLibrary,
} from "./github";
import { searchGdeltNews, getGdeltStatus, syncGdeltToLibrary } from "./gdelt";
import {
  searchGoogleNews,
  getGoogleNewsStatus,
  syncGoogleNewsToLibrary,
} from "./googlenews";
import { searchReddit, getRedditStatus, syncRedditToLibrary } from "./reddit";
import { searchPH, getPHStatus, syncPHToLibrary } from "./producthunt";
import {
  searchGuardian,
  getGuardianStatus,
  syncGuardianToLibrary,
} from "./theguardian";
import { fetchBBC, getBBCStatus, syncBBCToLibrary } from "./bbcnews";
import { fetchNPR, getNPRStatus, syncNPRToLibrary } from "./npr";
import { fetchTC, getTCStatus, syncTCToLibrary } from "./techcrunch";
import { fetchVerge, getVergeStatus, syncVergeToLibrary } from "./theverge";
import { fetchArs, getArsStatus, syncArsToLibrary } from "./arstechnica";
import { fetchMIT, getMITStatus, syncMITToLibrary } from "./mittechreview";
import {
  fetchReuters,
  getReutersStatus,
  syncReutersToLibrary,
} from "./reuters";
import {
  fetchChinaDaily,
  getChinaDailyStatus,
  syncChinaDailyToLibrary,
} from "./chinadaily";
import { fetchGovCN, getGovCNStatus, syncGovCNToLibrary } from "./govcn";
import { fetchXH, getXHStatus, syncXHToLibrary } from "./xinhuanet";
import {
  fetchThePaper,
  getThePaperStatus,
  syncThePaperToLibrary,
} from "./thepaper";
import { fetch36Kr, get36KrStatus, sync36KrToLibrary } from "./36kr";
import { fetchHuxiu, getHuxiuStatus, syncHuxiuToLibrary } from "./huxiu";
import { searchOpenMeteo, getOpenMeteoStatus } from "./openmeteo";
import { searchWttr, getWttrStatus } from "./wttr";
import { searchCoinGecko, getCoinGeckoStatus } from "./coingecko";
import { searchFrankfurter, getFrankfurterStatus } from "./frankfurter";
import { searchDictionary, getDictionaryStatus } from "./dictionary";
import { searchJoke, getJokeStatus } from "./joke";
import { searchIpify, getIpifyStatus } from "./ipify";
import { searchSunrise, getSunriseStatus } from "./sunrisesunset";
import { searchTimeApi, getTimeApiStatus } from "./timeapi";
import { searchZippopotam, getZippopotamStatus } from "./zippopotam";
import { searchCountryIs, getCountryIsStatus } from "./countryis";
import { searchErApi, getErApiStatus } from "./erapi";
import { searchFawazahmed, getFawazahmedStatus } from "./fawazahmed";
import { searchColorApi, getColorApiStatus } from "./colorapi";
import { hotSearchService } from "./hotsearch/hotsearch.service";
import { getPlatform } from "./hotsearch/platforms";

import {
  searchSvgrepo,
  getSvgrepoStatus,
  syncSvgrepoToMaterialLibrary,
  downloadSvgrepoImage,
} from "./svgrepo";
import {
  searchIconify,
  getIconifyStatus,
  syncIconifyToMaterialLibrary,
  downloadIconifyIcon,
} from "./iconify";
import {
  searchNounProject,
  getNounProjectStatus,
  syncNounProjectToMaterialLibrary,
  downloadNounProjectAsset,
} from "./nounproject";
import { generateCosKey, uploadFileToCos } from "./cos";
import { createHash, randomUUID } from "crypto";
import ElectronStore from "electron-store";
import {
  ExternalProcessManager,
  ProcessStatus,
} from "./externalProcessManager";
import { pluginProcessConfigs } from "./externalProcessConfig";
import { handleClientLogCommand, writeClientLog } from "./clientLogger";

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const appLaunchStartedAt = Date.now();

// type ImageToolModule = typeof import("./image-tool");
type VideoTemplateModule = typeof import("./video-template");
type AutoBrowserModule = typeof import("./auto-browser");
type ServerModule = typeof import("./server");
type LocalDatabaseModule = typeof import("./localDatabase");
type McpServerModule = typeof import("./mcp-server");
type SharpFactory = typeof import("sharp");

// let imageToolModulePromise: Promise<ImageToolModule> | null = null;
let videoTemplateModulePromise: Promise<VideoTemplateModule> | null = null;
let autoBrowserModulePromise: Promise<AutoBrowserModule> | null = null;
let serverModulePromise: Promise<ServerModule> | null = null;
let localDatabaseModulePromise: Promise<LocalDatabaseModule> | null = null;
let mcpServerModulePromise: Promise<McpServerModule> | null = null;
let sharpModulePromise: Promise<any> | null = null;

function getLocalDatabaseModule(): Promise<LocalDatabaseModule> {
  if (!localDatabaseModulePromise) {
    localDatabaseModulePromise = import("./localDatabase");
  }
  return localDatabaseModulePromise;
}

async function getCurrentLocalDatabaseInfo() {
  const { getLocalDatabaseInfo } = await getLocalDatabaseModule();
  const workspaceDirectory = String(
    store.get("workspaceDirectory", "") || "",
  ).trim();
  return getLocalDatabaseInfo(workspaceDirectory);
}

function resetImageToolModule() {
  // imageToolModulePromise = null;
}

async function getImageToolModule() {
  const module = await import("./image-tool");
  module.configureImageTool({
    getWorkspaceDirectory: () =>
      (store.get("workspaceDirectory", "") as string) || "",
  });
  return module;
}

async function getVideoTemplateModule() {
  if (!videoTemplateModulePromise) {
    videoTemplateModulePromise = import("./video-template").then((module) => {
      module.configureVideoTemplate({
        getWorkspaceDirectory: () =>
          (store.get("workspaceDirectory", "") as string) || "",
      });
      return module;
    });
  }

  return videoTemplateModulePromise;
}

async function getAutoBrowserModule() {
  if (!autoBrowserModulePromise) {
    autoBrowserModulePromise = import("./auto-browser");
  }

  return autoBrowserModulePromise;
}

async function getServerModule() {
  if (!serverModulePromise) {
    serverModulePromise = import("./server").then((module) => {
      if (typeof module.setTokenPersistenceHandlers === "function") {
        module.setTokenPersistenceHandlers({
          saveToken: saveCachedAuthToken,
          clearToken: clearCachedAuthToken,
          getToken: getCachedAuthToken,
        });
      }
      return module;
    });
  }

  return serverModulePromise;
}

async function ensureLocalServiceStartedForCachedToken(scene: string) {
  const cachedToken = getCachedAuthToken();
  if (!cachedToken) {
    return false;
  }

  const { isServerRunning, startServer } = await getServerModule();
  if (isServerRunning()) {
    return true;
  }

  writeMainLog("INFO", "检测到本地缓存 token，自动启动 1519 服务", {
    scene,
    hasToken: true,
  });
  startServer(1519);
  return true;
}

async function getSharp(): Promise<SharpFactory> {
  if (!sharpModulePromise) {
    sharpModulePromise = import("sharp");
  }

  const sharpModule = await sharpModulePromise;
  return sharpModule.default || sharpModule;
}

async function getMcpServerModule(): Promise<McpServerModule> {
  if (!mcpServerModulePromise) {
    mcpServerModulePromise = import("./mcp-server");
  }
  return mcpServerModulePromise;
}

function writeMainLog(
  level: "DEBUG" | "INFO" | "WARN" | "ERROR",
  message: string,
  context?: Record<string, any>,
) {
  writeClientLog({
    level,
    module: "main-process",
    message,
    context,
  });
}

function resolveBundledImageMagickDirectory(): string | null {
  const candidates = [
    join(
      process.resourcesPath,
      "resources",
      "plugin",
      process.platform,
      "image-tool",
      "imagemagick",
    ),
    join(
      process.resourcesPath,
      "app.asar.unpacked",
      "resources",
      "plugin",
      process.platform,
      "image-tool",
      "imagemagick",
    ),
    join(
      app.getAppPath(),
      "resources",
      "plugin",
      process.platform,
      "image-tool",
      "imagemagick",
    ),
    join(
      app.getAppPath(),
      "..",
      "resources",
      "plugin",
      process.platform,
      "image-tool",
      "imagemagick",
    ),
    join(
      process.cwd(),
      "resources",
      "plugin",
      process.platform,
      "image-tool",
      "imagemagick",
    ),
  ];

  return candidates.find((item) => fs.existsSync(item)) || null;
}

// 扩展app对象的类型
declare global {
  namespace NodeJS {
    interface Global {
      app: Electron.App & { isQuiting?: boolean };
    }
  }
}

// 为app对象添加isQuiting属性
(app as any).isQuiting = false;

// 全局变量
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let trayPowerSaveBlockerId: number | null = null;
let displayPowerSaveBlockerId: number | null = null;
let quitCleanupComplete = false;
let quitCleanupPromise: Promise<void> | null = null;

// 插件/外部进程管理器
const externalProcessManager = new ExternalProcessManager(pluginProcessConfigs);

function sendAppRuntimeEvent(type: string, payload: Record<string, any> = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("app-runtime-event", {
    type,
    at: new Date().toISOString(),
    ...payload,
  });
}

// 初始化 electron-store
// 处理 electron-store 在 CommonJS 环境下的导入问题
const Store = (ElectronStore as any).default || ElectronStore;
const store = new Store({
  defaults: {
    workspaceDirectory: "",
  },
});
const AUTH_TOKEN_STORE_KEY = "auth.token";

function normalizeAuthToken(token: unknown): string {
  return String(token || "").trim();
}

function saveCachedAuthToken(token: string): void {
  const normalizedToken = normalizeAuthToken(token);
  if (!normalizedToken) {
    clearCachedAuthToken();
    return;
  }
  store.set(AUTH_TOKEN_STORE_KEY, normalizedToken);
  writeMainLog("INFO", "登录 token 已写入本地缓存", {
    hasToken: true,
  });
}

function getCachedAuthToken(): string | null {
  const token = normalizeAuthToken(store.get(AUTH_TOKEN_STORE_KEY, ""));
  return token || null;
}

function clearCachedAuthToken(): void {
  store.delete(AUTH_TOKEN_STORE_KEY);
  writeMainLog("INFO", "登录 token 本地缓存已清除");
}

function getOrCreateDeviceKey(): string {
  const existing = String(store.get("deviceKey", "") || "").trim();
  if (existing) {
    return existing;
  }

  const created = `yd_${randomUUID()}`;
  store.set("deviceKey", created);
  return created;
}

const bundledImageMagickDirectory = resolveBundledImageMagickDirectory();
if (bundledImageMagickDirectory && !process.env.YISHE_IMAGEMAGICK_DIR) {
  process.env.YISHE_IMAGEMAGICK_DIR = bundledImageMagickDirectory;
}

/**
 * 获取默认工作目录路径
 * Windows: C:\yisheworkspace
 * macOS/Linux: ~/yisheworkspace
 */
function getDefaultWorkspaceDirectory(): string {
  if (platform() === "win32") {
    // Windows: 使用 C 盘
    return "C:\\yisheworkspace";
  } else {
    // macOS/Linux: 使用用户主目录
    return pathJoin(homedir(), "yisheworkspace");
  }
}

/**
 * 初始化默认工作目录
 * 如果工作目录未设置，自动设置为默认路径并创建目录
 * 如果用户已经设置过工作目录，保持用户的设置（即使目录不存在）
 */
function initializeDefaultWorkspaceDirectory(): void {
  const currentWorkspace = store.get("workspaceDirectory", "") as string;

  // 如果已经设置了工作目录（无论目录是否存在），保持用户的设置
  if (currentWorkspace && currentWorkspace.trim() !== "") {
    if (fs.existsSync(currentWorkspace)) {
      console.log("✅ 工作目录已设置:", currentWorkspace);
    } else {
      console.warn("⚠️ 工作目录不存在，但保持用户设置:", currentWorkspace);
    }
    return;
  }

  // 工作目录未设置，自动设置为默认路径
  const defaultWorkspace = getDefaultWorkspaceDirectory();

  try {
    // 创建目录（如果不存在）
    if (!fs.existsSync(defaultWorkspace)) {
      fs.mkdirSync(defaultWorkspace, { recursive: true });
      console.log("📁 已创建默认工作目录:", defaultWorkspace);
    }

    // 保存到 store
    store.set("workspaceDirectory", defaultWorkspace);
    console.log("✅ 已自动设置默认工作目录:", defaultWorkspace);
  } catch (error: any) {
    console.error("❌ 初始化默认工作目录失败:", error);
    // 如果创建失败，仍然保存路径，让用户手动创建
    store.set("workspaceDirectory", defaultWorkspace);
  }
}

const isMac = process.platform === "darwin";

function shouldForceTrayMode(): boolean {
  return app.isPackaged;
}

function createWindow(): void {
  const createdAt = Date.now();
  let hasShownMainWindow = false;
  const showMainWindow = (reason: string) => {
    if (!mainWindow || hasShownMainWindow) {
      return;
    }

    hasShownMainWindow = true;
    mainWindow.show();
    writeMainLog("INFO", "主窗口已显示", {
      reason,
      durationMs: Date.now() - appLaunchStartedAt,
      createWindowDurationMs: Date.now() - createdAt,
    });
  };

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    maximizable: true,
    show: false,
    fullscreen: false,
    fullscreenable: true,
    simpleFullscreen: false,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac ? { trafficLightPosition: { x: 14, y: 14 } } : {}),
    ...(process.platform === "win32"
      ? {
          titleBarOverlay: {
            color: "#ffffff",
            symbolColor: "#000000",
            height: 40,
          },
        }
      : {}),
    title: "衣设客户端",
    ...(process.platform === "linux" ? { icon } : { icon }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: false, // 允许加载外部资源（图片、视频等）
      allowRunningInsecureContent: true, // 允许混合内容（HTTPS页面加载HTTP资源）
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const ensureTrayPowerSaveBlocker = () => {
    if (
      trayPowerSaveBlockerId !== null &&
      powerSaveBlocker.isStarted(trayPowerSaveBlockerId)
    ) {
      if (
        displayPowerSaveBlockerId !== null &&
        powerSaveBlocker.isStarted(displayPowerSaveBlockerId)
      ) {
        return;
      }
    }

    if (
      trayPowerSaveBlockerId === null ||
      !powerSaveBlocker.isStarted(trayPowerSaveBlockerId)
    ) {
      trayPowerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }

    if (
      displayPowerSaveBlockerId === null ||
      !powerSaveBlocker.isStarted(displayPowerSaveBlockerId)
    ) {
      displayPowerSaveBlockerId = powerSaveBlocker.start(
        "prevent-display-sleep",
      );
    }
  };

  const releaseTrayPowerSaveBlocker = () => {
    if (
      trayPowerSaveBlockerId !== null &&
      powerSaveBlocker.isStarted(trayPowerSaveBlockerId)
    ) {
      powerSaveBlocker.stop(trayPowerSaveBlockerId);
    }

    trayPowerSaveBlockerId = null;

    if (
      displayPowerSaveBlockerId !== null &&
      powerSaveBlocker.isStarted(displayPowerSaveBlockerId)
    ) {
      powerSaveBlocker.stop(displayPowerSaveBlockerId);
    }

    displayPowerSaveBlockerId = null;
  };

  mainWindow.on("ready-to-show", () => {
    showMainWindow("ready-to-show");
    releaseTrayPowerSaveBlocker();
    if (isMac) {
      mainWindow?.setFullScreen(false);
      mainWindow?.setSimpleFullScreen(false);
      mainWindow?.setFullScreenable(false);
    }
    mainWindow?.setFullScreen(false);
    // 在开发模式下启用开发者工具（已注释掉，默认不打开）
    // if (is.dev) {
    //   mainWindow?.webContents.openDevTools()
    // }
  });

  mainWindow.on("hide", () => {
    ensureTrayPowerSaveBlocker();
    sendAppRuntimeEvent("window-hidden");
  });

  mainWindow.on("minimize", () => {
    ensureTrayPowerSaveBlocker();
    sendAppRuntimeEvent("window-minimized");
  });

  mainWindow.on("show", () => {
    releaseTrayPowerSaveBlocker();
    sendAppRuntimeEvent("window-visible");
  });

  mainWindow.on("restore", () => {
    releaseTrayPowerSaveBlocker();
    sendAppRuntimeEvent("window-restored");
  });

  mainWindow.on("closed", () => {
    releaseTrayPowerSaveBlocker();
  });

  mainWindow.on("close", async (event) => {
    if ((app as any).isQuiting) {
      return;
    }

    if (shouldForceTrayMode()) {
      event.preventDefault();
      mainWindow?.hide();
      return;
    }

    event.preventDefault();

    const result = await dialog.showMessageBox(mainWindow!, {
      type: "question",
      buttons: ["退到托盘", "直接退出", "取消"],
      defaultId: 0,
      cancelId: 2,
      title: "退出确认",
      message: "退出客户端后将无法提供服务",
      detail: "您可以选择退到托盘继续运行，或者直接退出程序。",
      icon: icon,
    });

    switch (result.response) {
      case 0: // 退到托盘
        mainWindow?.hide();
        break;
      case 1: // 直接退出
        (app as any).isQuiting = true;
        app.quit();
        break;
      case 2: // 取消
        break;
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // 配置 session 以允许加载外部图片和视频
  const ses = session.defaultSession;

  // 设置权限处理，允许加载所有外部资源
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    // 允许所有权限请求（包括图片、视频等）
    callback(true);
  });

  // 拦截资源请求，添加必要的请求头
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    // 为图片和视频请求添加必要的请求头
    if (details.resourceType === "image" || details.resourceType === "media") {
      details.requestHeaders["Referer"] = details.url;
      details.requestHeaders["User-Agent"] =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  // 监听资源加载失败
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      if (
        validatedURL &&
        (validatedURL.includes("http://") || validatedURL.includes("https://"))
      ) {
        console.warn("资源加载失败:", {
          url: validatedURL,
          errorCode,
          errorDescription,
        });
      }
    },
  );

  mainWindow.webContents.once("did-finish-load", () => {
    showMainWindow("did-finish-load");
  });

  setTimeout(() => {
    showMainWindow("startup-fallback-timeout");
  }, 1800);

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// 创建系统托盘
function createTray(): void {
  const { nativeImage } = require("electron");
  const path = require("path");
  const fs = require("fs");

  // 获取资源文件路径的辅助函数
  function getResourcePath(relativePath: string): string {
    if (is.dev) {
      // 开发环境：从 src/main 目录向上两级到项目根目录
      return path.join(__dirname, "../../", relativePath);
    } else {
      // 生产环境：尝试多个可能的路径
      const appPath = app.getAppPath();
      const resourcesPath = process.resourcesPath;
      const dirname = __dirname;
      const fileName = path.basename(relativePath);

      console.log("🔍 调试托盘图标路径:");
      console.log("  - app.getAppPath():", appPath);
      console.log("  - process.resourcesPath:", resourcesPath);
      console.log("  - __dirname:", dirname);
      console.log("  - 查找文件:", fileName);

      const possiblePaths = [
        // 方案1: asar.unpacked 目录（如果配置了 asarUnpack）
        path.join(
          appPath.replace(/app\.asar$/, "app.asar.unpacked"),
          relativePath,
        ),
        // 方案2: 从 process.resourcesPath 查找（electron-builder 打包后的 resources 目录）
        path.join(resourcesPath, "resources", fileName),
        // 方案3: 从 __dirname (out/main) 向上查找 resources
        path.join(dirname, "../resources", fileName),
        // 方案4: 从 __dirname 向上两级查找
        path.join(dirname, "../../resources", fileName),
        // 方案5: 直接使用 process.resourcesPath
        path.join(resourcesPath, fileName),
        // 方案6: 从 appPath 的父目录查找
        path.join(
          path.dirname(appPath.replace(/app\.asar$/, "")),
          "resources",
          fileName,
        ),
        // 方案7: 更多可能的路径
        path.join(dirname, "../../../resources", fileName),
      ];

      // 返回第一个存在的路径
      for (const testPath of possiblePaths) {
        try {
          if (fs.existsSync(testPath)) {
            console.log(`✅ 找到托盘图标: ${testPath}`);
            return testPath;
          }
        } catch (e) {
          // 忽略路径错误
        }
      }

      // 如果都不存在，返回第一个路径（用于错误提示）
      console.error(`❌ 托盘图标文件未找到，尝试过的路径:`);
      possiblePaths.forEach((p) => {
        try {
          const exists = fs.existsSync(p);
          console.error(`   ${exists ? "✅" : "❌"} ${p}`);
        } catch {
          console.error(`   ❌ ${p}`);
        }
      });
      return possiblePaths[0];
    }
  }

  let trayIconPath: string;
  if (process.platform === "win32") {
    // Windows: 优先使用 .ico 文件，如果不存在则使用 .png
    trayIconPath = getResourcePath("resources/tray-icon.ico");
    if (!fs.existsSync(trayIconPath)) {
      trayIconPath = getResourcePath("resources/tray-icon.png");
    }
  } else {
    // macOS/Linux
    trayIconPath = getResourcePath("resources/tray-icon.png");
  }

  // 检查文件是否存在，如果不存在则使用默认图标
  if (!fs.existsSync(trayIconPath)) {
    console.warn(`⚠️ 托盘图标文件不存在: ${trayIconPath}，尝试备用方案`);

    // 尝试多个备用路径
    const fallbackPaths = [
      // 尝试使用应用主图标
      icon && typeof icon === "string" ? icon : null,
      // 尝试从 resources 目录找其他图标
      getResourcePath("resources/icon.png"),
      getResourcePath("resources/favicon.png"),
      // 尝试从 renderer assets
      path.join(__dirname, "../renderer/assets/icon.png"),
      // 在打包后可能的位置
      !is.dev ? path.join(process.resourcesPath, "icon.png") : null,
      !is.dev
        ? path.join(
            app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"),
            "resources/icon.png",
          )
        : null,
    ].filter(Boolean) as string[];

    let found = false;
    for (const fallbackPath of fallbackPaths) {
      if (fallbackPath && fs.existsSync(fallbackPath)) {
        console.log(`✅ 使用备用图标: ${fallbackPath}`);
        trayIconPath = fallbackPath;
        found = true;
        break;
      }
    }

    if (!found) {
      console.error("❌ 无法找到任何可用的托盘图标文件，托盘可能无法正常显示");
      // 不返回，继续创建托盘，但可能会使用空图标或默认图标
    }
  }

  let trayIcon = nativeImage.createFromPath(trayIconPath);

  // Windows 和 macOS 都需要调整图标尺寸以确保显示正常
  if (process.platform === "win32") {
    // Windows 托盘图标推荐尺寸：16x16 或 32x32
    // 如果图标过大或过小，调整到合适的尺寸
    const size = trayIcon.getSize();
    if (size.width > 32 || size.height > 32) {
      trayIcon = trayIcon.resize({ width: 32, height: 32 });
    } else if (size.width < 16 || size.height < 16) {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
  } else if (process.platform === "darwin") {
    // macOS 托盘图标尺寸
    trayIcon = trayIcon.resize({ width: 20, height: 20 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("衣设程序");

  // Windows 特定配置：防止双击时触发两次点击事件
  if (process.platform === "win32") {
    tray.setIgnoreDoubleClickEvents(true);
  }

  // 创建托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示主窗口",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "隐藏主窗口",
      click: () => {
        mainWindow?.hide();
      },
    },
    { type: "separator" },
    {
      label: "服务器状态",
      submenu: [
        {
          label: "检查本地服务",
          click: async () => {
            try {
              const response = await fetch("http://localhost:1519/api/health");
              if (response.ok) {
                // 可以显示通知或更新托盘菜单
                console.log("本地服务运行正常");
              }
            } catch (error) {
              console.log("本地服务未运行");
            }
          },
        },
        {
          label: "检查远程服务",
          click: async () => {
            try {
              const response = await fetch("https://api.1s.design/api/test");
              if (response.ok) {
                console.log("远程服务连接正常");
              }
            } catch (error) {
              console.log("远程服务连接失败");
            }
          },
        },
      ],
    },
    { type: "separator" },
    {
      label: "退出程序",
      click: async () => {
        // 显示退出确认对话框
        const result = await dialog.showMessageBox(mainWindow!, {
          type: "question",
          buttons: ["确认退出", "取消"],
          defaultId: 1,
          cancelId: 1,
          title: "退出确认",
          message: "确定要退出衣设程序吗？",
          detail: "退出后将无法提供服务。",
          icon: icon,
        });

        if (result.response === 0) {
          (app as any).isQuiting = true;
          app.quit();
        }
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 托盘图标点击事件
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  // 托盘图标双击事件
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function schedulePostWindowStartupTasks() {
  setTimeout(() => {
    writeMainLog("INFO", "开始后台启动外部进程", {
      durationMs: Date.now() - appLaunchStartedAt,
    });
    externalProcessManager.startAll().catch((error) => {
      console.error("❌ 启动外部进程失败:", error);
      writeMainLog("ERROR", "应用启动后批量启动外部进程失败", {
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });
    });

    // 启动 MCP Server
    getMcpServerModule()
      .then(async (module) => {
        if (!module.isMcpServerRunning()) {
          writeMainLog("INFO", "启动 MCP Server");
          await module.startMcpServer(3210);
          writeMainLog("INFO", "MCP Server 启动成功");
        }
      })
      .catch((error) => {
        console.error("❌ 启动 MCP Server 失败:", error);
        writeMainLog("ERROR", "启动 MCP Server 失败", {
          error: error?.message,
        });
      });

    // 预热 Video Template 服务
    getVideoTemplateModule()
      .then(async (module) => {
        writeMainLog("INFO", "预热 Video Template 服务");
        await module.warmVideoTemplateService();
        writeMainLog("INFO", "Video Template 服务预热完成");
      })
      .catch((error) => {
        console.error("❌ 预热 Video Template 失败:", error);
        writeMainLog("ERROR", "预热 Video Template 失败", {
          error: error?.message,
        });
      });

    // 预热 Image Tool 服务
    getImageToolModule()
      .then(async (module) => {
        writeMainLog("INFO", "预热 Image Tool 服务");
        await module.ensureImageToolDirectories();
        writeMainLog("INFO", "Image Tool 服务预热完成");
      })
      .catch((error) => {
        console.error("❌ 预热 Image Tool 失败:", error);
        writeMainLog("ERROR", "预热 Image Tool 失败", {
          error: error?.message,
        });
      });
  }, 2500);
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

// protocol.registerSchemesAsPrivileged([{
//   scheme: 'yishe',
//   privileges: {
//     bypassCSP: true,
//     standard: true,
//     secure: true,
//     supportFetchAPI: true }
// }]);

app.setAsDefaultProtocolClient("yishe");

// 单实例锁定：确保同一物理机上只能运行一个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 如果获取锁失败，说明已经有实例在运行
  console.log("⚠️ 程序已经在运行中，退出当前实例");

  // 显示提示对话框（在退出前）
  // 注意：此时还没有窗口，所以使用 dialog.showMessageBoxSync
  dialog.showMessageBoxSync({
    type: "info",
    buttons: ["确定"],
    defaultId: 0,
    title: "程序已运行",
    message: "程序已经运行",
    detail:
      "检测到程序已经在运行中，请勿重复启动。\n\n如果无法找到运行中的程序窗口，请检查系统托盘。",
    icon: icon,
  });

  // 退出当前实例
  app.quit();
  process.exit(0);
} else {
  // 成功获取锁，监听第二个实例的启动
  app.on("second-instance", (_event, _commandLine, _workingDirectory) => {
    // 当第二个实例尝试启动时，在第一个实例中触发此事件
    console.log("⚠️ 检测到第二个实例尝试启动，激活第一个实例窗口");

    // 如果主窗口存在，显示并聚焦
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();

      // 显示提示对话框，告知用户程序已在运行
      dialog
        .showMessageBox(mainWindow, {
          type: "info",
          buttons: ["确定"],
          defaultId: 0,
          title: "程序已运行",
          message: "程序已经运行",
          detail:
            "检测到程序已经在运行中，请勿重复启动。\n\n如果无法找到运行中的程序窗口，请检查系统托盘。",
          icon: icon,
        })
        .catch((error) => {
          console.error("显示提示对话框失败:", error);
        });
    }
  });
}

app.whenReady().then(() => {
  // 初始化默认工作目录（在创建窗口之前）
  initializeDefaultWorkspaceDirectory();

  // 注册通用客户端能力
  import("./capabilities")
    .then((m) => {
      m.registerAllCapabilities();
      console.log(`[App] 通用能力已注册: ${m.getCapabilityCount()} 个`);
    })
    .catch((e) => {
      console.warn("[App] 通用能力注册失败:", e?.message || e);
    });
  void getCurrentLocalDatabaseInfo()
    .then((localDatabaseInfo) => {
      writeMainLog(
        localDatabaseInfo.connected ? "INFO" : "ERROR",
        localDatabaseInfo.connected
          ? "本地 SQLite 数据库初始化完成"
          : "本地 SQLite 数据库初始化失败",
        {
          databasePath: localDatabaseInfo.databasePath,
          sqliteVersion: localDatabaseInfo.sqliteVersion,
          schemaVersion: localDatabaseInfo.schemaVersion,
          error: localDatabaseInfo.error,
        },
      );
    })
    .catch((error) => {
      writeMainLog("ERROR", "本地 SQLite 数据库模块加载失败", {
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });
    });
  void ensureLocalServiceStartedForCachedToken("app-ready").catch((error) => {
    writeMainLog("ERROR", "缓存 token 自动启动 1519 服务失败", {
      scene: "app-ready",
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
  });

  // 添加协议注册代码

  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC test
  ipcMain.on("ping", () => console.log("pong"));
  ipcMain.handle("client-log:write", async (_event, payload) => {
    return writeClientLog(payload || {});
  });
  ipcMain.handle(
    "client-log:query",
    async (_event, action: string, payload: Record<string, any>) => {
      return handleClientLogCommand(action, payload || {});
    },
  );

  // 切换开发者工具（供 header 按钮调用）
  ipcMain.handle("toggle-devtools", async (event) => {
    const wc = event?.sender || mainWindow?.webContents;
    if (!wc) return { opened: false };
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
      return { opened: false };
    }
    wc.openDevTools({ mode: "right" });
    return { opened: true };
  });

  // 监听 token 保存事件，启动服务
  // 注意：server.ts 中也有 save-token 处理器，但它在服务启动后才注册
  // 这里我们在服务启动前拦截，先启动服务并保存 token
  ipcMain.handle("save-token", async (_event, newToken) => {
    const { saveToken, isServerRunning, startServer } = await getServerModule();
    // 先保存 token（无论服务是否启动）
    saveToken(newToken);
    writeMainLog("INFO", "保存登录 token，检查本地服务状态", {
      hasToken: !!newToken,
      serverRunning: isServerRunning(),
    });

    // 如果服务未启动，启动服务
    if (!isServerRunning()) {
      console.log("🔐 检测到 token 保存，启动 1519 服务...");
      writeMainLog("INFO", "token 保存后启动本地 1519 服务");
      startServer(1519);
    }

    return true;
  });

  // token 读取相关 IPC 处理器
  ipcMain.handle("get-token", async () => {
    await ensureLocalServiceStartedForCachedToken("get-token");
    const { getTokenValue } = await getServerModule();
    return getTokenValue();
  });

  ipcMain.handle("is-token-exist", async () => {
    await ensureLocalServiceStartedForCachedToken("is-token-exist");
    const { isTokenExist } = await getServerModule();
    return isTokenExist();
  });

  // Renderer 通过受限 IPC 清除登录态；不依赖 1519 HTTP 路由，因此不会受本地密钥或服务停止时机影响。
  ipcMain.handle("clear-token", async () => {
    const { clearToken } = await getServerModule();
    clearToken();
    clearActiveAgentConfig();
    const { clearServerEndpoint } = await import("./agent/server-capabilities");
    clearServerEndpoint();
    return true;
  });

  ipcMain.handle("get-device-key", async () => {
    return getOrCreateDeviceKey();
  });

  ipcMain.handle("local-database:get-info", async () => {
    return getCurrentLocalDatabaseInfo();
  });

  // 插件/外部进程管理 IPC
  ipcMain.handle("list-external-processes", async () => {
    return pluginProcessConfigs.map((config) => ({
      id: config.id,
      name: config.name,
      executable: config.executable,
      platforms: config.platforms,
      autoRestart: config.autoRestart ?? false,
      status:
        externalProcessManager.getProcessStatus(config.id) ||
        ProcessStatus.STOPPED,
    }));
  });

  // 客户端 Agent 配置存储（renderer → main process）
  let storedAgentConfig: {
    keyId: number | null;
    model: string;
    baseUrl: string;
    apiKey: string;
    enabled: boolean;
  } = { keyId: null, model: "", baseUrl: "", apiKey: "", enabled: false };

  ipcMain.handle(
    "agent-config:set",
    async (_event, config: typeof storedAgentConfig) => {
      storedAgentConfig = { ...storedAgentConfig, ...config };
      // 同时存到全局变量，供 MCP 工具读取
      (global as any).__agentConfig = storedAgentConfig;
      writeMainLog("INFO", "Agent 配置已更新", {
        enabled: storedAgentConfig.enabled,
        model: storedAgentConfig.model,
        keyId: storedAgentConfig.keyId,
      });
      return true;
    },
  );

  ipcMain.handle("agent-config:get", async () => {
    return storedAgentConfig;
  });

  // 注册客户端自研 LangGraph Agent 核心 IPC 通道
  setupAgentIpc();

  ipcMain.handle("start-external-process", async (_event, id: string) => {
    writeMainLog("INFO", "收到启动外部进程 IPC", { processId: id });
    const success = await externalProcessManager.startProcess(id);
    writeMainLog(success ? "INFO" : "ERROR", "启动外部进程 IPC 完成", {
      processId: id,
      success,
    });
    return success;
  });

  ipcMain.handle(
    "stop-external-process",
    async (_event, id: string, force = false) => {
      writeMainLog("INFO", "收到停止外部进程 IPC", { processId: id, force });
      const success = await externalProcessManager.stopProcess(id, force);
      writeMainLog(success ? "INFO" : "ERROR", "停止外部进程 IPC 完成", {
        processId: id,
        force,
        success,
      });
      return success;
    },
  );

  ipcMain.handle("restart-external-process", async (_event, id: string) => {
    writeMainLog("INFO", "收到重启外部进程 IPC", { processId: id });
    const success = await externalProcessManager.restartProcess(id);
    writeMainLog(success ? "INFO" : "ERROR", "重启外部进程 IPC 完成", {
      processId: id,
      success,
    });
    return success;
  });

  ipcMain.handle("auto-browser:invoke", async (_event, request) => {
    const startedAt = Date.now();
    writeMainLog("DEBUG", "收到 auto-browser IPC 调用", {
      method: request?.method || "GET",
      path: request?.path || "",
      query: request?.query || {},
      hasBody: !!request?.body,
    });
    try {
      const { invokeAutoBrowserRoute } = await getAutoBrowserModule();
      const response = await invokeAutoBrowserRoute(request);
      writeMainLog(
        response?.ok ? "DEBUG" : "WARN",
        "auto-browser IPC 调用完成",
        {
          method: request?.method || "GET",
          path: request?.path || "",
          status: response?.status,
          ok: response?.ok,
          durationMs: Date.now() - startedAt,
        },
      );
      return response;
    } catch (error) {
      writeMainLog("ERROR", "auto-browser IPC 调用异常", {
        method: request?.method || "GET",
        path: request?.path || "",
        durationMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });
      throw error;
    }
  });

  // 本地服务管理 IPC
  ipcMain.handle("start-local-service", async () => {
    try {
      const { isServerRunning, startServer } = await getServerModule();
      if (!isServerRunning()) {
        console.log("🚀 启动本地服务 (1519端口)...");
        writeMainLog("INFO", "准备启动本地 1519 服务");
        startServer(1519);
        writeMainLog("INFO", "本地 1519 服务启动命令已执行");
        return { success: true, message: "本地服务启动成功" };
      } else {
        writeMainLog("INFO", "本地 1519 服务已在运行");
        return { success: true, message: "本地服务已在运行" };
      }
    } catch (error: any) {
      console.error("❌ 启动本地服务失败:", error);
      writeMainLog("ERROR", "启动本地 1519 服务失败", {
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });
      return { success: false, message: error?.message || "启动本地服务失败" };
    }
  });

  ipcMain.handle("stop-local-service", async () => {
    try {
      const { isServerRunning, stopServer } = await getServerModule();
      if (isServerRunning()) {
        console.log("🛑 停止本地服务 (1519端口)...");
        writeMainLog("INFO", "准备停止本地 1519 服务");
        await stopServer();
        writeMainLog("INFO", "本地 1519 服务已停止");
        return { success: true, message: "本地服务已停止" };
      } else {
        writeMainLog("INFO", "本地 1519 服务未运行");
        return { success: true, message: "本地服务未运行" };
      }
    } catch (error: any) {
      console.error("❌ 停止本地服务失败:", error);
      writeMainLog("ERROR", "停止本地 1519 服务失败", {
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });
      return { success: false, message: error?.message || "停止本地服务失败" };
    }
  });

  ipcMain.handle("check-local-service-status", async () => {
    try {
      await ensureLocalServiceStartedForCachedToken(
        "check-local-service-status",
      );
      const { isServerRunning } = await getServerModule();
      const running = isServerRunning();
      // 尝试访问健康检查接口来确认服务是否真正可用
      let isAvailable = false;
      if (running) {
        try {
          await new Promise<void>((resolve) => {
            const req = http.get(
              "http://localhost:1519/api/health",
              (res: any) => {
                isAvailable = res.statusCode === 200;
                resolve(null);
              },
            );
            req.on("error", () => {
              isAvailable = false;
              resolve(null);
            });
            req.setTimeout(2000, () => {
              req.destroy();
              isAvailable = false;
              resolve(null);
            });
          });
        } catch {
          isAvailable = false;
        }
      }
      return {
        running,
        available: isAvailable,
        port: 1519,
      };
    } catch (error: any) {
      console.error("❌ 检查本地服务状态失败:", error);
      return {
        running: false,
        available: false,
        port: 1519,
        error: error?.message,
      };
    }
  });

  // MCP Server 管理 IPC
  ipcMain.handle("mcp-server:start", async () => {
    try {
      const { isMcpServerRunning, startMcpServer } = await getMcpServerModule();
      if (!isMcpServerRunning()) {
        console.log("🚀 启动 MCP Server (3210端口)...");
        writeMainLog("INFO", "准备启动 MCP Server");
        await startMcpServer(3210);
        writeMainLog("INFO", "MCP Server 启动成功");
        return { success: true, message: "MCP Server 启动成功" };
      } else {
        writeMainLog("INFO", "MCP Server 已在运行");
        return { success: true, message: "MCP Server 已在运行" };
      }
    } catch (error: any) {
      console.error("❌ 启动 MCP Server 失败:", error);
      writeMainLog("ERROR", "启动 MCP Server 失败", {
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });
      return {
        success: false,
        message: error?.message || "启动 MCP Server 失败",
      };
    }
  });

  ipcMain.handle("mcp-server:stop", async () => {
    try {
      const { isMcpServerRunning, stopMcpServer } = await getMcpServerModule();
      if (isMcpServerRunning()) {
        console.log("🛑 停止 MCP Server...");
        writeMainLog("INFO", "准备停止 MCP Server");
        await stopMcpServer();
        writeMainLog("INFO", "MCP Server 已停止");
        return { success: true, message: "MCP Server 已停止" };
      } else {
        writeMainLog("INFO", "MCP Server 未运行");
        return { success: true, message: "MCP Server 未运行" };
      }
    } catch (error: any) {
      console.error("❌ 停止 MCP Server 失败:", error);
      writeMainLog("ERROR", "停止 MCP Server 失败", {
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });
      return {
        success: false,
        message: error?.message || "停止 MCP Server 失败",
      };
    }
  });

  ipcMain.handle("mcp-server:status", async () => {
    try {
      const { getMcpServerInfo } = await getMcpServerModule();
      const info = getMcpServerInfo();
      return {
        running: info.running,
        port: info.port,
        toolCount: info.toolCount,
      };
    } catch (error: any) {
      console.error("❌ 检查 MCP Server 状态失败:", error);
      return {
        running: false,
        port: 3210,
        toolCount: 0,
        error: error?.message,
      };
    }
  });

  // MCP 工具执行 IPC
  ipcMain.handle(
    "mcp:call-tool",
    async (_event, toolName: string, toolArgs: Record<string, any>) => {
      try {
        const { callMcpTool } = await getMcpServerModule();
        return await callMcpTool(toolName, toolArgs || {});
      } catch (error: any) {
        writeMainLog("ERROR", "MCP 工具执行失败", {
          toolName,
          error: error?.message,
        });
        return {
          content: [
            { type: "text", text: error?.message || "MCP 工具执行异常" },
          ],
          isError: true,
        };
      }
    },
  );

  // MCP 工具列表 IPC
  ipcMain.handle("mcp:list-tools", async () => {
    try {
      const { listMcpTools } = await getMcpServerModule();
      return listMcpTools();
    } catch (error: any) {
      writeMainLog("ERROR", "MCP 工具列表获取失败", {
        error: error?.message,
      });
      return [];
    }
  });

  // 退出确认IPC处理器
  ipcMain.handle("confirm-exit", async () => {
    if (!mainWindow) return "cancel";

    const result = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["退到托盘", "直接退出", "取消"],
      defaultId: 0,
      cancelId: 2,
      title: "退出确认",
      message: "退出客户端后将无法提供服务",
      detail: "您可以选择退到托盘继续运行，或者直接退出程序。",
      icon: icon,
    });

    switch (result.response) {
      case 0: // 退到托盘
        mainWindow.hide();
        return "tray";
      case 1: // 直接退出
        (app as any).isQuiting = true;
        app.quit();
        return "quit";
      case 2: // 取消
        return "cancel";
      default:
        return "cancel";
    }
  });

  createWindow();

  // 创建系统托盘
  createTray();

  schedulePostWindowStartupTasks();

  // 注意：服务器现在只在用户登录后启动，不再在应用启动时启动

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  powerMonitor.on("suspend", () => {
    writeMainLog("WARN", "系统进入休眠/挂起，客户端连接可能短暂中断");
    sendAppRuntimeEvent("system-suspend");
  });

  powerMonitor.on("resume", () => {
    writeMainLog("INFO", "系统已从休眠/挂起恢复，通知渲染层刷新连接");
    sendAppRuntimeEvent("system-resume");
  });

  powerMonitor.on("unlock-screen", () => {
    sendAppRuntimeEvent("screen-unlocked");
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // 在Windows和Linux上，不要直接退出，而是隐藏窗口
    // app.quit()
  }
});

async function cleanupBeforeQuit(): Promise<void> {
  console.log("🔄 应用即将退出，清理资源...");
  writeMainLog("INFO", "应用即将退出，开始清理资源");

  // 停止 MCP Server
  if (mcpServerModulePromise) {
    await getMcpServerModule()
      .then((module) => module.stopMcpServer())
      .catch((error) => {
        console.error("❌ 停止 MCP Server 失败:", error);
        writeMainLog("ERROR", "停止 MCP Server 失败", {
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : error,
        });
      });
  }

  if (autoBrowserModulePromise) {
    await getAutoBrowserModule()
      .then((module) => module.shutdownAutoBrowserService())
      .catch((error) => {
        console.error("❌ 停止 auto-browser 服务失败:", error);
        writeMainLog("ERROR", "停止 auto-browser 服务失败", {
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : error,
        });
      });
  }

  // 停止外部进程（优先执行，给进程时间优雅关闭）
  await externalProcessManager.stopAll().catch((error) => {
    console.error("❌ 停止外部进程失败:", error);
    writeMainLog("ERROR", "停止外部进程失败，准备强制关闭", {
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
    // 如果优雅关闭失败，尝试强制关闭
    externalProcessManager.stopAll(true).catch(console.error);
  });

  // 清理托盘
  if (tray) {
    tray.destroy();
  }

  console.log("✅ 资源清理完成");
  writeMainLog("INFO", "应用退出资源清理完成");
}

// 应用退出时清理资源。Electron 不会等待 async before-quit，需要显式阻塞一次。
app.on("before-quit", (event) => {
  (app as any).isQuiting = true;

  if (quitCleanupComplete) {
    return;
  }

  event.preventDefault();
  if (!quitCleanupPromise) {
    quitCleanupPromise = cleanupBeforeQuit()
      .catch((error) => {
        console.error("❌ 应用退出清理异常:", error);
        writeMainLog("ERROR", "应用退出清理异常", {
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : error,
        });
      })
      .finally(() => {
        quitCleanupComplete = true;
        app.quit();
      });
  }
});

// 添加托盘相关的IPC监听器
ipcMain.handle(
  "show-tray-notification",
  async (_, options: { title: string; body: string }) => {
    if (tray) {
      tray.displayBalloon({
        title: options.title,
        content: options.body,
        icon: icon,
      });
    }
  },
);

ipcMain.handle("update-tray-tooltip", async (_, tooltip: string) => {
  if (tray) {
    tray.setToolTip(tooltip);
  }
});

ipcMain.handle("hide-main-window", async () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.handle("show-main-window", async () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// 添加调试工具切换事件处理
ipcMain.on("toggle-devtools", (event) => {
  console.log("toggle");
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools();
    } else {
      win.webContents.openDevTools();
    }
  }
});

ipcMain.handle("get-app-version", () => app.getVersion());
// });

ipcMain.handle("open-external", async (_event, url: string) => {
  await shell.openExternal(url);
});

// 工作目录相关 IPC 处理器
ipcMain.handle("select-workspace-directory", async () => {
  if (!mainWindow) {
    throw new Error("主窗口不存在");
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "选择工作目录",
  });

  if (result.canceled) {
    writeMainLog("INFO", "用户取消选择工作目录");
    return null;
  }

  const selectedPath = result.filePaths[0];
  if (selectedPath) {
    // 保存到 electron-store
    store.set("workspaceDirectory", selectedPath);
    writeMainLog("INFO", "已选择并保存工作目录", {
      workspaceDirectory: selectedPath,
    });
    return selectedPath;
  }

  return null;
});

ipcMain.handle("get-workspace-directory", async () => {
  return store.get("workspaceDirectory", "") as string;
});

ipcMain.handle("set-workspace-directory", async (_event, path: string) => {
  if (path && typeof path === "string") {
    store.set("workspaceDirectory", path);
    writeMainLog("INFO", "已设置工作目录", {
      workspaceDirectory: path,
    });
    return true;
  }
  writeMainLog("WARN", "设置工作目录失败，路径无效", { path });
  return false;
});

ipcMain.handle("image-tool:get-status", async () => {
  const { getImageToolStatus } = await getImageToolModule();
  return await getImageToolStatus();
});

ipcMain.handle("image-tool:start", async () => {
  const { getImageToolStatus } = await getImageToolModule();
  return await getImageToolStatus();
});

ipcMain.handle("image-tool:stop", async () => {
  resetImageToolModule();
  return {
    success: true,
    status: "stopped",
    message: "Image Tool 已关闭",
  };
});

ipcMain.handle("image-tool:get-directories", async () => {
  const { getImageToolDirectories } = await getImageToolModule();
  return {
    success: true,
    directories: getImageToolDirectories(),
  };
});

ipcMain.handle("image-tool:get-catalog", async () => {
  const { getImageToolCatalog } = await getImageToolModule();
  return await getImageToolCatalog();
});

ipcMain.handle("image-tool:get-operations", async () => {
  const { getImageToolOperations } = await getImageToolModule();
  return await getImageToolOperations();
});

ipcMain.handle("image-tool:get-operation-schemas", async () => {
  const { getImageToolOperationSchemas } = await getImageToolModule();
  return await getImageToolOperationSchemas();
});

ipcMain.handle(
  "image-tool:get-operation-detail",
  async (_event, type: string) => {
    const { getImageToolOperationDetail } = await getImageToolModule();
    return await getImageToolOperationDetail(type);
  },
);

ipcMain.handle("image-tool:get-examples", async () => {
  const { getImageToolExamples } = await getImageToolModule();
  return await getImageToolExamples();
});

ipcMain.handle("image-tool:get-example-detail", async (_event, id: string) => {
  const { getImageToolExampleById } = await getImageToolModule();
  return await getImageToolExampleById(id);
});

ipcMain.handle("image-tool:get-variations-config", async () => {
  const { getImageToolVariationsConfig } = await getImageToolModule();
  return await getImageToolVariationsConfig();
});

ipcMain.handle("image-tool:save-input", async (_event, payload: any) => {
  const { saveImageToolInput } = await getImageToolModule();
  return await saveImageToolInput(payload || {});
});

ipcMain.handle("image-tool:get-info", async (_event, payload: any) => {
  const { getImageInfo } = await getImageToolModule();
  return await getImageInfo(payload || {});
});

ipcMain.handle("image-tool:process", async (_event, payload: any) => {
  const { processImage } = await getImageToolModule();
  return await processImage(payload || {});
});

ipcMain.handle(
  "image-tool:process-with-prompt",
  async (_event, payload: any) => {
    const { processImageWithPrompt } = await getImageToolModule();
    return await processImageWithPrompt(payload || {});
  },
);

ipcMain.handle("image-tool:variations", async (_event, payload: any) => {
  const { generateImageVariations } = await getImageToolModule();
  return await generateImageVariations(payload || {});
});

ipcMain.handle("image-tool:list-files", async (_event, payload: any) => {
  const { listImageToolFiles } = await getImageToolModule();
  return await listImageToolFiles(payload || {});
});

ipcMain.handle("image-tool:delete-file", async (_event, payload: any) => {
  const { deleteImageToolFile } = await getImageToolModule();
  return await deleteImageToolFile(payload || {});
});

ipcMain.handle("image-tool:clear-files", async (_event, payload: any) => {
  const { clearImageToolFiles } = await getImageToolModule();
  return await clearImageToolFiles(payload || {});
});

ipcMain.handle("video-template:get-status", async () => {
  const { getVideoTemplateStatus } = await getVideoTemplateModule();
  return await getVideoTemplateStatus();
});

ipcMain.handle("video-template:start", async () => {
  const { warmVideoTemplateService, getVideoTemplateStatus } =
    await getVideoTemplateModule();
  await warmVideoTemplateService();
  return await getVideoTemplateStatus();
});

ipcMain.handle("video-template:stop", async () => {
  const { shutdownVideoTemplateService } = await getVideoTemplateModule();
  return await shutdownVideoTemplateService();
});

ipcMain.handle("video-template:get-catalog", async () => {
  const { getVideoTemplateCatalog } = await getVideoTemplateModule();
  return await getVideoTemplateCatalog();
});

ipcMain.handle("video-template:list-renders", async () => {
  const { listVideoTemplateRenders } = await getVideoTemplateModule();
  return await listVideoTemplateRenders();
});

ipcMain.handle("video-template:get-render", async (_event, jobId: string) => {
  const { getVideoTemplateRender } = await getVideoTemplateModule();
  return await getVideoTemplateRender(jobId);
});

ipcMain.handle(
  "video-template:enqueue-render",
  async (_event, payload: any) => {
    const { enqueueVideoTemplateRender } = await getVideoTemplateModule();
    return await enqueueVideoTemplateRender(payload || {});
  },
);

ipcMain.handle(
  "video-template:cancel-render",
  async (_event, jobId: string) => {
    const { cancelVideoTemplateRender } = await getVideoTemplateModule();
    return await cancelVideoTemplateRender(jobId);
  },
);

ipcMain.handle("open-path", async (_event, path: string) => {
  if (!path || typeof path !== "string") {
    throw new Error("路径无效");
  }

  try {
    await shell.openPath(path);
  } catch (error: any) {
    throw new Error(`打开路径失败: ${error?.message || "未知错误"}`);
  }
});

// 辅助函数：确保文件名有正确的扩展名
function ensureFileExtension(
  fileName: string,
  url?: string,
  contentType?: string,
): string {
  // 如果文件名已经有扩展名，直接返回
  if (fileName.includes(".")) {
    return fileName;
  }

  // 检查 URL 中是否包含 .psd
  if (url && url.toLowerCase().includes(".psd")) {
    return `${fileName}.psd`;
  }

  // 检查 Content-Type 是否为 PSD 相关类型
  if (contentType) {
    const lowerContentType = contentType.toLowerCase();
    if (
      lowerContentType.includes("photoshop") ||
      lowerContentType.includes("image/vnd.adobe.photoshop") ||
      (lowerContentType === "application/octet-stream" &&
        url &&
        url.toLowerCase().includes("psd"))
    ) {
      return `${fileName}.psd`;
    }
  }

  // 如果无法确定，返回原文件名（让系统处理）
  return fileName;
}

type DownloadManifestEntry = {
  url: string;
  cacheKey: string;
  fileName: string;
  filePath: string;
  fileSize?: number;
  contentType?: string | null;
  downloadedAt?: string;
  originalFileName?: string;
};

type DownloadManifest = Record<string, DownloadManifestEntry>;

const downloadInFlight = new Map<string, Promise<any>>();

function normalizeDownloadUrl(url: string): string {
  return new URL(String(url || "").trim()).toString();
}

function buildDownloadCacheKey(url: string): string {
  return createHash("sha256").update(normalizeDownloadUrl(url)).digest("hex");
}

function getDownloadManifestPath(filesDir: string): string {
  return pathJoin(filesDir, ".download-manifest.json");
}

function readDownloadManifest(filesDir: string): DownloadManifest {
  try {
    const manifestPath = getDownloadManifestPath(filesDir);
    if (!fs.existsSync(manifestPath)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDownloadManifest(
  filesDir: string,
  manifest: DownloadManifest,
): void {
  const manifestPath = getDownloadManifestPath(filesDir);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

function sanitizeDownloadFileName(fileName: string): string {
  const safe = String(fileName || "download")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return safe || "download";
}

function getFileNameFromUrl(parsedUrl: URL): string {
  const urlPath = parsedUrl.pathname;
  let fileName = urlPath.split("/").pop() || "download";

  if (!fileName.includes(".")) {
    const suggestedName =
      parsedUrl.searchParams.get("filename") ||
      parsedUrl.searchParams.get("name");
    fileName = suggestedName || fileName;
  }

  try {
    fileName = decodeURIComponent(fileName);
  } catch {
    // keep original name
  }
  return sanitizeDownloadFileName(fileName);
}

function getFileNameFromContentDisposition(
  contentDisposition: string | null,
): string | null {
  if (!contentDisposition) {
    return null;
  }
  const utf8Match = contentDisposition.match(
    /filename\*\s*=\s*UTF-8''([^;\n]*)/i,
  );
  const rawFileName =
    utf8Match?.[1] ||
    contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i)?.[1];
  if (!rawFileName) {
    return null;
  }
  let fileName = rawFileName.replace(/['"]/g, "");
  try {
    fileName = decodeURIComponent(fileName);
  } catch {
    // keep original name
  }
  return sanitizeDownloadFileName(fileName);
}

function buildCachedDownloadFileName(
  cacheKey: string,
  originalFileName: string,
  url?: string,
  contentType?: string | null,
): string {
  const withExtension = ensureFileExtension(
    sanitizeDownloadFileName(originalFileName),
    url,
    contentType || undefined,
  );
  const ext = extname(withExtension);
  const stem =
    sanitizeDownloadFileName(basename(withExtension, ext)).slice(0, 96) ||
    "download";
  return `${cacheKey.slice(0, 16)}_${stem}${ext || ""}`;
}

function getCachedDownloadByUrl(filesDir: string, url: string) {
  const normalizedUrl = normalizeDownloadUrl(url);
  const cacheKey = buildDownloadCacheKey(normalizedUrl);
  const manifest = readDownloadManifest(filesDir);
  const entry = manifest[cacheKey];
  if (
    entry?.url === normalizedUrl &&
    entry.filePath &&
    fs.existsSync(entry.filePath)
  ) {
    const stats = fs.statSync(entry.filePath);
    if (stats.isFile()) {
      return {
        found: true,
        cacheKey,
        entry: {
          ...entry,
          fileSize: stats.size,
        },
      };
    }
  }
  return { found: false, cacheKey, entry: null };
}

// 文件下载相关 IPC 处理器
/**
 * 从 URL 下载文件到工作目录下的 files 目录
 * @param url 文件下载链接
 * @returns 下载结果 { success: boolean, message: string, filePath?: string, skipped?: boolean }
 */
ipcMain.handle("download-file", async (_event, url: string) => {
  const normalizedUrlForLock = (() => {
    try {
      return normalizeDownloadUrl(url);
    } catch {
      return String(url || "").trim();
    }
  })();
  if (normalizedUrlForLock && downloadInFlight.has(normalizedUrlForLock)) {
    return downloadInFlight.get(normalizedUrlForLock);
  }

  const task = (async () => {
    try {
      // 检查工作目录是否设置
      const workspaceDir = store.get("workspaceDirectory", "") as string;
      if (!workspaceDir || workspaceDir.trim() === "") {
        return {
          success: false,
          message: "请先设置工作目录",
          error: "WORKSPACE_NOT_SET",
        };
      }

      // 验证 URL
      if (!url || typeof url !== "string" || url.trim() === "") {
        return {
          success: false,
          message: "无效的下载链接",
          error: "INVALID_URL",
        };
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch (error) {
        return {
          success: false,
          message: "无效的 URL 格式",
          error: "INVALID_URL_FORMAT",
        };
      }
      const normalizedUrl = normalizeDownloadUrl(url);
      const cacheKey = buildDownloadCacheKey(normalizedUrl);

      // 创建 files 目录
      const filesDir = pathJoin(workspaceDir, "files");
      if (!fs.existsSync(filesDir)) {
        fs.mkdirSync(filesDir, { recursive: true });
      }

      const cached = getCachedDownloadByUrl(filesDir, normalizedUrl);
      if (cached.found && cached.entry) {
        return {
          success: true,
          message: "文件链接已缓存，跳过下载",
          filePath: cached.entry.filePath,
          skipped: true,
          fileSize: cached.entry.fileSize,
          cacheKey,
        };
      }

      let fileName = getFileNameFromUrl(parsedUrl);

      // 使用 fetch API 下载文件（参考 yishe-admin 的实现）
      try {
        const DOWNLOAD_TIMEOUT = 120000; // 下载超时120秒

        // 创建 AbortController 用于超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          DOWNLOAD_TIMEOUT,
        );

        // 使用 fetch 下载文件，参考 yishe-admin 的实现
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "*/*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            Referer: parsedUrl.origin,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // 检查响应状态
        if (!response.ok) {
          return {
            success: false,
            message: `下载失败: HTTP ${response.status} ${response.statusText}`,
            error: "HTTP_ERROR",
            statusCode: response.status,
          };
        }

        // 从响应头获取文件名（如果 Content-Disposition 存在）
        const contentDisposition = response.headers.get("content-disposition");
        if (contentDisposition) {
          const suggestedFileName =
            getFileNameFromContentDisposition(contentDisposition);
          if (suggestedFileName) {
            fileName = suggestedFileName;
          }
        }

        const originalFileName = fileName;
        fileName = buildCachedDownloadFileName(
          cacheKey,
          fileName,
          url,
          response.headers.get("content-type"),
        );

        const finalFilePath = pathJoin(filesDir, fileName);

        // 如果文件已存在，返回跳过
        if (fs.existsSync(finalFilePath)) {
          const stats = fs.statSync(finalFilePath);
          const manifest = readDownloadManifest(filesDir);
          manifest[cacheKey] = {
            url: normalizedUrl,
            cacheKey,
            fileName,
            filePath: finalFilePath,
            fileSize: stats.size,
            contentType: response.headers.get("content-type"),
            downloadedAt:
              manifest[cacheKey]?.downloadedAt || new Date().toISOString(),
            originalFileName,
          };
          writeDownloadManifest(filesDir, manifest);
          return {
            success: true,
            message: "文件已存在，跳过下载",
            filePath: finalFilePath,
            skipped: true,
            fileSize: stats.size,
            cacheKey,
          };
        }

        // 获取响应数据并写入文件
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 写入文件
        fs.writeFileSync(finalFilePath, buffer);

        const stats = fs.statSync(finalFilePath);
        const manifest = readDownloadManifest(filesDir);
        manifest[cacheKey] = {
          url: normalizedUrl,
          cacheKey,
          fileName,
          filePath: finalFilePath,
          fileSize: stats.size,
          contentType: response.headers.get("content-type"),
          downloadedAt: new Date().toISOString(),
          originalFileName,
        };
        writeDownloadManifest(filesDir, manifest);

        return {
          success: true,
          message: "下载完成",
          filePath: finalFilePath,
          fileSize: stats.size,
          downloadedBytes: buffer.length,
          cacheKey,
        };
      } catch (error: any) {
        // 处理超时错误
        if (error.name === "AbortError") {
          return {
            success: false,
            message: "下载超时",
            error: "TIMEOUT",
          };
        }

        // 处理其他错误
        return {
          success: false,
          message: `下载失败: ${error.message || "未知错误"}`,
          error: "DOWNLOAD_ERROR",
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `下载失败: ${error.message || "未知错误"}`,
        error: "UNKNOWN_ERROR",
      };
    }
  })();

  if (normalizedUrlForLock) {
    downloadInFlight.set(normalizedUrlForLock, task);
  }
  try {
    return await task;
  } finally {
    if (normalizedUrlForLock) {
      downloadInFlight.delete(normalizedUrlForLock);
    }
  }
});

// 查询文件是否已下载
/**
 * 根据 URL 查询文件是否已下载
 * @param url 文件下载链接
 * @returns 查询结果 { found: boolean, filePath?: string, fileSize?: number, message: string }
 */
ipcMain.handle("check-file-downloaded", async (_event, url: string) => {
  try {
    // 检查工作目录是否设置
    const workspaceDir = store.get("workspaceDirectory", "") as string;
    if (!workspaceDir || workspaceDir.trim() === "") {
      return {
        found: false,
        message: "工作目录未设置",
        error: "WORKSPACE_NOT_SET",
      };
    }

    // 验证 URL
    if (!url || typeof url !== "string" || url.trim() === "") {
      return {
        found: false,
        message: "无效的下载链接",
        error: "INVALID_URL",
      };
    }

    try {
      normalizeDownloadUrl(url);
    } catch (error) {
      return {
        found: false,
        message: "无效的 URL 格式",
        error: "INVALID_URL_FORMAT",
      };
    }
    const normalizedUrl = normalizeDownloadUrl(url);
    const cacheKey = buildDownloadCacheKey(normalizedUrl);

    const filesDir = pathJoin(workspaceDir, "files");

    // 如果 files 目录不存在，说明没有下载过文件
    if (!fs.existsSync(filesDir)) {
      return {
        found: false,
        message: "文件目录不存在，未找到文件",
        filePath: null,
        cacheKey,
      };
    }

    const cached = getCachedDownloadByUrl(filesDir, normalizedUrl);
    if (cached.found && cached.entry) {
      return {
        found: true,
        filePath: cached.entry.filePath,
        fileSize: cached.entry.fileSize,
        message: "文件链接缓存已找到",
        cacheKey,
      };
    }

    // 如果都找不到，返回未找到
    return {
      found: false,
      message: "未找到对应的文件",
      filePath: null,
      cacheKey,
    };
  } catch (error: any) {
    return {
      found: false,
      message: `查询失败: ${error.message || "未知错误"}`,
      error: "UNKNOWN_ERROR",
    };
  }
});

/**
 * 检查任意本地路径是否存在（不限制在工作目录）
 */
ipcMain.handle("check-local-file-exists", async (_event, filePath: string) => {
  try {
    if (!filePath || typeof filePath !== "string" || filePath.trim() === "") {
      return {
        exists: false,
        isFile: false,
        isDirectory: false,
        message: "无效的文件路径",
      };
    }

    const normalized = filePath.trim();
    if (!fs.existsSync(normalized)) {
      return {
        exists: false,
        isFile: false,
        isDirectory: false,
        message: "文件不存在",
      };
    }

    const stats = fs.statSync(normalized);
    return {
      exists: true,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      fileSize: stats.isFile() ? stats.size : undefined,
      message: "OK",
    };
  } catch (error: any) {
    return {
      exists: false,
      isFile: false,
      isDirectory: false,
      message: error?.message || "检查文件时发生错误",
    };
  }
});

// Pixabay 免费图库图搜与下载
ipcMain.handle(
  "pixabay:search",
  async (
    _event,
    payload: {
      keyword: string;
      limit?: number;
      page?: number;
    },
  ) => {
    return searchPixabay(payload?.keyword || "", {
      limit: payload?.limit,
      page: payload?.page,
    });
  },
);

ipcMain.handle("pixabay:status", async () => {
  return getPixabayStatus();
});

ipcMain.handle(
  "pixabay:download",
  async (_event, payload: { imageUrl: string; filename?: string }) => {
    try {
      const { imageUrl, filename } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadPixabayImage(imageUrl, { filename });
      return { ok: res.success, filePath: res.filePath, msg: res.error };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "pixabay:sync",
  async (
    _event,
    payload: {
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncPixabayToMaterialLibrary(imageUrl, metadata);
      return { ok: res.success, msg: res.message, data: res.data };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// Google Arts & Culture 高清下载 - 支持 Windows 和 macOS
ipcMain.handle(
  "convert-to-png",
  async (
    _event,
    payload: {
      inputPath: string;
      pngPath: string;
      width?: number;
      height?: number;
    },
  ) => {
    const { inputPath, pngPath, width, height } = payload;

    try {
      console.log("开始图片转PNG:", { inputPath, pngPath, width, height });

      // 检查文件是否存在
      if (!fs.existsSync(inputPath)) {
        throw new Error(`文件不存在: ${inputPath}`);
      }

      const sharp = await getSharp();

      // 获取文件信息
      const imageInfo = await sharp(inputPath).metadata();
      console.log("图片信息:", {
        width: imageInfo.width,
        height: imageInfo.height,
        format: imageInfo.format,
      });

      if (width && height) {
        // 如果指定了尺寸，则按指定尺寸转换，保持宽高比，使用透明背景
        await sharp(inputPath)
          .resize(width, height, {
            fit: "inside", // 确保图像完全包含在内，保持原始宽高比
            background: { r: 0, g: 0, b: 0, alpha: 0 }, // 透明背景
            withoutEnlargement: true, // 如果图片小于目标尺寸，不放大
          })
          .png({
            compressionLevel: 6,
            quality: 100,
            progressive: false,
          })
          .toFile(pngPath);
      } else {
        // 如果没有指定尺寸，直接转换为PNG，保持原始尺寸和比例
        await sharp(inputPath)
          .png({
            compressionLevel: 6,
            quality: 100,
            progressive: false,
          })
          .toFile(pngPath);
      }

      // 方案2：如果上面的方案仍有问题，可以尝试这个更保守的方法
      // 先转换为高分辨率PNG，然后再缩放到目标尺寸
      /*
    const tempBuffer = await sharp(svgPath)
      .png({
        compressionLevel: 6,
        quality: 100,
        progressive: false
      })
      .toBuffer()

    await sharp(tempBuffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: false
      })
      .png({
        compressionLevel: 6,
        quality: 100,
        progressive: false
      })
      .toFile(pngPath)
    */

      // 检查生成的PNG文件
      const pngInfo = await sharp(pngPath).metadata();
      const fileStats = fs.statSync(pngPath);

      console.log("生成的PNG文件信息:", {
        width: pngInfo.width,
        height: pngInfo.height,
        format: pngInfo.format,
        channels: pngInfo.channels,
        depth: pngInfo.depth,
        density: pngInfo.density,
        hasAlpha: pngInfo.hasAlpha,
        size: fileStats.size,
        created: fileStats.birthtime,
        modified: fileStats.mtime,
      });

      // 验证PNG文件是否可以被正常读取
      try {
        const testRead = await sharp(pngPath).toBuffer();
        console.log("PNG文件验证成功，buffer大小:", testRead.length);
      } catch (readError) {
        console.error("PNG文件验证失败:", readError);
      }

      return { success: true, info: pngInfo };
    } catch (error) {
      console.error("SVG转PNG失败:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  },
);

ipcMain.handle("google-art:get-zooms", async (_event, url: string) => {
  const result = await getGoogleArtZooms(url);
  return result;
});

ipcMain.handle(
  "google-art:search",
  async (
    _event,
    payload: {
      keyword: string;
      page?: number;
      hl?: string;
      maxCount?: number;
      cursor?: string | null;
    },
  ) => {
    const result = await searchGoogleArts(payload);
    return result;
  },
);

ipcMain.handle("google-art:status", async () => {
  return getGoogleArtStatus();
});

ipcMain.handle(
  "google-art:sync",
  async (_event, payload: { url: string; zoomLevel: number }) => {
    const workspaceDir = store.get("workspaceDirectory", "") as string;
    if (!workspaceDir) {
      return { ok: false, msg: "工作目录未设置" };
    }
    const result = await syncGoogleArtToMaterialLibrary({
      url: payload?.url,
      zoomLevel: payload?.zoomLevel,
      workspaceDir,
    });
    return result;
  },
);

// Pinterest 图搜与下载
ipcMain.handle(
  "pinterest:search",
  async (
    _event,
    payload: {
      keyword: string;
      scope?: string;
      limit?: number;
      imageOnly?: boolean;
      bookmark?: string | null;
    },
  ) => {
    return searchPinterest(payload?.keyword || "", {
      scope: payload?.scope as any,
      limit: payload?.limit,
      imageOnly: payload?.imageOnly,
      bookmark: payload?.bookmark,
    });
  },
);

ipcMain.handle("pinterest:status", async () => {
  return getPinterestStatus();
});

ipcMain.handle(
  "pinterest:download",
  async (_event, payload: { imageUrl: string; filename?: string }) => {
    try {
      const { imageUrl, filename } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const client = new PinterestClient();
      const destDir = join(
        process.env.PINTEREST_TMP_DIR || join(app.getPath("temp"), "pinterest"),
      );
      const filePath = await client.downloadImage(imageUrl, destDir, filename);
      return { ok: true, filePath };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "pinterest:sync",
  async (
    _event,
    payload: {
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    const workspaceDir = store.get("workspaceDirectory", "") as string;
    if (!workspaceDir) {
      return { ok: false, msg: "工作目录未设置" };
    }
    return syncPinterestToMaterialLibrary({
      imageUrl: payload?.imageUrl,
      workspaceDir,
      metadata: payload?.metadata,
    });
  },
);

// Wikimedia Commons 图搜与下载
ipcMain.handle(
  "wikimedia:search",
  async (
    _event,
    payload: {
      keyword: string;
      limit?: number;
      imageOnly?: boolean;
      offset?: number | null;
    },
  ) => {
    return searchWikimedia(payload?.keyword || "", {
      limit: payload?.limit,
      imageOnly: payload?.imageOnly,
      offset: payload?.offset,
    });
  },
);

ipcMain.handle("wikimedia:status", async () => {
  return getWikimediaStatus();
});

ipcMain.handle(
  "wikimedia:download",
  async (_event, payload: { imageUrl: string; filename?: string }) => {
    try {
      const { imageUrl, filename } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const destDir = join(
        process.env.WIKIMEDIA_TMP_DIR || join(app.getPath("temp"), "wikimedia"),
      );
      const filePath = await downloadWikimediaImage(
        imageUrl,
        destDir,
        filename,
      );
      return { ok: true, filePath };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "wikimedia:sync",
  async (
    _event,
    payload: {
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    const workspaceDir = store.get("workspaceDirectory", "") as string;
    if (!workspaceDir) {
      return { ok: false, msg: "工作目录未设置" };
    }
    return syncWikimediaToMaterialLibrary({
      imageUrl: payload?.imageUrl,
      workspaceDir,
      metadata: payload?.metadata,
    });
  },
);

// Pexels 高清摄影图搜与下载
ipcMain.handle(
  "pexels:search",
  async (
    _event,
    payload: {
      keyword: string;
      limit?: number;
      page?: number;
    },
  ) => {
    return searchPexels(payload?.keyword || "", {
      limit: payload?.limit,
      page: payload?.page,
    });
  },
);

ipcMain.handle("pexels:status", async () => {
  return getPexelsStatus();
});

ipcMain.handle(
  "pexels:download",
  async (_event, payload: { imageUrl: string; filename?: string }) => {
    try {
      const { imageUrl, filename } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadPexelsImage(imageUrl, { filename });
      return { ok: res.success, filePath: res.filePath, msg: res.error };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "pexels:sync",
  async (
    _event,
    payload: {
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncPexelsToMaterialLibrary(imageUrl, metadata);
      return { ok: res.success, msg: res.message, data: res.data };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// Rawpixel 免版权艺术图搜与下载
ipcMain.handle(
  "rawpixel:search",
  async (
    _event,
    payload: {
      keyword: string;
      limit?: number;
      page?: number;
      sort?: string;
    },
  ) => {
    return searchRawpixel(payload?.keyword || "", {
      limit: payload?.limit,
      page: payload?.page,
      sort: payload?.sort,
    });
  },
);

ipcMain.handle("rawpixel:status", async () => {
  return getRawpixelStatus();
});

ipcMain.handle(
  "rawpixel:download",
  async (_event, payload: { imageUrl: string; filename?: string }) => {
    try {
      const { imageUrl, filename } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadRawpixelImage(imageUrl, { filename });
      return { ok: res.success, filePath: res.filePath, msg: res.error };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "rawpixel:sync",
  async (
    _event,
    payload: {
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncRawpixelToMaterialLibrary(imageUrl, metadata);
      return { ok: res.success, msg: res.message, data: res.data };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// StockSnap 免版权图搜与下载
ipcMain.handle(
  "stocksnap:search",
  async (
    _event,
    payload: {
      keyword: string;
      limit?: number;
      page?: number;
      sort?: string;
    },
  ) => {
    return searchStockSnap(payload?.keyword || "", {
      limit: payload?.limit,
      page: payload?.page,
      sort: payload?.sort,
    });
  },
);

ipcMain.handle("stocksnap:status", async () => {
  return getStockSnapStatus();
});

ipcMain.handle(
  "stocksnap:download",
  async (_event, payload: { imageUrl: string; filename?: string }) => {
    try {
      const { imageUrl, filename } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadStockSnapImage(imageUrl, { filename });
      return { ok: res.success, filePath: res.filePath, msg: res.error };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "stocksnap:sync",
  async (
    _event,
    payload: {
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncStockSnapToMaterialLibrary(imageUrl, metadata);
      return { ok: res.success, msg: res.message, data: res.data };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "openverse:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
    },
  ) => {
    const { query, page, limit, pageSize } = payload || {};
    return searchOpenverse(query, {
      page: page || 1,
      limit: limit || pageSize || 20,
    });
  },
);

ipcMain.handle("openverse:status", async () => {
  return getOpenverseStatus();
});

ipcMain.handle(
  "openverse:download",
  async (_event, payload: { imageUrl: string; filename?: string }) => {
    try {
      const { imageUrl, filename } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadOpenverseImage(imageUrl, { filename });
      return { ok: res.success, filePath: res.filePath, msg: res.error };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "openverse:sync",
  async (
    _event,
    payload: {
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncOpenverseToMaterialLibrary(imageUrl, metadata);
      return { ok: res.success, msg: res.message, data: res.data };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "kaboompics:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
    },
  ) => {
    const { query, page, limit, pageSize } = payload || {};
    return searchKaboompics(query, {
      page: page || 1,
      limit: limit || pageSize || 20,
    });
  },
);

ipcMain.handle("kaboompics:status", async () => {
  return getKaboompicsStatus();
});

ipcMain.handle(
  "kaboompics:download",
  async (_event, payload: { imageUrl: string; filename?: string }) => {
    try {
      const { imageUrl, filename } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadKaboompicsImage(imageUrl, { filename });
      return { ok: res.success, filePath: res.filePath, msg: res.error };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "kaboompics:sync",
  async (
    _event,
    payload: {
      clientId: string;
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { clientId, imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncKaboompicsToMaterialLibrary(clientId || "local", {
        imageUrl,
        metadata,
      });
      return { ok: res.success, msg: res.error, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "openclipart:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
      formatPreference?: "svg" | "png";
    },
  ) => {
    const { query, page, limit, pageSize, formatPreference } = payload || {};
    return searchOpenclipart(query, {
      page: page || 1,
      limit: limit || pageSize || 20,
      formatPreference,
    });
  },
);

ipcMain.handle("openclipart:status", async () => {
  return getOpenclipartStatus();
});

ipcMain.handle(
  "openclipart:download",
  async (
    _event,
    payload: { imageUrl: string; filename?: string; format?: "svg" | "png" },
  ) => {
    try {
      const { imageUrl, filename, format } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadOpenclipartImage(imageUrl, {
        filename,
        format,
      });
      return {
        ok: res.success,
        filePath: res.filePath,
        filename: res.filename,
        msg: res.error,
      };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "openclipart:sync",
  async (
    _event,
    payload: {
      clientId: string;
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { clientId, imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncOpenclipartToMaterialLibrary(clientId || "local", {
        imageUrl,
        metadata,
      });
      return { ok: res.success, msg: res.error, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "undraw:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
      color?: string;
    },
  ) => {
    const { query, page, limit, pageSize, color } = payload || {};
    return searchUndraw(query, {
      page: page || 1,
      limit: limit || pageSize || 20,
      color,
    });
  },
);

ipcMain.handle("undraw:status", async () => {
  return getUndrawStatus();
});

ipcMain.handle(
  "undraw:download",
  async (
    _event,
    payload: { imageUrl: string; filename?: string; color?: string },
  ) => {
    try {
      const { imageUrl, filename, color } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadUndrawImage(imageUrl, { filename, color });
      return {
        ok: res.success,
        filePath: res.filePath,
        filename: res.filename,
        msg: res.error,
      };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "undraw:sync",
  async (
    _event,
    payload: {
      clientId: string;
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { clientId, imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncUndrawToMaterialLibrary(clientId || "local", {
        imageUrl,
        metadata,
      });
      return { ok: res.success, msg: res.error, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "vecteezy:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
      mediaType?: "photos" | "png" | "vector";
    },
  ) => {
    const { query, page, limit, pageSize, mediaType } = payload || {};
    return searchVecteezy(query, {
      page: page || 1,
      limit: limit || pageSize || 20,
      mediaType,
    });
  },
);

ipcMain.handle("vecteezy:status", async () => {
  return getVecteezyStatus();
});

ipcMain.handle(
  "vecteezy:download",
  async (
    _event,
    payload: {
      imageUrl: string;
      filename?: string;
      format?: "svg" | "png" | "jpg";
    },
  ) => {
    try {
      const { imageUrl, filename, format } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadVecteezyAsset(imageUrl, { filename, format });
      return {
        ok: res.success,
        filePath: res.filePath,
        filename: res.filename,
        msg: res.error,
      };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "vecteezy:sync",
  async (
    _event,
    payload: {
      clientId: string;
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { clientId, imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncVecteezyToMaterialLibrary(clientId || "local", {
        imageUrl,
        metadata,
      });
      return { ok: res.success, msg: res.error, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);
ipcMain.handle(
  "nounproject:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
      mediaType?: "photos" | "icons";
      color?: string;
    },
  ) => {
    const { query, page, limit, pageSize, mediaType, color } = payload || {};
    return searchNounProject(query, {
      page: page || 1,
      limit: limit || pageSize || 20,
      mediaType: mediaType || "icons",
      color,
    });
  },
);

ipcMain.handle("nounproject:status", async () => {
  return getNounProjectStatus();
});

ipcMain.handle(
  "nounproject:download",
  async (
    _event,
    payload: {
      imageUrl: string;
      filename?: string;
      format?: "svg" | "png" | "jpg";
    },
  ) => {
    try {
      const { imageUrl, filename, format } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少素材链接" };
      const res = await downloadNounProjectAsset(imageUrl, {
        filename,
        format,
      });
      return {
        ok: res.success,
        filePath: res.filePath,
        filename: res.filename,
        msg: res.error,
      };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "nounproject:sync",
  async (
    _event,
    payload: {
      clientId: string;
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { clientId, imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少素材链接" };
      const res = await syncNounProjectToMaterialLibrary(clientId || "local", {
        imageUrl,
        metadata,
      });
      return { ok: res.success, msg: res.error, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "iconify:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
      prefix?: string;
      color?: string;
    },
  ) => {
    const { query, page, limit, pageSize, prefix, color } = payload || {};
    return searchIconify(query, {
      page: page || 1,
      limit: limit || pageSize || 20,
      prefix,
      color,
    });
  },
);

ipcMain.handle("iconify:status", async () => {
  return getIconifyStatus();
});

ipcMain.handle(
  "iconify:download",
  async (
    _event,
    payload: { imageUrl: string; filename?: string; color?: string },
  ) => {
    try {
      const { imageUrl, filename, color } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图标链接" };
      const res = await downloadIconifyIcon(imageUrl, { filename, color });
      return {
        ok: res.success,
        filePath: res.filePath,
        filename: res.filename,
        msg: res.error,
      };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "iconify:sync",
  async (
    _event,
    payload: {
      clientId: string;
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { clientId, imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图标链接" };
      const res = await syncIconifyToMaterialLibrary(clientId || "local", {
        imageUrl,
        metadata,
      });
      return { ok: res.success, msg: res.error, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── OpenMoji 开源 Emoji ─────────────────────────────────
ipcMain.handle(
  "openmoji:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
      style?: "color" | "black";
      group?: string;
    },
  ) => {
    const { query, page, limit, pageSize, style, group } = payload || {};
    return searchOpenMoji(query, {
      page: page || 1,
      limit: limit || pageSize || 20,
      style,
      group,
    });
  },
);

ipcMain.handle("openmoji:status", async () => {
  return getOpenMojiStatus();
});

ipcMain.handle(
  "openmoji:download",
  async (
    _event,
    payload: { imageUrl: string; filename?: string; style?: "color" | "black" },
  ) => {
    try {
      const { imageUrl, filename, style } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadOpenMojiEmoji(imageUrl, { filename, style });
      return {
        ok: res.success,
        filePath: res.filePath,
        filename: res.filename,
        msg: res.error,
      };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "openmoji:sync",
  async (
    _event,
    payload: {
      clientId: string;
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { clientId, imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncOpenMojiToMaterialLibrary(clientId || "local", {
        imageUrl,
        metadata,
      });
      return { ok: res.success, msg: res.error, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── Google Material Icons ───────────────────────────────
ipcMain.handle(
  "googleicons:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
      style?: "outlined" | "rounded" | "sharp" | "two-tone";
      size?: number;
    },
  ) => {
    const { query, page, limit, pageSize, style, size } = payload || {};
    return searchGoogleIcons(query, {
      page: page || 1,
      limit: limit || pageSize || 20,
      style,
      size,
    });
  },
);

ipcMain.handle("googleicons:status", async () => {
  return getGoogleIconsStatus();
});

ipcMain.handle(
  "googleicons:download",
  async (
    _event,
    payload: { imageUrl: string; filename?: string; style?: string },
  ) => {
    try {
      const { imageUrl, filename, style } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadGoogleIcon(imageUrl, { filename, style });
      return {
        ok: res.success,
        filePath: res.filePath,
        filename: res.filename,
        msg: res.error,
      };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "googleicons:sync",
  async (
    _event,
    payload: {
      clientId: string;
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { clientId, imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncGoogleIconsToMaterialLibrary(clientId || "local", {
        imageUrl,
        metadata,
      });
      return { ok: res.success, msg: res.error, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── Emojipedia Emoji/Sticker ────────────────────────────
ipcMain.handle(
  "emojipedia:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
      category?: string;
      platform?: string;
    },
  ) => {
    const { query, page, limit, pageSize, category, platform } = payload || {};
    return searchEmojipedia(query, {
      page: page || 1,
      limit: limit || pageSize || 20,
      category,
      platform,
    });
  },
);

ipcMain.handle("emojipedia:status", async () => {
  return getEmojipediaStatus();
});

ipcMain.handle(
  "emojipedia:download",
  async (
    _event,
    payload: { imageUrl: string; filename?: string; platform?: string },
  ) => {
    try {
      const { imageUrl, filename, platform } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await downloadEmojipediaItem(imageUrl, {
        filename,
        platform,
      });
      return {
        ok: res.success,
        filePath: res.filePath,
        filename: res.filename,
        msg: res.error,
      };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "emojipedia:sync",
  async (
    _event,
    payload: {
      clientId: string;
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { clientId, imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少图片链接" };
      const res = await syncEmojipediaToMaterialLibrary(clientId || "local", {
        imageUrl,
        metadata,
      });
      return { ok: res.success, msg: res.error, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ══════════════════════════════════════════════════════
// 新闻数据平台 IPC Handlers (18 platforms)
// ══════════════════════════════════════════════════════

// ─── HN ─────────────────────────────────────
ipcMain.handle("hackernews:search", async (_event, payload: any) => {
  try {
    const result = await searchHN(
      payload["type"] || payload.query || "ai",
      payload.options || {},
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("hackernews:status", async () => {
  return getHNStatus();
});

ipcMain.handle(
  "hackernews:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncHNToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── ArXiv ─────────────────────────────────────
ipcMain.handle(
  "arxiv:search",
  async (_event, payload: { query?: string; options?: any }) => {
    try {
      const result = await searchArxiv(
        payload["query"] || payload.query || "ai",
        payload.options || {},
      );
      return { ok: true, data: result };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle("arxiv:status", async () => {
  return getArxivStatus();
});

ipcMain.handle(
  "arxiv:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncArxivToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── GitHub ─────────────────────────────────────
ipcMain.handle(
  "github:search",
  async (_event, payload: { query?: string; options?: any }) => {
    try {
      const result = await searchGithubRepos(
        payload["query"] || payload.query || "ai",
        payload.options || {},
      );
      return { ok: true, data: result };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle("github:status", async () => {
  return getGithubStatus();
});

ipcMain.handle(
  "github:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncGithubToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── GDELT ─────────────────────────────────────
ipcMain.handle(
  "gdelt:search",
  async (_event, payload: { query?: string; options?: any }) => {
    try {
      const result = await searchGdeltNews(
        payload["query"] || payload.query || "ai",
        payload.options || {},
      );
      return { ok: true, data: result };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle("gdelt:status", async () => {
  return getGdeltStatus();
});

ipcMain.handle(
  "gdelt:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncGdeltToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── Google News ─────────────────────────────────────
ipcMain.handle(
  "googlenews:search",
  async (_event, payload: { query?: string; options?: any }) => {
    try {
      const result = await searchGoogleNews(
        payload["query"] || payload.query || "ai",
        payload.options || {},
      );
      return { ok: true, data: result };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle("googlenews:status", async () => {
  return getGoogleNewsStatus();
});

ipcMain.handle(
  "googlenews:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncGoogleNewsToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── Reddit ─────────────────────────────────────
ipcMain.handle(
  "reddit:search",
  async (_event, payload: { query?: string; options?: any }) => {
    try {
      const result = await searchReddit(
        payload["query"] || payload.query || "ai",
        payload.options || {},
      );
      return { ok: true, data: result };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle("reddit:status", async () => {
  return getRedditStatus();
});

ipcMain.handle(
  "reddit:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncRedditToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── Product Hunt ─────────────────────────────────────
ipcMain.handle("producthunt:search", async (_event, payload: any) => {
  try {
    const result = await searchPH(
      payload["accessToken"] || payload.query || "ai",
      payload.options || {},
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("producthunt:status", async () => {
  return getPHStatus();
});

ipcMain.handle(
  "producthunt:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncPHToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── Guardian ─────────────────────────────────────
ipcMain.handle("theguardian:search", async (_event, payload: any) => {
  try {
    const result = await searchGuardian(
      payload["apiKey"] || payload.query || "ai",
      payload.options || {},
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("theguardian:status", async () => {
  return getGuardianStatus();
});

ipcMain.handle(
  "theguardian:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncGuardianToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── BBC ─────────────────────────────────────
ipcMain.handle("bbcnews:search", async (_event, payload: any) => {
  try {
    const result = await fetchBBC(
      payload?.category || payload?.query || "technology",
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("bbcnews:status", async () => {
  return getBBCStatus();
});

ipcMain.handle(
  "bbcnews:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncBBCToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── NPR ─────────────────────────────────────
ipcMain.handle("npr:search", async (_event, payload: any) => {
  try {
    const result = await fetchNPR(
      payload?.category || payload?.query || "technology",
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("npr:status", async () => {
  return getNPRStatus();
});

ipcMain.handle(
  "npr:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncNPRToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── TechCrunch ─────────────────────────────────────
ipcMain.handle("techcrunch:search", async (_event, payload: any) => {
  try {
    const result = await fetchTC(
      payload?.category || payload?.query || "technology",
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("techcrunch:status", async () => {
  return getTCStatus();
});

ipcMain.handle(
  "techcrunch:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncTCToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── Verge ─────────────────────────────────────
ipcMain.handle("theverge:search", async (_event, payload: any) => {
  try {
    const result = await fetchVerge(
      payload?.category || payload?.query || "technology",
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("theverge:status", async () => {
  return getVergeStatus();
});

ipcMain.handle(
  "theverge:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncVergeToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── Ars Technica ─────────────────────────────────────
ipcMain.handle("arstechnica:search", async (_event, payload: any) => {
  try {
    const result = await fetchArs(
      payload?.category || payload?.query || "technology",
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("arstechnica:status", async () => {
  return getArsStatus();
});

ipcMain.handle(
  "arstechnica:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncArsToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── MIT Tech Review ─────────────────────────────────────
ipcMain.handle("mittechreview:search", async (_event, payload: any) => {
  try {
    const result = await fetchMIT(
      payload?.category || payload?.query || "technology",
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("mittechreview:status", async () => {
  return getMITStatus();
});

ipcMain.handle(
  "mittechreview:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncMITToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── Reuters ─────────────────────────────────────
ipcMain.handle("reuters:search", async (_event, payload: any) => {
  try {
    const result = await fetchReuters(
      payload["category"] || payload.query || "technology",
      payload.options || {},
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("reuters:status", async () => {
  return getReutersStatus();
});

ipcMain.handle(
  "reuters:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncReutersToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── China Daily ─────────────────────────────────────
ipcMain.handle("chinadaily:search", async (_event, payload: any) => {
  try {
    const result = await fetchChinaDaily(
      payload["category"] || payload.query || "technology",
      payload.options || {},
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("chinadaily:status", async () => {
  return getChinaDailyStatus();
});

ipcMain.handle(
  "chinadaily:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncChinaDailyToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── GovCN ─────────────────────────────────────
ipcMain.handle("govcn:search", async (_event, payload: any) => {
  try {
    const result = await fetchGovCN(
      payload?.category || payload?.query || "technology",
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("govcn:status", async () => {
  return getGovCNStatus();
});

ipcMain.handle(
  "govcn:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncGovCNToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── XinhuaNet ─────────────────────────────────────
ipcMain.handle("xinhuanet:search", async (_event, payload: any) => {
  try {
    const result = await fetchXH(
      payload["category"] || payload.query || "technology",
      payload.options || {},
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("xinhuanet:status", async () => {
  return getXHStatus();
});

ipcMain.handle(
  "xinhuanet:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncXHToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── The Paper 澎湃新闻 ─────────────────────────────────────
ipcMain.handle("thepaper:search", async (_event, payload: any) => {
  try {
    const result = await fetchThePaper(
      payload["category"] || payload.query || "all",
    );
    return { ok: true, data: result };
  } catch (error: any) {
    return { ok: false, msg: error?.message || String(error) };
  }
});

ipcMain.handle("thepaper:status", async () => {
  return getThePaperStatus();
});

ipcMain.handle(
  "thepaper:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncThePaperToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── 36Kr ─────────────────────────────────────
ipcMain.handle(
  "36kr:search",
  async (
    _event,
    payload: { category?: string; query?: string; options?: any },
  ) => {
    try {
      const result = await fetch36Kr(payload["category"] || "all", {
        query: payload.query,
        limit: payload.options?.limit || payload.options?.maxCount,
      });
      return { ok: true, data: result };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle("36kr:status", async () => {
  return get36KrStatus();
});

ipcMain.handle(
  "36kr:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await sync36KrToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── Huxiu 虎嗅 ─────────────────────────────────────
ipcMain.handle(
  "huxiu:search",
  async (
    _event,
    payload: { category?: string; query?: string; options?: any },
  ) => {
    try {
      const result = await fetchHuxiu(payload["category"] || "all", {
        query: payload.query,
        limit: payload.options?.limit || payload.options?.maxCount,
      });
      return { ok: true, data: result };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle("huxiu:status", async () => {
  return getHuxiuStatus();
});

ipcMain.handle(
  "huxiu:sync",
  async (_event, payload: { metadata?: Record<string, any> }) => {
    try {
      const res = await syncHuxiuToLibrary("local", {
        metadata: payload?.metadata || {},
      });
      return { ok: res.success, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ─── SVGRepo 50万+开源矢量 ────────────────────────────────
ipcMain.handle(
  "svgrepo:search",
  async (
    _event,
    payload: {
      query: string;
      page?: number;
      limit?: number;
      pageSize?: number;
      style?: any;
    },
  ) => {
    const { query, page, limit, pageSize, style } = payload || {};
    return searchSvgrepo(query, {
      page: page || 1,
      limit: limit || pageSize || 24,
      style,
    });
  },
);

ipcMain.handle("svgrepo:status", async () => {
  return getSvgrepoStatus();
});

ipcMain.handle(
  "svgrepo:download",
  async (_event, payload: { imageUrl: string; filename?: string }) => {
    try {
      const { imageUrl, filename } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少矢量图链接" };
      const res = await downloadSvgrepoImage(imageUrl, { filename });
      return {
        ok: res.success,
        filePath: res.filePath,
        filename: res.filename,
        msg: res.error,
      };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

ipcMain.handle(
  "svgrepo:sync",
  async (
    _event,
    payload: {
      clientId: string;
      imageUrl: string;
      metadata?: Record<string, any>;
    },
  ) => {
    try {
      const { clientId, imageUrl, metadata } = payload || {};
      if (!imageUrl) return { ok: false, msg: "缺少矢量图链接" };
      const res = await syncSvgrepoToMaterialLibrary(clientId || "local", {
        imageUrl,
        metadata,
      });
      return { ok: res.success, msg: res.error, data: res };
    } catch (error: any) {
      return { ok: false, msg: error?.message || String(error) };
    }
  },
);

// ══════════════════════════════════════════════════════
// 工具类 IPC Handlers (8 utilities)
// ══════════════════════════════════════════════════════

// Open-Meteo
ipcMain.handle("openmeteo:search", async (_e, p) => {
  try {
    return { ok: true, data: await searchOpenMeteo(p) };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("openmeteo:status", async () => getOpenMeteoStatus());

// wttr.in
ipcMain.handle("wttr:search", async (_e, p) => {
  try {
    return { ok: true, data: await searchWttr(p.city || "Beijing") };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("wttr:status", async () => getWttrStatus());

// CoinGecko
ipcMain.handle("coingecko:search", async (_e, p) => {
  try {
    return { ok: true, data: await searchCoinGecko(p) };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("coingecko:status", async () => getCoinGeckoStatus());

// Frankfurter
ipcMain.handle("frankfurter:search", async (_e, p) => {
  try {
    return { ok: true, data: await searchFrankfurter(p) };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("frankfurter:status", async () => getFrankfurterStatus());

// Dictionary
ipcMain.handle("dictionary:search", async (_e, p) => {
  try {
    return { ok: true, data: await searchDictionary(p.word || "hello") };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("dictionary:status", async () => getDictionaryStatus());

// Joke
ipcMain.handle("joke:search", async () => {
  try {
    return { ok: true, data: await searchJoke() };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("joke:status", async () => getJokeStatus());

// ipify
ipcMain.handle("ipify:search", async () => {
  try {
    return { ok: true, data: await searchIpify() };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("ipify:status", async () => getIpifyStatus());

// ══════════════════════════════════════════════════════
// 新工具类 IPC Handlers (4 utilities)
// ══════════════════════════════════════════════════════

// Sunrise-Sunset
ipcMain.handle("sunrisesunset:search", async (_e, p) => {
  try {
    return { ok: true, data: await searchSunrise(p) };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("sunrisesunset:status", async () => getSunriseStatus());

// timeapi.io
ipcMain.handle("timeapi:search", async (_e, p) => {
  try {
    return {
      ok: true,
      data: await searchTimeApi(p.timezone || "Asia/Shanghai"),
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("timeapi:status", async () => getTimeApiStatus());

// Zippopotam
ipcMain.handle("zippopotam:search", async (_e, p) => {
  try {
    return {
      ok: true,
      data: await searchZippopotam(p.countryCode || "us", p.zipCode || "90210"),
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("zippopotam:status", async () => getZippopotamStatus());

// country.is
ipcMain.handle("countryis:search", async (_e, p) => {
  try {
    return { ok: true, data: await searchCountryIs(p.ip || "8.8.8.8") };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("countryis:status", async () => getCountryIsStatus());

// 新工具类 IPC Handlers (3 utilities)
ipcMain.handle("erapi:search", async (_e, p) => {
  try {
    return { ok: true, data: await searchErApi(p.base || "USD") };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("erapi:status", async () => getErApiStatus());

ipcMain.handle("fawazahmed:search", async (_e, p) => {
  try {
    return { ok: true, data: await searchFawazahmed(p.base || "usd") };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("fawazahmed:status", async () => getFawazahmedStatus());

ipcMain.handle("colorapi:search", async (_e, p) => {
  try {
    return { ok: true, data: await searchColorApi(p.hex || "24B1E0") };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});
ipcMain.handle("colorapi:status", async () => getColorApiStatus());

// HotSearch
ipcMain.handle("hotsearch:status", async () => {
  const platforms = hotSearchService.getPlatforms();
  return {
    ok: true,
    available: platforms.length > 0,
    connected: true,
    message: `热搜服务可用，共 ${platforms.length} 个平台`,
    platforms,
  };
});
ipcMain.handle("hotsearch:search", async (_e, p) => {
  try {
    const key = p?.key || p?.platform || "";
    const platform = getPlatform(key);
    if (!platform) throw new Error(`平台不存在: ${key}`);
    const result = await hotSearchService.fetchPlatform(platform);
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, msg: e?.message };
  }
});

ipcMain.handle(
  "cos:upload-file",
  async (_event, payload: { filePath: string; key?: string }) => {
    const { filePath, key } = payload || {};
    if (!filePath) {
      return { ok: false, msg: "缺少文件路径" };
    }
    const res = await uploadFileToCos(filePath, key);
    return res;
  },
);

ipcMain.handle(
  "cos:generate-key",
  async (
    _event,
    payload: {
      category: string;
      filename: string;
      account?: string;
      userId?: string | number;
      entityId?: string | number;
      subDirectory?: string;
      isThumbnail?: boolean;
      timestamp?: number;
    },
  ) => {
    try {
      const key = await generateCosKey({
        category: payload.category,
        filename: payload.filename,
        account: payload.account,
        userId: payload.userId,
        entityId: payload.entityId,
        subDirectory: payload.subDirectory,
        isThumbnail: payload.isThumbnail,
        timestamp: payload.timestamp,
      });
      return { ok: true, key };
    } catch (error: any) {
      return { ok: false, msg: error?.message || "生成COS Key失败" };
    }
  },
);

async function handleRendererMaterialUpload(params: {
  url: string;
  name?: string;
  description?: string;
  keywords?: string;
  target?: "sticker" | "crawler-material";
}) {
  if (!mainWindow) {
    return { ok: false, message: "主窗口未初始化" };
  }

  try {
    const result = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const uploadService =
          window.__materialUploadService || window.__crawlerMaterialUploadService;
        if (uploadService) {
          return await uploadService(${JSON.stringify(params)});
        }
        return { ok: false, message: '上传服务未初始化' };
      })()
    `);

    return result;
  } catch (error: any) {
    console.error("素材上传失败:", error);
    return {
      ok: false,
      message: error?.message || "上传失败",
    };
  }
}

// 通用素材上传 - 在 renderer 端执行
ipcMain.handle(
  "material:download-and-upload",
  async (_event, params: Parameters<typeof handleRendererMaterialUpload>[0]) =>
    handleRendererMaterialUpload(params),
);

// 兼容旧命名
ipcMain.handle(
  "crawler-material:download-and-upload",
  async (_event, params: Parameters<typeof handleRendererMaterialUpload>[0]) =>
    handleRendererMaterialUpload(params),
);

ipcMain.handle(
  "read-file-bytes",
  async (_event, payload: { filePath: string; start: number; end: number }) => {
    try {
      const { filePath, start, end } = payload;
      if (!filePath || start < 0 || end <= start) {
        return null;
      }
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const fd = fs.openSync(filePath, "r");
      const bytesToRead = end - start;
      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, start);
      fs.closeSync(fd);

      // Convert Buffer to ArrayBuffer to transfer over IPC
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    } catch (error: any) {
      console.error("读取文件字节失败:", error);
      return null;
    }
  },
);

ipcMain.handle(
  "convert-image-format",
  async (
    _event,
    payload: { sourcePath: string; destPath: string; targetFormat: string },
  ) => {
    try {
      const { sourcePath, destPath, targetFormat } = payload;

      console.log("[convert-image-format] 开始转换:", {
        sourcePath,
        destPath,
        targetFormat,
      });

      if (!sourcePath || !destPath || !targetFormat) {
        console.error("[convert-image-format] 缺少参数");
        return { success: false, error: "缺少必要参数" };
      }

      if (!fs.existsSync(sourcePath)) {
        console.error("[convert-image-format] 源文件不存在:", sourcePath);
        return { success: false, error: "源文件不存在" };
      }

      // 确保目标目录存在
      const destDir = dirname(destPath);
      if (!fs.existsSync(destDir)) {
        console.log("[convert-image-format] 创建目标目录:", destDir);
        fs.mkdirSync(destDir, { recursive: true });
      }

      const absoluteDestPath = resolve(destPath);

      try {
        const sharp = await getSharp();
        let sharpInstance = sharp(sourcePath);

        if (targetFormat === "png") {
          sharpInstance = sharpInstance.png({
            compressionLevel: 6,
            progressive: false,
          });
        } else if (targetFormat === "jpg" || targetFormat === "jpeg") {
          sharpInstance = sharpInstance.jpeg({
            quality: 95,
            progressive: false,
          });
        }

        console.log("[convert-image-format] 尝试使用 sharp 转换...");
        await sharpInstance.toFile(absoluteDestPath);
        console.log("[convert-image-format] sharp 转换成功");
      } catch (saveError: any) {
        console.error("[convert-image-format] sharp 转换失败:", saveError);

        // 降级策略：如果转换失败，尝试直接复制文件
        try {
          console.log("[convert-image-format] 尝试降级策略：直接复制文件...");
          fs.copyFileSync(sourcePath, absoluteDestPath);
          console.log("[convert-image-format] 降级复制成功");
        } catch (copyError: any) {
          console.error("[convert-image-format] 降级复制也失败:", copyError);
          throw new Error(
            `文件保存失败: ${saveError.message}, 且降级复制失败: ${copyError.message}`,
          );
        }
      }

      console.log("[convert-image-format] 文件保存完成，开始验证...");

      // 验证文件是否真的创建成功
      if (!fs.existsSync(absoluteDestPath)) {
        console.error("[convert-image-format] 转换后文件不存在!");
        return { success: false, error: "转换后文件不存在" };
      }

      const destStats = fs.statSync(absoluteDestPath);

      return {
        success: true,
        filePath: absoluteDestPath,
        fileSize: destStats.size,
      };
    } catch (error: any) {
      console.error("[convert-image-format] 转换失败:", error);
      return { success: false, error: error?.message || "格式转换失败" };
    }
  },
);

type ImageLimitPayload = {
  sourcePath: string;
  outputPath?: string;
  workspaceDir?: string;
  maxWidth?: number;
  maxHeight?: number;
  maxBytes?: number;
  format?: "jpeg" | "png" | "webp";
  quality?: number;
  minQuality?: number;
  fit?: "inside" | "cover" | "contain" | "fill";
  position?: string;
  background?: string;
  cacheKey?: string;
  cacheFolder?: string;
};

function detectTargetFormat(
  sourcePath: string,
  preferred?: "jpeg" | "png" | "webp",
) {
  if (preferred) return preferred;
  const lower = String(sourcePath || "").toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";
  return "jpeg";
}

function buildDefaultOutputPath(
  sourcePath: string,
  format: "jpeg" | "png" | "webp",
) {
  const ext = format === "jpeg" ? "jpg" : format;
  const dot = sourcePath.lastIndexOf(".");
  const base = dot > 0 ? sourcePath.slice(0, dot) : sourcePath;
  return `${base}.compressed.${ext}`;
}

function ensureDirectory(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeColor(input?: string) {
  const color = String(input || "").trim();
  return color || "#ffffff";
}

function getWorkspaceDirForImagePayload(payload: ImageLimitPayload) {
  const explicitWorkspaceDir =
    typeof payload.workspaceDir === "string" ? payload.workspaceDir.trim() : "";
  if (explicitWorkspaceDir) {
    return explicitWorkspaceDir;
  }
  const storedWorkspaceDir = store.get("workspaceDirectory", "") as string;
  return typeof storedWorkspaceDir === "string"
    ? storedWorkspaceDir.trim()
    : "";
}

function buildImageProcessSignature(
  payload: ImageLimitPayload,
  sourceStats: fs.Stats,
) {
  const signaturePayload = {
    sourcePath: resolve(payload.sourcePath),
    size: sourceStats.size,
    mtimeMs: Math.floor(sourceStats.mtimeMs),
    maxWidth: payload.maxWidth || null,
    maxHeight: payload.maxHeight || null,
    maxBytes: payload.maxBytes || null,
    format: payload.format || null,
    quality: payload.quality || null,
    minQuality: payload.minQuality || null,
    fit: payload.fit || "inside",
    position: payload.position || "centre",
    background: normalizeColor(payload.background),
    cacheKey: payload.cacheKey || null,
  };

  return createHash("sha1")
    .update(JSON.stringify(signaturePayload))
    .digest("hex");
}

function buildCachedOutputPath(
  payload: ImageLimitPayload,
  format: "jpeg" | "png" | "webp",
  sourceStats: fs.Stats,
) {
  const workspaceDir = getWorkspaceDirForImagePayload(payload);
  if (!workspaceDir) return null;

  const cacheFolder =
    String(payload.cacheFolder || "publish-assets").trim() || "publish-assets";
  const cacheDir = resolve(workspaceDir, "cache", cacheFolder);
  ensureDirectory(cacheDir);

  const ext = format === "jpeg" ? "jpg" : format;
  const signature = buildImageProcessSignature(payload, sourceStats);
  const sourceBaseName =
    basename(payload.sourcePath, extname(payload.sourcePath))
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 48) || "image";

  return resolve(cacheDir, `${sourceBaseName}.${signature}.${ext}`);
}

async function processImageWithLimits(payload: ImageLimitPayload) {
  const { sourcePath, outputPath, maxWidth, maxHeight, maxBytes, format } =
    payload;

  if (!sourcePath || typeof sourcePath !== "string") {
    return { success: false, error: "sourcePath 缺失" };
  }
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: "源文件不存在" };
  }

  const targetFormat = detectTargetFormat(sourcePath, format);
  const sourceStats = fs.statSync(sourcePath);
  const targetPath =
    outputPath ||
    buildCachedOutputPath(payload, targetFormat, sourceStats) ||
    buildDefaultOutputPath(sourcePath, targetFormat);
  const targetDir = dirname(targetPath);
  ensureDirectory(targetDir);
  const sharp = await getSharp();

  if (fs.existsSync(targetPath)) {
    const cachedStats = fs.statSync(targetPath);
    const cachedMeta = await sharp(targetPath)
      .metadata()
      .catch(() => null);
    return {
      success: true,
      filePath: targetPath,
      format: cachedMeta?.format,
      width: cachedMeta?.width,
      height: cachedMeta?.height,
      fileSize: cachedStats.size,
      limitReached: !!maxBytes,
      maxBytes: maxBytes || null,
      underLimit: maxBytes ? cachedStats.size <= maxBytes : true,
      cached: true,
    };
  }

  const initialQuality = Math.max(
    1,
    Math.min(100, Number(payload.quality ?? 85)),
  );
  const minQuality = Math.max(
    1,
    Math.min(initialQuality, Number(payload.minQuality ?? 45)),
  );
  const fit = payload.fit || "inside";
  const position = payload.position || "centre";
  const background = normalizeColor(payload.background);

  let quality = initialQuality;
  let scale = 1;
  let bestBuffer: Buffer | null = null;

  for (let i = 0; i < 12; i++) {
    const targetWidth = maxWidth
      ? Math.max(1, Math.floor(maxWidth * scale))
      : undefined;
    const targetHeight = maxHeight
      ? Math.max(1, Math.floor(maxHeight * scale))
      : undefined;

    let pipeline = sharp(sourcePath).rotate();

    if (targetWidth || targetHeight) {
      pipeline = pipeline.resize(targetWidth, targetHeight, {
        fit,
        position,
        background,
        withoutEnlargement: fit === "inside",
      });
    }

    if (targetFormat === "png") {
      pipeline = pipeline.png({
        compressionLevel: 9,
        palette: true,
        quality: Math.max(quality, 60),
      });
    } else if (targetFormat === "webp") {
      pipeline = pipeline.webp({ quality });
    } else {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true, progressive: true });
    }

    const buffer = await pipeline.toBuffer();
    bestBuffer = buffer;

    if (!maxBytes || buffer.length <= maxBytes) {
      break;
    }

    if (quality > minQuality) {
      quality = Math.max(minQuality, quality - 8);
      continue;
    }

    if (scale > 0.45) {
      scale = Math.max(0.45, Number((scale - 0.1).toFixed(2)));
      continue;
    }

    break;
  }

  if (!bestBuffer) {
    return { success: false, error: "压缩失败：未生成输出内容" };
  }

  fs.writeFileSync(targetPath, bestBuffer);
  const outStats = fs.statSync(targetPath);
  const outMeta = await sharp(bestBuffer).metadata();

  return {
    success: true,
    filePath: targetPath,
    format: outMeta.format,
    width: outMeta.width,
    height: outMeta.height,
    fileSize: outStats.size,
    limitReached: !!maxBytes,
    maxBytes: maxBytes || null,
    underLimit: maxBytes ? outStats.size <= maxBytes : true,
    cached: false,
  };
}

ipcMain.handle(
  "process-image-for-preview",
  async (_event, payload: ImageLimitPayload) => {
    try {
      const result = await processImageWithLimits(payload);
      if (!result?.success || !result.filePath) {
        return result;
      }

      const extension = extname(result.filePath).toLowerCase();
      const mimeType =
        extension === ".png"
          ? "image/png"
          : extension === ".webp"
            ? "image/webp"
            : "image/jpeg";
      const bytes = fs.readFileSync(result.filePath);

      return {
        ...result,
        previewDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
      };
    } catch (error: any) {
      return { success: false, error: error?.message || "生成图片预览失败" };
    }
  },
);

ipcMain.handle(
  "process-image-with-limits",
  async (_event, payload: ImageLimitPayload) => {
    try {
      return await processImageWithLimits(payload);
    } catch (error: any) {
      return { success: false, error: error?.message || "图片处理失败" };
    }
  },
);

ipcMain.handle(
  "process-images-with-limits",
  async (_event, payload: { files: ImageLimitPayload[] }) => {
    try {
      const files = Array.isArray(payload?.files) ? payload.files : [];
      const results = [] as any[];
      for (const item of files) {
        results.push(await processImageWithLimits(item));
      }
      return {
        success: true,
        total: files.length,
        successCount: results.filter((r) => r?.success).length,
        results,
      };
    } catch (error: any) {
      return { success: false, error: error?.message || "批量图片处理失败" };
    }
  },
);

ipcMain.handle(
  "copy-file",
  async (_event, payload: { sourcePath: string; destPath: string }) => {
    try {
      const { sourcePath, destPath } = payload;
      if (!sourcePath || !destPath)
        return { success: false, error: "参数缺失" };

      const destDir = dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      fs.copyFileSync(sourcePath, destPath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
);

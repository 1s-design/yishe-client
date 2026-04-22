import {
  ensureDefaultBrowserProfile,
  getActiveBrowserProfile,
  getBrowserProfile,
  listBrowserProfiles,
  markBrowserProfileUsed,
  switchBrowserProfile,
} from "./BrowserProfileService.js";
import { logger } from "../utils/logger.js";
import {
  buildMissingLocalChromeMessage,
  getPlaywrightChromium,
  getDefaultChromeExecutablePath,
  initBundledPlaywrightEnv,
} from "../utils/playwrightRuntime.js";
import {
  patchContextNewPage,
  withDefaultActivatedPageOptions,
} from "../utils/playwrightPageFactory.js";
import {
  formatBrowserRuntimeTimestamp,
  installBrowserPageRuntime,
  installBrowserPageRuntimeForPage,
  isRuntimeOptionalPageUrl,
  probeBrowserPageRuntime,
} from "../utils/browserPageRuntime.js";
import { spawn, exec } from "child_process";
import { existsSync } from "fs";
import http from "http";
import https from "https";

const sessions = new Map();

function getHeadlessMode() {
  const headlessEnv = process.env.HEADLESS || process.env.BROWSER_HEADLESS;
  if (headlessEnv) {
    return headlessEnv.toLowerCase() === "true" || headlessEnv === "1";
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDebugPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return null;
  }
  return port;
}

function buildCdpEndpoint(port) {
  return `http://127.0.0.1:${port}`;
}

function escapePowerShellSingleQuotedValue(value) {
  return String(value || "").replace(/'/g, "''");
}

function parseRemoteDebuggingPortFromCommandLine(commandLine = "") {
  const match = String(commandLine || "").match(/--remote-debugging-port(?:=|\s+)(\d+)/i);
  const port = Number(match?.[1] || 0);
  return Number.isInteger(port) && port > 0 ? port : null;
}

function normalizeChromeProcessEntries(entries) {
  const items = Array.isArray(entries) ? entries : entries ? [entries] : [];
  return items
    .map((item) => {
      const pid = String(item?.ProcessId || item?.pid || "").trim();
      const commandLine = String(item?.CommandLine || item?.command || "").trim();
      return {
        pid,
        commandLine,
        debugPort: parseRemoteDebuggingPortFromCommandLine(commandLine),
      };
    })
    .filter((item) => !!item.pid);
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout,
  ]);
}

async function setBrowserWindowMaximized(context, headless = false) {
  if (!context || headless) return;

  let page = context.pages()[0];
  const createdPage = !page;
  if (!page) {
    page = await context.newPage();
  }

  try {
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "maximized" },
    });
  } catch (error) {
    logger.warn("设置窗口最大化失败（可忽略）:", error?.message || error);
  } finally {
    if (createdPage && page) {
      await page.close().catch(() => {});
    }
  }
}

function createEmptyStatus() {
  return {
    isInitialized: false,
    isConnected: false,
    lastActivity: null,
    pageCount: 0,
  };
}

function resolveProfile(profileId) {
  const normalizedProfileId = String(profileId || "").trim();
  if (normalizedProfileId) {
    const profile = getBrowserProfile(normalizedProfileId);
    if (!profile) {
      throw new Error(`指定环境不存在: ${normalizedProfileId}`);
    }
    return profile;
  }

  const activeProfile = getActiveBrowserProfile() || ensureDefaultBrowserProfile();
  if (!activeProfile) {
    throw new Error("未找到可用执行环境");
  }
  return activeProfile;
}

function getSession(profileId, create = false) {
  const normalizedProfileId = String(profileId || "").trim();
  if (!normalizedProfileId) {
    return null;
  }
  if (!sessions.has(normalizedProfileId) && create) {
    const profile = getBrowserProfile(normalizedProfileId);
    const debugPort = normalizeDebugPort(profile?.debugPort);
    sessions.set(normalizedProfileId, {
      profileId: normalizedProfileId,
      profileName: profile?.name || normalizedProfileId,
      userDataDir: profile?.userDataDir || null,
      debugPort,
      cdpEndpoint: debugPort ? buildCdpEndpoint(debugPort) : null,
      chromePid: null,
      browserInstance: null,
      contextInstance: null,
      connectPromise: null,
      lastConnectError: null,
      browserVersion: null,
      currentBrowserOptions: {},
      browserStatus: createEmptyStatus(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return sessions.get(normalizedProfileId) || null;
}

function wrapBrowserHandle(profileId) {
  return {
    profileId,
    newPage: async (pageOptions = {}) => createProfileBrowserPage(profileId, pageOptions),
  };
}

function buildProfileRuntimePayload(profile) {
  const session = getSession(profile?.id);
  const openedAtText = formatBrowserRuntimeTimestamp(session?.createdAt || session?.updatedAt || "");
  return {
    profileId: String(profile?.id || "").trim() || "default",
    profileName: String(profile?.name || profile?.id || "").trim() || "default",
    openedAtText,
  };
}

function resolveSessionDebugPort(session, profile) {
  const profileDebugPort = normalizeDebugPort(profile?.debugPort);
  const sessionDebugPort = normalizeDebugPort(session?.debugPort);
  const sessionOwnsRuntime = !!(
    session?.connectPromise ||
    session?.browserInstance ||
    session?.contextInstance ||
    session?.browserStatus?.isConnected
  );

  if (sessionOwnsRuntime && sessionDebugPort) {
    return sessionDebugPort;
  }

  return profileDebugPort || sessionDebugPort;
}

function execCommand(command, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr ? String(stderr).trim() : error.message;
        reject(new Error(message || error.message));
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

async function checkCdpEndpointAvailable(endpoint) {
  try {
    const targetUrl = new URL("/json/version", endpoint);
    const client = targetUrl.protocol === "https:" ? https : http;
    return await new Promise((resolve) => {
      const req = client.get(targetUrl, { timeout: 3000 }, (resp) => {
        let data = "";
        resp.on("data", (chunk) => {
          data += chunk;
        });
        resp.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve({
              ok: true,
              endpoint,
              browser: json.Browser || json.browser || "",
            });
          } catch {
            resolve({
              ok: true,
              endpoint,
              browser: "",
            });
          }
        });
      });
      req.on("error", (error) => resolve({ ok: false, endpoint, error: error?.message || "连接失败" }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, endpoint, error: "连接超时" });
      });
    });
  } catch (error) {
    return {
      ok: false,
      endpoint,
      error: error?.message || "检测 CDP 端点失败",
    };
  }
}

async function getListeningPids(port) {
  const safePort = normalizeDebugPort(port);
  if (!safePort) {
    return [];
  }

  const pids = new Set();
  if (process.platform === "win32") {
    let output = "";
    try {
      output = await execCommand(`netstat -ano -p tcp | findstr :${safePort}`);
    } catch {
      return [];
    }

    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.includes(`:${safePort}`) || !/\bLISTENING\b/i.test(line)) {
        continue;
      }

      const parts = line.split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) {
        pids.add(pid);
      }
    }
    return Array.from(pids);
  }

  try {
    const output = await execCommand(`lsof -nP -iTCP:${safePort} -sTCP:LISTEN -t`);
    output.split(/\s+/).filter(Boolean).forEach((pid) => pids.add(pid));
    return Array.from(pids);
  } catch {
    return [];
  }
}

async function getChromeProcessesByUserDataDir(userDataDir) {
  const safeUserDataDir = String(userDataDir || "").trim();
  if (!safeUserDataDir) {
    return [];
  }

  if (process.platform === "win32") {
    const needle = escapePowerShellSingleQuotedValue(safeUserDataDir.toLowerCase());
    const command =
      `powershell -NoProfile -Command "$needle='${needle}'; ` +
      `$items=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($needle) } | Select-Object ProcessId,CommandLine); ` +
      `if ($items.Count -gt 0) { $items | ConvertTo-Json -Compress }"`;
    try {
      const output = await execCommand(command, 15000);
      if (!output) {
        return [];
      }
      return normalizeChromeProcessEntries(JSON.parse(output));
    } catch {
      return [];
    }
  }

  const escapedNeedle = safeUserDataDir.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  try {
    const output = await execCommand(
      `ps -ax -o pid=,command= | grep -F "${escapedNeedle}" | grep -F "chrome" | grep -v grep`,
      15000,
    );
    if (!output) {
      return [];
    }
    const items = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.+)$/);
        return match
          ? {
              pid: match[1],
              command: match[2],
            }
          : null;
      })
      .filter(Boolean);
    return normalizeChromeProcessEntries(items);
  } catch {
    return [];
  }
}

async function killChromeProcessesByUserDataDir(userDataDir, { excludePids = [] } = {}) {
  const excludedPidSet = new Set(
    (Array.isArray(excludePids) ? excludePids : [])
      .map((pid) => String(pid || "").trim())
      .filter(Boolean),
  );
  const matched = await getChromeProcessesByUserDataDir(userDataDir);
  const targetPids = matched
    .map((item) => item.pid)
    .filter((pid) => pid && !excludedPidSet.has(pid));

  if (!targetPids.length) {
    return {
      matched,
      killed: [],
      errors: [],
    };
  }

  const result = await killPids(targetPids);
  return {
    matched,
    killed: result.killed,
    errors: result.errors,
  };
}

async function resolveListeningPid(port) {
  const pids = await getListeningPids(port);
  return pids[0] || null;
}

async function killPids(pids = []) {
  const uniquePids = Array.from(new Set(pids.map((pid) => String(pid || "").trim()).filter(Boolean)));
  const killed = [];
  const errors = [];

  for (const pid of uniquePids) {
    try {
      if (process.platform === "win32") {
        await execCommand(`taskkill /PID ${pid} /T /F`);
      } else {
        await execCommand(`kill -9 ${pid}`);
      }
      killed.push(pid);
    } catch (error) {
      errors.push({ pid, error: error?.message || String(error) });
    }
  }

  return { killed, errors };
}

async function killPortProcesses(port) {
  const pids = await getListeningPids(port);
  if (!pids.length) {
    return { killed: [], errors: [] };
  }
  return killPids(pids);
}

function buildChromeLaunchArgs({ port, headless = false, userDataDir }) {
  return [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    ...(headless ? ["--headless=new"] : ["--start-maximized"]),
  ];
}

function launchChromeWithDebugPort({ port, headless = false, userDataDir, executablePath }) {
  const safePort = normalizeDebugPort(port);
  const safeUserDataDir = String(userDataDir || "").trim();
  const safeExecutablePath = String(executablePath || "").trim();

  if (!safePort) {
    throw new Error(`无效的调试端口: ${port}`);
  }
  if (!safeUserDataDir) {
    throw new Error("缺少 userDataDir");
  }
  if (!safeExecutablePath) {
    throw new Error(buildMissingLocalChromeMessage());
  }
  if (!existsSync(safeExecutablePath)) {
    throw new Error(
      `缺少本地浏览器：指定的浏览器路径不存在 (${safeExecutablePath})。请安装本地 Chrome/Chromium，或设置 YISHE_BROWSER_EXECUTABLE。`,
    );
  }

  const child = spawn(
    safeExecutablePath,
    buildChromeLaunchArgs({ port: safePort, headless, userDataDir: safeUserDataDir }),
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();

  logger.info(
    `已为环境启动 Chrome: port=${safePort}, pid=${child.pid || "unknown"}, userDataDir=${safeUserDataDir}`,
  );
  return {
    pid: child.pid || null,
    port: safePort,
    userDataDir: safeUserDataDir,
    headless,
  };
}

function resolveSessionBrowserVersion(session) {
  try {
    if (session?.browserInstance && typeof session.browserInstance.version === "function") {
      return session.browserInstance.version() || null;
    }
  } catch {
    // ignore
  }

  try {
    if (session?.contextInstance && typeof session.contextInstance.browser === "function") {
      const browser = session.contextInstance.browser();
      if (browser && typeof browser.version === "function") {
        return browser.version() || null;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

async function getSessionPages(session) {
  if (!session?.contextInstance) {
    return [];
  }

  const probeTimeoutMs = 1500;
  const runtimePayload = buildProfileRuntimePayload({
    id: session.profileId,
    name: session.profileName,
  });
  const pages = session.contextInstance.pages().filter((page) => {
    try {
      return page && !(typeof page.isClosed === "function" && page.isClosed());
    } catch {
      return false;
    }
  });

  const results = await Promise.all(
    pages.map(async (page, index) => {
      let runtimeInfo = null;
      let title = "";
      let url = "";
      let isActive = index === 0;
      try {
        runtimeInfo = await withTimeout(
          probeBrowserPageRuntime(page, runtimePayload),
          probeTimeoutMs,
          "page.runtimeProbe",
        )
          .catch(() => null);
      } catch {
        // ignore
      }

      title = String(runtimeInfo?.title || "").trim();
      url = String(runtimeInfo?.url || "").trim();

      if (!title) {
        title = await withTimeout(page.title().catch(() => ""), probeTimeoutMs, "page.title").catch(() => "");
      }
      if (!url) {
        try {
          url = page.url();
        } catch {
          // ignore
        }
      }

      isActive = runtimeInfo
        ? runtimeInfo.visibilityState === "visible" || runtimeInfo.hasFocus === true
        : index === 0;

      return {
        id: `${session.profileId || "default"}-page-${index}`,
        index,
        pageIndex: index,
        title: title || `页面 ${index}`,
        url: url || "",
        type: "page",
        isActive,
        profileId: session.profileId,
        profileName: session.profileName,
        hasFocus: !!runtimeInfo?.hasFocus,
        visibilityState: String(runtimeInfo?.visibilityState || "unknown"),
        runtimeReachable: !!runtimeInfo,
        isPlaceholderPage: isRuntimeOptionalPageUrl(url),
        lastHeartbeatAt: Number(runtimeInfo?.lastHeartbeatAt || 0),
        lastProbeAt: Number(runtimeInfo?.lastProbeAt || 0),
        updatedAt: Number(runtimeInfo?.updatedAt || 0),
      };
    }),
  );

  return results;
}

async function probeSessionConnectedLightweight(session) {
  if (!session?.browserInstance || !session?.contextInstance) {
    return false;
  }

  try {
    if (typeof session.browserInstance.isConnected === "function" && !session.browserInstance.isConnected()) {
      return false;
    }

    const pages = session.contextInstance.pages().filter((page) => {
      try {
        return page && !(typeof page.isClosed === "function" && page.isClosed());
      } catch {
        return false;
      }
    });

    session.browserStatus.pageCount = pages.length;
    if (!pages.length) {
      session.browserStatus.isConnected = true;
      return true;
    }

    const runtimePayload = buildProfileRuntimePayload({
      id: session.profileId,
      name: session.profileName,
    });

    let hasRequiredRuntimePage = false;
    for (const page of pages.slice(0, 3)) {
      const runtimeInfo = await withTimeout(
        probeBrowserPageRuntime(page, runtimePayload),
        900,
        "page.runtimeLightweight",
      ).catch(() => null);

      if (runtimeInfo) {
        session.browserStatus.isConnected = true;
        session.browserStatus.lastActivity = Date.now();
        return true;
      }

      let candidateUrl = "";
      try {
        candidateUrl = page.url();
      } catch {
        // ignore
      }
      if (!isRuntimeOptionalPageUrl(candidateUrl)) {
        hasRequiredRuntimePage = true;
      }
    }

    if (!hasRequiredRuntimePage) {
      session.browserStatus.isConnected = true;
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

async function isSessionAvailable(session) {
  if (!session?.browserInstance || !session?.contextInstance) {
    return false;
  }

  try {
    if (typeof session.browserInstance.isConnected === "function" && !session.browserInstance.isConnected()) {
      throw new Error("浏览器连接已断开");
    }

    const pages = await getSessionPages(session);
    const hasReachableRuntime = pages.some((page) => page.runtimeReachable);
    const hasOnlyOptionalPages = pages.length > 0 && pages.every((page) => page.isPlaceholderPage);
    if (pages.length > 0 && !hasReachableRuntime && !hasOnlyOptionalPages) {
      throw new Error("页面运行时探活失败");
    }

    session.browserStatus.isInitialized = true;
    session.browserStatus.isConnected = true;
    session.browserStatus.pageCount = pages.length;
    session.browserStatus.lastActivity = Date.now();
    session.updatedAt = new Date().toISOString();
    return true;
  } catch (error) {
    session.browserStatus.isConnected = false;
    session.browserStatus.pageCount = 0;
    session.browserInstance = null;
    session.contextInstance = null;
    session.chromePid = null;
    session.lastConnectError = error?.message || String(error);
    session.updatedAt = new Date().toISOString();
    return false;
  }
}

function shouldReconnectSession(session, nextOptions = {}) {
  const current = session?.currentBrowserOptions || {};
  return (
    String(current.mode || "") !== String(nextOptions.mode || "") ||
    String(current.userDataDir || "") !== String(nextOptions.userDataDir || "") ||
    String(current.chromeExecutablePath || "") !== String(nextOptions.chromeExecutablePath || "") ||
    Number(current.debugPort || 0) !== Number(nextOptions.debugPort || 0) ||
    String(current.cdpEndpoint || "") !== String(nextOptions.cdpEndpoint || "") ||
    Boolean(current.headless) !== Boolean(nextOptions.headless)
  );
}

async function focusSessionWindow(session) {
  if (!session?.contextInstance) {
    throw new Error("浏览器上下文不可用");
  }

  const pages = await getSessionPages(session);
  if (!pages.length) {
    throw new Error("当前环境暂无可聚焦页面");
  }

  const pageEntry =
    pages.find((item) => item.isActive) ||
    pages.find((item) => item.index === 0) ||
    pages[0] ||
    null;
  const page = pageEntry ? await getManagedProfileBrowserPage(session.profileId, pageEntry.index) : null;
  if (!page) {
    throw new Error("未找到可聚焦页面");
  }

  try {
    const cdp = await session.contextInstance.newCDPSession(page);
    const windowStateResponse = await cdp.send("Browser.getWindowForTarget").catch(() => null);
    const windowId = windowStateResponse?.windowId;
    const currentWindowState = String(windowStateResponse?.bounds?.windowState || "").trim();
    if (windowId && (currentWindowState === "minimized" || currentWindowState === "hidden")) {
      await cdp
        .send("Browser.setWindowBounds", {
          windowId,
          bounds: { windowState: "normal" },
        })
        .catch(() => null);
    }
  } catch (error) {
    logger.warn("恢复浏览器窗口状态失败（可忽略）:", error?.message || error);
  }

  await page.bringToFront().catch(() => {});
  await page
    .evaluate(() => {
      try {
        window.focus();
      } catch {
        // ignore
      }
    })
    .catch(() => {});

  session.browserStatus.lastActivity = Date.now();
  session.browserStatus.pageCount = session.contextInstance.pages().length;
  session.updatedAt = new Date().toISOString();

  return {
    focused: true,
    profileId: session.profileId,
    profileName: session.profileName,
    pageIndex: pageEntry?.index ?? 0,
    pageTitle: pageEntry?.title || "",
    pageUrl: pageEntry?.url || "",
    debugPort: session.debugPort || null,
  };
}

function resetSession(session, { preserveError = false } = {}) {
  if (!session) return;

  session.browserInstance = null;
  session.contextInstance = null;
  session.chromePid = null;
  session.connectPromise = null;
  session.browserStatus = createEmptyStatus();
  session.browserVersion = null;
  if (!preserveError) {
    session.lastConnectError = null;
  }
  session.updatedAt = new Date().toISOString();
}

async function closeSession(session, { preserveError = false, killProcess = true } = {}) {
  if (!session) return;

  const browserInstance = session.browserInstance;
  const chromePid = session.chromePid;
  const debugPort = session.debugPort;

  try {
    if (browserInstance) {
      try {
        await browserInstance.close();
      } catch {
        try {
          browserInstance.disconnect?.();
        } catch {
          // ignore
        }
      }
    }
  } finally {
    if (killProcess) {
      if (chromePid) {
        await killPids([chromePid]).catch(() => {});
      } else if (debugPort && (browserInstance || session.contextInstance)) {
        await killPortProcesses(debugPort).catch(() => {});
      }
    }
    resetSession(session, { preserveError });
  }
}

export function hasManagedProfileBrowser(profileId) {
  const session = getSession(profileId);
  return !!(session?.browserInstance || session?.contextInstance || session?.connectPromise);
}

export async function getOrCreateManagedProfileBrowser(options = {}) {
  const profile = resolveProfile(options.profileId);
  const session = getSession(profile.id, true);
  const headless = typeof options.headless === "boolean" ? options.headless : getHeadlessMode();
  const allowLaunch = options.allowLaunch !== false;
  const skipWindowMaximize = options.skipWindowMaximize === true;
  const executablePath = String(
    options.chromeExecutablePath || process.env.CHROME_EXECUTABLE_PATH || getDefaultChromeExecutablePath(),
  ).trim();
  const debugPort = normalizeDebugPort(options.port || options.debugPort || profile.debugPort);
  if (!debugPort) {
    throw new Error(`环境 ${profile.id} 未配置可用的浏览器调试端口`);
  }

  const cdpEndpoint = String(options.cdpEndpoint || buildCdpEndpoint(debugPort)).trim();
  const nextOptions = {
    mode: "cdp",
    profileId: profile.id,
    headless,
    chromeExecutablePath: executablePath,
    userDataDir: profile.userDataDir,
    debugPort,
    cdpEndpoint,
  };

  session.profileName = profile.name || profile.id;
  session.userDataDir = profile.userDataDir;
  session.debugPort = debugPort;
  session.cdpEndpoint = cdpEndpoint;

  if (session.connectPromise) {
    await session.connectPromise;
    return wrapBrowserHandle(profile.id);
  }

  if ((session.browserInstance || session.contextInstance || session.connectPromise) && shouldReconnectSession(session, nextOptions)) {
    await closeSession(session);
  }

  session.currentBrowserOptions = nextOptions;

  if (await isSessionAvailable(session)) {
    patchContextNewPage(session.contextInstance, {
      background: true,
      headless,
    });
    await installBrowserPageRuntime(session.contextInstance, () => buildProfileRuntimePayload(getBrowserProfile(profile.id) || profile), {
      logger,
      logLabel: "安装浏览器页面运行时失败:",
    });
    return wrapBrowserHandle(profile.id);
  }

  if (session.browserInstance || session.contextInstance) {
    await closeSession(session);
  }

  session.lastConnectError = null;
  session.connectPromise = (async () => {
    initBundledPlaywrightEnv();
    const chromium = await getPlaywrightChromium();
    let launchedNewBrowser = false;

    try {
      switchBrowserProfile(profile.id);

      const existingEndpoint = await checkCdpEndpointAvailable(cdpEndpoint);
      if (!existingEndpoint.ok) {
        if (!allowLaunch) {
          throw new Error(`当前环境浏览器未启动，静默采集不会自动拉起新窗口。请先打开该执行环境后再重试。`);
        }
        const staleProcessCleanup = await killChromeProcessesByUserDataDir(profile.userDataDir, {
          excludePids: session.chromePid ? [session.chromePid] : [],
        }).catch(() => null);
        if (staleProcessCleanup?.killed?.length) {
          const stalePorts = Array.from(
            new Set(
              (staleProcessCleanup.matched || [])
                .map((item) => item.debugPort)
                .filter((port) => Number.isInteger(port) && port > 0),
            ),
          );
          logger.warn(
            `检测到环境 ${profile.id} 存在旧浏览器进程占用环境目录，已清理 pids=${staleProcessCleanup.killed.join(",")}${
              stalePorts.length ? `, legacyPorts=${stalePorts.join(",")}` : ""
            }`,
          );
          await sleep(1200);
        }

        launchedNewBrowser = true;
        const launched = launchChromeWithDebugPort({
          port: debugPort,
          headless,
          userDataDir: profile.userDataDir,
          executablePath,
        });
        session.chromePid = launched.pid || null;

        const maxChecks = 15;
        let ready = false;
        for (let index = 0; index < maxChecks; index += 1) {
          const status = await checkCdpEndpointAvailable(cdpEndpoint);
          if (status.ok) {
            ready = true;
            break;
          }
          await sleep(1000);
        }

        if (!ready) {
          const legacyProcesses = await getChromeProcessesByUserDataDir(profile.userDataDir).catch(() => []);
          const legacyPorts = Array.from(
            new Set(
              legacyProcesses
                .map((item) => item.debugPort)
                .filter((port) => Number.isInteger(port) && port > 0),
            ),
          );
          throw new Error(
            `Chrome 调试端口未就绪: ${cdpEndpoint}${
              legacyPorts.length ? `，检测到同环境目录进程端口: ${legacyPorts.join(",")}` : ""
            }`,
          );
        }
      }

      const maxRetries = 10;
      let lastError = null;
      for (let index = 0; index < maxRetries; index += 1) {
        try {
          session.browserInstance = await withTimeout(
            chromium.connectOverCDP(cdpEndpoint),
            15000,
            "connectOverCDP",
          );
          break;
        } catch (error) {
          lastError = error;
          if (index < maxRetries - 1) {
            await sleep(1200);
          }
        }
      }

      if (!session.browserInstance) {
        throw new Error(lastError?.message || `无法连接到 Chrome 调试端口: ${cdpEndpoint}`);
      }

      session.contextInstance = session.browserInstance.contexts()[0] || null;
      if (!session.contextInstance) {
        session.contextInstance = await session.browserInstance.newContext(
          headless ? { viewport: { width: 1920, height: 1080 } } : { viewport: null },
        );
      }

      session.chromePid = session.chromePid || (await resolveListeningPid(debugPort));
      patchContextNewPage(session.contextInstance, {
        background: true,
        headless,
      });
      if (!skipWindowMaximize) {
        await setBrowserWindowMaximized(session.contextInstance, headless);
      }
      await installBrowserPageRuntime(session.contextInstance, () => buildProfileRuntimePayload(getBrowserProfile(profile.id) || profile), {
        logger,
        logLabel: "安装浏览器页面运行时失败:",
      });
      session.browserStatus.isInitialized = true;
      session.browserStatus.isConnected = true;
      session.browserStatus.lastActivity = Date.now();
      session.browserStatus.pageCount = (await getSessionPages(session)).length;
      session.browserVersion = resolveSessionBrowserVersion(session);
      session.updatedAt = new Date().toISOString();
      markBrowserProfileUsed(profile.id, {
        browserVersion: session.browserVersion || "",
        lastUsedAt: session.updatedAt,
        debugPort,
      });
    } catch (error) {
      session.lastConnectError = error?.message || String(error);
      await closeSession(session, {
        preserveError: true,
        killProcess: launchedNewBrowser || !!session.chromePid,
      });
      throw new Error(
        `启动本地 Chrome 并连接环境失败。请确认目标机器已安装 Chrome，环境目录可写，且端口 ${debugPort} 未被其他程序占用。原错误: ${
          error?.message || error
        }`,
      );
    } finally {
      session.connectPromise = null;
    }
  })();

  await session.connectPromise;
  return wrapBrowserHandle(profile.id);
}

export async function getOrCreateManagedProfileBrowserContext(options = {}) {
  const profile = resolveProfile(options.profileId);
  await getOrCreateManagedProfileBrowser({ ...options, profileId: profile.id });
  const session = getSession(profile.id);
  if (!session?.contextInstance) {
    throw new Error("浏览器上下文不可用");
  }
  return session.contextInstance;
}

export async function isManagedProfileBrowserAvailable(profileId) {
  const targetProfileId = resolveProfile(profileId).id;
  const session = getSession(targetProfileId);
  if (!session) {
    return false;
  }
  return isSessionAvailable(session);
}

export async function listManagedProfileBrowserPages(profileId) {
  const targetProfile = resolveProfile(profileId);
  const session = getSession(targetProfile.id);
  if (!session || !(await isSessionAvailable(session))) {
    return [];
  }
  return getSessionPages(session);
}

export async function getManagedProfileBrowserPage(profileId, pageIndex = 0) {
  const targetProfile = resolveProfile(profileId);
  await getOrCreateManagedProfileBrowser({ profileId: targetProfile.id });
  const session = getSession(targetProfile.id);
  const pages = session?.contextInstance?.pages() || [];
  if (!pages.length) {
    return createProfileBrowserPage(targetProfile.id);
  }
  const index = Number.isInteger(pageIndex) ? pageIndex : 0;
  if (index < 0 || index >= pages.length) {
    throw new Error(`页面索引无效: ${pageIndex}`);
  }
  return pages[index];
}

export async function createProfileBrowserPage(profileId, pageOptions = {}) {
  const targetProfile = resolveProfile(profileId);
  await getOrCreateManagedProfileBrowser({ profileId: targetProfile.id });
  const session = getSession(targetProfile.id);
  if (!session?.contextInstance) {
    throw new Error("浏览器上下文不可用");
  }
  const finalPageOptions = withDefaultActivatedPageOptions(pageOptions);
  const page = await session.contextInstance.newPage(finalPageOptions);
  await installBrowserPageRuntimeForPage(page, buildProfileRuntimePayload(targetProfile));
  session.browserStatus.lastActivity = Date.now();
  session.browserStatus.pageCount = session.contextInstance.pages().length;
  session.updatedAt = new Date().toISOString();
  return page;
}

export function updateManagedProfileBrowserActivity(profileId) {
  const targetProfile = resolveProfile(profileId);
  const session = getSession(targetProfile.id);
  if (!session) {
    return;
  }
  session.browserStatus.lastActivity = Date.now();
  session.updatedAt = new Date().toISOString();
}

function buildInstanceSummary(profile, session, pages = []) {
  const hasInstance = !!session?.browserInstance || !!session?.contextInstance || !!session?.connectPromise;
  const lastActivityValue = session?.browserStatus?.lastActivity || null;
  const debugPort = resolveSessionDebugPort(session, profile);
  const cdpEndpoint = session?.cdpEndpoint || (debugPort ? buildCdpEndpoint(debugPort) : null);
  return {
    profileId: profile.id,
    profileName: profile.name || profile.id,
    userDataDir: profile.userDataDir,
    debugPort,
    cdpEndpoint,
    chromePid: session?.chromePid || null,
    hasInstance,
    isConnected: !!session?.browserStatus?.isConnected,
    connecting: !!session?.connectPromise,
    pageCount:
      typeof session?.browserStatus?.pageCount === "number"
        ? session.browserStatus.pageCount
        : pages.length,
    lastActivity:
      typeof lastActivityValue === "number"
        ? new Date(lastActivityValue).toISOString()
        : lastActivityValue,
    lastError: session?.lastConnectError || null,
    browserVersion: session?.browserVersion || profile.browserVersion || "",
    connection: {
      mode: "cdp",
      browserName: "chrome",
      browserVersion: session?.browserVersion || profile.browserVersion || "",
      userDataDir: profile.userDataDir,
      profileId: profile.id,
      debugPort,
      cdpEndpoint,
      chromePid: session?.chromePid || null,
      activeProfileId: listBrowserProfiles().activeProfileId || null,
      activeProfile: getActiveBrowserProfile() || null,
    },
    pages,
    updatedAt: session?.updatedAt || profile.updatedAt || null,
    isActiveProfile: profile.isActive === true,
  };
}

function isSessionConnectedLightweight(session) {
  return !!session?.browserStatus?.isConnected || !!session?.connectPromise;
}

export async function getManagedProfileBrowserStatus(options = {}) {
  const profileState = listBrowserProfiles();
  const profiles = Array.isArray(profileState.items) ? profileState.items : [];
  const normalizedProfileId = String(options.profileId || "").trim();
  const includePages = options.includePages === true;
  const lightweight = options.lightweight === true || options.includePages === false;

  if (normalizedProfileId) {
    const profile = getBrowserProfile(normalizedProfileId);
    if (!profile) {
      throw new Error(`指定环境不存在: ${normalizedProfileId}`);
    }
    const session = getSession(normalizedProfileId);
    const sessionAvailable = session
      ? lightweight
        ? await probeSessionConnectedLightweight(session)
        : await isSessionAvailable(session)
      : false;
    if (session && !sessionAvailable) {
      session.browserStatus.isConnected = false;
      if (!session.connectPromise) {
        session.browserStatus.pageCount = 0;
      }
    }
    const pages =
      includePages && session && sessionAvailable ? await getSessionPages(session) : [];
    const instance = buildInstanceSummary(profile, session, pages);
    return {
      ...instance,
      profiles,
      instances: [instance],
      pages: includePages ? pages : [],
      pageCount: Number(instance.pageCount || 0),
      timestamp: new Date().toISOString(),
    };
  }

  const instanceEntries = [];
  for (const profile of profiles) {
    const session = getSession(profile.id);
    const sessionAvailable = session
      ? lightweight
        ? isSessionConnectedLightweight(session)
        : await isSessionAvailable(session)
      : false;
    if (session && !sessionAvailable) {
      session.browserStatus.isConnected = false;
      if (!session.connectPromise) {
        session.browserStatus.pageCount = 0;
      }
    }
    const pages =
      includePages && session && sessionAvailable ? await getSessionPages(session) : [];
    instanceEntries.push(buildInstanceSummary(profile, session, pages));
  }

  const connectedInstances = instanceEntries.filter((item) => item.isConnected);
  const primaryInstance =
    instanceEntries.find((item) => item.profileId === profileState.activeProfileId) ||
    connectedInstances[0] ||
    instanceEntries[0] ||
    null;
  const allPages = instanceEntries.flatMap((item) => item.pages || []);
  const totalPageCount = instanceEntries.reduce(
    (sum, item) => sum + Number(item?.pageCount || 0),
    0,
  );
  const lastActivity = instanceEntries
    .map((item) => item.lastActivity)
    .filter(Boolean)
    .sort()
    .reverse()[0] || null;

  return {
    hasInstance: instanceEntries.some((item) => item.hasInstance),
    isConnected: connectedInstances.length > 0,
    pageCount: totalPageCount,
    lastActivity,
    lastError:
      instanceEntries.find((item) => item.lastError)?.lastError || null,
    connection: primaryInstance?.connection || {
      mode: "cdp",
      browserName: "chrome",
      browserVersion: "",
      userDataDir: null,
      profileId: null,
      debugPort: null,
      cdpEndpoint: null,
      chromePid: null,
      activeProfileId: profileState.activeProfileId || null,
      activeProfile: getActiveBrowserProfile() || null,
    },
    pages: includePages ? allPages : [],
    profiles,
    instances: instanceEntries,
    timestamp: new Date().toISOString(),
  };
}

export async function closeManagedProfileBrowser(profileId) {
  const normalizedProfileId = String(profileId || "").trim();
  if (normalizedProfileId) {
    const session = getSession(normalizedProfileId);
    if (session) {
      await closeSession(session);
    }
    return;
  }

  for (const session of sessions.values()) {
    await closeSession(session);
  }
}

export function forgetManagedProfileBrowserSession(profileId) {
  const normalizedProfileId = String(profileId || "").trim();
  if (!normalizedProfileId) {
    return false;
  }

  return sessions.delete(normalizedProfileId);
}

export async function focusManagedProfileBrowser(profileId) {
  const targetProfile = resolveProfile(profileId);
  const session = getSession(targetProfile.id);
  if (!session || !(await isSessionAvailable(session))) {
    throw new Error("当前环境浏览器未启动或不可用");
  }

  return await focusSessionWindow(session);
}

export async function checkManagedProfileBrowsers(options = {}) {
  const normalizedProfileId = String(options.profileId || "").trim();
  const reconnect = options.reconnect === true;
  const targets = normalizedProfileId
    ? [resolveProfile(normalizedProfileId).id]
    : Array.from(sessions.keys());

  if (!targets.length) {
    return {
      available: false,
      message: "无浏览器实例",
      status: await getManagedProfileBrowserStatus({ profileId: normalizedProfileId || undefined }),
    };
  }

  let available = false;
  let reconnected = false;
  for (const profileId of targets) {
    const session = getSession(profileId);
    if (!session) {
      continue;
    }
    const ok = await isSessionAvailable(session);
    if (ok) {
      available = true;
      continue;
    }
    if (reconnect) {
      try {
        const reconnectOptions =
          session.currentBrowserOptions && Object.keys(session.currentBrowserOptions).length
            ? session.currentBrowserOptions
            : { profileId };
        await getOrCreateManagedProfileBrowser(reconnectOptions);
        available = true;
        reconnected = true;
      } catch (error) {
        session.lastConnectError = error?.message || String(error);
      }
    }
  }

  return {
    available,
    reconnected,
    message: available ? "浏览器可用" : "未发现可用浏览器实例",
    status: await getManagedProfileBrowserStatus({
      profileId: normalizedProfileId || undefined,
    }),
  };
}

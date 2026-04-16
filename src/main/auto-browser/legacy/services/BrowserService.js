/**
 * 浏览器服务 - 管理 Playwright 浏览器实例
 *
 * 当前浏览器接入层已经统一为 CDP 模式：
 * - 受管环境默认通过各自的 debug port 启动并连接
 * - 显式传入 cdpEndpoint/userDataDir 时，也只走 CDP 直连
 *
 * 旧的多模式接入已经移除，当前仅保留 CDP。
 */

import { spawn, exec } from 'child_process';
import path from 'path';
import {
    join as pathJoin
} from 'path';
import {
    existsSync,
    mkdirSync,
    readFileSync
} from 'fs';
import {
    logger
} from '../utils/logger.js';
import {
    patchContextNewPage,
    withDefaultActivatedPageOptions
} from '../utils/playwrightPageFactory.js';
import {
    getPlaywrightChromium
} from '../utils/playwrightRuntime.js';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import http from 'http';
import https from 'https';
import {
    getBrowserProfilesWorkspaceDir,
    listBrowserProfiles,
    getBrowserProfile,
    getActiveBrowserProfile,
    ensureDefaultBrowserProfile,
    switchBrowserProfile,
    createBrowserProfile,
    updateBrowserProfile,
    deleteBrowserProfile,
    markBrowserProfileUsed
} from './BrowserProfileService.js';
import {
    checkManagedProfileBrowsers,
    closeManagedProfileBrowser,
    createProfileBrowserPage,
    focusManagedProfileBrowser,
    forgetManagedProfileBrowserSession,
    getManagedProfileBrowserPage,
    getManagedProfileBrowserStatus,
    getOrCreateManagedProfileBrowser,
    isManagedProfileBrowserAvailable,
    listManagedProfileBrowserPages,
    updateManagedProfileBrowserActivity
} from './ManagedProfileBrowserPool.js';

// 全局：Playwright Browser / BrowserContext
let browserInstance = null;    // playwright Browser（CDP 模式使用）
let contextInstance = null;    // playwright BrowserContext
let currentUserDataDir = null; // 当前 user data dir（CDP）
let currentExecutablePath = null;
let currentMode = null;
let currentBrowserName = null;
let currentBrowserVersion = null;
let currentCdpEndpoint = null;
let currentManagedProfileId = null;
let connectPromise = null;
let lastConnectError = null;
let currentBrowserOptions = {};
let hasLoggedLegacyModeFallback = false;
const FOCUS_TRACKER_SCRIPT = `
(() => {
  if (globalThis.__yisheFocusTrackerInstalled) {
    return;
  }

  const ensureState = () => {
    const prev = globalThis.__yisheFocusTracker || {};
    const now = Date.now();
    const next = {
      hasFocus: typeof document?.hasFocus === 'function' ? document.hasFocus() : false,
      visibilityState: document?.visibilityState || 'unknown',
      lastFocusAt: Number(prev.lastFocusAt || 0),
      lastBlurAt: Number(prev.lastBlurAt || 0),
      lastVisibleAt: Number(prev.lastVisibleAt || 0),
      updatedAt: now
    };

    if (next.hasFocus && !next.lastFocusAt) next.lastFocusAt = now;
    if (next.visibilityState === 'visible' && !next.lastVisibleAt) next.lastVisibleAt = now;

    globalThis.__yisheFocusTracker = next;
    return next;
  };

  const updateState = (reason) => {
    const prev = ensureState();
    const now = Date.now();
    const next = {
      ...prev,
      hasFocus: typeof document?.hasFocus === 'function' ? document.hasFocus() : false,
      visibilityState: document?.visibilityState || 'unknown',
      updatedAt: now,
      lastReason: reason || 'update'
    };

    if (reason === 'focus' || next.hasFocus) next.lastFocusAt = now;
    if (reason === 'blur') next.lastBlurAt = now;
    if (reason === 'visible' || next.visibilityState === 'visible') next.lastVisibleAt = now;

    globalThis.__yisheFocusTracker = next;
  };

  globalThis.__yisheFocusTrackerInstalled = true;
  ensureState();

  window.addEventListener('focus', () => updateState('focus'), true);
  window.addEventListener('blur', () => updateState('blur'), true);
  document.addEventListener('visibilitychange', () => {
    updateState(document.visibilityState === 'visible' ? 'visible' : 'hidden');
  }, true);
  window.addEventListener('pageshow', () => updateState('pageshow'), true);
  window.addEventListener('load', () => updateState('load'), true);
})();
`;
// 浏览器状态管理
let browserStatus = {
    isInitialized: false,
    isConnected: false,
    lastActivity: null,
    pageCount: 0
};

function existsAny(paths = []) {
    for (const p of paths) {
        try {
            if (p && existsSync(p)) return p;
        } catch {
            // ignore
        }
    }
    return null;
}

function getDefaultExecutablePath() {
    if (process.platform === 'win32') {
        const pf = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const pf64 = process.env.ProgramFiles || 'C:\\Program Files';
        return existsAny([
            pathJoin(pf64, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            pathJoin(pf, 'Google', 'Chrome', 'Application', 'chrome.exe')
        ]) || pathJoin(pf64, 'Google', 'Chrome', 'Application', 'chrome.exe');
    }
    if (process.platform === 'darwin') {
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }
    return '/usr/bin/google-chrome';
}

/**
 * 获取默认的 CDP User Data 目录（独立目录，避免与系统 Chrome 冲突）
 */
function getCdpDefaultUserDataDir() {
    const envDir = process.env.YISHE_AUTO_BROWSER_CDP_USER_DATA_DIR || process.env.UPLOADER_CDP_USER_DATA_DIR;
    if (envDir) {
        return envDir;
    }

    return path.resolve(getBrowserProfilesWorkspaceDir(), 'cdp-user-data');
}

function normalizeBrowserMode(value, { source = '浏览器模式' } = {}) {
    const rawMode = String(value || '').trim().toLowerCase();
    if (!rawMode || rawMode === 'cdp') {
        return 'cdp';
    }

    if (!hasLoggedLegacyModeFallback) {
        logger.warn(`${source} 已收口为 cdp 模式，收到 "${rawMode}" 时将自动改为 cdp`);
        hasLoggedLegacyModeFallback = true;
    }
    return 'cdp';
}

function getBrowserMode() {
    return normalizeBrowserMode(process.env.BROWSER_MODE, { source: '环境变量 BROWSER_MODE' });
}

function shouldUseManagedProfilePool(options = {}) {
    return !!String(options?.profileId || '').trim();
}

function getHeadlessMode() {
    const headlessEnv = process.env.HEADLESS || process.env.BROWSER_HEADLESS;
    if (headlessEnv) {
        return headlessEnv.toLowerCase() === 'true' || headlessEnv === '1';
    }
    return false; // 默认非无头模式
}

function normalizePathLike(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return null;
    }

    try {
        return path.resolve(normalized);
    } catch {
        return normalized;
    }
}

function resolveManagedProfile(profileId) {
    const normalizedProfileId = String(profileId || '').trim();
    if (!normalizedProfileId) {
        return null;
    }

    const profile = getBrowserProfile(normalizedProfileId);
    if (!profile) {
        throw new Error(`指定环境不存在: ${normalizedProfileId}`);
    }

    return profile;
}

function hasExplicitDirectCdpSelection(options = {}) {
    const explicitEndpoint = String(options?.cdpEndpoint || '').trim();
    const explicitUserDataDir = normalizePathLike(
        options?.cdpUserDataDir ||
        options?.userDataDir ||
        null
    );
    const explicitPort = Number(options?.port || options?.debugPort);
    return !!(
        explicitEndpoint ||
        explicitUserDataDir ||
        (Number.isFinite(explicitPort) && explicitPort > 0)
    );
}

function resolvePreferredManagedProfile(options = {}) {
    const explicitProfileId = String(options.profileId || '').trim();
    if (explicitProfileId) {
        return resolveManagedProfile(explicitProfileId);
    }

    if (hasExplicitDirectCdpSelection(options)) {
        return null;
    }

    return getActiveBrowserProfile() || ensureDefaultBrowserProfile();
}

function normalizeManagedBrowserActionOptions(options = {}) {
    const normalizedOptions =
        options && typeof options === 'object' ? { ...options } : {};
    const keepCurrentDirectConnection =
        !String(normalizedOptions.profileId || '').trim() &&
        !hasExplicitDirectCdpSelection(normalizedOptions) &&
        currentBrowserOptions &&
        Object.keys(currentBrowserOptions).length > 0 &&
        !String(currentBrowserOptions.profileId || '').trim() &&
        hasExplicitDirectCdpSelection(currentBrowserOptions);
    if (keepCurrentDirectConnection) {
        return normalizedOptions;
    }
    if (!String(normalizedOptions.profileId || '').trim()) {
        const profile = resolvePreferredManagedProfile(normalizedOptions);
        if (profile?.id) {
            normalizedOptions.profileId = profile.id;
        }
    }
    return normalizedOptions;
}

function normalizeBrowserConnectionOptions(options = {}) {
    const normalizedOptions = normalizeManagedBrowserActionOptions(options);
    normalizedOptions.mode = normalizeBrowserMode(
        normalizedOptions.mode || getBrowserMode(),
        { source: '浏览器连接模式' },
    );
    return normalizedOptions;
}

function parseCdpEndpoint(endpoint = 'http://127.0.0.1:9222') {
    try {
        const url = new URL(endpoint);
        const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
        return {
            endpoint: url.toString().replace(/\/$/, ''),
            hostname: String(url.hostname || '').trim().toLowerCase(),
            port: Number.isFinite(port) && port > 0 ? port : null,
            isLocal: ['127.0.0.1', 'localhost', '0.0.0.0'].includes(
                String(url.hostname || '').trim().toLowerCase(),
            ),
        };
    } catch {
        return {
            endpoint: String(endpoint || '').trim(),
            hostname: '',
            port: null,
            isLocal: false,
        };
    }
}

function resolveCdpProfileSelection(options = {}) {
    const explicitProfileId = String(options.profileId || '').trim();
    if (explicitProfileId) {
        const profile = resolveManagedProfile(explicitProfileId);
        return {
            profileId: profile.id,
            userDataDir: profile.userDataDir,
            profile,
            source: 'profile',
        };
    }

    const explicitUserDataDir = normalizePathLike(
        options.cdpUserDataDir ||
        options.userDataDir ||
        process.env.YISHE_AUTO_BROWSER_CDP_USER_DATA_DIR ||
        process.env.UPLOADER_CDP_USER_DATA_DIR
    );
    if (explicitUserDataDir) {
        return {
            profileId: null,
            userDataDir: explicitUserDataDir,
            profile: null,
            source: 'explicit-user-data',
        };
    }

    return {
        profileId: null,
        userDataDir: getCdpDefaultUserDataDir(),
        profile: null,
        source: 'cdp-default',
    };
}

function resolveDesiredConnectionState(options = {}) {
    const cdpSelection = resolveCdpProfileSelection(options);
    return {
        mode: 'cdp',
        cdpEndpoint: String(options.cdpEndpoint || process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222').trim(),
        userDataDir: normalizePathLike(cdpSelection.userDataDir),
        profileId: cdpSelection.profileId || null,
    };
}

function isHeadlessConnection() {
    if (typeof currentBrowserOptions?.headless === 'boolean') {
        return currentBrowserOptions.headless;
    }
    return getHeadlessMode();
}

async function shouldReconnectForOptions(options = {}) {
    if (!contextInstance && !browserInstance) {
        return false;
    }

    if (!await isBrowserAvailable()) {
        return false;
    }

    const desired = resolveDesiredConnectionState(options);
    const current = {
        mode: currentMode,
        userDataDir: normalizePathLike(currentUserDataDir),
        profileId: currentManagedProfileId || null,
        cdpEndpoint: String(currentCdpEndpoint || '').trim() || null,
    };

    if (desired.mode !== current.mode) {
        return true;
    }

    if (desired.mode === 'cdp') {
        return desired.cdpEndpoint !== current.cdpEndpoint
            || desired.userDataDir !== current.userDataDir
            || (desired.profileId || null) !== (current.profileId || null);
    }

    return desired.userDataDir !== current.userDataDir
        || (desired.profileId || null) !== (current.profileId || null);
}

/**
 * 通过 CDP 将浏览器窗口设为最大化（仅在有界面模式下调用）
 */
async function setBrowserWindowMaximized(context, headless = false) {
    if (!context || headless) return; // 无头模式下跳过
    let page = context.pages()[0];
    const createdPage = !page;
    if (!page) page = await context.newPage();
    try {
        const cdp = await context.newCDPSession(page);
        const { windowId } = await cdp.send('Browser.getWindowForTarget');
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
        logger.info('已通过 CDP 将浏览器窗口设为最大化');
    } catch (e) {
        logger.warn('设置窗口最大化失败（可忽略）:', e?.message || e);
    } finally {
        if (createdPage && page) await page.close().catch(() => { });
    }
}

function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    });
    return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

function execCommand(command, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        exec(command, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                const msg = stderr ? String(stderr).trim() : error.message;
                reject(new Error(msg || error.message));
                return;
            }
            resolve(String(stdout || '').trim());
        });
    });
}

async function checkCdpEndpointAvailable(endpoint = 'http://127.0.0.1:9222') {
    try {
        const targetUrl = new URL('/json/version', endpoint);
        const client = targetUrl.protocol === 'https:' ? https : http;
        return await new Promise((resolve) => {
            const req = client.get(targetUrl, { timeout: 3000 }, (resp) => {
                let data = '';
                resp.on('data', (chunk) => { data += chunk; });
                resp.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve({
                            ok: true,
                            endpoint,
                            browser: json.Browser || json.browser || ''
                        });
                    } catch {
                        resolve({
                            ok: true,
                            endpoint,
                            browser: ''
                        });
                    }
                });
            });
            req.on('error', (error) => resolve({ ok: false, endpoint, error: error?.message || '连接失败' }));
            req.on('timeout', () => {
                req.destroy();
                resolve({ ok: false, endpoint, error: '连接超时' });
            });
        });
    } catch (error) {
        return {
            ok: false,
            endpoint,
            error: error?.message || '检测 CDP 端点失败'
        };
    }
}

function resolveActiveBrowserVersion() {
    try {
        if (browserInstance && typeof browserInstance.version === 'function') {
            return browserInstance.version() || null;
        }
    } catch {
        // ignore
    }

    try {
        if (contextInstance && typeof contextInstance.browser === 'function') {
            const browser = contextInstance.browser();
            if (browser && typeof browser.version === 'function') {
                return browser.version() || null;
            }
        }
    } catch {
        // ignore
    }

    return null;
}

async function getListeningPids(port) {
    const pids = new Set();
    if (process.platform === 'win32') {
        let output = '';
        try {
            output = await execCommand(`netstat -ano -p tcp | findstr :${port}`);
        } catch {
            return [];
        }
        const lines = output.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (!line.includes(`:${port}`)) continue;
            const parts = line.split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid)) {
                pids.add(pid);
            }
        }
        return Array.from(pids);
    }

    try {
        const output = await execCommand(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
        output.split(/\s+/).filter(Boolean).forEach(pid => pids.add(pid));
        return Array.from(pids);
    } catch (e) {
        const fallback = await execCommand(`sh -lc "ss -lptn 'sport = :${port}' | awk '{print $6}' | sed 's/.*pid=\\([0-9]*\\).*/\\1/'"`);
        fallback.split(/\s+/).filter(Boolean).forEach(pid => pids.add(pid));
        return Array.from(pids);
    }
}

async function killPids(pids = []) {
    const killed = [];
    const errors = [];
    for (const pid of pids) {
        try {
            if (process.platform === 'win32') {
                await execCommand(`taskkill /PID ${pid} /T /F`);
            } else {
                await execCommand(`kill -9 ${pid}`);
            }
            killed.push(pid);
        } catch (e) {
            errors.push({ pid, error: e.message || String(e) });
        }
    }
    return { killed, errors };
}

/** 是否为「浏览器/上下文已关闭」类错误（用户关闭了由本服务启动的窗口后仍用旧引用会报此错） */
function isBrowserClosedError(err) {
    const msg = (err && err.message) ? String(err.message) : '';
    return /Target page, context or browser has been closed/i.test(msg) ||
        /Browser has been closed/i.test(msg) ||
        /Context has been closed/i.test(msg);
}

/**
 * 包装 newPage：若因浏览器/上下文已关闭而失败，则清除旧引用并重新 getOrCreateBrowser 后重试一次
 */
async function newPageWithReconnect(options = {}, pageOptions = {}) {
    try {
        if (!contextInstance) {
            if (browserInstance && typeof browserInstance.contexts === 'function') {
                const ctxs = browserInstance.contexts();
                const headless = getHeadlessMode();
                const contextOptions = { devtools: !headless };
                // 无头模式下需要指定 viewport
                if (headless) {
                    contextOptions.viewport = { width: 1920, height: 1080 };
                }
                contextInstance = ctxs[0] || await browserInstance.newContext(contextOptions);
                await installBrowserContextPatches(contextInstance);
            } else {
                throw new Error('No browser context available');
            }
        }
        const finalPageOptions = withDefaultActivatedPageOptions(pageOptions);
        const page = await contextInstance.newPage(finalPageOptions);
        await installFocusTrackerForPage(page);
        return page;
    } catch (err) {
        if (!isBrowserClosedError(err)) throw err;
        logger.warn('检测到浏览器/上下文已关闭，清除引用并尝试重新连接:', err.message);
        contextInstance = null;
        browserInstance = null;
        connectPromise = null;
        browserStatus.isInitialized = false;
        browserStatus.isConnected = false;
        browserStatus.pageCount = 0;
        await getOrCreateBrowser(currentBrowserOptions);
        if (!contextInstance) throw new Error('重新连接后仍无法获取浏览器上下文');
        const page = await contextInstance.newPage(pageOptions);
        await installFocusTrackerForPage(page);
        return page;
    }
}

function tryListProfiles(userDataDir) {
    // 读取 Chrome/Edge 的 "Local State" 来列出 profile 目录（可用于 UI 下拉选择）
    try {
        const localStatePath = pathJoin(userDataDir, 'Local State');
        if (!existsSync(localStatePath)) return [];
        const raw = readFileSync(localStatePath, 'utf-8');
        const json = JSON.parse(raw);
        const infoCache = json?.profile?.info_cache || {};
        return Object.entries(infoCache).map(([dir, info]) => ({
            dir,
            name: info?.name || dir,
            isDefault: dir === 'Default'
        }));
    } catch {
        return [];
    }
}

/**
 * 启动带远程调试端口的 Chrome（仅 --remote-debugging-port，使用指定 user-data-dir 保持登录态）
 * 支持无头模式通过 headless 参数或 HEADLESS 环境变量
 */
export function launchWithDebugPort({ port = 9222, headless = null, userDataDir = null, executablePath = null } = {}) {
    const exe = String(executablePath || getDefaultExecutablePath()).trim();
    if (!exe || !existsSync(exe)) {
        throw new Error(`未找到 Chrome 可执行文件: ${exe}，请确认已安装 Google Chrome`);
    }

    // 使用独立的 user-data-dir 避免与系统 Chrome 冲突，确保登录信息持久化
    const finalUserDataDir = userDataDir || getCdpDefaultUserDataDir();

    // 确定是否使用无头模式
    const useHeadless = headless !== undefined ? headless : getHeadlessMode();
    logger.info(`launchWithDebugPort - 输入 headless: ${headless}, 最终使用 useHeadless: ${useHeadless}`);
    logger.info(`launchWithDebugPort - userDataDir: ${finalUserDataDir}`);
    
    // 确保目录存在
    try {
        mkdirSync(finalUserDataDir, { recursive: true });
    } catch (e) {
        throw new Error(`无法创建/访问 user-data-dir: ${finalUserDataDir}，请确认路径可写。原错误: ${e.message}`);
    }

    const args = [
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${finalUserDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        ...(useHeadless ? ['--headless=new'] : [])
    ];

    const child = spawn(exe, args, { stdio: 'ignore', detached: true });
    child.unref();
    const pid = child.pid;
    const modeStr = useHeadless ? '无头' : '有界面';
    logger.info(`已启动 Chrome pid=${pid} port=${port}，模式: ${modeStr}，user-data-dir: ${finalUserDataDir}`);
    return {
        port,
        browserName: 'chrome',
        pid,
        headless: useHeadless,
        userDataDir: finalUserDataDir,
        executablePath: exe,
    };
}

/**
 * 检查浏览器是否可用
 */
export async function isBrowserAvailable(options = {}) {
    if (shouldUseManagedProfilePool(options)) {
        return await isManagedProfileBrowserAvailable(options?.profileId);
    }

    if (!contextInstance && !browserInstance) {
        return false;
    }

    try {
        if (browserInstance && !browserInstance.isConnected()) {
            return false;
        }
        const pages = await getVisiblePagesDetailed();
        // 在有界面模式下，若已经没有任何可见页，通常意味着用户已手动关闭最后一个浏览器窗口。
        // 这种情况下按“未连接”处理，避免控制端继续误判为可用。
        if (!isHeadlessConnection() && currentMode !== 'cdp' && pages.length === 0) {
            logger.info('浏览器可见页面为 0，按浏览器/上下文已关闭处理');
            browserStatus.isConnected = false;
            browserStatus.pageCount = 0;
            return false;
        }
        browserStatus.isConnected = true;
        browserStatus.pageCount = pages.length;
        browserStatus.lastActivity = Date.now();
        return true;
    } catch (error) {
        browserStatus.isConnected = false;
        browserStatus.pageCount = 0;
        logger.warn('浏览器连接检查失败:', error.message);
        return false;
    }
}

/**
 * 检测现有浏览器窗口
 */
export async function detectExistingBrowser() {
    if (shouldUseManagedProfilePool()) {
        const status = await getManagedProfileBrowserStatus();
        if (status?.hasInstance && status?.isConnected) {
            return {
                newPage: async (pageOptions = {}) => await createProfileBrowserPage(
                    status?.connection?.profileId || status?.connection?.activeProfileId || undefined,
                    pageOptions
                )
            };
        }
        return null;
    }

    try {
        // 尝试连接到现有的浏览器实例
        if ((contextInstance || browserInstance) && await isBrowserAvailable()) {
            logger.info('检测到现有浏览器实例，页面数量:', browserStatus.pageCount);
            await installBrowserContextPatches(contextInstance);
            return {
                newPage: async (pageOptions = {}) => await newPageWithReconnect(currentBrowserOptions, pageOptions)
            };
        }

        // 如果浏览器实例存在但不可用，清理它
        if (browserInstance || contextInstance) {
            logger.info('现有浏览器实例不可用，将重新创建');
            browserInstance = null;
            contextInstance = null;
            browserStatus.isInitialized = false;
            browserStatus.isConnected = false;
            currentManagedProfileId = null;
        }

        logger.debug('未发现可复用实例，将创建新的 Playwright 实例');
        return null;

    } catch (error) {
        logger.error('检测现有浏览器失败:', error);
        return null;
    }
}

/**
 * 获取或创建浏览器实例
 */
export async function getOrCreateBrowser(options = {}) {
    let normalizedOptions = {};
    if (options && Object.keys(options).length > 0) {
        normalizedOptions = normalizeBrowserConnectionOptions(options);
    } else if (currentBrowserOptions && Object.keys(currentBrowserOptions).length > 0) {
        normalizedOptions = { ...currentBrowserOptions };
    } else {
        normalizedOptions = normalizeBrowserConnectionOptions({});
    }

    if (shouldUseManagedProfilePool(normalizedOptions)) {
        return await getOrCreateManagedProfileBrowser(normalizedOptions);
    }

    currentBrowserOptions = { ...normalizedOptions };
    options = { ...currentBrowserOptions };

    // 并发保护：多次点击只跑一次连接
    if (connectPromise) {
        await connectPromise;
        return {
            newPage: async (pageOptions = {}) => await newPageWithReconnect(currentBrowserOptions, pageOptions)
        };
    }

    if (options && Object.keys(options).length > 0 && await shouldReconnectForOptions(options)) {
        logger.info('检测到浏览器环境参数变化，准备关闭当前实例并切换到新环境');
        await closeBrowser();
    }

    // 首先尝试检测现有浏览器
    const existingBrowser = await detectExistingBrowser();
    if (existingBrowser) {
        return existingBrowser;
    }

    // 创建新的浏览器实例
    logger.info('启动新的浏览器实例...');

    try {
        currentMode = 'cdp';
        currentBrowserName = 'chrome';
        currentBrowserVersion = null;
        lastConnectError = null;

        connectPromise = (async () => {
            const headless = options.headless !== undefined ? options.headless : getHeadlessMode();
            const chromium = await getPlaywrightChromium();
            logger.info(`getOrCreateBrowser - options.headless: ${options.headless}, 最终使用 headless: ${headless}`);
            const modeStr = headless ? '无头' : '有界面';
            const cdpSelection = resolveCdpProfileSelection(options);
            const parsedEndpoint = parseCdpEndpoint(
                options.cdpEndpoint || process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222'
            );
            const endpoint = parsedEndpoint.endpoint || String(options.cdpEndpoint || process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222').trim();
            const existingCdp = await checkCdpEndpointAvailable(endpoint);

            currentCdpEndpoint = endpoint;
            currentUserDataDir = cdpSelection.userDataDir;
            currentManagedProfileId = cdpSelection.profileId || null;
            currentExecutablePath = String(options.chromeExecutablePath || '').trim() || null;
            if (currentManagedProfileId) {
                switchBrowserProfile(currentManagedProfileId);
            }

            if (existingCdp.ok) {
                logger.info(`检测到可复用的现有 CDP 浏览器，优先接管 (${modeStr}): ${endpoint}`);
            } else if (parsedEndpoint.isLocal && parsedEndpoint.port) {
                logger.info(`未检测到可复用 CDP 浏览器，启动本地 Chrome 后重试 (${modeStr}): ${endpoint}`);
                const launched = launchWithDebugPort({
                    port: parsedEndpoint.port,
                    headless,
                    userDataDir: cdpSelection.userDataDir,
                    executablePath: options.chromeExecutablePath,
                });
                currentExecutablePath = launched.executablePath || currentExecutablePath;
                await new Promise((resolve) => setTimeout(resolve, 3500));
            } else {
                throw new Error(
                    `未检测到可接管的 CDP 浏览器: ${existingCdp.error || endpoint}`
                );
            }

            logger.info(`使用 CDP 模式连接浏览器 (${modeStr}):`, endpoint);
            const maxRetries = 10;
            const retryDelayMs = 2000;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    browserInstance = await withTimeout(chromium.connectOverCDP(endpoint), 15000, 'connectOverCDP');
                    break;
                } catch (e) {
                    if (i < maxRetries - 1) {
                        logger.info(`CDP 连接失败，${retryDelayMs / 1000} 秒后重试 (${i + 1}/${maxRetries})...`);
                        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                    } else {
                        throw new Error(
                            `连接 Chrome 失败，请确认 CDP 浏览器已启动并监听 ${endpoint}。原错误: ${e.message}`
                        );
                    }
                }
            }

            const contextOptions = { devtools: !headless };
            if (headless) {
                contextOptions.viewport = { width: 1920, height: 1080 };
            }
            contextInstance = browserInstance.contexts()[0] || await browserInstance.newContext(contextOptions);
            await installBrowserContextPatches(contextInstance);
            await setBrowserWindowMaximized(contextInstance, headless);

            browserStatus.isInitialized = true;
            browserStatus.isConnected = true;
            browserStatus.lastActivity = Date.now();
            browserStatus.pageCount = (await getVisiblePagesDetailed()).length;
            currentBrowserVersion = resolveActiveBrowserVersion();
            if (currentManagedProfileId) {
                markBrowserProfileUsed(currentManagedProfileId, {
                    browserVersion: currentBrowserVersion || '',
                    lastUsedAt: new Date().toISOString(),
                });
            }

            return;
        })();

        try {
            await connectPromise;
        } catch (e) {
            lastConnectError = e?.message || String(e);
            throw e;
        } finally {
            connectPromise = null;
        }

        return {
            newPage: async (pageOptions = {}) => await newPageWithReconnect(currentBrowserOptions, pageOptions)
        };

    } catch (error) {
        logger.error('浏览器启动失败:', error);
        throw error;
    }
}

/**
 * 定时检测浏览器实例是否存活；若已断开则清除引用，可选自动重连（通过接口调用）
 * @param { { reconnect?: boolean } } options - reconnect 为 true 时在断开后尝试重新 getOrCreateBrowser（CDP 模式下会重连端口）
 * @returns { Promise<{ available: boolean, reconnected?: boolean, message?: string, status?: object }> }
 */
export async function checkAndReconnectBrowser(options = {}) {
    if (shouldUseManagedProfilePool(options)) {
        return await checkManagedProfileBrowsers(options);
    }

    const managedResult = await checkManagedProfileBrowsers({
        reconnect: options.reconnect === true,
    }).catch(() => null);

    const { reconnect = false, headless = undefined } = options;
    const reconnectOptions = {
        ...currentBrowserOptions,
        ...(options && typeof options === 'object' ? options : {}),
        mode: 'cdp',
        ...(headless !== undefined ? { headless } : {}),
    };
    delete reconnectOptions.reconnect;

    if (!contextInstance && !browserInstance) {
        if (managedResult?.available) {
            return managedResult;
        }

        if (!reconnect) {
            return { available: false, message: '无浏览器实例' };
        }

        try {
            await getOrCreateBrowser(reconnectOptions);
            const ok = await isBrowserAvailable();
            if (ok) {
                logger.info('已成功自动连接 CDP 浏览器');
                return {
                    available: true,
                    reconnected: true,
                    adopted: true,
                    status: await getBrowserStatus()
                };
            }
        } catch (e) {
            logger.warn('自动接管现有 CDP 浏览器失败:', e?.message || e);
            return {
                available: false,
                reconnected: false,
                message: e?.message || '自动接管失败'
            };
        }

        return {
            available: false,
            reconnected: false,
            message: '检测到 CDP 浏览器，但接管后不可用'
        };
    }

    const available = await isBrowserAvailable();
    if (available) {
        return { available: true, status: await getBrowserStatus() };
    }

    if (managedResult?.available) {
        return managedResult;
    }

    logger.info('浏览器实例已断开，清除引用');
    contextInstance = null;
    browserInstance = null;
    connectPromise = null;
    browserStatus.isInitialized = false;
    browserStatus.isConnected = false;
    browserStatus.pageCount = 0;

    if (reconnect) {
        try {
            await getOrCreateBrowser(reconnectOptions);
            const ok = await isBrowserAvailable();
            if (ok) {
                logger.info('浏览器已重新连接');
                return { available: true, reconnected: true, status: await getBrowserStatus() };
            }
        } catch (e) {
            logger.warn('自动重连失败:', e?.message || e);
            return { available: false, reconnected: false, message: e?.message || '重连失败' };
        }
    }
    return { available: false, message: '浏览器已断开，引用已清除。可调用连接接口或带 reconnect: true 的检测接口重连。' };
}

/**
 * 获取浏览器状态信息
 */
export async function getBrowserStatus(options = {}) {
    if (shouldUseManagedProfilePool(options)) {
        return await getManagedProfileBrowserStatus(options);
    }

    const lightweight = options.lightweight === true || options.includePages === false;
    const includePages = options.includePages === true;
    let pagesInfo = [];
    const managedStatus = await getManagedProfileBrowserStatus({
        lightweight,
        includePages
    }).catch(() => null);
    currentBrowserVersion = resolveActiveBrowserVersion() || currentBrowserVersion;
    const profilesState = listBrowserProfiles();
    const activeProfile = currentManagedProfileId
        ? getBrowserProfile(currentManagedProfileId)
        : (profilesState.activeProfileId ? getBrowserProfile(profilesState.activeProfileId) : null);
    if (lightweight) {
        try {
            browserStatus.isConnected = !!(
                contextInstance &&
                browserInstance &&
                (typeof browserInstance.isConnected !== 'function' || browserInstance.isConnected())
            );
        } catch {
            browserStatus.isConnected = false;
        }

        if (!browserStatus.isConnected && !connectPromise) {
            browserStatus.pageCount = 0;
        }
    } else {
        try {
            const visiblePages = await getVisiblePagesDetailed();
            pagesInfo = visiblePages.map(item => ({ title: item.title || 'Unknown', url: item.url || 'Unknown' }));
            browserStatus.pageCount = visiblePages.length;
        } catch (e) {
            logger.debug('获取页面信息失败（可能正在导航）:', e?.message);
            pagesInfo = [];
            browserStatus.pageCount = 0;
        }
    }

    return {
        ...browserStatus,
        hasInstance: !!browserInstance || !!contextInstance || !!managedStatus?.hasInstance,
        isConnected: browserStatus.isConnected || !!managedStatus?.isConnected,
        pageCount: Number(browserStatus.pageCount || 0) + Number(managedStatus?.pageCount || 0),
        connecting: !!connectPromise || (managedStatus?.instances || []).some((item) => item?.connecting),
        lastError: lastConnectError || managedStatus?.lastError || null,
        connection: {
            mode: currentMode || managedStatus?.connection?.mode || null,
            browserName: currentBrowserName || managedStatus?.connection?.browserName || null,
            browserVersion: currentBrowserVersion || managedStatus?.connection?.browserVersion || null,
            executablePath: currentExecutablePath,
            userDataDir: currentUserDataDir || managedStatus?.connection?.userDataDir || null,
            profileId: currentManagedProfileId || managedStatus?.connection?.profileId || null,
            activeProfileId: profilesState.activeProfileId || managedStatus?.connection?.activeProfileId || null,
            cdpEndpoint: currentCdpEndpoint || managedStatus?.connection?.cdpEndpoint || null,
            debugPort: managedStatus?.connection?.debugPort || null,
            detectedProfiles: currentUserDataDir ? tryListProfiles(currentUserDataDir) : [],
            activeProfile: activeProfile || managedStatus?.connection?.activeProfile || null,
        },
        pages: includePages ? pagesInfo : [],
        profiles: managedStatus?.profiles || profilesState.items,
        instances: managedStatus?.instances || [],
        managedConnection: managedStatus?.connection || null,
        timestamp: new Date().toISOString()
    };
}

function getPagesInternal() {
    return contextInstance ? contextInstance.pages() : (browserInstance ? browserInstance.pages() : []);
}

async function installFocusTrackerForPage(page) {
    if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return;

    try {
        await page.evaluate(FOCUS_TRACKER_SCRIPT);
    } catch {
        // 页面导航中或尚未可执行脚本时忽略
    }
}

async function installFocusTracker(context) {
    if (!context) return;

    try {
        await context.addInitScript(FOCUS_TRACKER_SCRIPT);
    } catch (error) {
        logger.debug('注入 focus tracker init script 失败:', error?.message || error);
    }

    const pages = typeof context.pages === 'function' ? context.pages() : [];
    await Promise.all(pages.map((page) => installFocusTrackerForPage(page)));
}

async function installBrowserContextPatches(context) {
    if (!context) return;

    patchContextNewPage(context, {
        background: true,
        headless: isHeadlessConnection()
    });
    await installFocusTracker(context);
}

function isUserVisiblePage(page, { title = '', url = '' } = {}) {
    if (!page) return false;
    if (typeof page.isClosed === 'function' && page.isClosed()) return false;

    const safeUrl = String(url || '').trim();
    const safeTitle = String(title || '').trim();
    const lowerUrl = safeUrl.toLowerCase();

    if (lowerUrl.startsWith('devtools://')) return false;
    if (lowerUrl.startsWith('chrome-extension://')) return false;
    if (lowerUrl.startsWith('extension://')) return false;
    if (!safeUrl && !safeTitle) return false;

    return true;
}

async function getVisiblePagesDetailed() {
    const pages = getPagesInternal();
    const visiblePages = [];
    const seenPlaceholderKeys = new Set();
    const probeTimeoutMs = 1500;

    for (const page of pages) {
        let title = '';
        let url = '';
        try {
            title = await withTimeout(page.title().catch(() => ''), probeTimeoutMs, 'page.title').catch(() => '');
            url = page.url();
        } catch {
            // ignore
        }

        if (!isUserVisiblePage(page, { title, url })) {
            continue;
        }

        const normalizedUrl = String(url || '').trim().toLowerCase();
        const normalizedTitle = String(title || '').trim().toLowerCase();
        const isInternalNewTabLike =
            normalizedUrl === 'about:blank' ||
            normalizedUrl === 'chrome://newtab/' ||
            normalizedUrl === 'chrome://new-tab-page/' ||
            normalizedUrl === 'chrome-search://local-ntp/local-ntp.html' ||
            normalizedUrl === 'edge://newtab/';
        const isPlaceholderPage =
            isInternalNewTabLike ||
            (!normalizedTitle && !normalizedUrl);

        // 对同一个新标签内部链路产生的重复占位页做去重，只保留一个实例
        if (isPlaceholderPage) {
            const key = isInternalNewTabLike ? '__internal_new_tab__' : '__blank_placeholder__';
            if (seenPlaceholderKeys.has(key)) {
                continue;
            }
            seenPlaceholderKeys.add(key);
        }

        let focusState = {
            hasFocus: false,
            visibilityState: 'unknown',
            lastFocusAt: 0,
            lastBlurAt: 0,
            lastVisibleAt: 0,
            updatedAt: 0
        };
        try {
            focusState = await withTimeout(
                page.evaluate((trackerScript) => {
                    try {
                        globalThis.eval(trackerScript);
                    } catch {
                        // ignore
                    }

                    const tracker = globalThis.__yisheFocusTracker || {};
                    return {
                        hasFocus: typeof document?.hasFocus === 'function' ? document.hasFocus() : false,
                        visibilityState: document?.visibilityState || 'unknown',
                        lastFocusAt: Number(tracker.lastFocusAt || 0),
                        lastBlurAt: Number(tracker.lastBlurAt || 0),
                        lastVisibleAt: Number(tracker.lastVisibleAt || 0),
                        updatedAt: Number(tracker.updatedAt || 0)
                    };
                }, FOCUS_TRACKER_SCRIPT),
                probeTimeoutMs,
                'page.focusState'
            );
        } catch {
            // ignore page state probing failures during navigation
        }

        visiblePages.push({
            page,
            title,
            url,
            hasFocus: !!focusState?.hasFocus,
            visibilityState: String(focusState?.visibilityState || 'unknown'),
            lastFocusAt: Number(focusState?.lastFocusAt || 0),
            lastBlurAt: Number(focusState?.lastBlurAt || 0),
            lastVisibleAt: Number(focusState?.lastVisibleAt || 0),
            updatedAt: Number(focusState?.updatedAt || 0)
        });
    }

    const focusedCandidate = visiblePages
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.hasFocus || item.lastFocusAt > 0)
        .sort((a, b) => {
            if (Number(b.item.hasFocus) !== Number(a.item.hasFocus)) {
                return Number(b.item.hasFocus) - Number(a.item.hasFocus);
            }
            return (b.item.lastFocusAt || 0) - (a.item.lastFocusAt || 0);
        })[0];

    const visibleCandidate = visiblePages
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.visibilityState === 'visible' || item.lastVisibleAt > 0)
        .sort((a, b) => {
            if ((b.item.visibilityState === 'visible') !== (a.item.visibilityState === 'visible')) {
                return Number(b.item.visibilityState === 'visible') - Number(a.item.visibilityState === 'visible');
            }
            return (b.item.lastVisibleAt || 0) - (a.item.lastVisibleAt || 0);
        })[0];

    const focusedIndex = focusedCandidate ? focusedCandidate.index : -1;
    const visibleIndex = visibleCandidate ? visibleCandidate.index : -1;

    return visiblePages.map((item, index) => ({
        index,
        page: item.page,
        title: item.title,
        url: item.url,
        hasFocus: item.hasFocus,
        visibilityState: item.visibilityState,
        isFocusedTab: focusedIndex >= 0 ? index === focusedIndex : false,
        isVisibleTab: visibleIndex >= 0 ? index === visibleIndex : false
    }));
}

export async function listBrowserPages(options = {}) {
    const normalizedOptions = normalizeManagedBrowserActionOptions(options);
    if (shouldUseManagedProfilePool(normalizedOptions)) {
        return await listManagedProfileBrowserPages(normalizedOptions?.profileId);
    }

    const pages = await getVisiblePagesDetailed();
    return pages.map(({ index, title, url, hasFocus, visibilityState, isFocusedTab, isVisibleTab }) => ({
        index,
        title,
        url,
        hasFocus,
        visibilityState,
        isFocusedTab,
        isVisibleTab
    }));
}

export async function getBrowserPage(pageIndex, options = {}) {
    const normalizedOptions = normalizeManagedBrowserActionOptions(options);
    if (shouldUseManagedProfilePool(normalizedOptions)) {
        return await getManagedProfileBrowserPage(normalizedOptions?.profileId, pageIndex);
    }

    const pages = await getVisiblePagesDetailed();
    if (!pages.length) {
        return await newPageWithReconnect(currentBrowserOptions);
    }

    const index = Number.isInteger(pageIndex) ? pageIndex : 0;
    if (index < 0 || index >= pages.length) {
        throw new Error(`页面索引无效: ${pageIndex}`);
    }
    return pages[index].page;
}

export async function createBrowserPage(options = {}) {
    const normalizedOptions = normalizeManagedBrowserActionOptions(options);
    if (shouldUseManagedProfilePool(normalizedOptions)) {
        return await createProfileBrowserPage(normalizedOptions?.profileId, normalizedOptions);
    }

    return await newPageWithReconnect(currentBrowserOptions, normalizedOptions);
}

/**
 * 更新浏览器活动状态
 */
export function updateBrowserActivity(options = {}) {
    const normalizedOptions = normalizeManagedBrowserActionOptions(options);
    if (shouldUseManagedProfilePool(normalizedOptions)) {
        return updateManagedProfileBrowserActivity(normalizedOptions?.profileId);
    }

    browserStatus.lastActivity = Date.now();
    try {
        const pages = getPagesInternal().filter(page => {
            try {
                return page && !(typeof page.isClosed === 'function' && page.isClosed());
            } catch {
                return false;
            }
        });
        browserStatus.pageCount = pages.length;
    } catch {
        browserStatus.pageCount = 0;
    }
}

/**
 * 保持浏览器窗口打开（不关闭）
 */
export function keepBrowserOpen() {
    logger.info('浏览器窗口将保持打开状态');
    // 不执行任何关闭操作
}

/**
 * 关闭浏览器实例
 */
export async function closeBrowser(options = {}) {
    if (shouldUseManagedProfilePool(options)) {
        await closeManagedProfileBrowser(options?.profileId);
        return;
    }

    if (!String(options?.profileId || '').trim() && !options?.mode) {
        await closeManagedProfileBrowser();
    }

    try {
        if (contextInstance) {
            try {
                await contextInstance.close();
                logger.info('BrowserContext 已关闭');
            } catch (e) {
                logger.warn('关闭 BrowserContext 失败:', e.message);
            } finally {
                contextInstance = null;
            }
        }
        if (browserInstance) {
            try {
                await browserInstance.close();
                logger.info('Browser 已关闭');
            } catch (e) {
                logger.warn('关闭 Browser 失败:', e.message);
            } finally {
                browserInstance = null;
            }
        }

        browserStatus.isInitialized = false;
        browserStatus.isConnected = false;
        browserStatus.pageCount = 0;
        currentUserDataDir = null;
        currentExecutablePath = null;
        currentCdpEndpoint = null;
        currentManagedProfileId = null;
        currentBrowserVersion = null;
    } catch (error) {
        logger.error('清理浏览器资源时出错:', error);
    }
}

export async function focusBrowser(options = {}) {
    const normalizedOptions = normalizeManagedBrowserActionOptions(options);
    if (shouldUseManagedProfilePool(normalizedOptions)) {
        return await focusManagedProfileBrowser(normalizedOptions?.profileId);
    }

    throw new Error('当前浏览器模式暂不支持聚焦窗口');
}

/**
 * 强制关闭指定调试端口的浏览器实例（默认 9222）
 */
export async function forceCloseBrowserByPort({ port = 9222 } = {}) {
    const safePort = Number(port) || 9222;
    await closeBrowser();

    try {
        const pids = await getListeningPids(safePort);
        if (!pids.length) {
            return { ok: true, port: safePort, message: '未发现占用端口的进程', pids: [], killed: [] };
        }
        const { killed, errors } = await killPids(pids);
        const ok = killed.length > 0 && errors.length === 0;
        return { ok, port: safePort, pids, killed, errors };
    } catch (e) {
        return { ok: false, port: safePort, error: e.message || String(e) };
    }
}

/**
 * 清除用户数据
 */
export async function clearUserData() {
    try {
        const profile = getActiveBrowserProfile() || ensureDefaultBrowserProfile();
        const userDataDir = profile?.userDataDir;
        if (!userDataDir) {
            throw new Error('未找到可清理的受管环境目录');
        }

        await closeManagedProfileBrowser(profile.id);
        fs.emptyDirSync(userDataDir);
        logger.info(`已清空用户数据目录: ${userDataDir}`);
        return { success: true, userDataDir };
    } catch (error) {
        logger.error('清除用户数据失败:', error);
        throw error;
    }
}

/**
 * 导出用户数据为 ZIP 压缩包
 * @param {string} userDataDir 用户数据目录路径
 * @returns {Promise<Buffer>} ZIP 文件 Buffer
 */
export async function exportUserData(userDataDir) {
    try {
        if (!userDataDir || !fs.existsSync(userDataDir)) {
            throw new Error(`User Data 目录不存在: ${userDataDir}`);
        }

        // 确保浏览器已关闭
        logger.info('正在关闭浏览器以准备导出数据...');
        await closeBrowser();

        logger.info(`正在压缩用户数据目录: ${userDataDir} ...`);
        const zip = new AdmZip();

        // 我们递归添加目录内容
        // 注意：全量导出。虽然体积大，但最稳。
        zip.addLocalFolder(userDataDir);

        const buffer = zip.toBuffer();
        logger.info(`用户数据压缩完成，大小: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
        return buffer;
    } catch (error) {
        logger.error('导出用户数据失败:', error);
        throw error;
    }
}

/**
 * 从 ZIP 压缩包导入用户数据
 * @param {string} zipPath ZIP 文件路径
 * @param {string} userDataDir 目标用户数据目录
 */
export async function importUserData(zipPath, userDataDir) {
    try {
        if (!fs.existsSync(zipPath)) {
            throw new Error(`待导入的 ZIP 文件不存在: ${zipPath}`);
        }

        // 验证 ZIP 文件大小
        const fileStats = fs.statSync(zipPath);
        logger.info(`ZIP 文件大小: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);

        if (fileStats.size < 100) {
            throw new Error(`ZIP 文件过小 (${fileStats.size} 字节)，可能不是有效的 ZIP 文件或文件损坏`);
        }

        if (fileStats.size > 10 * 1024 * 1024 * 1024) {
            throw new Error(`ZIP 文件过大 (${(fileStats.size / 1024 / 1024 / 1024).toFixed(2)} GB)，超过 10GB 限制`);
        }

        // 检查磁盘空间（预估需要 3 倍 ZIP 大小的临时空间）
        const requiredSpace = fileStats.size * 3;
        const targetDir = path.dirname(userDataDir);
        try {
            if (process.platform !== 'win32') {
                const util = require('util');
                const statfs = util.promisify(fs.statfs);
                const stats = await statfs(targetDir);
                const freeSpace = stats.bavail * stats.bsize;
                if (freeSpace < requiredSpace) {
                    throw new Error(
                        `磁盘空间不足。需要: ${(requiredSpace / 1024 / 1024 / 1024).toFixed(2)} GB, ` +
                        `可用: ${(freeSpace / 1024 / 1024 / 1024).toFixed(2)} GB`
                    );
                }
            }
        } catch (diskErr) {
            if (!diskErr.message.includes('磁盘空间不足')) {
                logger.warn(`磁盘空间检查失败: ${diskErr.message}（继续尝试导入）`);
            } else {
                throw diskErr;
            }
        }

        // 验证 ZIP 格式完整性
        let zipInstance;
        try {
            zipInstance = new AdmZip(zipPath);
            const entries = zipInstance.getEntries();
            if (!entries || entries.length === 0) {
                throw new Error('ZIP 文件为空或格式无效');
            }
            logger.info(`ZIP 文件包含 ${entries.length} 个条目`);
        } catch (zipErr) {
            const errMsg = zipErr.message || String(zipErr);
            if (errMsg.includes('Invalid') || errMsg.includes('No END header')) {
                throw new Error(`ZIP 文件格式错误或已损坏: ${errMsg}。请确保上传的文件是完整的有效 ZIP 文件。`);
            }
            throw zipErr;
        }

        // 确保浏览器已关闭
        logger.info('正在关闭浏览器以准备导入数据...');
        await closeBrowser();

        // 清理目标目录
        if (fs.existsSync(userDataDir)) {
            logger.info(`正在清理旧的目标目录: ${userDataDir}`);
            fs.removeSync(userDataDir);
        }

        fs.ensureDirSync(userDataDir);

        logger.info(`正在从 ${zipPath} 导入用户数据到 ${userDataDir} ...`);
        try {
            zipInstance.extractAllTo(userDataDir, true);
        } catch (extractErr) {
            // 捕获解压过程中的错误
            if (extractErr.code === 'ENOSPC' || extractErr.message.includes('空间')) {
                throw new Error(`解压失败: 磁盘空间不足。请检查目标路径的可用空间。`);
            }
            throw new Error(`解压 ZIP 文件失败: ${extractErr.message}`);
        }

        logger.info('用户数据导入完成');
        return true;
    } catch (error) {
        logger.error('导入用户数据失败:', error);
        throw error;
    }
}

export function listManagedBrowserProfiles() {
    return listBrowserProfiles();
}

export function getManagedBrowserProfile(profileId) {
    return getBrowserProfile(profileId);
}

export function createManagedBrowserProfile(payload = {}) {
    return createBrowserProfile(payload);
}

export function updateManagedBrowserProfile(profileId, payload = {}) {
    return updateBrowserProfile(profileId, payload);
}

export async function deleteManagedBrowserProfile(profileId) {
    const normalizedProfileId = String(profileId || '').trim();
    if (!normalizedProfileId) {
        throw new Error('缺少 profileId');
    }

    await closeManagedProfileBrowser(normalizedProfileId);
    forgetManagedProfileBrowserSession(normalizedProfileId);
    if (currentManagedProfileId === normalizedProfileId) {
        currentManagedProfileId = null;
    }
    return deleteBrowserProfile(profileId);
}

export function switchManagedBrowserProfile(profileId) {
    return switchBrowserProfile(profileId);
}

/**
 * 清理资源
 */
export async function cleanup() {
    await closeManagedProfileBrowser();
    await closeBrowser();
}

// 导出默认的浏览器服务类
export class BrowserService {
    static async getOrCreateBrowser(options = {}) {
        return getOrCreateBrowser(options);
    }

    static async close(options = {}) {
        return closeBrowser(options);
    }

    static async clearUserData() {
        return clearUserData();
    }

    static async getStatus(options = {}) {
        return await getBrowserStatus(options);
    }

    static async cleanup() {
        return cleanup();
    }

    static async isBrowserAvailable(options = {}) {
        return isBrowserAvailable(options);
    }

    static async detectExistingBrowser() {
        return detectExistingBrowser();
    }

    static launchWithDebugPort(options = {}) {
        return launchWithDebugPort(options);
    }

    static updateActivity(options = {}) {
        return updateBrowserActivity(options);
    }

    static keepOpen() {
        return keepBrowserOpen();
    }

    static async exportUserData(userDataDir) {
        return exportUserData(userDataDir);
    }

    static async importUserData(zipPath, userDataDir) {
        return importUserData(zipPath, userDataDir);
    }

    static async forceCloseByPort(options = {}) {
        return forceCloseBrowserByPort(options);
    }

    static listProfiles() {
        return listBrowserProfiles();
    }

    static getProfile(profileId) {
        return getBrowserProfile(profileId);
    }

    static createProfile(payload = {}) {
        return createBrowserProfile(payload);
    }

    static updateProfile(profileId, payload = {}) {
        return updateBrowserProfile(profileId, payload);
    }

    static async deleteProfile(profileId) {
        const normalizedProfileId = String(profileId || '').trim();
        if (!normalizedProfileId) {
            throw new Error('缺少 profileId');
        }

        await closeManagedProfileBrowser(normalizedProfileId);
        forgetManagedProfileBrowserSession(normalizedProfileId);
        if (currentManagedProfileId === normalizedProfileId) {
            currentManagedProfileId = null;
        }
        return deleteBrowserProfile(profileId);
    }

    static switchProfile(profileId) {
        return switchBrowserProfile(profileId);
    }

    static async focus(options = {}) {
        return focusBrowser(options);
    }

    static async listPages(options = {}) {
        return listBrowserPages(options);
    }

    static async getPage(pageIndex, options = {}) {
        return getBrowserPage(pageIndex, options);
    }

    static async createPage(options = {}) {
        return createBrowserPage(options);
    }
}

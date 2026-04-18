import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { chromium as playwrightChromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalizeDir(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return null;
    }

    return path.resolve(normalized);
}

export function isPackagedRuntime() {
    return typeof process.__nexe !== 'undefined';
}

export function getAppDir() {
    const explicitDir = normalizeDir(process.env.YISHE_APP_ROOT_DIR || process.env.UPLOADER_APP_ROOT_DIR);
    if (explicitDir) {
        return explicitDir;
    }

    if (isPackagedRuntime()) {
        return path.dirname(process.execPath);
    }

    return path.resolve(__dirname, '../..');
}

function existsAny(paths = []) {
    for (const candidate of paths) {
        try {
            if (candidate && existsSync(candidate)) {
                return candidate;
            }
        } catch {
            // ignore
        }
    }

    return null;
}

function getConfiguredChromeExecutableInfo() {
    const candidates = [
        ['YISHE_BROWSER_EXECUTABLE', process.env.YISHE_BROWSER_EXECUTABLE],
        ['YISHE_REMOTION_BROWSER_EXECUTABLE', process.env.YISHE_REMOTION_BROWSER_EXECUTABLE],
        ['CHROME_EXECUTABLE_PATH', process.env.CHROME_EXECUTABLE_PATH],
    ];

    for (const [envName, value] of candidates) {
        const normalizedPath = normalizeDir(value);
        if (normalizedPath) {
            return {
                configuredBy: envName,
                executablePath: normalizedPath,
            };
        }
    }

    return null;
}

function getSystemChromeExecutableCandidates() {
    if (process.platform === 'win32') {
        const pf = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const pf64 = process.env.ProgramFiles || 'C:\\Program Files';
        const localAppData = process.env.LOCALAPPDATA || '';
        return [
            path.join(pf64, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            localAppData
                ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
                : '',
        ].filter(Boolean);
    }

    if (process.platform === 'darwin') {
        return [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            path.join(
                process.env.HOME || '',
                'Applications',
                'Google Chrome.app',
                'Contents',
                'MacOS',
                'Google Chrome'
            ),
        ].filter(Boolean);
    }

    return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
    ];
}

export function getDefaultChromeExecutableInfo() {
    const configuredInfo = getConfiguredChromeExecutableInfo();
    if (configuredInfo) {
        return {
            executablePath: configuredInfo.executablePath,
            exists: existsSync(configuredInfo.executablePath),
            source: 'env',
            configuredBy: configuredInfo.configuredBy,
            checkedPaths: [configuredInfo.executablePath],
        };
    }

    const checkedPaths = getSystemChromeExecutableCandidates();
    const executablePath = existsAny(checkedPaths) || checkedPaths[0] || null;

    return {
        executablePath,
        exists: !!(executablePath && existsSync(executablePath)),
        source: 'system',
        configuredBy: null,
        checkedPaths,
    };
}

export function buildMissingLocalChromeMessage(
    info = getDefaultChromeExecutableInfo()
) {
    const executablePath = String(info?.executablePath || '').trim();
    const configuredBy = String(info?.configuredBy || '').trim();
    const checkedPaths = Array.isArray(info?.checkedPaths)
        ? info.checkedPaths.filter(Boolean)
        : [];
    const checkedPathText = checkedPaths.length
        ? `已检查路径: ${checkedPaths.join(', ')}`
        : '未检测到可检查的浏览器路径';

    if (configuredBy && executablePath) {
        return `缺少本地浏览器：环境变量 ${configuredBy} 指向的浏览器不存在 (${executablePath})。请安装本地 Chrome/Chromium，或修正 ${configuredBy}。`;
    }

    return `缺少本地浏览器，请先安装 Chrome/Chromium，或设置 YISHE_BROWSER_EXECUTABLE。${checkedPathText}`;
}

export function getDefaultChromeExecutablePath() {
    return getDefaultChromeExecutableInfo().executablePath;
}

export function initBundledPlaywrightEnv() {
    const info = getDefaultChromeExecutableInfo();
    return {
        browsersPath: null,
        executablePath: info.executablePath,
        exists: info.exists,
        source: info.exists ? 'local-chrome' : 'missing-local-chrome',
        usingBundledPath: false,
        checkedPaths: info.checkedPaths,
        configuredBy: info.configuredBy,
        message: info.exists ? null : buildMissingLocalChromeMessage(info),
    };
}

export async function getPlaywrightChromium() {
    initBundledPlaywrightEnv();
    return playwrightChromium;
}

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

function uniquePaths(paths = []) {
    return paths.filter((candidate, index, list) => candidate && list.indexOf(candidate) === index);
}

function resolveEmbeddedChromeMode() {
    const configuredMode = String(
        process.env.YISHE_BROWSER_CHROME_MODE ||
        process.env.YISHE_REMOTION_CHROME_MODE ||
        ''
    ).trim();

    if (configuredMode === 'headless-shell') {
        return configuredMode;
    }

    return 'chrome-for-testing';
}

function getEmbeddedExecutableRelativePath(chromeMode) {
    if (chromeMode === 'headless-shell') {
        if (process.platform === 'win32' && process.arch === 'x64') {
            return path.join('chrome-headless-shell-win64', 'chrome-headless-shell.exe');
        }

        if (process.platform === 'darwin' && process.arch === 'arm64') {
            return path.join('chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
        }

        if (process.platform === 'darwin' && process.arch === 'x64') {
            return path.join('chrome-headless-shell-mac-x64', 'chrome-headless-shell');
        }

        if (process.platform === 'linux' && process.arch === 'arm64') {
            return path.join('chrome-headless-shell-linux-arm64', 'headless_shell');
        }

        if (process.platform === 'linux') {
            return path.join('chrome-headless-shell-linux64', 'chrome-headless-shell');
        }

        return null;
    }

    if (process.platform === 'win32' && process.arch === 'x64') {
        return path.join('chrome-win64', 'chrome.exe');
    }

    if (process.platform === 'darwin' && process.arch === 'arm64') {
        return path.join(
            'chrome-mac-arm64',
            'Google Chrome for Testing.app',
            'Contents',
            'MacOS',
            'Google Chrome for Testing'
        );
    }

    if (process.platform === 'darwin' && process.arch === 'x64') {
        return path.join(
            'chrome-mac-x64',
            'Google Chrome for Testing.app',
            'Contents',
            'MacOS',
            'Google Chrome for Testing'
        );
    }

    if (process.platform === 'linux') {
        return path.join('chrome-linux64', 'chrome');
    }

    return null;
}

function getEmbeddedExecutableCandidates(chromeMode) {
    const executableRelativePath = getEmbeddedExecutableRelativePath(chromeMode);
    if (!executableRelativePath) {
        return [];
    }

    const nestedResourcePath = path.join('resources', 'remotion-browser', chromeMode);
    const flatResourcePath = path.join('remotion-browser', chromeMode);

    return uniquePaths([
        process.resourcesPath
            ? path.join(process.resourcesPath, nestedResourcePath, executableRelativePath)
            : '',
        process.resourcesPath
            ? path.join(process.resourcesPath, flatResourcePath, executableRelativePath)
            : '',
        process.resourcesPath
            ? path.join(process.resourcesPath, 'app.asar.unpacked', nestedResourcePath, executableRelativePath)
            : '',
        process.resourcesPath
            ? path.join(process.resourcesPath, 'app.asar.unpacked', flatResourcePath, executableRelativePath)
            : '',
        path.resolve(process.cwd(), 'resources', 'remotion-browser', chromeMode, executableRelativePath),
    ]);
}

export function getBundledChromeExecutablePath() {
    const preferredMode = resolveEmbeddedChromeMode();
    const searchOrder = preferredMode === 'headless-shell'
        ? ['headless-shell', 'chrome-for-testing']
        : ['chrome-for-testing', 'headless-shell'];

    for (const chromeMode of searchOrder) {
        for (const candidate of getEmbeddedExecutableCandidates(chromeMode)) {
            try {
                if (candidate && existsSync(candidate)) {
                    return candidate;
                }
            } catch {
                // ignore
            }
        }
    }

    return null;
}

export function initBundledPlaywrightEnv() {
    const executablePath = getBundledChromeExecutablePath();
    return {
        browsersPath: null,
        executablePath,
        exists: !!executablePath,
        source: executablePath ? 'bundled-chrome' : 'local-chrome',
        usingBundledPath: !!executablePath,
    };
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

export function getDefaultChromeExecutablePath() {
    const configuredPath = normalizeDir(
        process.env.YISHE_BROWSER_EXECUTABLE ||
        process.env.YISHE_REMOTION_BROWSER_EXECUTABLE ||
        process.env.CHROME_EXECUTABLE_PATH
    );
    if (configuredPath) {
        return configuredPath;
    }

    const bundledPath = getBundledChromeExecutablePath();
    if (bundledPath) {
        return bundledPath;
    }

    if (process.platform === 'win32') {
        const pf = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const pf64 = process.env.ProgramFiles || 'C:\\Program Files';
        return existsAny([
            path.join(pf64, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]) || path.join(pf64, 'Google', 'Chrome', 'Application', 'chrome.exe');
    }

    if (process.platform === 'darwin') {
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    return '/usr/bin/google-chrome';
}

export async function getPlaywrightChromium() {
    initBundledPlaywrightEnv();
    return playwrightChromium;
}

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

export function initBundledPlaywrightEnv() {
    return {
        browsersPath: null,
        exists: false,
        source: 'local-chrome',
        usingBundledPath: false,
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

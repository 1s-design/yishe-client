import fs from 'fs';
import path from 'path';
import { homedir, platform } from 'os';
import ElectronStore from 'electron-store';

const Store = ElectronStore?.default || ElectronStore;

let storeInstance = null;

function normalizePath(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return '';
    }

    try {
        return path.resolve(normalized);
    } catch {
        return normalized;
    }
}

function getStore() {
    if (storeInstance) {
        return storeInstance;
    }

    try {
        storeInstance = new Store({
            defaults: {
                workspaceDirectory: '',
            },
        });
    } catch {
        storeInstance = null;
    }

    return storeInstance;
}

export function getDefaultClientWorkspaceDirectory() {
    if (platform() === 'win32') {
        return 'C:\\yisheworkspace';
    }

    return path.join(homedir(), 'yisheworkspace');
}

export function getClientWorkspaceDirectory() {
    const explicitWorkspaceDir = normalizePath(
        process.env.YISHE_WORKSPACE_DIR || process.env.YISHE_CLIENT_WORKSPACE_DIR,
    );
    if (explicitWorkspaceDir) {
        return explicitWorkspaceDir;
    }

    try {
        const storedWorkspaceDir = normalizePath(
            getStore()?.get('workspaceDirectory', '') || '',
        );
        if (storedWorkspaceDir) {
            return storedWorkspaceDir;
        }
    } catch {
        // ignore
    }

    return normalizePath(getDefaultClientWorkspaceDirectory());
}

export function getAutoBrowserWorkspaceDir() {
    const explicitWorkspaceDir = normalizePath(
        process.env.YISHE_AUTO_BROWSER_WORKSPACE_DIR ||
        process.env.YISHE_BROWSER_PROFILE_WORKSPACE_DIR ||
        process.env.BROWSER_PROFILE_WORKSPACE_DIR,
    );
    if (explicitWorkspaceDir) {
        return explicitWorkspaceDir;
    }

    return path.resolve(getClientWorkspaceDirectory(), 'auto-browser');
}

export function resolveAutoBrowserPath(...segments) {
    return path.resolve(getAutoBrowserWorkspaceDir(), ...segments);
}

export function ensureDirectory(dirPath) {
    const resolved = normalizePath(dirPath);
    if (!resolved) {
        throw new Error('目录路径不能为空');
    }

    if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
    }
    return resolved;
}

export function getAutoBrowserTempDir() {
    return ensureDirectory(resolveAutoBrowserPath('temp'));
}

export function getAutoBrowserAuthDataDir() {
    return ensureDirectory(resolveAutoBrowserPath('auth-data'));
}

export function getAutoBrowserScreenshotDir() {
    return ensureDirectory(resolveAutoBrowserPath('screenshots'));
}

export function getAutoBrowserUploadDir() {
    return ensureDirectory(resolveAutoBrowserPath('uploads'));
}

export function buildAutoBrowserFilePath(subDir, fileName, fallbackPrefix = 'auto-browser-file') {
    const safeFileName = String(fileName || '').trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
    const normalizedFileName = safeFileName || `${fallbackPrefix}-${Date.now()}`;
    return path.resolve(ensureDirectory(resolveAutoBrowserPath(subDir)), normalizedFileName);
}

export function buildAutoBrowserScreenshotPath(fileName) {
    return buildAutoBrowserFilePath('screenshots', fileName, 'browser-screenshot');
}

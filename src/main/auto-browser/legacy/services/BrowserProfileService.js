import path from 'path';
import os from 'os';
import fs from 'fs-extra';

const REGISTRY_FILENAME = 'profiles.json';
const PROFILE_FILENAME = 'profile.json';
const PROFILE_DIRNAME = 'browser-profiles';
const USER_DATA_DIRNAME = 'user-data';
const DEBUG_PORT_BASE = Number(process.env.BROWSER_PROFILE_DEBUG_PORT_BASE) || 9333;
const DEBUG_PORT_MAX = Number(process.env.BROWSER_PROFILE_DEBUG_PORT_MAX) || 9999;

function getDefaultWorkspaceDir() {
    const envDir = process.env.YISHE_BROWSER_PROFILE_WORKSPACE_DIR || process.env.BROWSER_PROFILE_WORKSPACE_DIR;
    if (envDir) {
        return path.resolve(envDir);
    }

    if (process.platform === 'win32') {
        return path.resolve('C:\\temp\\yishe-auto-browser-workspace');
    }

    const homeDir = os.homedir();
    const safeBase = homeDir && typeof homeDir === 'string'
        ? homeDir
        : process.cwd();

    return path.resolve(safeBase, '.yishe-auto-browser', 'workspace');
}

export function getBrowserProfilesWorkspaceDir() {
    return getDefaultWorkspaceDir();
}

export function getBrowserProfilesRootDir() {
    return path.resolve(getDefaultWorkspaceDir(), PROFILE_DIRNAME);
}

function getRegistryPath() {
    return path.resolve(getBrowserProfilesRootDir(), REGISTRY_FILENAME);
}

function getProfileDirectory(profileId) {
    return path.resolve(getBrowserProfilesRootDir(), String(profileId));
}

export function getBrowserProfileUserDataDir(profileId) {
    return path.resolve(getProfileDirectory(profileId), USER_DATA_DIRNAME);
}

function getProfileMetaPath(profileId) {
    return path.resolve(getProfileDirectory(profileId), PROFILE_FILENAME);
}

function createEmptyRegistry() {
    return {
        version: 1,
        activeProfileId: null,
        items: [],
    };
}

function normalizeProfileId(value, fallback = '') {
    const normalized = String(value || fallback || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '');
    return normalized || '';
}

function normalizeProfileList(items = []) {
    return (Array.isArray(items) ? items : [])
        .map((item) => ({
            id: normalizeProfileId(item?.id),
            name: String(item?.name || '').trim() || undefined,
        }))
        .filter((item) => !!item.id);
}

function normalizePlatforms(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

function normalizeDebugPort(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return null;
    }
    return port;
}

function loadProfileRecordsByRegistry(registry) {
    const items = Array.isArray(registry?.items) ? registry.items : [];
    const records = new Map();

    for (const item of items) {
        const profileId = normalizeProfileId(item?.id);
        if (!profileId) {
            continue;
        }

        records.set(
            profileId,
            loadProfileRecord(profileId) || buildProfileRecord(profileId, item)
        );
    }

    return records;
}

function collectUsedDebugPorts(registry, { excludeProfileId = '', records = null } = {}) {
    const usedPorts = new Set();
    const normalizedExcludeProfileId = normalizeProfileId(excludeProfileId);
    const items = Array.isArray(registry?.items) ? registry.items : [];

    for (const item of items) {
        const profileId = normalizeProfileId(item?.id);
        if (!profileId || profileId === normalizedExcludeProfileId) {
            continue;
        }

        const record = records instanceof Map
            ? (records.get(profileId) || null)
            : loadProfileRecord(profileId);
        const debugPort = normalizeDebugPort(record?.debugPort);
        if (debugPort) {
            usedPorts.add(debugPort);
        }
    }

    return usedPorts;
}

function allocateDebugPortFromUsedPorts(usedPorts) {
    for (let port = DEBUG_PORT_BASE; port <= DEBUG_PORT_MAX; port += 1) {
        if (!usedPorts.has(port)) {
            return port;
        }
    }

    throw new Error(`没有可用的浏览器调试端口，请检查 ${DEBUG_PORT_BASE}-${DEBUG_PORT_MAX} 端口段`);
}

function allocateDebugPort(registry, options = {}) {
    const usedPorts = collectUsedDebugPorts(registry, options);
    return allocateDebugPortFromUsedPorts(usedPorts);
}

function buildProfileRecord(profileId, payload = {}) {
    const now = new Date().toISOString();
    return {
        id: profileId,
        name: String(payload.name || profileId).trim() || profileId,
        remark: String(payload.remark || '').trim() || '',
        account: String(payload.account || '').trim() || '',
        platforms: normalizePlatforms(payload.platforms),
        debugPort: normalizeDebugPort(payload.debugPort),
        browserVersion: String(payload.browserVersion || '').trim() || '',
        loginSummary: payload.loginSummary && typeof payload.loginSummary === 'object'
            ? payload.loginSummary
            : {},
        createdAt: payload.createdAt || now,
        updatedAt: payload.updatedAt || now,
        lastUsedAt: payload.lastUsedAt || null,
    };
}

function loadRegistry() {
    const registryPath = getRegistryPath();
    try {
        if (!fs.existsSync(registryPath)) {
            return createEmptyRegistry();
        }

        const raw = fs.readJsonSync(registryPath);
        return {
            version: Number(raw?.version) || 1,
            activeProfileId: normalizeProfileId(raw?.activeProfileId) || null,
            items: normalizeProfileList(raw?.items),
        };
    } catch {
        return createEmptyRegistry();
    }
}

function saveRegistry(registry) {
    fs.ensureDirSync(getBrowserProfilesRootDir());
    fs.writeJsonSync(getRegistryPath(), registry, { spaces: 2 });
}

function loadProfileRecord(profileId) {
    const metaPath = getProfileMetaPath(profileId);
    if (!fs.existsSync(metaPath)) {
        return null;
    }

    try {
        const raw = fs.readJsonSync(metaPath);
        return buildProfileRecord(profileId, raw);
    } catch {
        return null;
    }
}

function saveProfileRecord(profileId, payload) {
    const profileDir = getProfileDirectory(profileId);
    fs.ensureDirSync(profileDir);
    fs.ensureDirSync(getBrowserProfileUserDataDir(profileId));
    fs.writeJsonSync(getProfileMetaPath(profileId), buildProfileRecord(profileId, payload), { spaces: 2 });
}

function ensureProfileDebugPort(profileId, profile, registry, options = {}) {
    const debugPort = normalizeDebugPort(profile?.debugPort);
    if (debugPort) {
        if (options.usedPorts instanceof Set) {
            options.usedPorts.add(debugPort);
        }
        return {
            ...profile,
            debugPort,
        };
    }

    const nextDebugPort = options.usedPorts instanceof Set
        ? allocateDebugPortFromUsedPorts(options.usedPorts)
        : allocateDebugPort(registry, {
            excludeProfileId: profileId,
            records: options.records,
        });
    const nextRecord = buildProfileRecord(profileId, {
        ...profile,
        debugPort: nextDebugPort,
    });
    saveProfileRecord(profileId, nextRecord);
    if (options.records instanceof Map) {
        options.records.set(profileId, nextRecord);
    }
    if (options.usedPorts instanceof Set) {
        options.usedPorts.add(nextDebugPort);
    }
    return nextRecord;
}

function summarizeProfile(profile, registry) {
    const profileId = normalizeProfileId(profile?.id);
    const userDataDir = getBrowserProfileUserDataDir(profileId);
    const activeProfileId = normalizeProfileId(registry?.activeProfileId) || null;
    return {
        id: profileId,
        name: String(profile?.name || profileId).trim() || profileId,
        remark: String(profile?.remark || '').trim() || '',
        account: String(profile?.account || '').trim() || '',
        platforms: normalizePlatforms(profile?.platforms),
        debugPort: normalizeDebugPort(profile?.debugPort),
        browserVersion: String(profile?.browserVersion || '').trim() || '',
        loginSummary: profile?.loginSummary && typeof profile.loginSummary === 'object'
            ? profile.loginSummary
            : {},
        createdAt: profile?.createdAt || null,
        updatedAt: profile?.updatedAt || null,
        lastUsedAt: profile?.lastUsedAt || null,
        userDataDir,
        exists: fs.existsSync(userDataDir),
        isActive: activeProfileId === profileId,
    };
}

function getNextProfileId(items = []) {
    const used = new Set((Array.isArray(items) ? items : []).map((item) => normalizeProfileId(item?.id)));
    for (let index = 1; index < 1000; index += 1) {
        const candidate = String(index).padStart(3, '0');
        if (!used.has(candidate)) {
            return candidate;
        }
    }

    return `profile_${Date.now()}`;
}

export function ensureBrowserProfilesWorkspace() {
    fs.ensureDirSync(getBrowserProfilesRootDir());
    const registry = loadRegistry();
    saveRegistry(registry);
    return {
        workspaceDir: getDefaultWorkspaceDir(),
        profilesRootDir: getBrowserProfilesRootDir(),
        registryPath: getRegistryPath(),
    };
}

export function listBrowserProfiles() {
    const registry = loadRegistry();
    const records = loadProfileRecordsByRegistry(registry);
    const usedPorts = collectUsedDebugPorts(registry, { records });
    const profiles = registry.items
        .map((item) => {
            const profileId = normalizeProfileId(item?.id);
            if (!profileId) {
                return null;
            }
            const record = records.get(profileId) || buildProfileRecord(profileId, item);
            return ensureProfileDebugPort(profileId, record, registry, {
                records,
                usedPorts,
            });
        })
        .filter(Boolean)
        .map((item) => summarizeProfile(item, registry));

    return {
        workspaceDir: getDefaultWorkspaceDir(),
        profilesRootDir: getBrowserProfilesRootDir(),
        activeProfileId: registry.activeProfileId || null,
        items: profiles,
    };
}

export function getBrowserProfile(profileId) {
    const normalizedId = normalizeProfileId(profileId);
    if (!normalizedId) {
        return null;
    }
    const registry = loadRegistry();
    const record = loadProfileRecord(normalizedId);
    if (!record) {
        return null;
    }
    return summarizeProfile(ensureProfileDebugPort(normalizedId, record, registry), registry);
}

export function createBrowserProfile(payload = {}) {
    ensureBrowserProfilesWorkspace();
    const registry = loadRegistry();
    const requestedId = normalizeProfileId(payload.id);
    const profileId = requestedId || getNextProfileId(registry.items);

    if (registry.items.some((item) => item.id === profileId)) {
        throw new Error(`环境已存在: ${profileId}`);
    }

    const now = new Date().toISOString();
    const requestedDebugPort = normalizeDebugPort(payload.debugPort);
    const debugPort = requestedDebugPort || allocateDebugPort(registry);
    if (collectUsedDebugPorts(registry).has(debugPort)) {
        throw new Error(`浏览器调试端口已被其他环境占用: ${debugPort}`);
    }
    const record = buildProfileRecord(profileId, {
        ...payload,
        debugPort,
        createdAt: now,
        updatedAt: now,
    });

    saveProfileRecord(profileId, record);
    registry.items.push({ id: profileId, name: record.name });
    if (!registry.activeProfileId) {
        registry.activeProfileId = profileId;
    }
    saveRegistry(registry);

    return summarizeProfile(record, registry);
}

export function ensureDefaultBrowserProfile(payload = {}) {
    const registry = loadRegistry();
    if (registry.activeProfileId) {
        return getBrowserProfile(registry.activeProfileId);
    }

    if (Array.isArray(registry.items) && registry.items.length > 0) {
        const firstProfileId = registry.items[0]?.id;
        if (firstProfileId) {
            return switchBrowserProfile(firstProfileId);
        }
    }

    return createBrowserProfile({
        name: '默认环境',
        remark: '系统自动创建',
        ...payload,
    });
}

export function updateBrowserProfile(profileId, payload = {}) {
    const normalizedId = normalizeProfileId(profileId);
    if (!normalizedId) {
        throw new Error('缺少 profileId');
    }

    const existing = loadProfileRecord(normalizedId);
    if (!existing) {
        throw new Error(`环境不存在: ${normalizedId}`);
    }

    const registry = loadRegistry();
    const hasDebugPortPatch = Object.prototype.hasOwnProperty.call(payload, 'debugPort');
    const requestedDebugPort = hasDebugPortPatch
        ? normalizeDebugPort(payload.debugPort)
        : normalizeDebugPort(existing.debugPort);
    const debugPort = requestedDebugPort || allocateDebugPort(registry, { excludeProfileId: normalizedId });
    if (collectUsedDebugPorts(registry, { excludeProfileId: normalizedId }).has(debugPort)) {
        throw new Error(`浏览器调试端口已被其他环境占用: ${debugPort}`);
    }
    const nextRecord = buildProfileRecord(normalizedId, {
        ...existing,
        ...payload,
        id: normalizedId,
        debugPort,
        updatedAt: new Date().toISOString(),
    });
    saveProfileRecord(normalizedId, nextRecord);
    registry.items = normalizeProfileList(
        registry.items.map((item) => (item.id === normalizedId ? { ...item, name: nextRecord.name } : item)),
    );
    saveRegistry(registry);
    return summarizeProfile(nextRecord, registry);
}

export function deleteBrowserProfile(profileId) {
    const normalizedId = normalizeProfileId(profileId);
    if (!normalizedId) {
        throw new Error('缺少 profileId');
    }

    const registry = loadRegistry();
    const existing = loadProfileRecord(normalizedId);
    if (!existing) {
        throw new Error(`环境不存在: ${normalizedId}`);
    }

    fs.removeSync(getProfileDirectory(normalizedId));
    registry.items = registry.items.filter((item) => item.id !== normalizedId);
    if (registry.activeProfileId === normalizedId) {
        registry.activeProfileId = registry.items[0]?.id || null;
    }
    saveRegistry(registry);

    return {
        deleted: true,
        profileId: normalizedId,
        activeProfileId: registry.activeProfileId || null,
    };
}

export function switchBrowserProfile(profileId) {
    const normalizedId = normalizeProfileId(profileId);
    if (!normalizedId) {
        throw new Error('缺少 profileId');
    }

    const registry = loadRegistry();
    const exists = registry.items.some((item) => item.id === normalizedId);
    if (!exists) {
        throw new Error(`环境不存在: ${normalizedId}`);
    }

    registry.activeProfileId = normalizedId;
    saveRegistry(registry);
    const record = loadProfileRecord(normalizedId) || buildProfileRecord(normalizedId, { name: normalizedId });
    return summarizeProfile(record, registry);
}

export function getActiveBrowserProfile() {
    const registry = loadRegistry();
    if (!registry.activeProfileId) {
        return null;
    }
    return getBrowserProfile(registry.activeProfileId);
}

export function findBrowserProfileByUserDataDir(userDataDir) {
    const target = path.resolve(String(userDataDir || ''));
    if (!target) {
        return null;
    }

    const registry = loadRegistry();
    for (const item of registry.items) {
        const profilePath = path.resolve(getBrowserProfileUserDataDir(item.id));
        if (profilePath === target) {
            const record = loadProfileRecord(item.id) || buildProfileRecord(item.id, item);
            return summarizeProfile(record, registry);
        }
    }

    return null;
}

export function markBrowserProfileUsed(profileId, patch = {}) {
    const normalizedId = normalizeProfileId(profileId);
    if (!normalizedId) {
        return null;
    }
    const existing = loadProfileRecord(normalizedId);
    if (!existing) {
        return null;
    }

    return updateBrowserProfile(normalizedId, {
        ...existing,
        ...patch,
        lastUsedAt: patch.lastUsedAt || new Date().toISOString(),
    });
}

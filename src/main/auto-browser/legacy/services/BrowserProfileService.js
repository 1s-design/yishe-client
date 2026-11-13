import path from 'path';
import { randomUUID } from 'node:crypto';
import fs from 'fs-extra';
import ElectronStore from 'electron-store';
import { getAutoBrowserWorkspaceDir } from '../utils/workspacePaths.js';

const REGISTRY_FILENAME = 'profiles.json';
const PROFILE_FILENAME = 'profile.json';
const PROFILE_DIRNAME = 'browser-profiles';
const USER_DATA_DIRNAME = 'user-data';
const DEBUG_PORT_BASE = Number(process.env.BROWSER_PROFILE_DEBUG_PORT_BASE) || 9333;
const DEBUG_PORT_MAX = Number(process.env.BROWSER_PROFILE_DEBUG_PORT_MAX) || 9999;
const MACHINE_CODE_STORE_KEY = 'clientMachineCode';
const Store = ElectronStore?.default || ElectronStore;

// 图片采集专用浏览器环境：所有需要真浏览器的采集源共用一个，系统自动创建、不可删除。
// 只有这一个环境受保护；历史单源环境（【素材采集】SVGRepo 等）已下线，不再参与保护判定。
const COLLECT_PROFILE_NAME = '【素材采集】采集专用';
const COLLECT_PROFILE_PLATFORM = 'image-collect';
const COLLECT_MANAGED_BY = 'system:collect';

let identityStoreInstance = null;

function getDefaultWorkspaceDir() {
    return getAutoBrowserWorkspaceDir();
}

function getIdentityStore() {
    if (identityStoreInstance) {
        return identityStoreInstance;
    }

    try {
        identityStoreInstance = new Store({
            defaults: {
                workspaceDirectory: '',
                [MACHINE_CODE_STORE_KEY]: '',
            },
        });
    } catch {
        identityStoreInstance = null;
    }

    return identityStoreInstance;
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

function normalizeMachineCode(value, fallback = '') {
    return normalizeProfileId(String(value || fallback || '').toUpperCase());
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

function hasCollectPlatformTag(payload = {}) {
    const platforms = normalizePlatforms(payload?.platforms).map((item) => item.toLowerCase());
    return platforms.includes(COLLECT_PROFILE_PLATFORM);
}

/** 判断环境是否为采集系统托管（受保护、不可删除、不参与默认环境选举） */
export function isCollectManagedProfile(payload = {}) {
    if (payload?.protected === true || payload?.nonDeletable === true) {
        return true;
    }
    if (String(payload?.managedBy || '').trim() === COLLECT_MANAGED_BY) {
        return true;
    }
    if (hasCollectPlatformTag(payload)) {
        return true;
    }
    const name = String(payload?.name || '').trim();
    const remark = String(payload?.remark || '').trim();
    // 只认采集专用环境本身，历史单源环境不再自动获得保护
    return name === COLLECT_PROFILE_NAME || remark.includes(COLLECT_PROFILE_NAME);
}

function resolveCollectProfileKind(payload = {}) {
    const explicit = String(payload?.kind || '').trim();
    if (explicit && explicit !== 'collect-legacy') {
        return explicit;
    }
    return isCollectManagedProfile(payload) ? 'collect-shared' : '';
}

function normalizeDebugPort(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return null;
    }
    return port;
}

function isManagedProfileDebugPort(value) {
    const port = normalizeDebugPort(value);
    return !!(port && port >= DEBUG_PORT_BASE && port <= DEBUG_PORT_MAX);
}

function normalizeManagedProfileDebugPort(value) {
    const port = normalizeDebugPort(value);
    return isManagedProfileDebugPort(port) ? port : null;
}

function generateMachineCode() {
    return `YC-${randomUUID().replace(/[^a-zA-Z0-9]/g, '').slice(-12).toUpperCase()}`;
}

function getDefaultMachineCode() {
    const store = getIdentityStore();
    const storedCode = normalizeMachineCode(store?.get(MACHINE_CODE_STORE_KEY, ''));
    if (storedCode) {
        return storedCode;
    }

    const nextCode = generateMachineCode();
    try {
        store?.set(MACHINE_CODE_STORE_KEY, nextCode);
    } catch {
        // ignore
    }
    return nextCode;
}

function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function reconcileProfileDebugPorts(registry) {
    const records = loadProfileRecordsByRegistry(registry);
    const items = Array.isArray(registry?.items) ? registry.items : [];
    const portCounts = new Map();
    const currentPorts = new Map();

    for (const item of items) {
        const profileId = normalizeProfileId(item?.id);
        if (!profileId) {
            continue;
        }

        const record = records.get(profileId) || loadProfileRecord(profileId) || buildProfileRecord(profileId, item);
        records.set(profileId, record);
        const debugPort = normalizeManagedProfileDebugPort(record?.debugPort);
        currentPorts.set(profileId, debugPort);
        if (debugPort) {
            portCounts.set(debugPort, Number(portCounts.get(debugPort) || 0) + 1);
        }
    }

    const reservedPorts = new Set(
        Array.from(portCounts.entries())
            .filter(([, count]) => Number(count) === 1)
            .map(([port]) => Number(port)),
    );
    const usedPorts = new Set(reservedPorts);

    for (const item of items) {
        const profileId = normalizeProfileId(item?.id);
        if (!profileId) {
            continue;
        }

        const record = records.get(profileId) || buildProfileRecord(profileId, item);
        const currentPort = currentPorts.get(profileId) || null;
        const isUniqueReserved = !!(currentPort && reservedPorts.has(currentPort));
        const canKeepCurrent = isUniqueReserved || !!(currentPort && !usedPorts.has(currentPort));

        if (canKeepCurrent) {
            usedPorts.add(currentPort);
            if (normalizeDebugPort(record?.debugPort) !== currentPort) {
                const nextRecord = buildProfileRecord(profileId, {
                    ...record,
                    debugPort: currentPort,
                });
                saveProfileRecord(profileId, nextRecord);
                records.set(profileId, nextRecord);
            }
            continue;
        }

        const nextDebugPort = allocateDebugPortFromUsedPorts(usedPorts);
        usedPorts.add(nextDebugPort);
        const nextRecord = buildProfileRecord(profileId, {
            ...record,
            debugPort: nextDebugPort,
        });
        saveProfileRecord(profileId, nextRecord);
        records.set(profileId, nextRecord);
    }

    return records;
}

function buildProfileRecord(profileId, payload = {}) {
    const now = new Date().toISOString();
    const collectProtected = isCollectManagedProfile(payload);
    const collectKind = collectProtected ? (resolveCollectProfileKind(payload) || 'collect-shared') : '';
    return {
        id: profileId,
        name: String(payload.name || profileId).trim() || profileId,
        remark: String(payload.remark || '').trim() || '',
        account: String(payload.account || '').trim() || '',
        platforms: normalizePlatforms(payload.platforms),
        debugPort: normalizeDebugPort(payload.debugPort),
        browserVersion: String(payload.browserVersion || '').trim() || '',
        headless: typeof payload.headless === 'boolean' ? payload.headless : null,
        loginSummary: payload.loginSummary && typeof payload.loginSummary === 'object'
            ? payload.loginSummary
            : {},
        // 采集专用环境托管标记：受保护、不可删除。
        protected: collectProtected,
        nonDeletable: collectProtected,
        managedBy: collectProtected
            ? (String(payload.managedBy || '').trim() || COLLECT_MANAGED_BY)
            : '',
        kind: collectKind,
        protectedReason: collectProtected
            ? '图片采集专用环境，所有需浏览器采集源共用，系统保护不可删除'
            : '',
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
    const debugPort = normalizeManagedProfileDebugPort(profile?.debugPort);
    if (debugPort && (!(options.usedPorts instanceof Set) || !options.usedPorts.has(debugPort))) {
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
    const collectProtected = profile?.protected === true || isCollectManagedProfile(profile);
    const collectKind = collectProtected
        ? (String(profile?.kind || '').trim() || resolveCollectProfileKind(profile))
        : '';
    return {
        id: profileId,
        name: String(profile?.name || profileId).trim() || profileId,
        remark: String(profile?.remark || '').trim() || '',
        account: String(profile?.account || '').trim() || '',
        platforms: normalizePlatforms(profile?.platforms),
        debugPort: normalizeDebugPort(profile?.debugPort),
        browserVersion: String(profile?.browserVersion || '').trim() || '',
        headless: typeof profile?.headless === 'boolean' ? profile.headless : null,
        loginSummary: profile?.loginSummary && typeof profile.loginSummary === 'object'
            ? profile.loginSummary
            : {},
        protected: collectProtected,
        nonDeletable: collectProtected,
        managedBy: collectProtected
            ? (String(profile?.managedBy || '').trim() || COLLECT_MANAGED_BY)
            : '',
        kind: collectKind,
        protectedReason: collectProtected
            ? (String(profile?.protectedReason || '').trim()
                || '图片采集专用环境，所有需浏览器采集源共用，系统保护不可删除')
            : '',
        createdAt: profile?.createdAt || null,
        updatedAt: profile?.updatedAt || null,
        lastUsedAt: profile?.lastUsedAt || null,
        userDataDir,
        exists: fs.existsSync(userDataDir),
        isActive: activeProfileId === profileId,
    };
}

function getNextProfileId(items = [], machineCode = '') {
    const prefix = normalizeMachineCode(machineCode, getDefaultMachineCode());
    const usedNumbers = new Set();
    const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);

    for (const item of Array.isArray(items) ? items : []) {
        const currentId = normalizeProfileId(item?.id);
        const match = currentId.match(pattern);
        const number = Number(match?.[1] || 0);
        if (Number.isInteger(number) && number > 0) {
            usedNumbers.add(number);
        }
    }

    for (let index = 1; index < 1000000; index += 1) {
        const candidate = `${prefix}-${String(index).padStart(3, '0')}`;
        if (!usedNumbers.has(index) && !fs.existsSync(getProfileDirectory(candidate))) {
            return candidate;
        }
    }

    throw new Error(`设备 ${prefix} 已达到可用环境编号上限`);
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
    const records = reconcileProfileDebugPorts(registry);
    const usedPorts = new Set();
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
    const records = reconcileProfileDebugPorts(registry);
    const record = records.get(normalizedId) || null;
    if (!record) {
        return null;
    }
    return summarizeProfile(record, registry);
}

export function createBrowserProfile(payload = {}) {
    ensureBrowserProfilesWorkspace();
    const registry = loadRegistry();
    const records = reconcileProfileDebugPorts(registry);
    const requestedId = normalizeProfileId(payload.id);
    const profileId = requestedId || getNextProfileId(registry.items, payload.machineCode);

    if (registry.items.some((item) => item.id === profileId)) {
        throw new Error(`环境已存在: ${profileId}`);
    }

    const now = new Date().toISOString();
    const requestedDebugPort = normalizeManagedProfileDebugPort(payload.debugPort);
    const usedPorts = collectUsedDebugPorts(registry, { records });
    const debugPort = requestedDebugPort || allocateDebugPortFromUsedPorts(usedPorts);
    if (usedPorts.has(debugPort)) {
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
    // 采集专用环境不设为默认环境：发布/店铺任务仍走普通环境，互不抢窗口与登录态
    if (!registry.activeProfileId && !record.protected) {
        registry.activeProfileId = profileId;
    }
    saveRegistry(registry);

    return summarizeProfile(record, registry);
}

function isProtectedProfileId(profileId) {
    const normalizedId = normalizeProfileId(profileId);
    if (!normalizedId) {
        return false;
    }
    const record = loadProfileRecord(normalizedId);
    return !!record && (record.protected === true || isCollectManagedProfile(record));
}

export function ensureDefaultBrowserProfile(payload = {}) {
    const registry = loadRegistry();
    if (registry.activeProfileId && !isProtectedProfileId(registry.activeProfileId)) {
        return getBrowserProfile(registry.activeProfileId);
    }

    const candidate = (Array.isArray(registry.items) ? registry.items : [])
        .map((item) => normalizeProfileId(item?.id))
        .find((profileId) => !!profileId && !isProtectedProfileId(profileId));
    if (candidate) {
        return switchBrowserProfile(candidate);
    }

    return createBrowserProfile({
        name: '默认环境',
        remark: '系统自动创建',
        ...payload,
    });
}

/**
 * 幂等获取（必要时自动创建）唯一的「图片采集专用」浏览器环境。
 * 新设备首次启动/首次采集时调用即可自动拥有一个采集环境；
 * 已存在历史【素材采集】单源环境时仍会新建一个统一环境，旧环境只保留登录态。
 */
export function ensureCollectBrowserProfile(payload = {}) {
    const registry = loadRegistry();
    const items = Array.isArray(registry.items) ? registry.items : [];
    for (const item of items) {
        const profileId = normalizeProfileId(item?.id);
        if (!profileId) {
            continue;
        }
        const record = loadProfileRecord(profileId) || buildProfileRecord(profileId, item);
        const platforms = normalizePlatforms(record?.platforms);
        if (String(record?.kind || '').trim() === 'collect-shared'
            || platforms.includes(COLLECT_PROFILE_PLATFORM)
            || String(record?.name || '').trim() === COLLECT_PROFILE_NAME) {
            return getBrowserProfile(profileId) || summarizeProfile(record, registry);
        }
    }

    return createBrowserProfile({
        name: COLLECT_PROFILE_NAME,
        remark: '图片采集专用浏览器环境，所有需要真浏览器的采集源共用；系统自动创建且不可删除',
        platforms: [COLLECT_PROFILE_PLATFORM],
        managedBy: COLLECT_MANAGED_BY,
        kind: 'collect-shared',
        protected: true,
        headless: false,
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
    const records = reconcileProfileDebugPorts(registry);
    const hasDebugPortPatch = Object.prototype.hasOwnProperty.call(payload, 'debugPort');
    const requestedDebugPort = hasDebugPortPatch
        ? normalizeManagedProfileDebugPort(payload.debugPort)
        : normalizeManagedProfileDebugPort(existing.debugPort);
    const usedPorts = collectUsedDebugPorts(registry, { excludeProfileId: normalizedId, records });
    const debugPort = requestedDebugPort || allocateDebugPortFromUsedPorts(usedPorts);
    if (usedPorts.has(debugPort)) {
        throw new Error(`浏览器调试端口已被其他环境占用: ${debugPort}`);
    }
    // 采集托管环境的保护标记不允许通过普通编辑接口抹掉（改名也不能解除保护）
    const collectProtected = existing.protected === true || isCollectManagedProfile(existing);
    const safePayload = { ...payload };
    if (collectProtected) {
        // 固定标识（名称/备注/平台标签）也不允许通过普通编辑改名，
        // 否则系统托管环境会失去可识别性，UI 上也会出现「两个采集专用」。
        for (const key of [
            'protected', 'nonDeletable', 'managedBy', 'kind', 'protectedReason',
            'name', 'remark', 'platforms',
        ]) {
            delete safePayload[key];
        }
    }
    const nextRecord = buildProfileRecord(normalizedId, {
        ...existing,
        ...safePayload,
        ...(collectProtected
            ? {
                protected: true,
                managedBy: COLLECT_MANAGED_BY,
                kind: existing.kind && existing.kind !== 'collect-legacy' ? existing.kind : 'collect-shared',
            }
            : {}),
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
    if (existing.protected === true || isCollectManagedProfile(existing)) {
        throw new Error(
            `环境 ${normalizedId}（${existing.name || ''}）为采集系统托管环境，已标记保护，不允许删除：`
            + (existing.protectedReason || '图片采集专用 / 历史登录态需保留'),
        );
    }

    fs.removeSync(getProfileDirectory(normalizedId));
    registry.items = registry.items.filter((item) => item.id !== normalizedId);
    if (registry.activeProfileId === normalizedId) {
        // 不要把「采集专用/历史采集」环境选成默认环境，发布任务需要普通环境
        registry.activeProfileId = registry.items
            .map((item) => normalizeProfileId(item?.id))
            .find((profileId) => !!profileId && !isProtectedProfileId(profileId)) || null;
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
    const records = reconcileProfileDebugPorts(registry);
    const exists = registry.items.some((item) => item.id === normalizedId);
    if (!exists) {
        throw new Error(`环境不存在: ${normalizedId}`);
    }

    registry.activeProfileId = normalizedId;
    saveRegistry(registry);
    const record = records.get(normalizedId)
        || loadProfileRecord(normalizedId)
        || buildProfileRecord(normalizedId, { name: normalizedId });
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

import fs from 'fs';
import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { getTokenValue } from '../../../../server';
import { ImageManager } from '../../services/ImageManager.js';
import { logger } from '../../utils/logger.js';
import {
    PLATFORM_NAME,
    TEMU_DEFAULT_UPLOAD_REFERER,
    TEMU_IMAGE_UPLOAD_SIGNATURE_TAG,
    TEMU_IMAGE_UPLOAD_SIGNATURE_URL,
    TEMU_STORE_IMAGE_URL
} from './constants.js';
import {
    collectTemuSessionBundle,
    getTemuCurrentSessionContext,
    validateTemuSessionBundle
} from './session.js';
import { clickClickableByText } from './page.js';
import { runTemuLoginSmallFeature } from './smallFeatures.js';

const TEMU_IMAGE_TRIGGER_LABELS = [
    '选择图片',
    '从图库选择',
    '从图片空间选择',
    '图片空间',
    '图库',
    '选择素材',
    '添加图片',
    '添加商品图',
    '添加详情图',
    '管理图片'
];

const TEMU_IMAGE_SECTION_KEYWORDS = [
    '商品图',
    '商品图片',
    '主图',
    '轮播图',
    '详情图',
    '详情图片',
    '图文详情',
    '产品图片',
    '图片信息'
];

const TEMU_IMAGE_PICKER_CONFIRM_LABELS = ['确定', '确认', '完成', '选择', '提交', '保存'];
const TEMU_UPLOAD_RETRY_LIMIT = 3;
const TEMU_SESSION_REFRESH_RETRY_LIMIT = 1;
const TEMU_REMOTE_API_BASE = process.env.NODE_ENV === 'development'
    ? (process.env.YISHE_LOCAL_API_BASE || 'http://localhost:1520/api')
    : (process.env.YISHE_REMOTE_API_BASE || 'https://1s.design:1520/api');

function normalizeText(value) {
    return String(value || '').trim();
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function dedupeStrings(values = []) {
    return Array.from(new Set(values.map((item) => normalizeText(item)).filter(Boolean)));
}

function resolveTemuStoredCredentialPair(record = {}) {
    const normalizedRecord = isPlainObject(record) ? record : {};
    const session = isPlainObject(normalizedRecord?.session) ? normalizedRecord.session : {};

    return {
        account: normalizeText(normalizedRecord?.account || session?.account),
        password: normalizeText(normalizedRecord?.password || session?.password)
    };
}

function summarizeImageSourceForLog(value = '') {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }

    try {
        const url = new URL(normalized);
        const fileName = normalizeText(url.pathname.split('/').pop() || '');
        return fileName || normalized.slice(0, 160);
    } catch {
        return basename(normalized) || normalized.slice(0, 160);
    }
}

function escapeForHasText(value = '') {
    return String(value || '').replace(/(["\\])/g, '\\$1');
}

function extractImageSource(item) {
    if (typeof item === 'string') {
        return normalizeText(item);
    }

    if (!item || typeof item !== 'object') {
        return '';
    }

    const candidates = [
        item.source,
        item.url,
        item.src,
        item.path,
        item.filePath,
        item.image,
        item.imageUrl,
        item.image_url,
        item.ossUrl,
        item.oss_image_url
    ];

    return candidates.map((value) => normalizeText(value)).find(Boolean) || '';
}

function flattenImageSources(input) {
    if (Array.isArray(input)) {
        return input.map(extractImageSource).filter(Boolean);
    }

    if (typeof input === 'string') {
        const normalized = normalizeText(input);
        if (!normalized) {
            return [];
        }
        if (/^https?:\/\//i.test(normalized) || /^[a-zA-Z]:[\\/]/.test(normalized)) {
            return [normalized];
        }

        return normalized
            .split(/[\n,，]/)
            .map((item) => normalizeText(item))
            .filter(Boolean);
    }

    if (input && typeof input === 'object') {
        const directSource = extractImageSource(input);
        if (directSource) {
            return [directSource];
        }
        return Object.values(input).map(extractImageSource).filter(Boolean);
    }

    return [];
}

function collectImageSources(input) {
    if (Array.isArray(input)) {
        return input.flatMap((item) => collectImageSources(item));
    }

    return flattenImageSources(input);
}

export function normalizeTemuImageSources(input = []) {
    return dedupeStrings(collectImageSources(input));
}

export function resolveTemuPublishImageSources(publishInfo = {}) {
    const candidateLists = [
        publishInfo.images,
        publishInfo.imageUrls,
        publishInfo.imageSources,
        publishInfo.assets?.images,
        publishInfo.media?.images,
        publishInfo.data?.images,
        publishInfo.data?.imageUrls,
        publishInfo.data?.imageSources,
        publishInfo.meta?.images,
        publishInfo.metadata?.images
    ];

    return normalizeTemuImageSources(candidateLists);
}

function inferMimeType(filePath = '') {
    const extension = extname(String(filePath || '')).replace('.', '').toLowerCase();
    switch (extension) {
        case 'png':
            return 'image/png';
        case 'webp':
            return 'image/webp';
        case 'gif':
            return 'image/gif';
        case 'bmp':
            return 'image/bmp';
        case 'avif':
            return 'image/avif';
        case 'jpeg':
        case 'jpg':
        default:
            return 'image/jpeg';
    }
}

async function prepareTemuImageFiles(imageSources = []) {
    const imageManager = new ImageManager();
    const fileEntries = [];
    const tempFiles = [];

    try {
        for (let index = 0; index < imageSources.length; index += 1) {
            const source = normalizeText(imageSources[index]);
            if (!source) {
                continue;
            }

            if (/^https?:\/\//i.test(source)) {
                const tempPath = await imageManager.downloadImage(
                    source,
                    `temu_publish_${Date.now()}_${index}`
                );
                fileEntries.push({
                    source,
                    filePath: tempPath,
                    fileName: basename(tempPath),
                    isTempFile: true
                });
                tempFiles.push(tempPath);
                continue;
            }

            if (fs.existsSync(source)) {
                fileEntries.push({
                    source,
                    filePath: source,
                    fileName: basename(source),
                    isTempFile: false
                });
                continue;
            }

            throw new Error(`图片资源不存在: ${source}`);
        }

        return {
            success: true,
            fileEntries,
            tempFiles,
            cleanup() {
                tempFiles.forEach((filePath) => imageManager.deleteTempFile(filePath));
            }
        };
    } catch (error) {
        tempFiles.forEach((filePath) => imageManager.deleteTempFile(filePath));
        return {
            success: false,
            message: error?.message || String(error),
            fileEntries,
            tempFiles,
            cleanup() {}
        };
    }
}

function buildCookieHeader(cookies = {}) {
    return Object.entries(cookies)
        .filter(([name, value]) => normalizeText(name) && value !== undefined && value !== null)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
}

function buildTemuUploadHeaderCandidates(sessionContext = {}, requestCaptureState = {}) {
    const cookieHeader = normalizeText(
        sessionContext.cookieHeader || buildCookieHeader(sessionContext.cookies || {})
    );
    const baseHeaders = {
        accept: 'application/json, text/plain, */*',
        cookie: cookieHeader,
        origin: normalizeText(
            requestCaptureState.origin || sessionContext.headers?.origin || 'https://agentseller.temu.com'
        ),
        referer: normalizeText(
            requestCaptureState.referer
            || sessionContext.currentUrl
            || sessionContext.headers?.referer
            || TEMU_DEFAULT_UPLOAD_REFERER
        )
    };

    const userAgent = normalizeText(
        requestCaptureState.userAgent || sessionContext.userAgent || sessionContext.headers?.['user-agent']
    );
    const mallId = normalizeText(
        requestCaptureState.mallId || sessionContext.mallId || sessionContext.headers?.mallid
    );
    const antiContent = normalizeText(
        requestCaptureState.antiContent
        || sessionContext.antiContent
        || sessionContext.headers?.['anti-content']
    );

    if (userAgent) {
        baseHeaders['user-agent'] = userAgent;
    }
    if (mallId) {
        baseHeaders.mallid = mallId;
    }

    const headerCandidates = [];
    if (antiContent) {
        headerCandidates.push({
            ...baseHeaders,
            'anti-content': antiContent
        });
    }
    headerCandidates.push(baseHeaders);

    return {
        cookieHeader,
        headerCandidates: headerCandidates.filter((headers, index, list) => {
            return list.findIndex((item) => JSON.stringify(item) === JSON.stringify(headers)) === index;
        })
    };
}

function normalizeTemuUploadSessionContext(sessionContext = {}) {
    if (!sessionContext || typeof sessionContext !== 'object') {
        return null;
    }

    if (sessionContext.success) {
        return sessionContext;
    }

    const cookies = sessionContext.cookies && typeof sessionContext.cookies === 'object'
        ? sessionContext.cookies
        : {};
    const headers = sessionContext.headers && typeof sessionContext.headers === 'object'
        ? sessionContext.headers
        : (sessionContext.headersTemplate && typeof sessionContext.headersTemplate === 'object'
            ? sessionContext.headersTemplate
            : {});
    const cookieHeader = normalizeText(
        sessionContext.cookieHeader || buildCookieHeader(cookies)
    );
    const cookieCount = Number(sessionContext.cookieCount);

    return {
        success: !!cookieHeader,
        message: cookieHeader ? '' : '当前 Temu 会话缺少 cookies',
        currentUrl: normalizeText(
            sessionContext.currentUrl || headers.referer || headers.origin || ''
        ),
        cookies,
        cookieHeader,
        headers,
        userAgent: normalizeText(sessionContext.userAgent || headers['user-agent'] || ''),
        mallId: normalizeText(sessionContext.mallId || headers.mallid || ''),
        antiContent: normalizeText(sessionContext.antiContent || headers['anti-content'] || ''),
        cookieCount: Number.isFinite(cookieCount) && cookieCount > 0
            ? cookieCount
            : Object.keys(cookies).length,
        effectiveRegion: normalizeText(sessionContext.effectiveRegion || 'global') || 'global'
    };
}

export function resolveTemuStoredSessionContext(publishInfo = {}, preferredSessionContext = null) {
    const settings = publishInfo.platformOptions
        || publishInfo.publishOptions
        || publishInfo.platformSettings?.temu
        || {};
    const candidates = [
        {
            value: preferredSessionContext,
            source: normalizeText(preferredSessionContext?.source || '')
        },
        {
            value: publishInfo.temuStoredSession,
            source: 'stored_platform_session'
        },
        {
            value: settings.temuStoredSession,
            source: 'stored_platform_session'
        }
    ];

    for (const candidate of candidates) {
        const normalized = normalizeTemuUploadSessionContext(candidate.value);
        if (normalized?.success) {
            return {
                ...normalized,
                source: normalizeText(normalized.source || candidate.source)
            };
        }
    }

    return null;
}

function buildTemuRealtimeStoredSessionContext(profileData = {}) {
    const profileRecord = isPlainObject(profileData) ? profileData : {};
    const userInfo = isPlainObject(profileRecord.userInfo) ? profileRecord.userInfo : {};
    const session = isPlainObject(profileRecord.session) ? profileRecord.session : {};
    const globalSession = isPlainObject(session.global) ? session.global : {};
    const usSession = isPlainObject(session.us) ? session.us : {};
    const euSession = isPlainObject(session.eu) ? session.eu : {};
    const globalCookies = isPlainObject(globalSession.cookies)
        ? globalSession.cookies
        : (isPlainObject(profileRecord.cookies_global)
            ? profileRecord.cookies_global
            : (isPlainObject(profileRecord.cookies) ? profileRecord.cookies : {}));
    const headersTemplate = isPlainObject(globalSession.headers)
        ? globalSession.headers
        : (isPlainObject(profileRecord.headersTemplate) ? profileRecord.headersTemplate : {});

    return normalizeTemuUploadSessionContext({
        source: 'stored_platform_session',
        success: true,
        storedProfile: profileRecord,
        account: normalizeText(session?.account || profileRecord.account),
        password: normalizeText(session?.password || profileRecord.password),
        currentUrl: normalizeText(headersTemplate.referer || headersTemplate.origin),
        userAgent: normalizeText(headersTemplate['user-agent'] || profileRecord.userAgent),
        mallId: normalizeText(profileRecord.mallId || userInfo.mallId || headersTemplate.mallid),
        mallName: normalizeText(profileRecord.mallName || userInfo.mallName),
        accountId: normalizeText(profileRecord.accountId || userInfo.accountId),
        accountType: normalizeText(profileRecord.accountType || userInfo.accountType),
        mallList: Array.isArray(profileRecord.mallList)
            ? profileRecord.mallList
            : (Array.isArray(userInfo.mallList) ? userInfo.mallList : []),
        antiContent: normalizeText(headersTemplate['anti-content'] || profileRecord.antiContent),
        headers: headersTemplate,
        headersTemplate,
        regionHeaders: {
            global: headersTemplate,
            us: isPlainObject(usSession.headers) ? usSession.headers : {},
            eu: isPlainObject(euSession.headers) ? euSession.headers : {}
        },
        cookies: globalCookies,
        cookies_global: globalCookies,
        cookies_us: isPlainObject(usSession.cookies) ? usSession.cookies : {},
        cookies_eu: isPlainObject(euSession.cookies) ? euSession.cookies : {}
    });
}

async function fetchTemuRealtimeStoredSessionProfile(profileId = '') {
    const normalizedProfileId = normalizeText(profileId);
    if (!normalizedProfileId) {
        return null;
    }

    const token = normalizeText(getTokenValue());
    if (!token) {
        return null;
    }

    try {
        const response = await fetch(`${TEMU_REMOTE_API_BASE}/user/getPlatformSessions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                platform: 'temu',
                profileId: normalizedProfileId
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            logger.warn(`${PLATFORM_NAME}实时获取已存储会话失败`, {
                profileId: normalizedProfileId,
                status: response.status
            });
            return null;
        }

        return isPlainObject(payload?.data)
            ? payload.data
            : (isPlainObject(payload) ? payload : null);
    } catch (error) {
        logger.warn(`${PLATFORM_NAME}实时获取已存储会话异常`, {
            profileId: normalizedProfileId,
            message: error?.message || String(error)
        });
        return null;
    }
}

async function fetchTemuRealtimeStoredSessionContext(profileId = '') {
    const profileRecord = await fetchTemuRealtimeStoredSessionProfile(profileId);
    if (!profileRecord) {
        return null;
    }

    return buildTemuRealtimeStoredSessionContext(profileRecord);
}

export async function resolveTemuRealtimeSessionContext(publishInfo = {}, preferredSessionContext = null) {
    const directSession = resolveTemuStoredSessionContext(publishInfo, preferredSessionContext);
    if (directSession?.success) {
        return directSession;
    }

    const profileId = normalizeText(
        publishInfo?.profileId
        || publishInfo?.browserAutomationProfileId
        || publishInfo?.meta?.profileId
        || publishInfo?.metadata?.profileId
    );

    return await fetchTemuRealtimeStoredSessionContext(profileId);
}

function resolveTemuPublishProfileId(publishInfo = {}) {
    return normalizeText(
        publishInfo?.profileId
        || publishInfo?.browserAutomationProfileId
        || publishInfo?.meta?.profileId
        || publishInfo?.metadata?.profileId
    );
}

export async function resolveTemuLoginCredentials(publishInfo = {}, preferredSessionContext = null) {
    const publishSettings = publishInfo.platformOptions
        || publishInfo.publishOptions
        || publishInfo.platformSettings?.temu
        || {};
    const explicitCredentials = {
        account: normalizeText(publishSettings?.account || publishInfo?.account),
        password: normalizeText(publishSettings?.password || publishInfo?.password)
    };
    if (explicitCredentials.account && explicitCredentials.password) {
        return {
            ...explicitCredentials,
            source: 'publish_info'
        };
    }

    const directCandidates = [
        preferredSessionContext,
        publishInfo?.temuStoredSession,
        publishInfo?.platformOptions?.temuStoredSession,
        publishInfo?.publishOptions?.temuStoredSession,
        publishInfo?.platformSettings?.temu?.temuStoredSession
    ];
    for (const candidate of directCandidates) {
        const credentials = resolveTemuStoredCredentialPair(candidate);
        if (credentials.account && credentials.password) {
            return {
                ...credentials,
                source: normalizeText(candidate?.source || 'stored_platform_session')
            };
        }
    }

    const storedProfile = isPlainObject(preferredSessionContext?.storedProfile)
        ? preferredSessionContext.storedProfile
        : null;
    const storedProfileCredentials = resolveTemuStoredCredentialPair(storedProfile);
    if (storedProfileCredentials.account && storedProfileCredentials.password) {
        return {
            ...storedProfileCredentials,
            source: 'stored_platform_session',
            storedProfile
        };
    }

    const profileId = resolveTemuPublishProfileId(publishInfo);
    if (!profileId) {
        return null;
    }

    const profileRecord = await fetchTemuRealtimeStoredSessionProfile(profileId);
    const realtimeCredentials = resolveTemuStoredCredentialPair(profileRecord);
    if (!realtimeCredentials.account || !realtimeCredentials.password) {
        return null;
    }

    return {
        ...realtimeCredentials,
        source: 'stored_platform_session',
        storedProfile: profileRecord
    };
}

function buildMergedRegionSession(nextCookies = {}, nextHeaders = {}, fallbackSession = {}, updatedAt = '') {
    const fallbackCookies = isPlainObject(fallbackSession?.cookies) ? fallbackSession.cookies : {};
    const fallbackHeaders = isPlainObject(fallbackSession?.headers) ? fallbackSession.headers : {};

    return {
        cookies: Object.keys(nextCookies).length ? nextCookies : fallbackCookies,
        headers: Object.keys(nextHeaders).length ? nextHeaders : fallbackHeaders,
        updatedAt
    };
}

function buildTemuStoredSessionUpdatePayload(sessionBundle = {}, profileId = '', existingProfile = {}, credentials = null) {
    // 服务端结构尽量增量更新，避免现场采集时把历史可用区域信息整体抹掉。
    const collectedAt = normalizeText(sessionBundle?.collectedAt || new Date().toISOString()) || new Date().toISOString();
    const currentProfile = isPlainObject(existingProfile) ? existingProfile : {};
    const currentSession = isPlainObject(currentProfile?.session) ? currentProfile.session : {};
    const currentUserInfo = isPlainObject(currentProfile?.userInfo) ? currentProfile.userInfo : {};
    const storedCredentials = resolveTemuStoredCredentialPair(currentProfile);
    const nextCredentials = {
        account: normalizeText(credentials?.account || sessionBundle?.account || storedCredentials.account),
        password: normalizeText(credentials?.password || sessionBundle?.password || storedCredentials.password)
    };
    const headersTemplate = isPlainObject(sessionBundle?.headersTemplate)
        ? sessionBundle.headersTemplate
        : {};
    const regionHeaders = isPlainObject(sessionBundle?.regionHeaders)
        ? sessionBundle.regionHeaders
        : {};
    const nextGlobalHeaders = Object.keys(headersTemplate).length
        ? headersTemplate
        : (isPlainObject(regionHeaders?.global)
            ? regionHeaders.global
            : (isPlainObject(currentProfile?.headersTemplate) ? currentProfile.headersTemplate : {}));
    const mallList = Array.isArray(sessionBundle?.mallList) && sessionBundle.mallList.length
        ? sessionBundle.mallList
        : (Array.isArray(currentProfile?.mallList)
            ? currentProfile.mallList
            : (Array.isArray(currentUserInfo?.mallList) ? currentUserInfo.mallList : []));
    const mallId = normalizeText(sessionBundle?.mallId || currentProfile?.mallId || currentUserInfo?.mallId);
    const mallName = normalizeText(sessionBundle?.mallName || currentProfile?.mallName || currentUserInfo?.mallName);
    const accountId = normalizeText(sessionBundle?.accountId || currentProfile?.accountId || currentUserInfo?.accountId);
    const accountType = normalizeText(sessionBundle?.accountType || currentProfile?.accountType || currentUserInfo?.accountType);
    const hasFreshUserInfo = !!accountId || mallList.length > 0;

    return {
        profiles: {
            [profileId]: {
                mallId,
                mallName,
                accountId,
                accountType,
                mallList,
                headersTemplate: nextGlobalHeaders,
                userInfo: {
                    status: hasFreshUserInfo
                        ? 'success'
                        : (normalizeText(currentUserInfo?.status || 'missing') || 'missing'),
                    message: hasFreshUserInfo
                        ? '发布时实时采集会话并同步用户信息'
                        : (normalizeText(currentUserInfo?.message || '暂无用户信息，可手动获取') || '暂无用户信息，可手动获取'),
                    fetchedAt: hasFreshUserInfo
                        ? collectedAt
                        : normalizeText(currentUserInfo?.fetchedAt || ''),
                    accountId,
                    accountType,
                    mallId,
                    mallName,
                    mallList,
                    mallCount: mallList.length
                },
                updatedAt: collectedAt,
                validation: {
                    status: 'fresh',
                    message: '发布时实时采集会话已更新',
                    checkedAt: collectedAt
                },
                session: {
                    account: nextCredentials.account,
                    password: nextCredentials.password,
                    global: buildMergedRegionSession(
                        isPlainObject(sessionBundle?.cookies_global)
                            ? sessionBundle.cookies_global
                            : (isPlainObject(sessionBundle?.cookies) ? sessionBundle.cookies : {}),
                        nextGlobalHeaders,
                        currentSession?.global,
                        collectedAt
                    ),
                    us: buildMergedRegionSession(
                        isPlainObject(sessionBundle?.cookies_us) ? sessionBundle.cookies_us : {},
                        isPlainObject(regionHeaders?.us) ? regionHeaders.us : {},
                        currentSession?.us,
                        collectedAt
                    ),
                    eu: buildMergedRegionSession(
                        isPlainObject(sessionBundle?.cookies_eu) ? sessionBundle.cookies_eu : {},
                        isPlainObject(regionHeaders?.eu) ? regionHeaders.eu : {},
                        currentSession?.eu,
                        collectedAt
                    )
                }
            }
        }
    };
}

async function persistTemuCollectedSessionToServer(sessionBundle = {}, profileId = '', existingProfile = null, credentials = null) {
    const normalizedProfileId = normalizeText(profileId);
    const token = normalizeText(getTokenValue());
    if (!normalizedProfileId || !token) {
        return {
            success: false,
            skipped: true,
            message: !normalizedProfileId ? '缺少 profileId，跳过回写会话' : '缺少登录 token，跳过回写会话'
        };
    }

    try {
        let currentProfile = isPlainObject(existingProfile) ? existingProfile : {};
        if (!Object.keys(currentProfile).length) {
            currentProfile = await fetchTemuRealtimeStoredSessionProfile(normalizedProfileId) || {};
        }

        const response = await fetch(`${TEMU_REMOTE_API_BASE}/user/updatePlatformSessions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                platform: 'temu',
                data: buildTemuStoredSessionUpdatePayload(sessionBundle, normalizedProfileId, currentProfile, credentials)
            })
        });
        if (!response.ok) {
            return {
                success: false,
                skipped: false,
                message: `回写 Temu 会话失败，状态码 ${response.status}`
            };
        }

        return {
            success: true,
            skipped: false,
            message: 'Temu 会话已回写服务端'
        };
    } catch (error) {
        return {
            success: false,
            skipped: false,
            message: error?.message || String(error)
        };
    }
}

export async function resolveTemuValidatedSessionContext(publishInfo = {}, options = {}) {
    const preferredSessionContext = options.preferredSessionContext || null;
    const page = options.page || null;
    const pageOperator = options.pageOperator || null;
    const collectRegionCookies = options.collectRegionCookies !== false;
    const persistCollectedSession = options.persistCollectedSession !== false;
    const profileId = resolveTemuPublishProfileId(publishInfo);

    logger.info(`${PLATFORM_NAME}准备获取并校验实时会话`, {
        profileId: profileId || ''
    });
    // 发布前先取一次服务端实时 session，能直接用就不再打断当前浏览器环境。
    const realtimeSession = await resolveTemuRealtimeSessionContext(
        publishInfo,
        preferredSessionContext
    );
    if (realtimeSession?.success) {
        logger.info(`${PLATFORM_NAME}已获取服务端实时会话，开始校验`, {
            profileId: profileId || '',
            source: realtimeSession.source || 'stored_platform_session'
        });
        const validationResult = await validateTemuSessionBundle(realtimeSession);
        if (validationResult?.success) {
            logger.info(`${PLATFORM_NAME}实时会话校验通过`, {
                profileId: profileId || '',
                source: realtimeSession.source || 'stored_platform_session',
                accountId: validationResult.accountId || '',
                mallCount: Array.isArray(validationResult.mallList) ? validationResult.mallList.length : 0
            });
            return {
                success: true,
                source: realtimeSession.source || 'stored_platform_session',
                sessionContext: {
                    ...realtimeSession,
                    accountId: realtimeSession.accountId || validationResult.accountId || '',
                    accountType: realtimeSession.accountType || validationResult.accountType || '',
                    mallList: Array.isArray(realtimeSession.mallList) && realtimeSession.mallList.length
                        ? realtimeSession.mallList
                        : validationResult.mallList || []
                },
                validationResult,
                persisted: false
            };
        }

        logger.warn(`${PLATFORM_NAME}实时会话校验失败，准备回退现场采集`, {
            profileId: profileId || '',
            source: realtimeSession.source || 'stored_platform_session',
            message: validationResult?.message || 'session_invalid'
        });
    }

    if (!page) {
        return {
            success: false,
            message: realtimeSession?.success
                ? '实时会话校验失败，且当前无可用页面执行现场采集'
                : '当前未获取到可用 Temu 会话'
        };
    }

    logger.info(`${PLATFORM_NAME}准备现场采集会话`, {
        profileId: profileId || '',
        collectRegionCookies
    });
    let collectedSessionResult = await collectTemuSessionBundle(page, {
        collectRegionCookies
    });
    let resolvedLoginCredentials = null;
    // 只有校验失败且页面明确处于未登录时，才回退到自动登录再重采。
    if ((!collectedSessionResult?.success || !collectedSessionResult.sessionBundle) && collectedSessionResult?.reason === 'login_required') {
        resolvedLoginCredentials = await resolveTemuLoginCredentials(
            publishInfo,
            realtimeSession || preferredSessionContext
        );
        if (resolvedLoginCredentials?.account && resolvedLoginCredentials?.password) {
            logger.info(`${PLATFORM_NAME}现场采集检测到未登录，准备使用已存账号密码自动登录`, {
                profileId: profileId || '',
                credentialSource: resolvedLoginCredentials.source || 'stored_platform_session'
            });
            const loginResult = await runTemuLoginSmallFeature({
                ...publishInfo,
                profileId,
                account: resolvedLoginCredentials.account,
                password: resolvedLoginCredentials.password,
                keepPageOpen: true
            }, {
                page,
                pageOperator
            });
            if (!loginResult?.success) {
                return {
                    success: false,
                    message: loginResult?.message || collectedSessionResult?.message || 'Temu 自动登录失败'
                };
            }

            logger.info(`${PLATFORM_NAME}自动登录成功，准备重新采集会话`, {
                profileId: profileId || '',
                credentialSource: resolvedLoginCredentials.source || 'stored_platform_session'
            });
            collectedSessionResult = await collectTemuSessionBundle(page, {
                collectRegionCookies
            });
        }
    }
    if (!collectedSessionResult?.success || !collectedSessionResult.sessionBundle) {
        return {
            success: false,
            message: collectedSessionResult?.message || 'Temu 现场采集会话失败'
        };
    }

    let persisted = false;
    let persistMessage = '';
    const storedProfile = isPlainObject(realtimeSession?.storedProfile) ? realtimeSession.storedProfile : null;
    logger.info(`${PLATFORM_NAME}现场采集会话成功`, {
        profileId: profileId || '',
        cookieCount: Object.keys(collectedSessionResult.sessionBundle?.cookies || {}).length
    });
    if (persistCollectedSession) {
        const persistResult = await persistTemuCollectedSessionToServer(
            collectedSessionResult.sessionBundle,
            profileId,
            storedProfile,
            resolvedLoginCredentials
        );
        persisted = !!persistResult?.success;
        persistMessage = persistResult?.message || '';

        if (persistResult?.success) {
            logger.info(`${PLATFORM_NAME}现场采集会话已回写服务端`, {
                profileId: profileId || ''
            });
        } else if (!persistResult?.skipped) {
            logger.warn(`${PLATFORM_NAME}现场采集会话回写服务端失败`, {
                profileId: profileId || '',
                message: persistMessage
            });
        }
    }

    return {
        success: true,
        source: 'live_page_session',
        sessionContext: {
            ...collectedSessionResult.sessionBundle,
            account: normalizeText(
                collectedSessionResult.sessionBundle?.account
                || resolvedLoginCredentials?.account
                || realtimeSession?.account
            ),
            password: normalizeText(
                collectedSessionResult.sessionBundle?.password
                || resolvedLoginCredentials?.password
                || realtimeSession?.password
            ),
            source: 'live_page_session'
        },
        validationResult: {
            success: true,
            message: '现场采集会话成功'
        },
        persisted,
        persistMessage
    };
}

async function parseJsonResponse(response) {
    const rawText = await response.text();

    try {
        return {
            payload: rawText ? JSON.parse(rawText) : null,
            rawText
        };
    } catch {
        return {
            payload: null,
            rawText
        };
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60_000) {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new Error(`request timeout after ${timeoutMs}ms`)),
        timeoutMs
    );

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

async function requestTemuUploadSignature(headerCandidates = []) {
    let lastError = null;

    for (const headers of headerCandidates) {
        try {
            const response = await fetchWithTimeout(
                TEMU_IMAGE_UPLOAD_SIGNATURE_URL,
                {
                    method: 'POST',
                    headers: {
                        ...headers,
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        tag: TEMU_IMAGE_UPLOAD_SIGNATURE_TAG
                    })
                },
                20_000
            );
            const { payload, rawText } = await parseJsonResponse(response);
            const uploadSign = normalizeText(payload?.result);

            if (response.ok && payload?.success === true && uploadSign) {
                return {
                    success: true,
                    uploadSign,
                    headers
                };
            }

            lastError = new Error(
                payload?.errorMsg
                || payload?.message
                || rawText
                || `获取图片上传签名失败，状态码 ${response.status}`
            );
        } catch (error) {
            lastError = error;
        }
    }

    return {
        success: false,
        message: lastError?.message || '获取图片上传签名失败'
    };
}

function normalizeUploadedImageRecord(payload = {}, fileEntry = {}) {
    const url = normalizeText(
        payload?.url
        || payload?.result?.url
        || payload?.data?.url
        || payload?.result?.image_url
        || payload?.data?.image_url
        || payload?.image_url
    );

    const widthValue = payload?.width ?? payload?.result?.width ?? payload?.data?.width;
    const heightValue = payload?.height ?? payload?.result?.height ?? payload?.data?.height;

    return {
        source: fileEntry.source || '',
        filePath: fileEntry.filePath || '',
        fileName: fileEntry.fileName || '',
        url,
        width: Number.isFinite(Number(widthValue)) ? Number(widthValue) : null,
        height: Number.isFinite(Number(heightValue)) ? Number(heightValue) : null,
        raw: payload
    };
}

function extractFileNameHints(value = '') {
    const normalized = normalizeText(value);
    if (!normalized) {
        return [];
    }

    try {
        const url = new URL(normalized);
        const pathname = normalizeText(url.pathname.split('/').pop() || '');
        const pathnameNoExt = pathname.replace(/\.[^.]+$/, '');
        return dedupeStrings([pathname, pathnameNoExt]);
    } catch {
        const filename = normalizeText(basename(normalized));
        const filenameNoExt = filename.replace(/\.[^.]+$/, '');
        return dedupeStrings([filename, filenameNoExt]);
    }
}

async function uploadSingleTemuImage(fileEntry, headerCandidates = []) {
    let lastError = null;
    const attemptDetails = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const signatureResult = await requestTemuUploadSignature(headerCandidates);
        if (!signatureResult.success) {
            lastError = new Error(signatureResult.message || '获取图片上传签名失败');
            attemptDetails.push({
                stage: 'request_signature',
                attempt: attempt + 1,
                success: false,
                message: lastError.message
            });
            continue;
        }

        for (const headers of headerCandidates) {
            try {
                const fileBuffer = await readFile(fileEntry.filePath);
                const formData = new FormData();
                formData.set('upload_sign', signatureResult.uploadSign);
                formData.set('url_width_height', 'true');
                formData.append(
                    'image',
                    new Blob([fileBuffer], { type: inferMimeType(fileEntry.filePath) }),
                    fileEntry.fileName
                );

                const response = await fetchWithTimeout(
                    TEMU_STORE_IMAGE_URL,
                    {
                        method: 'POST',
                        headers,
                        body: formData
                    },
                    90_000
                );
                const { payload, rawText } = await parseJsonResponse(response);
                const normalized = normalizeUploadedImageRecord(payload, fileEntry);

                if (response.ok && normalized.url) {
                    return {
                        success: true,
                        uploadedImage: normalized,
                        attemptDetails
                    };
                }

                lastError = new Error(
                    payload?.errorMsg
                    || payload?.message
                    || rawText
                    || `上传图片失败，状态码 ${response.status}`
                );
                attemptDetails.push({
                    stage: 'upload_image',
                    attempt: attempt + 1,
                    success: false,
                    status: response.status,
                    message: lastError.message,
                    hasAntiContent: !!headers['anti-content'],
                    hasMallId: !!headers.mallid
                });
            } catch (error) {
                lastError = error;
                attemptDetails.push({
                    stage: 'upload_image',
                    attempt: attempt + 1,
                    success: false,
                    message: lastError?.message || String(lastError),
                    hasAntiContent: !!headers['anti-content'],
                    hasMallId: !!headers.mallid
                });
            }
        }
    }

    return {
        success: false,
        message: lastError?.message || `上传图片失败: ${fileEntry.fileName || fileEntry.source || ''}`,
        attemptDetails
    };
}

async function refreshTemuUploadSession(page, options = {}) {
    const fallbackHeadersTemplate = {
        origin: options.requestCaptureState?.origin || 'https://agentseller.temu.com',
        referer:
            options.requestCaptureState?.referer
            || normalizeText(page?.url?.())
            || TEMU_DEFAULT_UPLOAD_REFERER,
        'user-agent': options.requestCaptureState?.userAgent || '',
        'anti-content': options.requestCaptureState?.antiContent || '',
        mallid: options.requestCaptureState?.mallId || ''
    };

    return await getTemuCurrentSessionContext(page, {
        region: 'global',
        headersTemplate: fallbackHeadersTemplate,
        mallId: options.requestCaptureState?.mallId || '',
        antiContent: options.requestCaptureState?.antiContent || ''
    });
}

export function createTemuLiveRequestCapture(context) {
    if (!context || typeof context.on !== 'function') {
        return {
            state: {
                requestCount: 0,
                antiContent: '',
                mallId: '',
                origin: '',
                referer: '',
                userAgent: '',
                lastRequestUrl: ''
            },
            dispose() {}
        };
    }

    const state = {
        requestCount: 0,
        antiContent: '',
        mallId: '',
        origin: '',
        referer: '',
        userAgent: '',
        lastRequestUrl: ''
    };

    const onRequest = (request) => {
        try {
            const url = normalizeText(request.url());
            const resourceType = normalizeText(request.resourceType());
            if (!/temu\.com|kuajingmaihuo\.com/i.test(url)) {
                return;
            }
            if (!['xhr', 'fetch', 'document'].includes(resourceType)) {
                return;
            }

            const headers = request.headers();
            const normalizedHeaders = Object.fromEntries(
                Object.entries(headers || {}).map(([key, value]) => [
                    String(key || '').toLowerCase(),
                    normalizeText(value)
                ])
            );

            state.requestCount += 1;
            state.lastRequestUrl = url;
            if (normalizedHeaders['anti-content']) {
                state.antiContent = normalizedHeaders['anti-content'];
            }
            if (normalizedHeaders.mallid && normalizedHeaders.mallid !== 'undefined') {
                state.mallId = normalizedHeaders.mallid;
            }
            if (normalizedHeaders.origin) {
                state.origin = normalizedHeaders.origin;
            }
            if (normalizedHeaders.referer) {
                state.referer = normalizedHeaders.referer;
            }
            if (normalizedHeaders['user-agent']) {
                state.userAgent = normalizedHeaders['user-agent'];
            }
        } catch {
            // ignore request capture failures
        }
    };

    context.on('request', onRequest);

    return {
        state,
        dispose() {
            context.off('request', onRequest);
        }
    };
}

async function findTemuImageTriggerCandidates(page) {
    return page.evaluate(({ triggerLabels, sectionKeywords }) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0;
        };

        const sectionSelector = [
            'section',
            'form',
            'fieldset',
            '[class*="section"]',
            '[class*="panel"]',
            '[class*="card"]',
            '[class*="block"]',
            '[class*="group"]',
            '[class*="wrapper"]',
            '[class*="container"]'
        ].join(',');

        const occurrenceMap = new Map();
        const clickables = Array.from(
            document.querySelectorAll('button,[role="button"],a,span,div')
        ).filter(isVisible);

        return clickables
            .map((element) => {
                const text = normalize(element.innerText || element.textContent);
                if (!text) {
                    return null;
                }

                const matchedLabel = triggerLabels.find((label) => text.includes(label));
                if (!matchedLabel) {
                    return null;
                }

                const section = element.closest(sectionSelector);
                const sectionText = normalize(section?.textContent || '');
                const sectionKeyword = sectionKeywords.find((keyword) => {
                    return sectionText.includes(keyword) || text.includes(keyword);
                }) || '';
                const tagName = element.tagName.toLowerCase();
                const key = `${tagName}::${matchedLabel}`;
                const sameTextIndex = occurrenceMap.get(key) || 0;
                occurrenceMap.set(key, sameTextIndex + 1);

                return {
                    tagName,
                    label: matchedLabel,
                    sameTextIndex,
                    text: text.slice(0, 120),
                    sectionKeyword,
                    className: normalize(element.className || '').slice(0, 160)
                };
            })
            .filter(Boolean)
            .sort((left, right) => {
                const leftSectionScore = left.sectionKeyword ? 0 : 1;
                const rightSectionScore = right.sectionKeyword ? 0 : 1;
                const leftButtonScore = left.tagName === 'button' ? 0 : 1;
                const rightButtonScore = right.tagName === 'button' ? 0 : 1;
                return leftSectionScore - rightSectionScore
                    || leftButtonScore - rightButtonScore
                    || left.sameTextIndex - right.sameTextIndex;
            })
            .slice(0, 12);
    }, {
        triggerLabels: TEMU_IMAGE_TRIGGER_LABELS,
        sectionKeywords: TEMU_IMAGE_SECTION_KEYWORDS
    }).catch(() => []);
}

async function clickTemuImageTriggerCandidate(page, candidate) {
    const safeLabel = escapeForHasText(candidate?.label || '');
    const tagName = normalizeText(candidate?.tagName || '').toLowerCase();
    const sameTextIndex = Number(candidate?.sameTextIndex || 0);
    const selectorCandidates = [];

    if (tagName) {
        selectorCandidates.push(`${tagName}:has-text("${safeLabel}")`);
    }
    selectorCandidates.push(`button:has-text("${safeLabel}")`);
    selectorCandidates.push(`[role="button"]:has-text("${safeLabel}")`);
    selectorCandidates.push(`a:has-text("${safeLabel}")`);
    selectorCandidates.push(`span:has-text("${safeLabel}")`);
    selectorCandidates.push(`div:has-text("${safeLabel}")`);

    for (const selector of selectorCandidates) {
        try {
            const locator = page.locator(selector);
            const count = await locator.count();
            if (!count || count <= sameTextIndex) {
                continue;
            }

            const target = locator.nth(sameTextIndex);
            if (!(await target.isVisible().catch(() => false))) {
                continue;
            }

            await target.scrollIntoViewIfNeeded().catch(() => undefined);
            await target.click({ timeout: 5_000 }).catch(async () => {
                await target.click({ timeout: 5_000, force: true });
            });

            return {
                success: true,
                selector,
                sameTextIndex,
                label: candidate.label
            };
        } catch {
            continue;
        }
    }

    return {
        success: false,
        reason: 'trigger_not_found',
        label: candidate?.label || ''
    };
}

async function selectTemuImagesInPicker(page, uploadedImages = [], limit = uploadedImages.length) {
    const matcherHints = dedupeStrings(
        uploadedImages.flatMap((item) => [
            item?.url,
            item?.source,
            ...(extractFileNameHints(item?.url)),
            ...(extractFileNameHints(item?.source))
        ])
    );

    return page.evaluate(({ matchers, maxCount }) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0;
        };
        const isSelected = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const className = normalize(element.className || '').toLowerCase();
            return element.getAttribute('aria-checked') === 'true'
                || element.getAttribute('aria-selected') === 'true'
                || className.includes('selected')
                || className.includes('checked')
                || className.includes('active')
                || className.includes('is-selected');
        };
        const resolveClickable = (img) =>
            img.closest(
                'label,button,[role="button"],li,[class*="card"],[class*="item"],[class*="image"],[class*="checkbox"]'
            ) || img;

        const containerCandidates = Array.from(
            document.querySelectorAll(
                '[role="dialog"],[class*="dialog"],[class*="modal"],[class*="drawer"],body'
            )
        ).filter(isVisible);

        const enrichedContainers = containerCandidates.map((container) => {
            const images = Array.from(container.querySelectorAll('img')).filter(isVisible);
            return {
                container,
                imageCount: images.length
            };
        });

        enrichedContainers.sort((left, right) => right.imageCount - left.imageCount);
        const activeContainer = enrichedContainers[0]?.container || document.body;

        const cards = [];
        const cardSet = new Set();
        for (const img of Array.from(activeContainer.querySelectorAll('img')).filter(isVisible)) {
            const card = resolveClickable(img);
            if (!(card instanceof HTMLElement) || cardSet.has(card)) {
                continue;
            }
            cardSet.add(card);
            const srcText = normalize(
                img.getAttribute('src')
                || img.getAttribute('data-src')
                || img.getAttribute('data-lazy-src')
                || img.currentSrc
            );
            const altText = normalize(img.getAttribute('alt') || '');
            const cardText = normalize(card.innerText || card.textContent || '');
            const haystack = `${srcText} ${altText} ${cardText}`.toLowerCase();
            const score = matchers.reduce((acc, matcher) => {
                const normalizedMatcher = normalize(matcher).toLowerCase();
                return normalizedMatcher && haystack.includes(normalizedMatcher) ? acc + 1 : acc;
            }, 0);

            cards.push({
                card,
                srcText,
                cardText,
                selected: isSelected(card),
                score
            });
        }

        cards.sort((left, right) => right.score - left.score);
        const preferredCards = cards.filter((item) => !item.selected && item.score > 0);
        const fallbackCards = cards.filter((item) => !item.selected && item.score <= 0);
        const targets = preferredCards.concat(fallbackCards).slice(0, maxCount);

        let selectedCount = 0;
        for (const item of targets) {
            item.card.click();
            selectedCount += 1;
        }

        return {
            selectedCount,
            matchedCount: preferredCards.slice(0, maxCount).length,
            candidateCount: cards.length,
            usedFallback: preferredCards.length < Math.min(cards.length, maxCount)
        };
    }, {
        matchers: matcherHints,
        maxCount: Math.max(0, Number(limit || 0))
    }).catch(() => ({
        selectedCount: 0,
        matchedCount: 0,
        candidateCount: 0,
        usedFallback: false
    }));
}

async function confirmTemuImagePicker(page) {
    const clicked = await clickClickableByText(page, TEMU_IMAGE_PICKER_CONFIRM_LABELS, {
        selector: 'button,[role="button"],a,span,div',
        exact: false
    });

    if (!clicked) {
        return {
            success: false,
            reason: 'confirm_button_not_found'
        };
    }

    await page.waitForTimeout(1_500);
    return {
        success: true,
        detail: clicked
    };
}

export async function bindTemuUploadedImagesToEditPage(page, uploadedImages = []) {
    const images = Array.isArray(uploadedImages) ? uploadedImages.filter((item) => item?.url) : [];
    if (!images.length) {
        return {
            success: true,
            skipped: true,
            message: '没有可回填到编辑页的 Temu 图片'
        };
    }

    const triggerCandidates = await findTemuImageTriggerCandidates(page);
    if (!triggerCandidates.length) {
        return {
            success: false,
            message: '未识别到 Temu 编辑页图片入口',
            triggerCandidates: []
        };
    }

    const attemptResults = [];
    const usedCandidateKeys = new Set();

    for (const candidate of triggerCandidates) {
        const candidateKey = `${candidate.tagName}::${candidate.label}::${candidate.sameTextIndex}`;
        if (usedCandidateKeys.has(candidateKey)) {
            continue;
        }
        usedCandidateKeys.add(candidateKey);

        for (let pickerAttempt = 0; pickerAttempt < 2; pickerAttempt += 1) {
            const clickResult = await clickTemuImageTriggerCandidate(page, candidate);
            if (!clickResult.success) {
                attemptResults.push({
                    candidate,
                    pickerAttempt: pickerAttempt + 1,
                    success: false,
                    reason: clickResult.reason || 'trigger_click_failed'
                });
                break;
            }

            await page.waitForTimeout(1_500);
            const selectionResult = await selectTemuImagesInPicker(page, images, images.length);
            if (!selectionResult.selectedCount) {
                attemptResults.push({
                    candidate,
                    pickerAttempt: pickerAttempt + 1,
                    success: false,
                    reason: 'picker_images_not_selected',
                    selectionResult
                });
                continue;
            }

            const confirmResult = await confirmTemuImagePicker(page);
            attemptResults.push({
                candidate,
                pickerAttempt: pickerAttempt + 1,
                success: !!confirmResult.success,
                reason: confirmResult.success ? '' : confirmResult.reason || 'picker_confirm_failed',
                selectionResult,
                confirmResult
            });

            if (confirmResult.success) {
                return {
                    success: true,
                    skipped: false,
                    selectedCount: selectionResult.selectedCount || 0,
                    matchedCount: selectionResult.matchedCount || 0,
                    usedFallback: !!selectionResult.usedFallback,
                    candidate,
                    attemptResults
                };
            }
        }
    }

    return {
        success: false,
        skipped: false,
        message: 'Temu 编辑页图片回填未成功',
        triggerCandidates,
        attemptResults
    };
}

export async function uploadTemuPublishImages(page, publishInfo = {}, options = {}) {
    const resolvedSession = await resolveTemuValidatedSessionContext(publishInfo, {
        preferredSessionContext: options.sessionContext,
        page,
        collectRegionCookies: false,
        persistCollectedSession: true
    });

    return await uploadTemuImagesToCloud(
        page,
        resolveTemuPublishImageSources(publishInfo),
        {
            ...options,
            sessionContext: resolvedSession?.success
                ? resolvedSession.sessionContext
                : options.sessionContext,
            resourceLabel: options.resourceLabel || '商品图片',
            emptyMessage: options.emptyMessage || `${PLATFORM_NAME}发布数据未提供图片，跳过图片上传`
        }
    );
}

export async function uploadTemuImagesToCloud(page, imageSources = [], options = {}) {
    const normalizedImageSources = normalizeTemuImageSources(imageSources);
    const resourceLabel = normalizeText(options.resourceLabel || '图片');
    const emptyMessage = normalizeText(options.emptyMessage || '')
        || `${PLATFORM_NAME}未提供需要上传的${resourceLabel}，跳过上传`;

    if (!normalizedImageSources.length) {
        logger.info(`${PLATFORM_NAME}未检测到需要上传到Temu云的${resourceLabel}`, {
            resourceLabel,
            requestedImageCount: 0
        });
        return {
            success: true,
            skipped: true,
            message: emptyMessage,
            requestedImageCount: 0,
            requestedSourceCount: 0,
            uploadedCount: 0,
            uploadedImages: [],
            failedImages: []
        };
    }

    let sessionContext = normalizeTemuUploadSessionContext(options.sessionContext)
        || await refreshTemuUploadSession(page, options);

    if (!sessionContext?.success) {
        logger.error(`${PLATFORM_NAME}${resourceLabel}上传前获取会话失败`, {
            requestedImageCount: normalizedImageSources.length,
            message: sessionContext?.message || 'session_context_unavailable'
        });
        return {
            success: false,
            message: sessionContext?.message || `获取当前 Temu 会话失败，无法上传${resourceLabel}`,
            requestedImageCount: normalizedImageSources.length,
            requestedSourceCount: normalizedImageSources.length,
            uploadedCount: 0,
            uploadedImages: [],
            failedImages: normalizedImageSources.map((source) => ({
                source,
                error: 'session_context_unavailable'
            }))
        };
    }

    const { cookieHeader, headerCandidates } = buildTemuUploadHeaderCandidates(
        sessionContext,
        options.requestCaptureState
    );

    if (!cookieHeader || !headerCandidates.length) {
        logger.error(`${PLATFORM_NAME}${resourceLabel}上传前未获得可用会话头`, {
            requestedImageCount: normalizedImageSources.length,
            cookieCount: sessionContext.cookieCount || 0,
            mallId: sessionContext.mallId || '',
            antiContentReady: !!sessionContext.antiContent
        });
        return {
            success: false,
            message: `当前 Temu 页面未获取到可用 cookies，无法上传${resourceLabel}`,
            requestedImageCount: normalizedImageSources.length,
            requestedSourceCount: normalizedImageSources.length,
            uploadedCount: 0,
            uploadedImages: [],
            failedImages: normalizedImageSources.map((source) => ({
                source,
                error: 'cookies_missing'
            }))
        };
    }

    logger.info(`${PLATFORM_NAME}开始上传${resourceLabel}到Temu云文件`, {
        requestedImageCount: normalizedImageSources.length,
        mallId: sessionContext.mallId || '',
        cookieCount: sessionContext.cookieCount || 0,
        antiContentReady: !!sessionContext.antiContent
    });

    const preparedResult = await prepareTemuImageFiles(normalizedImageSources);
    if (!preparedResult.success) {
        logger.error(`${PLATFORM_NAME}${resourceLabel}上传前文件准备失败`, {
            requestedImageCount: normalizedImageSources.length,
            message: preparedResult.message || 'prepare_failed'
        });
        return {
            success: false,
            message: preparedResult.message || `准备 Temu ${resourceLabel}文件失败`,
            requestedImageCount: normalizedImageSources.length,
            requestedSourceCount: normalizedImageSources.length,
            uploadedCount: 0,
            uploadedImages: [],
            failedImages: normalizedImageSources.map((source) => ({
                source,
                error: 'prepare_failed'
            }))
        };
    }

    const uploadedImages = [];
    const failedImages = [];
    const retryEvents = [];

    try {
        logger.info(`${PLATFORM_NAME}${resourceLabel}本地文件准备完成`, {
            preparedCount: preparedResult.fileEntries.length,
            requestedImageCount: normalizedImageSources.length
        });

        for (let index = 0; index < preparedResult.fileEntries.length; index += 1) {
            const fileEntry = preparedResult.fileEntries[index];
            const current = index + 1;
            const total = preparedResult.fileEntries.length;
            logger.info(`${PLATFORM_NAME}开始上传${resourceLabel}到Temu云文件 ${current}/${total}`, {
                source: fileEntry.source,
                sourceName: summarizeImageSourceForLog(fileEntry.source),
                fileName: fileEntry.fileName,
                current,
                total
            });

            let activeHeaderCandidates = headerCandidates;
            let uploadResult = null;

            for (let uploadAttempt = 0; uploadAttempt < TEMU_UPLOAD_RETRY_LIMIT; uploadAttempt += 1) {
                uploadResult = await uploadSingleTemuImage(fileEntry, activeHeaderCandidates);
                if (uploadResult.success) {
                    break;
                }

                const canRefreshSession = uploadAttempt < TEMU_UPLOAD_RETRY_LIMIT - 1
                    && uploadAttempt < TEMU_SESSION_REFRESH_RETRY_LIMIT
                    && page;
                if (!canRefreshSession) {
                    break;
                }

                const refreshedSessionContext = normalizeTemuUploadSessionContext(
                    await refreshTemuUploadSession(page, options)
                );
                if (!refreshedSessionContext?.success) {
                    retryEvents.push({
                        source: fileEntry.source,
                        fileName: fileEntry.fileName,
                        uploadAttempt: uploadAttempt + 1,
                        refreshed: false,
                        message: refreshedSessionContext?.message || 'refresh_session_failed'
                    });
                    break;
                }

                sessionContext = refreshedSessionContext;
                const rebuiltHeaders = buildTemuUploadHeaderCandidates(
                    sessionContext,
                    options.requestCaptureState
                );
                activeHeaderCandidates = rebuiltHeaders.headerCandidates || activeHeaderCandidates;
                retryEvents.push({
                    source: fileEntry.source,
                    fileName: fileEntry.fileName,
                    uploadAttempt: uploadAttempt + 1,
                    refreshed: true,
                    mallId: sessionContext.mallId || '',
                    antiContentReady: !!sessionContext.antiContent
                });
            }

            if (!uploadResult?.success) {
                failedImages.push({
                    source: fileEntry.source,
                    fileName: fileEntry.fileName,
                    error: uploadResult?.message || 'upload_failed',
                    attemptDetails: uploadResult?.attemptDetails || []
                });
                logger.error(`${PLATFORM_NAME}${resourceLabel}上传到Temu云文件失败 ${current}/${total}`, {
                    source: fileEntry.source,
                    sourceName: summarizeImageSourceForLog(fileEntry.source),
                    fileName: fileEntry.fileName,
                    current,
                    total,
                    message: uploadResult?.message || 'upload_failed'
                });
                continue;
            }

            uploadedImages.push(uploadResult.uploadedImage);
            logger.info(`${PLATFORM_NAME}${resourceLabel}上传到Temu云文件成功 ${current}/${total}`, {
                source: fileEntry.source,
                sourceName: summarizeImageSourceForLog(fileEntry.source),
                fileName: fileEntry.fileName,
                current,
                total,
                url: uploadResult.uploadedImage.url,
                width: uploadResult.uploadedImage.width,
                height: uploadResult.uploadedImage.height
            });
        }
    } finally {
        preparedResult.cleanup();
    }

    const success = failedImages.length === 0 && uploadedImages.length === normalizedImageSources.length;
    const summaryPayload = {
        requestedImageCount: normalizedImageSources.length,
        uploadedCount: uploadedImages.length,
        failedCount: failedImages.length,
        mallId: sessionContext.mallId || ''
    };
    if (success) {
        logger.info(`${PLATFORM_NAME}${resourceLabel}上传到Temu云文件完成`, summaryPayload);
    } else {
        logger.warn(`${PLATFORM_NAME}${resourceLabel}上传到Temu云文件未全部成功`, {
            ...summaryPayload,
            failedImages
        });
    }
    return {
        success,
        message: success ? `${PLATFORM_NAME}${resourceLabel}上传完成` : `${PLATFORM_NAME}${resourceLabel}上传未完成`,
        requestedImageCount: normalizedImageSources.length,
        requestedSourceCount: normalizedImageSources.length,
        uploadedCount: uploadedImages.length,
        uploadedImages,
        failedImages,
        retryEvents,
        sessionContext: {
            currentUrl: sessionContext.currentUrl || '',
            cookieCount: sessionContext.cookieCount || 0,
            mallId: sessionContext.mallId || '',
            effectiveRegion: sessionContext.effectiveRegion || 'global',
            antiContentReady: !!sessionContext.antiContent
        }
    };
}

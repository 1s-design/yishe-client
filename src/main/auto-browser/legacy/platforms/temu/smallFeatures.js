import { getOrCreateBrowser } from '../../services/BrowserService.js';
import { PageOperator } from '../../services/PageOperator.js';
import { logger } from '../../utils/logger.js';
import { PLATFORM_NAME, TEMU_SELLER_HOME_URL } from './constants.js';
import {
    normalizeBoolean,
    normalizeTemuSettings,
    pushTrace
} from './utils.js';
import {
    ensureTemuLoginPage,
    performTemuLogin,
    resolveTemuLoginState
} from './login.js';
import {
    clickButtonByText,
    clickClickableByText,
    clickVisibleSelector,
    collectTemuEditPageStructure,
    collectTemuFrameworkSnapshot,
    waitForVisibleSelector
} from './page.js';
import {
    collectTemuSessionBundle
} from './session.js';

const TEMU_SESSION_ACQUIRE_MODE_DIRECT = 'direct';
const TEMU_SESSION_ACQUIRE_MODE_LOGIN = 'login';
const TEMU_PUBLISH_DETAIL_TRIGGER_MODE_PAGE_LOAD = 'pageLoad';
const TEMU_PUBLISH_DETAIL_TRIGGER_MODE_MANUAL = 'manual';
const TEMU_PUBLISH_DETAIL_TRIGGER_MODE_BUTTON_TEXT = 'buttonText';
const TEMU_PUBLISH_DETAIL_TRIGGER_MODE_SELECTOR = 'selector';
const TEMU_PUBLISH_DETAIL_PAGE_URL = 'https://agentseller.temu.com/goods/edit?from=productList&productId=';
const TEMU_PUBLISH_DETAIL_REQUEST_URL = 'https://agentseller.temu.com/visage-agent-seller/product/edit';
const TEMU_PUBLISH_DETAIL_TRIGGER_BUTTON_TEXT = '提交';
const TEMU_REQUEST_CAPTURE_CLICK_TIMEOUT = 15_000;
const TEMU_REQUEST_CAPTURE_RESOURCE_TYPES = ['xhr', 'fetch'];
const TEMU_SESSION_RESTORE_REGION_TARGETS = {
    global: {
        key: 'global',
        label: '全球',
        url: TEMU_SELLER_HOME_URL,
        domain: 'agentseller.temu.com'
    },
    us: {
        key: 'us',
        label: '美国',
        url: 'https://agentseller-us.temu.com/',
        domain: 'agentseller-us.temu.com'
    },
    eu: {
        key: 'eu',
        label: '欧区',
        url: 'https://agentseller-eu.temu.com/',
        domain: 'agentseller-eu.temu.com'
    }
};
const TEMU_SESSION_HTTP_ONLY_PATTERNS = [
    /^api_uid$/i,
    /^passToken$/i,
    /^merchantSessionKey$/i,
    /^passport_/i,
    /^SUB_PASS_ID$/i,
    /^ttwid$/i,
    /^sid_tt$/i,
    /^sessionid(?:_ss)?$/i,
    /^sid_guard$/i,
    /^session_tlb_tag$/i,
    /^sid_ucp_v1$/i,
    /^ssid_ucp_v1$/i,
    /^PHPSESSID(?:_SS)?$/i
];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeKeepPageOpen(value) {
    if (value === undefined || value === null || value === '') {
        return true;
    }
    return normalizeBoolean(value);
}

function normalizeCollectRegionCookies(value) {
    if (value === undefined || value === null || value === '') {
        return true;
    }
    return normalizeBoolean(value);
}

function normalizeIncludeDebugInfo(value) {
    if (value === undefined || value === null || value === '') {
        return false;
    }
    return normalizeBoolean(value);
}

function isTemuHttpOnlyCookie(name = '') {
    const normalized = String(name || '').trim();
    if (!normalized) {
        return false;
    }

    return TEMU_SESSION_HTTP_ONLY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeTemuSessionRestoreRegion(value, fallbackCookies = {}) {
    const record = isPlainObject(value) ? value : {};
    const cookies = isPlainObject(record.cookies)
        ? record.cookies
        : (isPlainObject(fallbackCookies) ? fallbackCookies : {});

    return {
        cookies,
        headers: isPlainObject(record.headers) ? record.headers : {},
        updatedAt: String(record.updatedAt || '').trim()
    };
}

function buildTemuSessionRestoreSettings(input = {}) {
    const inputSession = isPlainObject(input?.session) ? input.session : {};

    return {
        keepPageOpen: normalizeKeepPageOpen(input?.keepPageOpen),
        includeDebugInfo: normalizeIncludeDebugInfo(input?.includeDebugInfo),
        mallId: String(input?.mallId || '').trim(),
        mallName: String(input?.mallName || '').trim(),
        session: {
            global: normalizeTemuSessionRestoreRegion(
                inputSession.global,
                input?.cookies_global || input?.cookies
            ),
            us: normalizeTemuSessionRestoreRegion(inputSession.us, input?.cookies_us),
            eu: normalizeTemuSessionRestoreRegion(inputSession.eu, input?.cookies_eu)
        }
    };
}

function buildTemuSessionRestoreCookiePlan(settings) {
    const cookies = [];
    const regionStats = [];

    for (const [regionKey, target] of Object.entries(TEMU_SESSION_RESTORE_REGION_TARGETS)) {
        const regionRecord = normalizeTemuSessionRestoreRegion(settings?.session?.[regionKey]);
        const cookieEntries = Object.entries(regionRecord.cookies)
            .filter(([name, value]) => String(name || '').trim() && value !== undefined && value !== null)
            .map(([name, value]) => ({
                name: String(name || '').trim(),
                value: String(value),
                domain: target.domain,
                path: '/',
                httpOnly: isTemuHttpOnlyCookie(name),
                secure: true,
                sameSite: 'Lax'
            }));

        cookies.push(...cookieEntries);
        regionStats.push({
            regionKey,
            label: target.label,
            domain: target.domain,
            targetUrl: target.url,
            cookieCount: cookieEntries.length,
            updatedAt: regionRecord.updatedAt || null
        });
    }

    return {
        cookies,
        regionStats,
        totalCookieCount: cookies.length
    };
}

function normalizeTemuSessionAcquireMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === TEMU_SESSION_ACQUIRE_MODE_LOGIN) {
        return TEMU_SESSION_ACQUIRE_MODE_LOGIN;
    }
    return TEMU_SESSION_ACQUIRE_MODE_DIRECT;
}

function normalizePositiveInteger(value, fallback, options = {}) {
    const {
        min = 1,
        max = Number.MAX_SAFE_INTEGER
    } = options;
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(normalized)));
}

function normalizeStringList(value) {
    if (Array.isArray(value)) {
        return Array.from(new Set(
            value.map((item) => String(item || '').trim()).filter(Boolean)
        ));
    }

    return Array.from(new Set(
        String(value || '')
            .split(/[\n,，]/)
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
}

function normalizeTemuPublishDetailTriggerMode(value) {
    const normalized = String(value || '').trim();
    if (normalized === TEMU_PUBLISH_DETAIL_TRIGGER_MODE_PAGE_LOAD) {
        return TEMU_PUBLISH_DETAIL_TRIGGER_MODE_PAGE_LOAD;
    }
    if (normalized === TEMU_PUBLISH_DETAIL_TRIGGER_MODE_BUTTON_TEXT) {
        return TEMU_PUBLISH_DETAIL_TRIGGER_MODE_BUTTON_TEXT;
    }
    if (normalized === TEMU_PUBLISH_DETAIL_TRIGGER_MODE_SELECTOR) {
        return TEMU_PUBLISH_DETAIL_TRIGGER_MODE_SELECTOR;
    }
    return TEMU_PUBLISH_DETAIL_TRIGGER_MODE_MANUAL;
}

function buildTemuPublishDetailRequestCaptureSettings(input = {}) {
    const spuId = String(input?.spuId || input?.supId || input?.productId || '').trim();

    return {
        spuId,
        requestKeywords: [TEMU_PUBLISH_DETAIL_REQUEST_URL],
        triggerMode: TEMU_PUBLISH_DETAIL_TRIGGER_MODE_BUTTON_TEXT,
        buttonTexts: [TEMU_PUBLISH_DETAIL_TRIGGER_BUTTON_TEXT],
        buttonSelector: '',
        captureTimeoutMs: normalizePositiveInteger(input?.captureTimeoutMs, 60_000, {
            min: 3_000,
            max: 300_000
        }),
        keepPageOpen: normalizeKeepPageOpen(input?.keepPageOpen),
        includeDebugInfo: normalizeIncludeDebugInfo(input?.includeDebugInfo)
    };
}

function buildTemuPublishDetailPageUrl(spuId) {
    return `${TEMU_PUBLISH_DETAIL_PAGE_URL}${encodeURIComponent(String(spuId || '').trim())}`;
}

function normalizeTemuRequestHeaders(headers = {}) {
    return Object.fromEntries(
        Object.entries(headers || {}).map(([key, value]) => [
            String(key || '').toLowerCase(),
            String(value || '').trim()
        ])
    );
}

function extractUrlQueryParams(url = '') {
    try {
        const parsedUrl = new URL(String(url || '').trim());
        const query = {};

        for (const [key, value] of parsedUrl.searchParams.entries()) {
            if (!(key in query)) {
                query[key] = value;
                continue;
            }

            if (Array.isArray(query[key])) {
                query[key].push(value);
                continue;
            }

            query[key] = [query[key], value];
        }

        return query;
    } catch {
        return {};
    }
}

function normalizeRequestBody(rawBody = '') {
    const bodyText = String(rawBody || '').trim();
    if (!bodyText) {
        return {
            postData: '',
            postDataJson: null,
            postDataForm: null
        };
    }

    try {
        return {
            postData: bodyText,
            postDataJson: JSON.parse(bodyText),
            postDataForm: null
        };
    } catch {
        // ignore json parse errors
    }

    try {
        const formEntries = Array.from(new URLSearchParams(bodyText).entries());
        if (formEntries.length) {
            return {
                postData: bodyText,
                postDataJson: null,
                postDataForm: Object.fromEntries(formEntries)
            };
        }
    } catch {
        // ignore form parse errors
    }

    return {
        postData: bodyText,
        postDataJson: null,
        postDataForm: null
    };
}

function buildTemuCapturedRequest(request, matchedKeyword = '') {
    const requestUrl = String(request?.url?.() || '').trim();
    let rawPostData = String(request?.postData?.() || '').trim();
    let postDataJson = null;
    let postDataBuffer = null;

    try {
        postDataJson = request?.postDataJSON?.() ?? null;
    } catch {
        postDataJson = null;
    }

    try {
        postDataBuffer = request?.postDataBuffer?.() ?? null;
    } catch {
        postDataBuffer = null;
    }

    if (!rawPostData && postDataBuffer && Buffer.isBuffer(postDataBuffer) && postDataBuffer.length) {
        rawPostData = String(postDataBuffer.toString('utf8') || '').trim();
    }

    const normalizedBody = normalizeRequestBody(rawPostData);
    return {
        capturedAt: new Date().toISOString(),
        matchedKeyword,
        url: requestUrl,
        method: String(request?.method?.() || '').trim().toUpperCase() || 'GET',
        resourceType: String(request?.resourceType?.() || '').trim().toLowerCase(),
        frameUrl: String(request?.frame?.()?.url?.() || '').trim(),
        headers: normalizeTemuRequestHeaders(request?.headers?.() || {}),
        query: extractUrlQueryParams(requestUrl),
        postData: normalizedBody.postData,
        postDataJson: postDataJson ?? normalizedBody.postDataJson,
        postDataForm: normalizedBody.postDataForm,
        source: 'playwright'
    };
}

function buildTemuCapturedRequestFromCdp(event = {}, matchedKeyword = '', resolvedPostData = '') {
    const request = isPlainObject(event?.request) ? event.request : {};
    const requestUrl = String(request?.url || '').trim();
    const rawPostData = String(resolvedPostData || request?.postData || '').trim();
    const normalizedBody = normalizeRequestBody(rawPostData);

    return {
        capturedAt: new Date().toISOString(),
        matchedKeyword,
        url: requestUrl,
        method: String(request?.method || '').trim().toUpperCase() || 'GET',
        resourceType: String(event?.type || '').trim().toLowerCase(),
        frameUrl: '',
        headers: normalizeTemuRequestHeaders(request?.headers || {}),
        query: extractUrlQueryParams(requestUrl),
        postData: normalizedBody.postData,
        postDataJson: normalizedBody.postDataJson,
        postDataForm: normalizedBody.postDataForm,
        source: 'cdp'
    };
}

async function createTemuMatchedRequestCapture(pageOrContext, options = {}) {
    const page = pageOrContext && typeof pageOrContext?.context === 'function'
        ? pageOrContext
        : null;
    const context = page
        ? page.context()
        : pageOrContext;
    const requestKeywords = normalizeStringList(options?.requestKeywords || options?.requestKeyword);
    const normalizedKeywords = requestKeywords.map((item) => ({
        raw: item,
        normalized: item.toLowerCase()
    }));
    const state = {
        requestKeywords,
        observedRequestCount: 0,
        matchedRequestCount: 0,
        lastObservedRequestUrl: '',
        lastMatchedRequest: null,
        matchedRequests: []
    };
    let cdpSession = null;

    const pushMatchedRequest = (matchedRequest) => {
        if (!matchedRequest || typeof matchedRequest !== 'object') {
            return;
        }

        const existingIndex = state.matchedRequests.findIndex((item) => {
            return String(item?.method || '').trim().toUpperCase() === String(matchedRequest?.method || '').trim().toUpperCase()
                && String(item?.url || '').trim() === String(matchedRequest?.url || '').trim();
        });

        if (existingIndex >= 0) {
            const existingRequest = state.matchedRequests[existingIndex];
            if (
                (!isTemuBodyRequest(existingRequest) && isTemuBodyRequest(matchedRequest))
                || (!isTemuMutationRequest(existingRequest) && isTemuMutationRequest(matchedRequest))
            ) {
                state.matchedRequests[existingIndex] = matchedRequest;
                state.lastMatchedRequest = matchedRequest;
            }
            return;
        }

        state.matchedRequestCount += 1;
        state.lastMatchedRequest = matchedRequest;

        if (state.matchedRequests.length < 12) {
            state.matchedRequests.push(matchedRequest);
        }
    };

    const onRequest = (request) => {
        try {
            const url = String(request?.url?.() || '').trim();
            const resourceType = String(request?.resourceType?.() || '').trim().toLowerCase();
            if (!url || !/temu\.com|kuajingmaihuo\.com/i.test(url)) {
                return;
            }
            if (!TEMU_REQUEST_CAPTURE_RESOURCE_TYPES.includes(resourceType)) {
                return;
            }

            state.observedRequestCount += 1;
            state.lastObservedRequestUrl = url;

            const matchedKeyword = normalizedKeywords.find((keyword) => {
                return url.toLowerCase().includes(keyword.normalized);
            });
            if (!matchedKeyword) {
                return;
            }

            const matchedRequest = buildTemuCapturedRequest(request, matchedKeyword.raw);
            pushMatchedRequest(matchedRequest);
        } catch {
            // ignore request capture errors
        }
    };

    context.on('request', onRequest);

    const onCdpRequestWillBeSent = async (event) => {
        try {
            const request = isPlainObject(event?.request) ? event.request : {};
            const url = String(request?.url || '').trim();
            const resourceType = String(event?.type || '').trim().toLowerCase();
            if (!url || !/temu\.com|kuajingmaihuo\.com/i.test(url)) {
                return;
            }
            if (resourceType && !TEMU_REQUEST_CAPTURE_RESOURCE_TYPES.includes(resourceType)) {
                return;
            }

            state.observedRequestCount += 1;
            state.lastObservedRequestUrl = url;

            const matchedKeyword = normalizedKeywords.find((keyword) => {
                return url.toLowerCase().includes(keyword.normalized);
            });
            if (!matchedKeyword) {
                return;
            }

            let resolvedPostData = String(request?.postData || '').trim();
            if (!resolvedPostData && request?.hasPostData && cdpSession && event?.requestId) {
                try {
                    const postDataResponse = await cdpSession.send('Network.getRequestPostData', {
                        requestId: event.requestId
                    });
                    resolvedPostData = String(postDataResponse?.postData || '').trim();
                } catch {
                    resolvedPostData = '';
                }
            }

            const matchedRequest = buildTemuCapturedRequestFromCdp(
                event,
                matchedKeyword.raw,
                resolvedPostData
            );
            pushMatchedRequest(matchedRequest);
        } catch {
            // ignore cdp request capture errors
        }
    };

    if (page && typeof context?.newCDPSession === 'function') {
        try {
            cdpSession = await context.newCDPSession(page);
            await cdpSession.send('Network.enable').catch(() => undefined);
            cdpSession.on('Network.requestWillBeSent', onCdpRequestWillBeSent);
        } catch {
            cdpSession = null;
        }
    }

    return {
        state,
        clear() {
            state.observedRequestCount = 0;
            state.matchedRequestCount = 0;
            state.lastObservedRequestUrl = '';
            state.lastMatchedRequest = null;
            state.matchedRequests = [];
        },
        dispose() {
            context.off('request', onRequest);
            if (cdpSession) {
                cdpSession.off?.('Network.requestWillBeSent', onCdpRequestWillBeSent);
                void cdpSession.detach?.().catch(() => undefined);
            }
        }
    };
}

function isTemuBodyRequest(request = null) {
    if (!request || typeof request !== 'object') {
        return false;
    }

    if (String(request.postData || '').trim()) {
        return true;
    }

    if (request.postDataJson && typeof request.postDataJson === 'object') {
        return Object.keys(request.postDataJson).length > 0;
    }

    if (request.postDataForm && typeof request.postDataForm === 'object') {
        return Object.keys(request.postDataForm).length > 0;
    }

    return false;
}

function isTemuMutationRequest(request = null) {
    const method = String(request?.method || '').trim().toUpperCase();
    return ['POST', 'PUT', 'PATCH'].includes(method);
}

function pickPreferredTemuMatchedRequest(matchedRequests = []) {
    const normalizedRequests = Array.isArray(matchedRequests) ? matchedRequests : [];
    if (!normalizedRequests.length) {
        return null;
    }

    return normalizedRequests.find((item) => isTemuMutationRequest(item) && isTemuBodyRequest(item))
        || normalizedRequests.find((item) => isTemuBodyRequest(item))
        || normalizedRequests.find((item) => isTemuMutationRequest(item))
        || normalizedRequests[0]
        || null;
}

async function waitForTemuMatchedRequest(captureState, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    let fallbackMatchedRequest = null;

    while (Date.now() < deadline) {
        const matchedRequests = Array.isArray(captureState?.matchedRequests)
            ? captureState.matchedRequests
            : [];
        if (matchedRequests.length) {
            const preferredMatchedRequest = pickPreferredTemuMatchedRequest(matchedRequests);
            if (preferredMatchedRequest) {
                fallbackMatchedRequest = preferredMatchedRequest;
            }

            if (preferredMatchedRequest && (isTemuBodyRequest(preferredMatchedRequest) || isTemuMutationRequest(preferredMatchedRequest))) {
                return {
                    success: true,
                    matchedRequest: preferredMatchedRequest,
                    observedRequestCount: captureState.observedRequestCount || 0,
                    matchedRequestCount: captureState.matchedRequestCount || 0,
                    matchedRequests
                };
            }

            await sleep(250);
            continue;
        }

        await sleep(250);
    }

    if (fallbackMatchedRequest) {
        return {
            success: true,
            matchedRequest: fallbackMatchedRequest,
            observedRequestCount: captureState.observedRequestCount || 0,
            matchedRequestCount: captureState.matchedRequestCount || 0,
            matchedRequests: Array.isArray(captureState?.matchedRequests)
                ? captureState.matchedRequests
                : []
        };
    }

    return {
        success: false,
        matchedRequest: captureState?.lastMatchedRequest || null,
        observedRequestCount: captureState?.observedRequestCount || 0,
        matchedRequestCount: captureState?.matchedRequestCount || 0,
        matchedRequests: Array.isArray(captureState?.matchedRequests)
            ? captureState.matchedRequests
            : []
    };
}

async function clickTemuTriggerByText(page, texts = [], timeoutMs = TEMU_REQUEST_CAPTURE_CLICK_TIMEOUT) {
    const deadline = Date.now() + timeoutMs;
    const candidates = normalizeStringList(texts);

    while (Date.now() < deadline) {
        const buttonClicked = await clickButtonByText(page, candidates, {
            exact: true,
            selectors: ['button', '[role="button"]'],
            clickOptions: {
                timeout: 3_000
            }
        });
        if (buttonClicked) {
            return {
                success: true,
                detail: {
                    ...buttonClicked,
                    strategy: 'button_exact_text'
                }
            };
        }

        const fallbackButtonClicked = await clickButtonByText(page, candidates, {
            exact: false,
            selectors: ['button', '[role="button"]'],
            clickOptions: {
                timeout: 3_000
            }
        });
        if (fallbackButtonClicked) {
            return {
                success: true,
                detail: {
                    ...fallbackButtonClicked,
                    strategy: 'button_partial_text'
                }
            };
        }

        const clicked = await clickClickableByText(page, candidates, {
            selector: 'button,[role="button"]',
            exact: false
        });
        if (clicked) {
            return {
                success: true,
                detail: {
                    ...clicked,
                    strategy: 'legacy_clickable_text'
                }
            };
        }

        await page.waitForTimeout(400);
    }

    return {
        success: false,
        reason: 'button_text_not_found',
        buttonTexts: candidates
    };
}

async function clickTemuTriggerBySelector(page, selector = '', timeoutMs = TEMU_REQUEST_CAPTURE_CLICK_TIMEOUT) {
    const selectors = normalizeStringList(selector);
    const matched = await waitForVisibleSelector(page, selectors, timeoutMs);
    if (!matched) {
        return {
            success: false,
            reason: 'button_selector_not_found',
            buttonSelector: selectors.join(', ')
        };
    }

    const clicked = await clickVisibleSelector(page, selectors, {
        timeout: 5_000
    });
    if (clicked) {
        return {
            success: true,
            detail: clicked
        };
    }

    return {
        success: false,
        reason: 'button_selector_click_failed',
        buttonSelector: selectors.join(', ')
    };
}

async function triggerTemuPublishDetailRequestCapture(page, settings = {}) {
    if (settings.triggerMode === TEMU_PUBLISH_DETAIL_TRIGGER_MODE_PAGE_LOAD) {
        return {
            success: true,
            skipped: true,
            triggerMode: settings.triggerMode,
            message: '已启用页面加载阶段侦听'
        };
    }

    if (settings.triggerMode === TEMU_PUBLISH_DETAIL_TRIGGER_MODE_MANUAL) {
        return {
            success: true,
            skipped: true,
            triggerMode: settings.triggerMode,
            message: '页面已打开，请在侦听超时前手动触发目标操作'
        };
    }

    if (settings.triggerMode === TEMU_PUBLISH_DETAIL_TRIGGER_MODE_BUTTON_TEXT) {
        return await clickTemuTriggerByText(page, settings.buttonTexts, TEMU_REQUEST_CAPTURE_CLICK_TIMEOUT);
    }

    if (settings.triggerMode === TEMU_PUBLISH_DETAIL_TRIGGER_MODE_SELECTOR) {
        return await clickTemuTriggerBySelector(page, settings.buttonSelector, TEMU_REQUEST_CAPTURE_CLICK_TIMEOUT);
    }

    return {
        success: false,
        reason: 'unsupported_trigger_mode',
        triggerMode: settings.triggerMode
    };
}

function buildCompactTemuSessionBundle(sessionBundle = {}) {
    return {
        collectedAt: sessionBundle?.collectedAt || '',
        currentUrl: sessionBundle?.currentUrl || '',
        mallId: sessionBundle?.mallId || '',
        mallName: sessionBundle?.mallName || '',
        mallList: Array.isArray(sessionBundle?.mallList) ? sessionBundle.mallList : [],
        accountId: sessionBundle?.accountId || '',
        accountType: sessionBundle?.accountType || '',
        antiContent: sessionBundle?.antiContent || '',
        userAgent: sessionBundle?.userAgent || '',
        headersTemplate: sessionBundle?.headersTemplate || {},
        regionHeaders: sessionBundle?.regionHeaders || {},
        cookies: sessionBundle?.cookies || {},
        cookies_global: sessionBundle?.cookies_global || sessionBundle?.cookies || {},
        cookies_us: sessionBundle?.cookies_us || {},
        cookies_eu: sessionBundle?.cookies_eu || {}
    };
}

function buildTemuSessionAcquireSettings(input = {}) {
    return {
        ...normalizeTemuSettings(input),
        acquireMode: normalizeTemuSessionAcquireMode(input?.acquireMode),
        keepPageOpen: normalizeKeepPageOpen(input?.keepPageOpen),
        collectRegionCookies: normalizeCollectRegionCookies(input?.collectRegionCookies),
        includeDebugInfo: normalizeIncludeDebugInfo(input?.includeDebugInfo)
    };
}

function buildTemuSessionAcquireResult({
    featureKey,
    profileId,
    currentUrl,
    loginState,
    sessionBundle,
    pageKeptOpen,
    acquireMode,
    includeDebugInfo,
    loginStateBefore,
    executionTrace,
    snapshot
}) {
    const compactSessionBundle = buildCompactTemuSessionBundle(sessionBundle);
    if (!includeDebugInfo) {
        return {
            featureKey,
            profileId: profileId || null,
            currentUrl,
            loginState,
            acquireMode,
            sessionBundle: compactSessionBundle,
            pageKeptOpen
        };
    }

    return {
        featureKey,
        profileId: profileId || null,
        currentUrl,
        pageTitle: snapshot?.title || '',
        loginStateBefore,
        loginState,
        detectedButtons: snapshot?.buttons || [],
        detectedInputs: snapshot?.inputs || [],
        bodyPreview: snapshot?.bodyPreview || '',
        acquireMode,
        sessionBundle: {
            ...compactSessionBundle,
            cookieDomains: sessionBundle?.cookieDomains || [],
            requestCapture: sessionBundle?.requestCapture || {},
            regionCollection: sessionBundle?.regionCollection || {},
            warnings: sessionBundle?.warnings || []
        },
        executionTrace,
        pageKeptOpen
    };
}

export async function runTemuLoginSmallFeature(input = {}, runtimeOptions = {}) {
    const profileId = String(input?.profileId || '').trim() || undefined;
    const settings = {
        ...normalizeTemuSettings(input),
        keepPageOpen: normalizeKeepPageOpen(input?.keepPageOpen)
    };
    const pageOperator = runtimeOptions?.pageOperator || new PageOperator();
    const executionTrace = [];
    const managePage = !runtimeOptions?.page;
    let page = runtimeOptions?.page || null;

    try {
        logger.info(`${PLATFORM_NAME}工具开始执行登录流程`, {
            profileId: profileId || 'default',
            loginUrl: settings.loginUrl,
            keepPageOpen: settings.keepPageOpen,
            reusePage: !managePage,
            hasAccount: !!settings.account,
            hasPassword: !!settings.password
        });
        pushTrace(executionTrace, 'start', 'success', {
            profileId: profileId || null,
            loginUrl: settings.loginUrl,
            keepPageOpen: settings.keepPageOpen,
            reusePage: !managePage
        });

        if (managePage) {
            const browser = await getOrCreateBrowser({ profileId });
            page = await browser.newPage({ foreground: true });
            await pageOperator.setupAntiDetection(page);
            pushTrace(executionTrace, 'open_page', 'success', {
                reusedCurrentPage: false,
                currentUrl: page.url()
            });
        } else {
            pushTrace(executionTrace, 'open_page', 'success', {
                reusedCurrentPage: true,
                currentUrl: page.url()
            });
        }

        const loginPageState = await ensureTemuLoginPage(page, settings.loginUrl);
        pushTrace(executionTrace, 'open_login_page', 'success', loginPageState);

        const loginStateBefore = await resolveTemuLoginState(page);
        pushTrace(executionTrace, 'check_login_state_before', loginStateBefore.loggedIn ? 'success' : 'pending', loginStateBefore);

        const loginResult = await performTemuLogin(page, settings, pageOperator);
        if (!loginResult.success) {
            pushTrace(executionTrace, 'perform_login', 'failed', {
                reason: loginResult.reason,
                currentUrl: page.url()
            });

            const snapshot = await collectTemuFrameworkSnapshot(page);
            return {
                success: false,
                message: loginResult.message || `${PLATFORM_NAME}登录失败`,
                data: {
                    featureKey: 'temu-login',
                    profileId: profileId || null,
                    currentUrl: page.url(),
                    pageTitle: snapshot.title,
                    loginStateBefore,
                    loginState: loginResult.loginState || null,
                    bodyPreview: loginResult.bodyPreview || snapshot.bodyPreview,
                    detectedButtons: snapshot.buttons,
                    detectedInputs: snapshot.inputs,
                    executionTrace,
                    pageKeptOpen: settings.keepPageOpen
                }
            };
        }

        const loginStateAfter = await resolveTemuLoginState(page);
        pushTrace(executionTrace, 'perform_login', 'success', {
            reason: loginResult.reason,
            currentUrl: page.url()
        });
        pushTrace(executionTrace, 'check_login_state_after', loginStateAfter.loggedIn ? 'success' : 'pending', loginStateAfter);

        const snapshot = await collectTemuFrameworkSnapshot(page);
        return {
            success: true,
            message: loginResult.reason === 'already_logged_in'
                ? `${PLATFORM_NAME}当前已登录`
                : `${PLATFORM_NAME}登录流程执行完成`,
            data: {
                featureKey: 'temu-login',
                profileId: profileId || null,
                currentUrl: page.url(),
                pageTitle: snapshot.title,
                loginStateBefore,
                loginState: loginStateAfter,
                detectedButtons: snapshot.buttons,
                detectedInputs: snapshot.inputs,
                bodyPreview: snapshot.bodyPreview,
                executionTrace,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    } catch (error) {
        logger.error(`${PLATFORM_NAME}工具执行失败:`, error);
        pushTrace(executionTrace, 'fatal_error', 'failed', {
            message: error?.message || String(error)
        });

        return {
            success: false,
            message: error?.message || `${PLATFORM_NAME}工具执行失败`,
            data: {
                featureKey: 'temu-login',
                profileId: profileId || null,
                currentUrl: page?.url?.() || '',
                executionTrace,
                reusedCurrentPage: !managePage,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    } finally {
        if (managePage && page && !settings.keepPageOpen) {
            try {
                await page.close();
            } catch (closeError) {
                logger.warn(`${PLATFORM_NAME}工具关闭页面失败: ${closeError?.message || closeError}`);
            }
        } else if (managePage && page && settings.keepPageOpen) {
            logger.info(`${PLATFORM_NAME}工具保留页面，方便继续调试`);
        }
    }
}

export async function runTemuSessionCollectSmallFeature(input = {}, runtimeOptions = {}) {
    const profileId = String(input?.profileId || '').trim() || undefined;
    const settings = {
        keepPageOpen: normalizeKeepPageOpen(input?.keepPageOpen),
        collectRegionCookies: normalizeCollectRegionCookies(input?.collectRegionCookies),
        includeDebugInfo: normalizeIncludeDebugInfo(input?.includeDebugInfo)
    };
    const pageOperator = runtimeOptions?.pageOperator || new PageOperator();
    const executionTrace = [];
    const managePage = !runtimeOptions?.page;
    let page = runtimeOptions?.page || null;

    try {
        logger.info(`${PLATFORM_NAME}工具开始采集会话`, {
            profileId: profileId || 'default',
            keepPageOpen: settings.keepPageOpen,
            collectRegionCookies: settings.collectRegionCookies,
            includeDebugInfo: settings.includeDebugInfo,
            reusePage: !managePage
        });
        pushTrace(executionTrace, 'start', 'success', {
            profileId: profileId || null,
            keepPageOpen: settings.keepPageOpen,
            collectRegionCookies: settings.collectRegionCookies,
            includeDebugInfo: settings.includeDebugInfo,
            reusePage: !managePage
        });

        if (managePage) {
            const browser = await getOrCreateBrowser({ profileId });
            page = await browser.newPage({ foreground: true });
            await pageOperator.setupAntiDetection(page);
            pushTrace(executionTrace, 'open_page', 'success', {
                reusedCurrentPage: false,
                currentUrl: page.url()
            });
        } else {
            pushTrace(executionTrace, 'open_page', 'success', {
                reusedCurrentPage: true,
                currentUrl: page.url()
            });
        }

        const loginStateBefore = await resolveTemuLoginState(page);
        pushTrace(executionTrace, 'check_login_state_before', loginStateBefore.loggedIn ? 'success' : 'pending', loginStateBefore);

        const sessionResult = await collectTemuSessionBundle(page, {
            collectRegionCookies: settings.collectRegionCookies
        });
        if (!sessionResult.success) {
            pushTrace(executionTrace, 'collect_session_bundle', 'failed', {
                reason: sessionResult.reason,
                currentUrl: page.url()
            });

            const snapshot = await collectTemuFrameworkSnapshot(page);
            const loginStateAfterFailure = await resolveTemuLoginState(page);
            return {
                success: false,
                message: sessionResult.reason === 'login_required'
                    ? `请先登录${PLATFORM_NAME}后再执行会话采集`
                    : sessionResult.message || `${PLATFORM_NAME}会话采集失败`,
                data: {
                    featureKey: 'temu-session-collect',
                    profileId: profileId || null,
                    currentUrl: page.url(),
                    pageTitle: snapshot.title,
                    loginStateBefore,
                    loginState: loginStateAfterFailure,
                    bodyPreview: snapshot.bodyPreview,
                    detectedButtons: snapshot.buttons,
                    detectedInputs: snapshot.inputs,
                    executionTrace,
                    pageKeptOpen: settings.keepPageOpen
                }
            };
        }

        const loginStateAfter = await resolveTemuLoginState(page);
        pushTrace(executionTrace, 'check_login_state_after', loginStateAfter.loggedIn ? 'success' : 'pending', loginStateAfter);

        pushTrace(executionTrace, 'collect_session_bundle', 'success', {
            mallId: sessionResult.sessionBundle?.mallId || '',
            mallCount: sessionResult.sessionBundle?.mallList?.length || 0,
            currentUrl: page.url()
        });

        const snapshot = await collectTemuFrameworkSnapshot(page);
        const compactSessionBundle = buildCompactTemuSessionBundle(sessionResult.sessionBundle);

        if (!settings.includeDebugInfo) {
            return {
                success: true,
                message: `${PLATFORM_NAME}会话采集完成`,
                data: {
                    featureKey: 'temu-session-collect',
                    profileId: profileId || null,
                    currentUrl: page.url(),
                    loginState: loginStateAfter,
                    sessionBundle: compactSessionBundle,
                    pageKeptOpen: settings.keepPageOpen
                }
            };
        }

        return {
            success: true,
            message: `${PLATFORM_NAME}会话采集完成`,
            data: {
                featureKey: 'temu-session-collect',
                profileId: profileId || null,
                currentUrl: page.url(),
                pageTitle: snapshot.title,
                loginStateBefore,
                loginState: loginStateAfter,
                detectedButtons: snapshot.buttons,
                detectedInputs: snapshot.inputs,
                bodyPreview: snapshot.bodyPreview,
                sessionBundle: {
                    ...compactSessionBundle,
                    cookieDomains: sessionResult.sessionBundle?.cookieDomains || [],
                    requestCapture: sessionResult.sessionBundle?.requestCapture || {},
                    regionCollection: sessionResult.sessionBundle?.regionCollection || {},
                    warnings: sessionResult.sessionBundle?.warnings || []
                },
                executionTrace,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    } catch (error) {
        logger.error(`${PLATFORM_NAME}会话采集工具执行失败:`, error);
        pushTrace(executionTrace, 'fatal_error', 'failed', {
            message: error?.message || String(error)
        });

        return {
            success: false,
            message: error?.message || `${PLATFORM_NAME}会话采集工具执行失败`,
            data: {
                featureKey: 'temu-session-collect',
                profileId: profileId || null,
                currentUrl: page?.url?.() || '',
                executionTrace,
                reusedCurrentPage: !managePage,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    } finally {
        if (managePage && page && !settings.keepPageOpen) {
            try {
                await page.close();
            } catch (closeError) {
                logger.warn(`${PLATFORM_NAME}工具关闭页面失败: ${closeError?.message || closeError}`);
            }
        } else if (managePage && page && settings.keepPageOpen) {
            logger.info(`${PLATFORM_NAME}工具保留页面，方便继续调试`);
        }
    }
}

export async function runTemuSessionAcquireSmallFeature(input = {}, runtimeOptions = {}) {
    const profileId = String(input?.profileId || '').trim() || undefined;
    const settings = buildTemuSessionAcquireSettings(input);
    const pageOperator = runtimeOptions?.pageOperator || new PageOperator();
    const executionTrace = [];
    const managePage = !runtimeOptions?.page;
    let page = runtimeOptions?.page || null;

    try {
        logger.info(`${PLATFORM_NAME}工具开始获取会话`, {
            profileId: profileId || 'default',
            acquireMode: settings.acquireMode,
            keepPageOpen: settings.keepPageOpen,
            collectRegionCookies: settings.collectRegionCookies,
            includeDebugInfo: settings.includeDebugInfo,
            reusePage: !managePage,
            hasAccount: !!settings.account,
            hasPassword: !!settings.password
        });
        pushTrace(executionTrace, 'start', 'success', {
            profileId: profileId || null,
            acquireMode: settings.acquireMode,
            keepPageOpen: settings.keepPageOpen,
            collectRegionCookies: settings.collectRegionCookies,
            includeDebugInfo: settings.includeDebugInfo,
            reusePage: !managePage
        });

        if (managePage) {
            const browser = await getOrCreateBrowser({ profileId });
            page = await browser.newPage({ foreground: true });
            await pageOperator.setupAntiDetection(page);
            pushTrace(executionTrace, 'open_page', 'success', {
                reusedCurrentPage: false,
                currentUrl: page.url()
            });
        } else {
            pushTrace(executionTrace, 'open_page', 'success', {
                reusedCurrentPage: true,
                currentUrl: page.url()
            });
        }

        const loginStateBefore = await resolveTemuLoginState(page);
        pushTrace(executionTrace, 'check_login_state_before', loginStateBefore.loggedIn ? 'success' : 'pending', loginStateBefore);

        let acquireMessage = `${PLATFORM_NAME}会话获取完成`;
        if (settings.acquireMode === TEMU_SESSION_ACQUIRE_MODE_LOGIN) {
            const loginResult = await performTemuLogin(page, settings, pageOperator);
            if (!loginResult.success) {
                pushTrace(executionTrace, 'perform_login', 'failed', {
                    reason: loginResult.reason,
                    currentUrl: page.url()
                });

                const snapshot = await collectTemuFrameworkSnapshot(page);
                return {
                    success: false,
                    message: loginResult.message || `${PLATFORM_NAME}登录失败，无法继续获取会话`,
                    data: {
                        featureKey: 'temu-session-acquire',
                        profileId: profileId || null,
                        currentUrl: page.url(),
                        pageTitle: snapshot.title,
                        loginStateBefore,
                        loginState: loginResult.loginState || null,
                        acquireMode: settings.acquireMode,
                        bodyPreview: loginResult.bodyPreview || snapshot.bodyPreview,
                        detectedButtons: snapshot.buttons,
                        detectedInputs: snapshot.inputs,
                        executionTrace,
                        pageKeptOpen: settings.keepPageOpen
                    }
                };
            }

            pushTrace(executionTrace, 'perform_login', 'success', {
                reason: loginResult.reason,
                currentUrl: page.url()
            });
            acquireMessage = loginResult.reason === 'already_logged_in'
                ? `${PLATFORM_NAME}当前已登录，会话获取完成`
                : `${PLATFORM_NAME}登录并获取会话完成`;
        }

        const sessionResult = await collectTemuSessionBundle(page, {
            collectRegionCookies: settings.collectRegionCookies
        });
        if (!sessionResult.success) {
            pushTrace(executionTrace, 'collect_session_bundle', 'failed', {
                reason: sessionResult.reason,
                currentUrl: page.url()
            });

            const snapshot = await collectTemuFrameworkSnapshot(page);
            const loginStateAfterFailure = await resolveTemuLoginState(page);
            const failureMessage = sessionResult.reason === 'login_required'
                ? settings.acquireMode === TEMU_SESSION_ACQUIRE_MODE_LOGIN
                    ? `请先处理${PLATFORM_NAME}登录验证后再重新获取会话`
                    : `当前环境未登录${PLATFORM_NAME}，请切换为“登录并获取”或先手动登录`
                : sessionResult.message || `${PLATFORM_NAME}会话获取失败`;
            return {
                success: false,
                message: failureMessage,
                data: {
                    featureKey: 'temu-session-acquire',
                    profileId: profileId || null,
                    currentUrl: page.url(),
                    pageTitle: snapshot.title,
                    loginStateBefore,
                    loginState: loginStateAfterFailure,
                    acquireMode: settings.acquireMode,
                    bodyPreview: snapshot.bodyPreview,
                    detectedButtons: snapshot.buttons,
                    detectedInputs: snapshot.inputs,
                    executionTrace,
                    pageKeptOpen: settings.keepPageOpen
                }
            };
        }

        const loginStateAfter = await resolveTemuLoginState(page);
        pushTrace(executionTrace, 'check_login_state_after', loginStateAfter.loggedIn ? 'success' : 'pending', loginStateAfter);
        pushTrace(executionTrace, 'collect_session_bundle', 'success', {
            mallId: sessionResult.sessionBundle?.mallId || '',
            mallCount: sessionResult.sessionBundle?.mallList?.length || 0,
            currentUrl: page.url()
        });

        const snapshot = await collectTemuFrameworkSnapshot(page);
        return {
            success: true,
            message: acquireMessage,
            data: buildTemuSessionAcquireResult({
                featureKey: 'temu-session-acquire',
                profileId,
                currentUrl: page.url(),
                loginState: loginStateAfter,
                sessionBundle: sessionResult.sessionBundle,
                pageKeptOpen: settings.keepPageOpen,
                acquireMode: settings.acquireMode,
                includeDebugInfo: settings.includeDebugInfo,
                loginStateBefore,
                executionTrace,
                snapshot
            })
        };
    } catch (error) {
        logger.error(`${PLATFORM_NAME}会话获取工具执行失败:`, error);
        pushTrace(executionTrace, 'fatal_error', 'failed', {
            message: error?.message || String(error)
        });

        return {
            success: false,
            message: error?.message || `${PLATFORM_NAME}会话获取工具执行失败`,
            data: {
                featureKey: 'temu-session-acquire',
                profileId: profileId || null,
                currentUrl: page?.url?.() || '',
                acquireMode: settings.acquireMode,
                executionTrace,
                reusedCurrentPage: !managePage,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    } finally {
        if (managePage && page && !settings.keepPageOpen) {
            try {
                await page.close();
            } catch (closeError) {
                logger.warn(`${PLATFORM_NAME}工具关闭页面失败: ${closeError?.message || closeError}`);
            }
        } else if (managePage && page && settings.keepPageOpen) {
            logger.info(`${PLATFORM_NAME}工具保留页面，方便继续调试`);
        }
    }
}

export async function runTemuSessionRestoreSmallFeature(input = {}, runtimeOptions = {}) {
    const featureKey = 'temu-session-restore';
    const profileId = String(input?.profileId || '').trim() || undefined;
    const settings = buildTemuSessionRestoreSettings(input);
    const pageOperator = runtimeOptions?.pageOperator || new PageOperator();
    const executionTrace = [];
    const managePage = !runtimeOptions?.page;
    let page = runtimeOptions?.page || null;

    try {
        const cookiePlan = buildTemuSessionRestoreCookiePlan(settings);
        if (!cookiePlan.totalCookieCount) {
            return {
                success: false,
                message: '当前存储会话没有可写入的 Cookie',
                data: {
                    featureKey,
                    profileId: profileId || null,
                    executionTrace,
                    pageKeptOpen: settings.keepPageOpen,
                    restoredRegions: cookiePlan.regionStats
                }
            };
        }

        logger.info(`${PLATFORM_NAME}工具开始恢复已存储会话`, {
            profileId: profileId || 'default',
            keepPageOpen: settings.keepPageOpen,
            includeDebugInfo: settings.includeDebugInfo,
            totalCookieCount: cookiePlan.totalCookieCount,
            reusePage: !managePage
        });
        pushTrace(executionTrace, 'start', 'success', {
            profileId: profileId || null,
            keepPageOpen: settings.keepPageOpen,
            includeDebugInfo: settings.includeDebugInfo,
            totalCookieCount: cookiePlan.totalCookieCount,
            reusePage: !managePage
        });

        if (managePage) {
            const browser = await getOrCreateBrowser({ profileId });
            page = await browser.newPage({ foreground: true });
            await pageOperator.setupAntiDetection(page);
            pushTrace(executionTrace, 'open_page', 'success', {
                reusedCurrentPage: false,
                currentUrl: page.url()
            });
        } else {
            pushTrace(executionTrace, 'open_page', 'success', {
                reusedCurrentPage: true,
                currentUrl: page.url()
            });
        }

        await page.context().addCookies(cookiePlan.cookies);
        pushTrace(executionTrace, 'inject_cookies', 'success', {
            totalCookieCount: cookiePlan.totalCookieCount,
            restoredRegions: cookiePlan.regionStats
        });

        await page.goto(TEMU_SELLER_HOME_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000
        });
        await sleep(1_500);
        pushTrace(executionTrace, 'open_seller_home', 'success', {
            currentUrl: page.url()
        });

        const loginState = await resolveTemuLoginState(page);
        pushTrace(executionTrace, 'check_login_state_after_restore', loginState.loggedIn ? 'success' : 'pending', loginState);

        const responseData = {
            featureKey,
            profileId: profileId || null,
            currentUrl: page.url(),
            loginState,
            restoredAt: new Date().toISOString(),
            restoredRegions: cookiePlan.regionStats,
            restoredCookieCount: cookiePlan.totalCookieCount,
            mallId: settings.mallId || null,
            mallName: settings.mallName || null,
            pageKeptOpen: settings.keepPageOpen
        };

        if (!settings.includeDebugInfo) {
            return {
                success: !!loginState.loggedIn,
                message: loginState.loggedIn
                    ? `${PLATFORM_NAME}已将存储会话写入当前环境`
                    : `${PLATFORM_NAME}Cookie 已写入当前环境，但当前仍未识别为已登录`,
                data: responseData
            };
        }

        const snapshot = await collectTemuFrameworkSnapshot(page);
        return {
            success: !!loginState.loggedIn,
            message: loginState.loggedIn
                ? `${PLATFORM_NAME}已将存储会话写入当前环境`
                : `${PLATFORM_NAME}Cookie 已写入当前环境，但当前仍未识别为已登录`,
            data: {
                ...responseData,
                pageTitle: snapshot.title,
                detectedButtons: snapshot.buttons,
                detectedInputs: snapshot.inputs,
                bodyPreview: snapshot.bodyPreview,
                executionTrace
            }
        };
    } catch (error) {
        logger.error(`${PLATFORM_NAME}恢复存储会话失败:`, error);
        pushTrace(executionTrace, 'fatal_error', 'failed', {
            message: error?.message || String(error)
        });

        return {
            success: false,
            message: error?.message || `${PLATFORM_NAME}恢复存储会话失败`,
            data: {
                featureKey,
                profileId: profileId || null,
                currentUrl: page?.url?.() || '',
                executionTrace,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    } finally {
        if (managePage && page && !settings.keepPageOpen) {
            try {
                await page.close();
            } catch (closeError) {
                logger.warn(`${PLATFORM_NAME}工具关闭页面失败: ${closeError?.message || closeError}`);
            }
        } else if (managePage && page && settings.keepPageOpen) {
            logger.info(`${PLATFORM_NAME}工具保留页面，方便继续调试`);
        }
    }
}

export async function runTemuPublishDetailRequestCaptureSmallFeature(input = {}, runtimeOptions = {}) {
    const featureKey = 'temu-publish-detail-request-capture';
    const profileId = String(input?.profileId || '').trim() || undefined;
    const settings = buildTemuPublishDetailRequestCaptureSettings(input);
    const pageOperator = runtimeOptions?.pageOperator || new PageOperator();
    const executionTrace = [];
    const managePage = !runtimeOptions?.page;
    let page = runtimeOptions?.page || null;
    let requestCapture = null;

    if (!settings.spuId) {
        return {
            success: false,
            message: '请先提供 spuId',
            data: {
                featureKey,
                profileId: profileId || null,
                executionTrace,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    }

    if (!settings.requestKeywords.length) {
        return {
            success: false,
            message: '系统未配置目标侦听接口',
            data: {
                featureKey,
                profileId: profileId || null,
                spuId: settings.spuId,
                executionTrace,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    }

    if (
        settings.triggerMode === TEMU_PUBLISH_DETAIL_TRIGGER_MODE_BUTTON_TEXT
        && !settings.buttonTexts.length
    ) {
        return {
            success: false,
            message: '系统未配置提交按钮文字',
            data: {
                featureKey,
                profileId: profileId || null,
                spuId: settings.spuId,
                triggerMode: settings.triggerMode,
                executionTrace,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    }

    if (
        settings.triggerMode === TEMU_PUBLISH_DETAIL_TRIGGER_MODE_SELECTOR
        && !settings.buttonSelector
    ) {
        return {
            success: false,
            message: '当前触发方式需要填写按钮选择器',
            data: {
                featureKey,
                profileId: profileId || null,
                spuId: settings.spuId,
                triggerMode: settings.triggerMode,
                executionTrace,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    }

    try {
        const targetUrl = buildTemuPublishDetailPageUrl(settings.spuId);
        logger.info(`${PLATFORM_NAME}工具开始侦听发布详情请求`, {
            profileId: profileId || 'default',
            spuId: settings.spuId,
            triggerMode: settings.triggerMode,
            requestKeywords: settings.requestKeywords,
            captureTimeoutMs: settings.captureTimeoutMs,
            keepPageOpen: settings.keepPageOpen,
            reusePage: !managePage
        });
        pushTrace(executionTrace, 'start', 'success', {
            profileId: profileId || null,
            spuId: settings.spuId,
            triggerMode: settings.triggerMode,
            requestKeywords: settings.requestKeywords,
            captureTimeoutMs: settings.captureTimeoutMs,
            keepPageOpen: settings.keepPageOpen,
            reusePage: !managePage
        });

        if (managePage) {
            const browser = await getOrCreateBrowser({ profileId });
            page = await browser.newPage({ foreground: true });
            await pageOperator.setupAntiDetection(page);
            pushTrace(executionTrace, 'open_page', 'success', {
                reusedCurrentPage: false,
                currentUrl: page.url()
            });
        } else {
            pushTrace(executionTrace, 'open_page', 'success', {
                reusedCurrentPage: true,
                currentUrl: page.url()
            });
        }

        requestCapture = await createTemuMatchedRequestCapture(page, {
            requestKeywords: settings.requestKeywords
        });
        pushTrace(executionTrace, 'start_request_capture', 'success', {
            requestKeywords: settings.requestKeywords
        });

        await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000
        });
        await page.waitForLoadState('networkidle', {
            timeout: 10_000
        }).catch(() => undefined);
        await page.waitForTimeout(2_500);
        pushTrace(executionTrace, 'open_publish_detail_page', 'success', {
            targetUrl,
            currentUrl: page.url()
        });

        const loginState = await resolveTemuLoginState(page);
        pushTrace(executionTrace, 'check_login_state', loginState.loggedIn ? 'success' : 'pending', loginState);

        if (!loginState.loggedIn) {
            const snapshot = await collectTemuFrameworkSnapshot(page);
            return {
                success: false,
                message: `当前环境未登录${PLATFORM_NAME}，请先登录后再侦听请求`,
                data: {
                    featureKey,
                    profileId: profileId || null,
                    spuId: settings.spuId,
                    targetUrl,
                    currentUrl: page.url(),
                    pageTitle: snapshot.title,
                    loginState,
                    detectedButtons: snapshot.buttons,
                    detectedInputs: snapshot.inputs,
                    bodyPreview: snapshot.bodyPreview,
                    executionTrace,
                    pageKeptOpen: settings.keepPageOpen
                }
            };
        }

        if (settings.triggerMode !== TEMU_PUBLISH_DETAIL_TRIGGER_MODE_PAGE_LOAD) {
            requestCapture.clear();
            pushTrace(executionTrace, 'reset_request_capture', 'success', {
                triggerMode: settings.triggerMode
            });
        }

        const triggerResult = await triggerTemuPublishDetailRequestCapture(page, settings);
        pushTrace(
            executionTrace,
            'trigger_target_action',
            triggerResult.success ? (triggerResult.skipped ? 'pending' : 'success') : 'failed',
            triggerResult
        );

        if (!triggerResult.success) {
            const snapshot = await collectTemuFrameworkSnapshot(page);
            const pageStructure = settings.includeDebugInfo
                ? await collectTemuEditPageStructure(page)
                : undefined;

            return {
                success: false,
                message: '未找到“提交”按钮或点击失败，无法继续侦听商品编辑请求',
                data: {
                    featureKey,
                    profileId: profileId || null,
                    spuId: settings.spuId,
                    targetUrl,
                    currentUrl: page.url(),
                    requestUrl: TEMU_PUBLISH_DETAIL_REQUEST_URL,
                    triggerMode: settings.triggerMode,
                    requestKeywords: settings.requestKeywords,
                    triggerResult,
                    pageTitle: snapshot.title,
                    detectedButtons: snapshot.buttons,
                    detectedInputs: snapshot.inputs,
                    bodyPreview: snapshot.bodyPreview,
                    pageStructure,
                    executionTrace,
                    pageKeptOpen: settings.keepPageOpen
                }
            };
        }

        const captureResult = await waitForTemuMatchedRequest(
            requestCapture.state,
            settings.captureTimeoutMs
        );

        if (!captureResult.success) {
            const snapshot = await collectTemuFrameworkSnapshot(page);
            const pageStructure = settings.includeDebugInfo
                ? await collectTemuEditPageStructure(page)
                : undefined;

            pushTrace(executionTrace, 'capture_target_request', 'failed', {
                requestKeywords: settings.requestKeywords,
                observedRequestCount: captureResult.observedRequestCount,
                matchedRequestCount: captureResult.matchedRequestCount,
                lastObservedRequestUrl: requestCapture.state.lastObservedRequestUrl || ''
            });

            return {
                success: false,
                message: `未在 ${settings.captureTimeoutMs}ms 内捕获到商品编辑请求`,
                data: {
                    featureKey,
                    profileId: profileId || null,
                    spuId: settings.spuId,
                    targetUrl,
                    currentUrl: page.url(),
                    requestUrl: TEMU_PUBLISH_DETAIL_REQUEST_URL,
                    triggerMode: settings.triggerMode,
                    requestKeywords: settings.requestKeywords,
                    triggerResult,
                    pageTitle: snapshot.title,
                    detectedButtons: snapshot.buttons,
                    detectedInputs: snapshot.inputs,
                    bodyPreview: snapshot.bodyPreview,
                    requestCapture: {
                        observedRequestCount: captureResult.observedRequestCount,
                        matchedRequestCount: captureResult.matchedRequestCount,
                        lastObservedRequestUrl: requestCapture.state.lastObservedRequestUrl || '',
                        matchedRequests: captureResult.matchedRequests
                    },
                    pageStructure,
                    executionTrace,
                    pageKeptOpen: settings.keepPageOpen
                }
            };
        }

        pushTrace(executionTrace, 'capture_target_request', 'success', {
            matchedKeyword: captureResult.matchedRequest?.matchedKeyword || '',
            method: captureResult.matchedRequest?.method || '',
            url: captureResult.matchedRequest?.url || ''
        });

        return {
            success: true,
            message: `${PLATFORM_NAME}商品编辑请求已捕获`,
            data: {
                featureKey,
                profileId: profileId || null,
                spuId: settings.spuId,
                postData: captureResult.matchedRequest?.postData || '',
                postDataJson: captureResult.matchedRequest?.postDataJson || null,
                postDataForm: captureResult.matchedRequest?.postDataForm || {},
                capturedAt: captureResult.matchedRequest?.capturedAt || new Date().toISOString(),
                pageKeptOpen: settings.keepPageOpen
            }
        };
    } catch (error) {
        logger.error(`${PLATFORM_NAME}发布详情请求侦听工具执行失败:`, error);
        pushTrace(executionTrace, 'fatal_error', 'failed', {
            message: error?.message || String(error)
        });

        return {
            success: false,
            message: error?.message || `${PLATFORM_NAME}发布详情请求侦听工具执行失败`,
            data: {
                featureKey,
                profileId: profileId || null,
                spuId: settings.spuId,
                requestUrl: TEMU_PUBLISH_DETAIL_REQUEST_URL,
                currentUrl: page?.url?.() || '',
                triggerMode: settings.triggerMode,
                requestKeywords: settings.requestKeywords,
                executionTrace,
                reusedCurrentPage: !managePage,
                pageKeptOpen: settings.keepPageOpen
            }
        };
    } finally {
        requestCapture?.dispose?.();

        if (managePage && page && !settings.keepPageOpen) {
            try {
                await page.close();
            } catch (closeError) {
                logger.warn(`${PLATFORM_NAME}工具关闭页面失败: ${closeError?.message || closeError}`);
            }
        } else if (managePage && page && settings.keepPageOpen) {
            logger.info(`${PLATFORM_NAME}工具保留页面，方便继续调试`);
        }
    }
}

export default {
    runTemuLoginSmallFeature,
    runTemuSessionCollectSmallFeature,
    runTemuSessionAcquireSmallFeature,
    runTemuPublishDetailRequestCaptureSmallFeature
};

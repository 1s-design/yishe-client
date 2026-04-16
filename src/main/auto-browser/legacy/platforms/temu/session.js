import {
    PLATFORM_NAME,
    TEMU_SELLER_HOME_URL,
    TEMU_USERINFO_API_URL
} from './constants.js';
import {
    logger
} from '../../utils/logger.js';

const TEMU_DEFAULT_ACCEPT = 'application/json, text/plain, */*';
const TEMU_REGION_URLS = {
    global: TEMU_SELLER_HOME_URL,
    us: 'https://agentseller-us.temu.com/',
    eu: 'https://agentseller-eu.temu.com/'
};
const TEMU_REGION_HOSTS = {
    global: 'agentseller.temu.com',
    us: 'agentseller-us.temu.com',
    eu: 'agentseller-eu.temu.com'
};
const TEMU_REGION_COOKIE_DOMAINS = {
    global: ['temu.com', 'agentseller.temu.com'],
    us: ['temu.com', 'agentseller-us.temu.com'],
    eu: ['temu.com', 'agentseller-eu.temu.com']
};
const TEMU_REGION_SWITCHER_TEXT_MARKERS = ['全球', '美国', '欧区', '商家中心'];
const TEMU_REGION_CLICK_INDEX = {
    us: 1,
    eu: 2
};
const TEMU_REGION_CARD_SELECTOR = 'a.index-module__drItem___kEdZY';
const TEMU_CAPTURE_HEADER_KEYS = [
    'accept',
    'accept-language',
    'anti-content',
    'cache-control',
    'content-type',
    'mallid',
    'origin',
    'priority',
    'referer',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
    'user-agent'
];
const TEMU_CAPTURE_WARMUP_URLS = [
    'https://agentseller.temu.com/newon/product-select'
];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMatcherText(value = '') {
    return String(value || '').replace(/\s+/g, '');
}

function normalizeCookieDomain(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized.startsWith('.') ? normalized.slice(1) : normalized;
}

function filterCookieEntries(cookieEntries = [], domainKeyword = '') {
    const safeDomainKeywords = Array.isArray(domainKeyword)
        ? domainKeyword.map((item) => normalizeCookieDomain(item)).filter(Boolean)
        : [normalizeCookieDomain(domainKeyword)].filter(Boolean);

    return cookieEntries.filter((cookie) => {
        if (!cookie?.name) {
            return false;
        }

        if (!safeDomainKeywords.length) {
            return true;
        }

        const cookieDomain = normalizeCookieDomain(cookie.domain);
        return !!cookieDomain && safeDomainKeywords.includes(cookieDomain);
    });
}

function normalizeCookieEntries(cookieEntries = [], domainKeyword = '') {
    const result = {};

    for (const cookie of filterCookieEntries(cookieEntries, domainKeyword)) {
        result[cookie.name] = cookie.value;
    }

    return result;
}

function buildCookieHeader(cookies = {}) {
    return Object.entries(cookies)
        .filter(([name, value]) => String(name || '').trim() && value !== undefined && value !== null)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
}

function extractTemuCaptureHeaders(headers = {}) {
    return TEMU_CAPTURE_HEADER_KEYS.reduce((result, key) => {
        const value = String(headers?.[key] || '').trim();
        if (!value || value === 'undefined') {
            return result;
        }

        result[key] = value;
        return result;
    }, {});
}

function normalizeTemuRegionKey(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'us' || normalized === 'eu') {
        return normalized;
    }
    return 'global';
}

function getFallbackOriginFromUrl(pageUrl) {
    try {
        const url = new URL(String(pageUrl || '').trim() || TEMU_SELLER_HOME_URL);
        return url.origin;
    } catch {
        return new URL(TEMU_SELLER_HOME_URL).origin;
    }
}

function buildRegionHeaders(regionKey, sessionInfo = {}) {
    const regionUrl = TEMU_REGION_URLS[regionKey] || TEMU_REGION_URLS.global;
    const origin = new URL(regionUrl).origin;
    const headers = {
        accept: TEMU_DEFAULT_ACCEPT,
        'content-type': 'application/json',
        origin,
        referer: regionUrl,
        'user-agent': String(sessionInfo.userAgent || '').trim()
    };

    if (sessionInfo.antiContent) {
        headers['anti-content'] = sessionInfo.antiContent;
    }
    if (sessionInfo.mallId) {
        headers.mallid = String(sessionInfo.mallId);
    }

    return headers;
}

function pickSelectedMall(mallList = [], preferredMallId = '') {
    const safeMallId = String(preferredMallId || '').trim();
    if (!Array.isArray(mallList) || !mallList.length) {
        return null;
    }

    if (safeMallId) {
        const matchedMall = mallList.find((item) => String(item?.mallId || '') === safeMallId);
        if (matchedMall) {
            return matchedMall;
        }
    }

    return mallList[0] || null;
}

function summarizeCookieDomains(cookieEntries = []) {
    const domains = Array.from(new Set(
        cookieEntries
            .map((item) => String(item?.domain || '').trim())
            .filter(Boolean)
    ));

    return domains.sort();
}

function collectTemuCookieMaps(cookieEntries = [], options = {}) {
    const includeRegionalCookies = options.includeRegionalCookies !== false;
    const cookiesGlobal = normalizeCookieEntries(
        cookieEntries,
        TEMU_REGION_COOKIE_DOMAINS.global
    );
    const cookiesUs = includeRegionalCookies
        ? normalizeCookieEntries(cookieEntries, TEMU_REGION_COOKIE_DOMAINS.us)
        : {};
    const cookiesEu = includeRegionalCookies
        ? normalizeCookieEntries(cookieEntries, TEMU_REGION_COOKIE_DOMAINS.eu)
        : {};

    return {
        cookies: cookiesGlobal,
        cookies_global: cookiesGlobal,
        cookies_us: cookiesUs,
        cookies_eu: cookiesEu
    };
}

async function resolveTemuCurrentUserAgent(page, fallbackValue = '') {
    const fallback = String(fallbackValue || '').trim();
    if (!page) {
        return fallback;
    }

    try {
        const userAgent = await page.evaluate(() => navigator.userAgent || '');
        return String(userAgent || '').trim() || fallback;
    } catch {
        return fallback;
    }
}

export async function getTemuCurrentSessionContext(page, options = {}) {
    if (!page || typeof page.context !== 'function') {
        return {
            success: false,
            requestedRegion: normalizeTemuRegionKey(options?.region),
            effectiveRegion: 'global',
            message: '缺少可用页面，无法获取当前 Temu 会话'
        };
    }

    try {
        const context = page.context();
        const currentUrl = String(page.url() || '').trim();
        const allCookies = await context.cookies();
        const cookieMaps = collectTemuCookieMaps(allCookies, options);
        const requestedRegion = normalizeTemuRegionKey(options?.region);
        const preferredCookies =
            requestedRegion === 'us'
                ? cookieMaps.cookies_us
                : requestedRegion === 'eu'
                    ? cookieMaps.cookies_eu
                    : cookieMaps.cookies_global;
        const preferredCookieCount = Object.keys(preferredCookies).length;
        const effectiveRegion =
            preferredCookieCount > 0 || requestedRegion === 'global'
                ? requestedRegion
                : 'global';
        const activeCookies =
            effectiveRegion === 'us'
                ? cookieMaps.cookies_us
                : effectiveRegion === 'eu'
                    ? cookieMaps.cookies_eu
                    : cookieMaps.cookies_global;
        const userAgent = await resolveTemuCurrentUserAgent(
            page,
            options?.headersTemplate?.['user-agent']
        );
        const origin = String(
            options?.headersTemplate?.origin || options?.origin || getFallbackOriginFromUrl(currentUrl)
        ).trim();
        const referer = String(
            options?.headersTemplate?.referer || options?.referer || currentUrl || `${origin}/`
        ).trim();
        const mallId = String(
            options?.mallId
            || cookieMaps.cookies_global.mallid
            || cookieMaps.cookies_us.mallid
            || cookieMaps.cookies_eu.mallid
            || options?.headersTemplate?.mallid
            || ''
        ).trim();
        const antiContent = String(
            options?.antiContent || options?.headersTemplate?.['anti-content'] || ''
        ).trim();
        const sessionInfo = {
            userAgent,
            antiContent,
            mallId
        };
        const headersTemplate = {
            ...buildRegionHeaders('global', sessionInfo),
            ...(options?.headersTemplate && typeof options.headersTemplate === 'object'
                ? options.headersTemplate
                : {})
        };
        if (mallId) {
            headersTemplate.mallid = mallId;
        }

        const regionHeaders = {
            global: {
                ...buildRegionHeaders('global', sessionInfo),
                ...(effectiveRegion === 'global' ? headersTemplate : {})
            },
            us: buildRegionHeaders('us', sessionInfo),
            eu: buildRegionHeaders('eu', sessionInfo)
        };
        const activeHeaders =
            effectiveRegion === 'us'
                ? regionHeaders.us
                : effectiveRegion === 'eu'
                    ? regionHeaders.eu
                    : regionHeaders.global;
        const temuCookieEntries = filterCookieEntries(
            allCookies,
            Array.from(new Set([
                ...TEMU_REGION_COOKIE_DOMAINS.global,
                ...TEMU_REGION_COOKIE_DOMAINS.us,
                ...TEMU_REGION_COOKIE_DOMAINS.eu
            ]))
        );
        const warnings = [];
        if (requestedRegion !== effectiveRegion) {
            warnings.push(`${requestedRegion.toUpperCase()} 区域当前未拿到独立 cookies，已回退使用 GLOBAL`);
        }

        return {
            success: true,
            requestedRegion,
            effectiveRegion,
            currentUrl,
            userAgent,
            mallId,
            antiContent,
            headers: activeHeaders,
            headersTemplate,
            regionHeaders,
            cookies: activeCookies,
            cookies_global: cookieMaps.cookies_global,
            cookies_us: cookieMaps.cookies_us,
            cookies_eu: cookieMaps.cookies_eu,
            cookieHeader: buildCookieHeader(activeCookies),
            cookieHeaders: {
                global: buildCookieHeader(cookieMaps.cookies_global),
                us: buildCookieHeader(cookieMaps.cookies_us),
                eu: buildCookieHeader(cookieMaps.cookies_eu)
            },
            cookieCount: Object.keys(activeCookies).length,
            cookieCounts: {
                global: Object.keys(cookieMaps.cookies_global).length,
                us: Object.keys(cookieMaps.cookies_us).length,
                eu: Object.keys(cookieMaps.cookies_eu).length
            },
            cookieDomains: summarizeCookieDomains(temuCookieEntries),
            warnings
        };
    } catch (error) {
        return {
            success: false,
            requestedRegion: normalizeTemuRegionKey(options?.region),
            effectiveRegion: 'global',
            message: error?.message || String(error)
        };
    }
}

function createTemuRequestCapture(context) {
    const state = {
        requestCount: 0,
        antiContent: '',
        mallId: '',
        origin: '',
        referer: '',
        userAgent: '',
        capturedHeaders: {},
        lastRequestUrl: '',
        requestSamples: []
    };

    const onRequest = (request) => {
        try {
            const url = String(request.url() || '');
            const resourceType = String(request.resourceType() || '');
            if (!/temu\.com|kuajingmaihuo\.com/i.test(url)) {
                return;
            }
            if (!['xhr', 'fetch', 'document'].includes(resourceType)) {
                return;
            }

            const headers = request.headers();
            const normalizedHeaders = Object.fromEntries(
                Object.entries(headers || {}).map(([key, value]) => [String(key || '').toLowerCase(), String(value || '').trim()])
            );
            const capturedHeaders = extractTemuCaptureHeaders(normalizedHeaders);

            state.requestCount += 1;
            state.lastRequestUrl = url;
            if (Object.keys(capturedHeaders).length) {
                state.capturedHeaders = {
                    ...state.capturedHeaders,
                    ...capturedHeaders
                };
            }

            if (state.capturedHeaders['anti-content']) {
                state.antiContent = state.capturedHeaders['anti-content'];
            }
            if (state.capturedHeaders.mallid) {
                state.mallId = state.capturedHeaders.mallid;
            }
            if (state.capturedHeaders.origin) {
                state.origin = state.capturedHeaders.origin;
            }
            if (state.capturedHeaders.referer) {
                state.referer = state.capturedHeaders.referer;
            }
            if (state.capturedHeaders['user-agent']) {
                state.userAgent = state.capturedHeaders['user-agent'];
            }

            if (state.requestSamples.length < 8) {
                state.requestSamples.push({
                    url,
                    resourceType,
                    hasAntiContent: !!normalizedHeaders['anti-content'],
                    mallId: normalizedHeaders.mallid || '',
                    origin: normalizedHeaders.origin || '',
                    referer: normalizedHeaders.referer || ''
                });
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

async function waitForCaptureWarmup(captureState, timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (captureState.requestCount > 0 && (captureState.antiContent || captureState.origin || captureState.referer)) {
            return true;
        }
        await sleep(400);
    }
    return captureState.requestCount > 0;
}

async function warmupTemuTrafficCapture(page, captureState) {
    for (const warmupUrl of TEMU_CAPTURE_WARMUP_URLS) {
        try {
            await page.goto(warmupUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 45_000
            });
            await page.waitForTimeout(2_500);
            await waitForCaptureWarmup(captureState, 2_500);

            if (captureState.antiContent || captureState.mallId) {
                return {
                    success: true,
                    url: warmupUrl
                };
            }
        } catch (error) {
            return {
                success: false,
                url: warmupUrl,
                message: error?.message || String(error)
            };
        }
    }

    return {
        success: false,
        url: ''
    };
}

async function postJsonWithTimeout(url, options = {}, timeoutMs = 15_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`request timeout after ${timeoutMs}ms`)), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchTemuUserInfo(headersTemplate = {}, cookies = {}) {
    const cookieHeader = buildCookieHeader(cookies);
    if (!cookieHeader) {
        return {
            success: false,
            message: 'cookies 为空，无法请求 userInfo'
        };
    }

    const baseHeaders = {
        accept: headersTemplate.accept || TEMU_DEFAULT_ACCEPT,
        'content-type': headersTemplate['content-type'] || 'application/json',
        origin: headersTemplate.origin || new URL(TEMU_SELLER_HOME_URL).origin,
        referer: headersTemplate.referer || TEMU_SELLER_HOME_URL,
        cookie: cookieHeader
    };

    if (headersTemplate['user-agent']) {
        baseHeaders['user-agent'] = headersTemplate['user-agent'];
    }

    const attemptHeadersList = [];
    if (headersTemplate['anti-content']) {
        attemptHeadersList.push({
            ...baseHeaders,
            'anti-content': headersTemplate['anti-content']
        });
    }
    attemptHeadersList.push(baseHeaders);

    let lastFailure = null;

    for (const requestHeaders of attemptHeadersList) {
        try {
            const response = await postJsonWithTimeout(TEMU_USERINFO_API_URL, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify({})
            });
            const rawText = await response.text();
            let payload = null;

            try {
                payload = rawText ? JSON.parse(rawText) : null;
            } catch {
                payload = null;
            }

            if (!response.ok) {
                lastFailure = {
                    success: false,
                    status: response.status,
                    message: payload?.errorMsg || rawText || `userInfo 请求失败，状态码 ${response.status}`
                };
                continue;
            }

            const result = payload?.result || {};
            return {
                success: payload?.success === true,
                status: response.status,
                payload,
                accountId: result.accountId || '',
                accountType: result.accountType || '',
                mallList: Array.isArray(result.mallList) ? result.mallList : [],
                message: payload?.success === true ? 'userInfo 获取成功' : payload?.errorMsg || 'userInfo 返回失败'
            };
        } catch (error) {
            lastFailure = {
                success: false,
                message: error?.message || String(error)
            };
        }
    }

    return lastFailure || {
        success: false,
        message: 'userInfo 请求失败'
    };
}

async function findRegionSwitcherContainer(page) {
    const locator = page.locator('div');
    const containerIndex = await locator.evaluateAll((nodes, markers) => {
        const normalizeText = (value = '') => String(value || '').replace(/\s+/g, '');
        const candidates = [];

        for (const [index, node] of nodes.entries()) {
            const text = normalizeText(node.textContent || '');
            if (!markers.every((marker) => text.includes(marker))) {
                continue;
            }

            const style = window.getComputedStyle(node);
            const isVisible = node.getClientRects().length > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden';

            candidates.push({
                index,
                isVisible,
                textLength: text.length,
                childCount: node.children.length,
                descendantCount: node.querySelectorAll('*').length
            });
        }

        if (!candidates.length) {
            return -1;
        }

        candidates.sort((left, right) => {
            const leftVisibilityPenalty = left.isVisible ? 0 : 1;
            const rightVisibilityPenalty = right.isVisible ? 0 : 1;
            const leftPenalty = left.childCount >= 3 ? 0 : 1;
            const rightPenalty = right.childCount >= 3 ? 0 : 1;
            return leftVisibilityPenalty - rightVisibilityPenalty
                || leftPenalty - rightPenalty
                || left.textLength - right.textLength
                || left.descendantCount - right.descendantCount
                || left.index - right.index;
        });

        return candidates[0].index;
    }, TEMU_REGION_SWITCHER_TEXT_MARKERS);

    if (containerIndex < 0) {
        return null;
    }

    return {
        index: containerIndex,
        locator: locator.nth(containerIndex)
    };
}

async function attemptRegionSelectionClick(page, regionKey) {
    const fallbackIndex = TEMU_REGION_CLICK_INDEX[regionKey];
    if (fallbackIndex === undefined) {
        return {
            clicked: false,
            strategy: 'not_configured'
        };
    }

    try {
        const container = await findRegionSwitcherContainer(page);
        if (container?.locator) {
            const childLocator = container.locator.locator(':scope > *');
            const childCount = await childLocator.count();
            if (childCount > fallbackIndex) {
                const target = childLocator.nth(fallbackIndex);
                const childText = normalizeMatcherText(await target.innerText().catch(() => ''));

                await target.scrollIntoViewIfNeeded().catch(() => { });

                try {
                    await target.click({
                        timeout: 5_000
                    });
                } catch {
                    await target.click({
                        timeout: 5_000,
                        force: true
                    });
                }

                return {
                    clicked: true,
                    strategy: 'text_container_child',
                    detail: `div[${container.index}] child[${fallbackIndex}] ${childText}`.trim()
                };
            }

            return {
                clicked: false,
                strategy: 'text_container_child_missing',
                detail: `div[${container.index}] childCount=${childCount}`
            };
        }
    } catch {
        // ignore container-based click errors and continue to fallback
    }

    try {
        const locator = page.locator(TEMU_REGION_CARD_SELECTOR);
        const count = await locator.count();
        if (count > fallbackIndex) {
            await locator.nth(fallbackIndex).click();
            return {
                clicked: true,
                strategy: 'selector_index',
                detail: `${TEMU_REGION_CARD_SELECTOR}[${fallbackIndex}]`
            };
        }
    } catch {
        // ignore selector fallback errors
    }

    return {
        clicked: false,
        strategy: 'not_found'
    };
}

async function collectRegionCookies(context, regionKey) {
    const regionHost = TEMU_REGION_HOSTS[regionKey];
    const regionUrl = TEMU_REGION_URLS[regionKey];
    const regionCookieDomains = TEMU_REGION_COOKIE_DOMAINS[regionKey] || [regionHost];
    let page = null;

    try {
        page = await context.newPage();
        await page.goto(regionUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000
        });
        await page.waitForTimeout(3_000);

        let strategy = 'direct_url';
        let regionCookies = normalizeCookieEntries(await context.cookies(), regionCookieDomains);

        if (!Object.keys(regionCookies).length) {
            const clickResult = await attemptRegionSelectionClick(page, regionKey);
            if (clickResult.clicked) {
                strategy = clickResult.strategy;
                await page.waitForTimeout(3_000);
                regionCookies = normalizeCookieEntries(await context.cookies(), regionCookieDomains);
            }
        }

        if (!Object.keys(regionCookies).length) {
            const currentUrl = String(page.url() || '');
            if (currentUrl.includes(regionHost)) {
                strategy = `${strategy}+cookie_domain_retry`;
                regionCookies = normalizeCookieEntries(await context.cookies(), regionCookieDomains);
            }
        }

        return {
            success: Object.keys(regionCookies).length > 0,
            region: regionKey,
            currentUrl: page.url(),
            strategy,
            cookieCount: Object.keys(regionCookies).length,
            cookies: regionCookies,
            warning: Object.keys(regionCookies).length > 0 ? '' : `${regionKey} 区域未采集到独立 cookies`
        };
    } catch (error) {
        return {
            success: false,
            region: regionKey,
            currentUrl: page?.url?.() || '',
            strategy: 'error',
            cookieCount: 0,
            cookies: {},
            warning: error?.message || String(error)
        };
    } finally {
        if (page) {
            await page.close().catch(() => { });
        }
    }
}

export async function collectTemuSessionBundle(page, options = {}) {
    const context = page.context();
    const warnings = [];
    const trafficCapture = createTemuRequestCapture(context);

    try {
        logger.info(`${PLATFORM_NAME}准备采集会话信息`, {
            collectRegionCookies: options.collectRegionCookies !== false,
            currentUrl: page.url()
        });

        await page.goto(TEMU_SELLER_HOME_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000
        });
        await page.waitForTimeout(4_000);

        const currentUrl = String(page.url() || '');
        if (/login|passport|authentication/i.test(currentUrl)) {
            return {
                success: false,
                reason: 'login_required',
                message: '当前环境未登录 Temu，无法采集会话'
            };
        }

        let captureReady = await waitForCaptureWarmup(trafficCapture.state, 8_000);
        if (!captureReady || !trafficCapture.state.antiContent) {
            const warmupResult = await warmupTemuTrafficCapture(page, trafficCapture.state);
            if (warmupResult.success) {
                captureReady = true;
            } else if (warmupResult.message) {
                warnings.push(`预热 Temu 请求失败: ${warmupResult.message}`);
            }
        }
        if (!captureReady) {
            warnings.push('未捕获到明显的 Temu XHR/fetch 请求，anti-content 可能为空');
        }
        if (!trafficCapture.state.antiContent) {
            warnings.push('未捕获到 anti-content，请在后续接入时允许重新刷新页面补抓');
        }

        const allCookies = await context.cookies();
        const cookiesGlobal = normalizeCookieEntries(
            allCookies,
            TEMU_REGION_COOKIE_DOMAINS.global
        );
        if (!Object.keys(cookiesGlobal).length) {
            return {
                success: false,
                reason: 'cookies_not_found',
                message: '未采集到 Temu 会话 cookies'
            };
        }

        const capturedHeaders = extractTemuCaptureHeaders(trafficCapture.state.capturedHeaders);
        const userAgent = trafficCapture.state.userAgent
            || capturedHeaders['user-agent']
            || await page.evaluate(() => navigator.userAgent).catch(() => '');
        const origin = trafficCapture.state.origin || capturedHeaders.origin || getFallbackOriginFromUrl(page.url());
        const referer = trafficCapture.state.referer || capturedHeaders.referer || `${origin}/`;
        const initialMallId = String(trafficCapture.state.mallId || '').trim();

        const headersTemplate = {
            ...capturedHeaders,
            accept: capturedHeaders.accept || TEMU_DEFAULT_ACCEPT,
            'content-type': capturedHeaders['content-type'] || 'application/json',
            origin,
            referer,
            'user-agent': userAgent
        };
        if (trafficCapture.state.antiContent) {
            headersTemplate['anti-content'] = trafficCapture.state.antiContent;
        }
        if (initialMallId) {
            headersTemplate.mallid = initialMallId;
        }

        const userInfoResult = await fetchTemuUserInfo(headersTemplate, cookiesGlobal);
        if (!userInfoResult.success) {
            warnings.push(`mallList 获取失败: ${userInfoResult.message || 'unknown error'}`);
        }

        const mallList = Array.isArray(userInfoResult.mallList) ? userInfoResult.mallList : [];
        const selectedMall = pickSelectedMall(mallList, initialMallId);
        const mallId = String(selectedMall?.mallId || initialMallId || '').trim();
        const mallName = String(selectedMall?.mallName || '').trim();

        if (mallId) {
            headersTemplate.mallid = mallId;
        }

        const regionCollection = {
            enabled: options.collectRegionCookies !== false,
            us: {
                success: false,
                cookieCount: 0,
                cookies: {}
            },
            eu: {
                success: false,
                cookieCount: 0,
                cookies: {}
            }
        };

        if (options.collectRegionCookies !== false) {
            const usRegion = await collectRegionCookies(context, 'us');
            const euRegion = await collectRegionCookies(context, 'eu');
            regionCollection.us = usRegion;
            regionCollection.eu = euRegion;

            if (usRegion.warning) {
                warnings.push(`US 区域: ${usRegion.warning}`);
            }
            if (euRegion.warning) {
                warnings.push(`EU 区域: ${euRegion.warning}`);
            }
        }

        const temuCookieEntries = filterCookieEntries(
            allCookies,
            Array.from(new Set([
                ...TEMU_REGION_COOKIE_DOMAINS.global,
                ...TEMU_REGION_COOKIE_DOMAINS.us,
                ...TEMU_REGION_COOKIE_DOMAINS.eu
            ]))
        );

        return {
            success: true,
            sessionBundle: {
                collectedAt: new Date().toISOString(),
                currentUrl: page.url(),
                mallId,
                mallName,
                mallList,
                accountId: userInfoResult.accountId || '',
                accountType: userInfoResult.accountType || '',
                antiContent: trafficCapture.state.antiContent || '',
                userAgent,
                headersTemplate,
                regionHeaders: {
                    global: {
                        ...headersTemplate
                    },
                    us: buildRegionHeaders('us', {
                        userAgent,
                        antiContent: trafficCapture.state.antiContent,
                        mallId
                    }),
                    eu: buildRegionHeaders('eu', {
                        userAgent,
                        antiContent: trafficCapture.state.antiContent,
                        mallId
                    })
                },
                cookies: cookiesGlobal,
                cookies_global: cookiesGlobal,
                cookies_us: regionCollection.us.cookies || {},
                cookies_eu: regionCollection.eu.cookies || {},
                cookieDomains: summarizeCookieDomains(temuCookieEntries),
                requestCapture: {
                    requestCount: trafficCapture.state.requestCount,
                    lastRequestUrl: trafficCapture.state.lastRequestUrl,
                    mallIdFromTraffic: initialMallId,
                    capturedHeaders,
                    requestSamples: trafficCapture.state.requestSamples
                },
                regionCollection: {
                    enabled: regionCollection.enabled,
                    us: {
                        success: !!regionCollection.us.success,
                        currentUrl: regionCollection.us.currentUrl || '',
                        strategy: regionCollection.us.strategy || '',
                        cookieCount: regionCollection.us.cookieCount || 0
                    },
                    eu: {
                        success: !!regionCollection.eu.success,
                        currentUrl: regionCollection.eu.currentUrl || '',
                        strategy: regionCollection.eu.strategy || '',
                        cookieCount: regionCollection.eu.cookieCount || 0
                    }
                },
                warnings
            }
        };
    } catch (error) {
        logger.error(`${PLATFORM_NAME}采集会话信息失败:`, error);
        return {
            success: false,
            reason: 'session_collect_failed',
            message: error?.message || String(error)
        };
    } finally {
        trafficCapture.dispose();
    }
}

export default {
    collectTemuSessionBundle,
    getTemuCurrentSessionContext
};

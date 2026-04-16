import { logger } from './logger.js';

const DEFAULT_BACKGROUND_PAGE_TIMEOUT_MS = 5000;
const patchedContexts = new WeakSet();
const originalNewPageMethods = new WeakMap();

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTimeout(value) {
    const timeout = Number(value);
    if (!Number.isFinite(timeout) || timeout <= 0) {
        return DEFAULT_BACKGROUND_PAGE_TIMEOUT_MS;
    }
    return timeout;
}

function mergePageOptions(defaultOptions = {}, pageOptions = {}) {
    return {
        ...(isPlainObject(defaultOptions) ? defaultOptions : {}),
        ...(isPlainObject(pageOptions) ? pageOptions : {})
    };
}

export function withDefaultActivatedPageOptions(pageOptions = {}) {
    const finalOptions = mergePageOptions({}, pageOptions);
    const hasActivate = Object.prototype.hasOwnProperty.call(finalOptions, 'activate');
    const hasForeground = Object.prototype.hasOwnProperty.call(finalOptions, 'foreground');
    const hasBackground = Object.prototype.hasOwnProperty.call(finalOptions, 'background');

    if (hasActivate || hasForeground) {
        return finalOptions;
    }

    if (hasBackground) {
        if (finalOptions.background === false) {
            return {
                ...finalOptions,
                activate: true
            };
        }
        return finalOptions;
    }

    return {
        ...finalOptions,
        activate: true
    };
}

function getOriginalNewPage(context) {
    const cached = originalNewPageMethods.get(context);
    if (cached) {
        return cached;
    }

    if (!context || typeof context.newPage !== 'function') {
        throw new Error('浏览器上下文不支持 newPage');
    }

    const original = context.newPage.bind(context);
    originalNewPageMethods.set(context, original);
    return original;
}

function shouldCreateBackgroundPage(options = {}) {
    if (options.headless === true) {
        return false;
    }

    return options.background !== false;
}

function shouldActivatePage(options = {}) {
    return options.activate === true || options.foreground === true;
}

async function getPageWindowState(context, page) {
    if (!context || !page || typeof context.newCDPSession !== 'function') {
        return null;
    }

    let cdpSession = null;
    try {
        cdpSession = await context.newCDPSession(page);
        const windowInfo = await cdpSession.send('Browser.getWindowForTarget').catch(() => null);
        const windowState = String(windowInfo?.bounds?.windowState || '').trim().toLowerCase();
        return windowState || null;
    } catch (error) {
        logger.debug(`读取浏览器窗口状态失败，将继续尝试激活页签: ${error?.message || error}`);
        return null;
    } finally {
        await cdpSession?.detach?.().catch(() => { });
    }
}

async function activatePageIfNeeded(context, page, options = {}) {
    if (!page || options.headless === true || !shouldActivatePage(options)) {
        return page;
    }

    const windowState = await getPageWindowState(context, page);
    if (windowState === 'minimized' || windowState === 'hidden') {
        logger.debug(`浏览器窗口当前为 ${windowState}，保留任务页在后台，避免打断当前操作`);
        return page;
    }

    await page.bringToFront().catch((error) => {
        logger.debug(`激活任务页失败，继续沿用当前页签状态: ${error?.message || error}`);
    });
    return page;
}

function shouldActivateForegroundPage(options = {}) {
    if (options.headless === true) {
        return false;
    }

    return options.activate === true || options.foreground === true;
}

async function getPageWindowSession(page) {
    const context = typeof page?.context === 'function' ? page.context() : null;
    if (!context || typeof context.newCDPSession !== 'function') {
        return null;
    }

    try {
        const cdp = await context.newCDPSession(page);
        const response = await cdp.send('Browser.getWindowForTarget').catch(() => null);
        return {
            cdp,
            windowId: response?.windowId ?? null,
            windowState: String(response?.bounds?.windowState || '').trim() || null
        };
    } catch (error) {
        logger.debug(`读取页面窗口状态失败，将仅尝试激活标签页: ${error?.message || error}`);
        return null;
    }
}

async function activatePageTab(page, options = {}) {
    if (!page || typeof page.bringToFront !== 'function') {
        return page;
    }

    const windowSession = await getPageWindowSession(page);
    const shouldRestoreWindow = options.restoreWindow === true;
    const shouldFocusWindow = options.focusWindow === true;

    try {
        if (
            shouldRestoreWindow
            && windowSession?.cdp
            && windowSession?.windowId
            && (windowSession.windowState === 'minimized' || windowSession.windowState === 'hidden')
        ) {
            await windowSession.cdp.send('Browser.setWindowBounds', {
                windowId: windowSession.windowId,
                bounds: { windowState: 'normal' }
            }).catch(() => null);
        }

        await page.bringToFront().catch((error) => {
            logger.debug(`激活任务标签页失败: ${error?.message || error}`);
        });

        if (
            shouldFocusWindow
            && windowSession?.windowState !== 'minimized'
            && windowSession?.windowState !== 'hidden'
        ) {
            await page.evaluate(() => {
                try {
                    window.focus();
                } catch {
                    // ignore
                }
            }).catch(() => { });
        }
    } finally {
        await windowSession?.cdp?.detach?.().catch(() => { });
    }

    return page;
}

async function tryCreateBackgroundPage(context, options = {}) {
    if (!shouldCreateBackgroundPage(options)) {
        return null;
    }

    const browser = typeof context?.browser === 'function' ? context.browser() : null;
    if (!browser || typeof browser.newBrowserCDPSession !== 'function') {
        return null;
    }

    const browserContexts = typeof browser.contexts === 'function' ? browser.contexts() : [];
    if (Array.isArray(browserContexts) && browserContexts.length > 1 && browserContexts[0] !== context) {
        return null;
    }

    const timeout = normalizeTimeout(options.timeoutMs);
    const pagePromise = typeof context.waitForEvent === 'function'
        ? context.waitForEvent('page', { timeout }).catch(() => null)
        : null;

    if (!pagePromise) {
        return null;
    }

    let cdpSession = null;
    try {
        cdpSession = await browser.newBrowserCDPSession();
    } catch (error) {
        logger.debug(`创建浏览器级 CDP 会话失败，将回退为普通建页: ${error?.message || error}`);
        return null;
    }

    try {
        const { targetId } = await cdpSession.send('Target.createTarget', {
            url: 'about:blank',
            newWindow: false,
            background: true
        });
        const page = await pagePromise;
        if (page) {
            return page;
        }

        await cdpSession.send('Target.closeTarget', { targetId }).catch(() => { });
        return null;
    } catch (error) {
        logger.debug(`后台创建页面失败，将回退为普通建页: ${error?.message || error}`);
        return null;
    } finally {
        await cdpSession?.detach?.().catch(() => { });
    }
}

export async function createContextPage(context, options = {}) {
    const finalOptions = mergePageOptions({}, options);
    const backgroundPage = await tryCreateBackgroundPage(context, finalOptions);
    const page = backgroundPage || await getOriginalNewPage(context)();
    if (shouldActivateForegroundPage(finalOptions)) {
        await activatePageTab(page, {
            restoreWindow: finalOptions.restoreWindow === true,
            focusWindow: finalOptions.focusWindow === true
        });
    }
    return page;
}

export function patchContextNewPage(context, defaultOptions = {}) {
    if (!context || typeof context.newPage !== 'function') {
        return context;
    }

    if (patchedContexts.has(context)) {
        return context;
    }

    getOriginalNewPage(context);
    context.newPage = async (pageOptions = {}) => {
        const finalOptions = mergePageOptions(defaultOptions, pageOptions);
        return await createContextPage(context, finalOptions);
    };
    patchedContexts.add(context);
    return context;
}

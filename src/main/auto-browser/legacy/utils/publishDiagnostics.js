/**
 * 发布页诊断工具
 *
 * 目的：把「未登录」和「页面结构变化」区分开，避免把登录失效报成
 * "未找到文件选择器"这类误导信息，让运营一眼看出该做什么。
 */

import { logger } from './logger.js';

/** URL 中出现这些片段，基本可以判定被重定向到登录/鉴权页 */
const LOGIN_URL_HINTS = [
    'passport',
    '/login',
    'signin',
    '/sso',
    'auth/login',
    'accounts.'
];

/** 页面上出现这些文案，说明当前是游客态 */
const LOGIN_TEXT_HINTS = ['立即登录', '登录注册', '扫码登录', '密码登录', '登录后'];

export function isLoginUrl(url) {
    const normalized = String(url || '').toLowerCase();
    return LOGIN_URL_HINTS.some((hint) => normalized.includes(hint));
}

/**
 * 收集当前页面的诊断信号。任何一步失败都不抛错，尽量返回可用信息。
 */
export async function collectPageDiagnostics(page, options = {}) {
    const fileInputSelector = options.fileInputSelector || 'input[type="file"]';

    let snapshot = {
        url: '',
        title: '',
        hasFileInput: false,
        hasLoginEntry: false,
        loginTextFound: '',
        hasAvatar: false,
        bodyTextSample: ''
    };

    try {
        snapshot = await page.evaluate(
            ({ fileInputSelector, loginTextHints }) => {
                const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();

                const loginTextFound =
                    loginTextHints.find((hint) => text.includes(hint)) || '';

                const hasLoginEntry =
                    !!document.querySelector(
                        'a[href*="login"], .login-btn, .login-text, .login-button, [class*="LoginBtn"], [class*="loginBtn"]'
                    ) ||
                    Array.from(document.querySelectorAll('button, a')).some((el) => {
                        const label = (el.textContent || '').trim();
                        return label === '登录' || label === '立即登录';
                    });

                const hasAvatar = !!document.querySelector(
                    '[class*="avatar"], [class*="Avatar"], img[src*="avatar"]'
                );

                return {
                    url: location.href,
                    title: document.title,
                    hasFileInput: !!document.querySelector(fileInputSelector),
                    hasLoginEntry,
                    loginTextFound,
                    hasAvatar,
                    bodyTextSample: text.slice(0, 200)
                };
            },
            { fileInputSelector, loginTextHints: LOGIN_TEXT_HINTS }
        );
    } catch (error) {
        logger.warn('[diagnostics] 页面诊断采样失败:', error?.message || error);
    }

    snapshot.loginUrl = isLoginUrl(snapshot.url);
    return snapshot;
}

/**
 * 判定当前页面是否处于「游客态」。
 * 只有拿到较强证据才返回 true，避免把正常页面误判成未登录。
 */
export function isVisitorState(snapshot) {
    if (!snapshot) return false;
    if (snapshot.loginUrl) return true;
    if (snapshot.hasFileInput) return false; // 有上传入口，通常说明已登录
    if (snapshot.hasAvatar) return false; // 有头像，保守认为已登录
    return snapshot.hasLoginEntry || !!snapshot.loginTextFound;
}

function formatSnapshot(snapshot) {
    if (!snapshot) return '';
    const parts = [];
    if (snapshot.url) parts.push(`页面 ${snapshot.url}`);
    if (snapshot.title) parts.push(`标题「${snapshot.title}」`);
    if (snapshot.loginTextFound) parts.push(`识别到登录提示「${snapshot.loginTextFound}」`);
    return parts.length ? `（${parts.join('，')}）` : '';
}

/**
 * 导航到发布页后调用：只在有明确证据时抛「未登录」，否则放行。
 */
export async function assertLoggedIn(page, platformLabel, options = {}) {
    const snapshot = await collectPageDiagnostics(page, options);

    logger.info(`[${platformLabel}] 登录态诊断:`, {
        url: snapshot.url,
        hasFileInput: snapshot.hasFileInput,
        hasLoginEntry: snapshot.hasLoginEntry,
        loginTextFound: snapshot.loginTextFound,
        hasAvatar: snapshot.hasAvatar
    });

    if (isVisitorState(snapshot)) {
        throw new Error(
            `${platformLabel}未登录：当前浏览器未登录${platformLabel}${formatSnapshot(snapshot)}。` +
                `请在客户端对应 profile 中登录${platformLabel}后重试`
        );
    }

    return snapshot;
}

/**
 * 找不到上传入口时调用：区分「未登录」与「页面结构变化」，给出可执行的信息。
 */
export async function throwUploadEntryMissing(
    page,
    platformLabel,
    entryLabel,
    options = {}
) {
    const snapshot = await collectPageDiagnostics(page, options);

    logger.error(`[${platformLabel}] 未找到${entryLabel}，页面诊断:`, snapshot);

    if (isVisitorState(snapshot)) {
        throw new Error(
            `${platformLabel}未登录：当前浏览器未登录${platformLabel}${formatSnapshot(snapshot)}。` +
                `请在客户端对应 profile 中登录${platformLabel}后重试`
        );
    }

    throw new Error(
        `${platformLabel}页面结构可能已变化：未找到${entryLabel}${formatSnapshot(snapshot)}。` +
            `账号登录状态正常，请更新该平台的上传入口选择器`
    );
}

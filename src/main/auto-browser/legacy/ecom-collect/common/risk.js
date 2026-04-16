import { sanitizeText } from './runtime.js';

export function detectRiskKind(text) {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) {
        return null;
    }

    if (
        normalized.includes('chrome-error://chromewebdata') ||
        normalized.includes('err_connection_closed') ||
        normalized.includes('err_timed_out') ||
        normalized.includes('err_tunnel_connection_failed') ||
        normalized.includes("this site can't be reached") ||
        normalized.includes('this site can’t be reached') ||
        normalized.includes('无法访问此网站')
    ) {
        return 'network_error';
    }

    if (
        normalized.includes('404 not found') ||
        normalized.includes('page not found') ||
        normalized.includes('页面不存在') ||
        normalized.includes('sorry, the page you visited does not exist')
    ) {
        return 'not_found';
    }

    const loginUrlIndicators = [
        '/login',
        '/signin',
        'passport.',
        'account/login',
        'ap/signin',
    ];
    const strongLoginIndicators = [
        '请先登录',
        '登录/注册',
        '登录 / 注册',
        '密码登录',
        '短信登录',
        '扫码登录',
        'qr code login',
        'sign in to continue',
        '电子邮件或电话号码',
        '账号名/手机/邮箱',
        'account name/email/phone number',
    ];

    if (
        loginUrlIndicators.some((item) => normalized.includes(item)) ||
        strongLoginIndicators.some((item) => normalized.includes(item))
    ) {
        return 'login_required';
    }

    if (
        normalized.includes('robot or human') ||
        normalized.includes('verify you are human') ||
        normalized.includes('security check') ||
        normalized.includes('captcha') ||
        normalized.includes('risk/challenge') ||
        normalized.includes('图形验证码') ||
        normalized.includes('安全验证') ||
        normalized.includes('请完成验证') ||
        normalized.includes('拼图') ||
        normalized.includes('滑块')
    ) {
        return 'captcha';
    }

    if (
        normalized.includes('unusual traffic') ||
        normalized.includes('error 429') ||
        normalized.includes('too many requests') ||
        normalized.includes('访问受限') ||
        normalized.includes('forbidden') ||
        normalized.includes('access denied') ||
        normalized.includes('检测到当前环境存在安全风险') ||
        normalized.includes('请进入抖音查看商品详情') ||
        normalized.includes('进入抖音查看商品详情') ||
        normalized.includes('打开抖音app') ||
        normalized.includes('请打开抖音app') ||
        normalized.includes('打开 app 查看') ||
        normalized.includes('open in app')
    ) {
        return 'risk_control';
    }

    return null;
}

export async function inspectRisk(page) {
    try {
        const detail = await page.evaluate(() => {
            const title = document.title || '';
            const bodyText = (document.body?.innerText || '').slice(0, 3000);
            return {
                title,
                bodyText,
                url: location.href,
            };
        });

        const riskKind = detectRiskKind(`${detail.title}\n${detail.bodyText}\n${detail.url}`);
        return riskKind
            ? {
                blocked: true,
                riskKind,
                title: sanitizeText(detail.title),
                bodyText: sanitizeText(detail.bodyText).slice(0, 1000),
                url: detail.url,
            }
            : {
                blocked: false,
                riskKind: null,
                title: sanitizeText(detail.title),
                bodyText: sanitizeText(detail.bodyText).slice(0, 1000),
                url: detail.url,
            };
    } catch (error) {
        return {
            blocked: false,
            riskKind: null,
            title: '',
            bodyText: '',
            url: page.url(),
            error: error?.message || String(error),
        };
    }
}

/**
 * 登录状态检查器 - 提供通用的登录状态检查框架
 */

import { logger } from '../utils/logger.js';

/**
 * 登录状态检查器类
 */
export class LoginChecker {
    constructor(platformName, config) {
        this.platformName = platformName;
        this.config = config;
    }

    /**
     * 检查登录状态
     */
    async checkLoginStatus(page) {
        try {
            // 等待页面完全加载
            await this.waitForPageLoad(page);

            // 获取当前URL，检查是否被重定向到登录页面
            const currentUrl = page.url();
            logger.info(`${this.platformName}当前URL:`, currentUrl);

            // 检查是否在登录页面
            const isOnLoginPage = this.isOnLoginPage(currentUrl);

            if (isOnLoginPage) {
                logger.info('检测到在登录页面，未登录');
                return {
                    isLoggedIn: false,
                    details: {
                        reason: 'redirected_to_login_page',
                        currentUrl: currentUrl
                    }
                };
            }

            // 执行页面内的登录状态检测
            const loginStatus = await this.checkPageElements(page);

            logger.info(`${this.platformName}登录状态检测结果:`, loginStatus);
            return loginStatus;

        } catch (error) {
            logger.error(`${this.platformName}登录状态检测失败:`, error);
            return {
                isLoggedIn: false,
                details: {
                    error: error instanceof Error ? error.message : '检测失败',
                    reason: 'detection_error'
                }
            };
        }
    }

    /**
     * 等待页面加载
     */
    async waitForPageLoad(page) {
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));
    }

    /**
     * 检查是否在登录页面
     */
    isOnLoginPage(currentUrl) {
        const loginKeywords = ['login', 'auth', 'signin', 'passport', 'signup'];
        return loginKeywords.some(keyword => currentUrl.includes(keyword));
    }

    /**
     * 检查页面元素
     */
    async checkPageElements(page) {
        return await page.evaluate((config) => {
            const { userElements, loginElements } = config.selectors;

            // 查找用户元素
            const foundUserElements = [];
            let hasUserElement = false;

            userElements.forEach(selector => {
                try {
                    const element = document.querySelector(selector);
                    if (element) {
                        foundUserElements.push(selector);
                        hasUserElement = true;
                    }
                } catch (e) {
                    // 忽略无效选择器
                }
            });

            // 查找登录元素
            const foundLoginElements = [];
            let hasLoginElement = false;

            loginElements.forEach(selector => {
                try {
                    const element = document.querySelector(selector);
                    if (element) {
                        foundLoginElements.push(selector);
                        hasLoginElement = true;
                    }
                } catch (e) {
                    // 忽略无效选择器
                }
            });

            // 判断登录状态：有用户元素且没有登录元素
            const isLoggedIn = hasUserElement && !hasLoginElement;

            const details = {
                userElementsFound: foundUserElements,
                loginElementsFound: foundLoginElements,
                pageTitle: document.title,
                currentUrl: window.location.href,
                hasUserElement,
                hasLoginElement
            };

            return {
                isLoggedIn,
                details
            };
        }, this.config);
    }

    /**
     * 获取登录状态描述
     */
    getLoginStatusDescription(result) {
        if (!result.isLoggedIn) {
            const reason = result.details?.reason || 'unknown';
            switch (reason) {
                case 'redirected_to_login_page':
                    return `${this.platformName}: 被重定向到登录页面`;
                case 'detection_error':
                    return `${this.platformName}: 检测过程出错`;
                default:
                    if (result.details?.hasLoginElement) {
                        return `${this.platformName}: 未登录 (检测到登录按钮)`;
                    } else {
                        return `${this.platformName}: 未登录 (未检测到用户元素)`;
                    }
            }
        }

        if (result.details?.hasUserElement) {
            return `${this.platformName}: 已登录 (检测到用户元素)`;
        } else {
            return `${this.platformName}: 已登录`;
        }
    }
}

/**
 * 平台特定的登录检查器
 */
export class DouyinLoginChecker extends LoginChecker {
    constructor() {
        super('抖音', {
            selectors: {
                userElements: [
                    '#header-avatar',
                    '.user-avatar',
                    '.user-info',
                    '.header-user',
                    '[data-testid="user-avatar"]',
                    '.creator-header'
                ],
                loginElements: [
                    '.login-btn',
                    '.login-button',
                    '.login-entry',
                    'button[data-testid="login-button"]',
                    '.login-mask',
                    '.login-container',
                    'text=手机号登录',
                    'text=扫码登录',
                    'text=密码登录',
                    '.login-text',
                    '.auth-btn',
                    '[class*="login"]'
                ]
            }
        });
    }

    getLoginStatusDescription(result) {
        if (!result.isLoggedIn) {
            if (result.details?.reason === 'redirected_to_login_page') {
                return '抖音: 被重定向到登录页面';
            } else if (result.details?.reason === 'detection_error') {
                return '抖音: 检测过程出错';
            } else {
                if (result.details?.hasLoginElement) {
                    return '抖音: 未登录 (检测到登录按钮)';
                } else {
                    return '抖音: 未登录 (未检测到用户元素)';
                }
            }
        } else {
            if (result.details?.hasHeaderAvatar) {
                return '抖音: 已登录 (检测到头像元素)';
            } else {
                return '抖音: 已登录 (检测到用户元素)';
            }
        }
    }
}

export class XiaohongshuLoginChecker extends LoginChecker {
    constructor() {
        super('小红书', {
            selectors: {
                userElements: [
                    '.user_avatar',
                    '[class="user_avatar"]',
                    '.reds-avatar-border',
                    '.user-avatar',
                    '.creator-header',
                    '.header-avatar',
                    '.user-info',
                    '.user-profile',
                    '[data-testid="user-avatar"]',
                    '.avatar-container',
                    '.user-container',
                    '.user-menu',
                    '.profile-avatar'
                ],
                loginElements: [
                    '.login',
                    'button[data-testid="login-button"]',
                    '.login-btn',
                    '.login-text',
                    '.login-button',
                    '.login-entry',
                    '.auth-btn',
                    '.sign-in-btn',
                    '[class*="login"]',
                    '.login-prompt',
                    '.login-link',
                    '.sign-up-btn',
                    '.register-btn'
                ]
            }
        });
    }

    getLoginStatusDescription(result) {
        if (!result.isLoggedIn) {
            if (result.details?.reason === 'redirected_to_login_page') {
                return '小红书: 被重定向到登录页面';
            } else if (result.details?.reason === 'detection_error') {
                return '小红书: 检测过程出错';
            } else {
                if (result.details?.hasLoginElement) {
                    return '小红书: 未登录 (检测到登录按钮)';
                } else {
                    return '小红书: 未登录 (未检测到用户元素)';
                }
            }
        } else {
            if (result.details?.hasUserAvatar) {
                return '小红书: 已登录 (检测到user_avatar元素)';
            } else {
                return '小红书: 已登录 (检测到用户元素)';
            }
        }
    }
}

export class GenericLoginChecker extends LoginChecker {
    constructor(platformName, config) {
        super(platformName, config);
    }
}

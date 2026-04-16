import {
    getOrCreateBrowser,
    isBrowserAvailable,
    updateBrowserActivity
} from './BrowserService.js';
import {
    DouyinLoginChecker,
    XiaohongshuLoginChecker,
    GenericLoginChecker
} from './LoginChecker.js';
import {
    PLATFORM_CONFIGS
} from '../config/platforms.js';
import {
    logger
} from '../utils/logger.js';

function getPlatformLoginConfigs() {
    return [
        {
            name: 'xiaohongshu',
            checker: new XiaohongshuLoginChecker(),
            config: PLATFORM_CONFIGS.xiaohongshu
        },
        {
            name: 'douyin',
            checker: new DouyinLoginChecker(),
            config: PLATFORM_CONFIGS.douyin
        },
        {
            name: 'kuaishou',
            checker: new GenericLoginChecker('快手', { selectors: PLATFORM_CONFIGS.kuaishou.loginSelectors }),
            config: PLATFORM_CONFIGS.kuaishou
        },
        {
            name: 'doudian',
            checker: new GenericLoginChecker('抖店', { selectors: PLATFORM_CONFIGS.doudian.loginSelectors }),
            config: PLATFORM_CONFIGS.doudian
        },
        {
            name: 'kuaishou_shop',
            checker: new GenericLoginChecker('快手小店', { selectors: PLATFORM_CONFIGS.kuaishou_shop.loginSelectors }),
            config: PLATFORM_CONFIGS.kuaishou_shop
        },
        {
            name: 'temu',
            checker: new GenericLoginChecker('Temu', { selectors: PLATFORM_CONFIGS.temu.loginSelectors }),
            config: PLATFORM_CONFIGS.temu
        },
        {
            name: 'weibo',
            checker: new GenericLoginChecker('微博', { selectors: PLATFORM_CONFIGS.weibo.loginSelectors }),
            config: PLATFORM_CONFIGS.weibo
        },
        {
            name: 'youtube',
            checker: new GenericLoginChecker('YouTube', { selectors: PLATFORM_CONFIGS.youtube.loginSelectors }),
            config: PLATFORM_CONFIGS.youtube
        },
        {
            name: 'xianyu',
            checker: new GenericLoginChecker('咸鱼', { selectors: PLATFORM_CONFIGS.xianyu.loginSelectors }),
            config: PLATFORM_CONFIGS.xianyu
        },
        {
            name: 'tiktok',
            checker: new GenericLoginChecker('TikTok', { selectors: PLATFORM_CONFIGS.tiktok.loginSelectors }),
            config: PLATFORM_CONFIGS.tiktok
        }
    ];
}

function buildEmptyLoginStatus(platformConfigs = []) {
    const loginStatus = {};
    for (const platformConfig of platformConfigs) {
        loginStatus[platformConfig.name] = {
            isLoggedIn: false,
            status: 'unknown',
            message: '',
            timestamp: Date.now()
        };
    }
    return loginStatus;
}

export class PlatformLoginService {
    static loginStatusCache = null;
    static cacheTimestamp = 0;
    static cacheProfileKey = null;
    static CACHE_CONFIG = {
        enabled: true,
        duration: 5 * 60 * 1000
    };

    static isCacheValid(profileKey = 'default') {
        if (!this.CACHE_CONFIG.enabled) {
            logger.debug('[缓存] 未启用');
            return false;
        }
        if (!this.loginStatusCache) {
            logger.debug('[缓存] 无缓存数据');
            return false;
        }
        if (this.cacheProfileKey !== profileKey) {
            logger.debug('[缓存] 环境已切换，忽略旧缓存');
            return false;
        }
        const now = Date.now();
        const cacheAge = now - this.cacheTimestamp;
        logger.debug(`[缓存] 存在，age: ${cacheAge} ms, duration: ${this.CACHE_CONFIG.duration} ms`);
        return cacheAge < this.CACHE_CONFIG.duration;
    }

    static clearLoginStatusCache() {
        this.loginStatusCache = null;
        this.cacheTimestamp = 0;
        this.cacheProfileKey = null;
        logger.info('登录状态缓存已清除');
    }

    static setCacheConfig(config) {
        Object.assign(this.CACHE_CONFIG, config);
        logger.info('缓存配置已更新:', this.CACHE_CONFIG);
    }

    static getCacheInfo() {
        const now = Date.now();
        const cacheAge = this.loginStatusCache ? now - this.cacheTimestamp : 0;

        return {
            hasCache: !!this.loginStatusCache,
            cacheAge,
            cacheProfileKey: this.cacheProfileKey,
            isValid: this.isCacheValid(this.cacheProfileKey || 'default'),
            config: {
                ...this.CACHE_CONFIG
            }
        };
    }

    static async checkSocialMediaLoginStatus(forceRefresh = false, options = {}) {
        const profileKey = String(options?.profileId || 'default').trim() || 'default';
        logger.info('[登录状态] checkSocialMediaLoginStatus called, forceRefresh:', forceRefresh, 'profileKey:', profileKey);

        const platformConfigs = getPlatformLoginConfigs();
        let loginStatus = buildEmptyLoginStatus(platformConfigs);

        try {
            if (!forceRefresh && this.isCacheValid(profileKey)) {
                logger.info('[登录状态] 使用缓存的登录状态数据', this.loginStatusCache, '缓存时间戳:', this.cacheTimestamp);
                return this.loginStatusCache;
            }

            logger.info('[登录状态] 开始检查登录状态，缓存已失效或强制刷新');

            let browser;
            try {
                const isAvailable = await isBrowserAvailable();
                if (isAvailable) {
                    logger.info('检测到现有浏览器实例，将复用');
                } else {
                    logger.info('未检测到现有浏览器实例，将创建新的');
                }

                browser = await getOrCreateBrowser({ profileId: options?.profileId });
                updateBrowserActivity();
            } catch (browserError) {
                logger.error('获取浏览器实例失败:', browserError);
                for (const platformConfig of platformConfigs) {
                    loginStatus[platformConfig.name] = {
                        isLoggedIn: false,
                        status: 'error',
                        message: browserError instanceof Error ? browserError.message : '浏览器初始化失败',
                        timestamp: Date.now()
                    };
                }
                this.loginStatusCache = loginStatus;
                this.cacheTimestamp = Date.now();
                this.cacheProfileKey = profileKey;
                logger.info('[缓存] 浏览器获取失败已更新', this.loginStatusCache, '时间戳:', this.cacheTimestamp);
                return loginStatus;
            }

            logger.info(`开始检查 ${platformConfigs.length} 个平台的登录状态...`);

            const checkPromises = platformConfigs.map(async (platformConfig) => {
                let page = null;
                try {
                    logger.info(`正在处理平台: ${platformConfig.name}`);

                    page = await browser.newPage();
                    page.setDefaultTimeout(30000);
                    page.setDefaultNavigationTimeout(30000);

                    logger.info(`正在访问 ${platformConfig.name} 的URL: ${platformConfig.config.uploadUrl}`);
                    await page.goto(platformConfig.config.uploadUrl, {
                        waitUntil: platformConfig.config.waitUntil || 'domcontentloaded',
                        timeout: platformConfig.config.timeout || 30000
                    });
                    logger.info(`${platformConfig.name} 页面加载成功`);

                    await new Promise((resolve) => setTimeout(resolve, 2000));

                    const pageTitle = await page.title().catch(() => '');
                    const currentUrl = page.url();
                    logger.info(`${platformConfig.name} 页面标题:`, pageTitle);
                    logger.info(`${platformConfig.name} 当前URL:`, currentUrl);

                    logger.info(`开始检查 ${platformConfig.name} 的登录状态...`);
                    const loginResult = await platformConfig.checker.checkLoginStatus(page);
                    logger.info(`${platformConfig.name} 登录状态检查结果:`, loginResult);

                    loginStatus[platformConfig.name] = {
                        isLoggedIn: loginResult.isLoggedIn,
                        status: 'success',
                        message: platformConfig.checker.getLoginStatusDescription(loginResult),
                        timestamp: Date.now(),
                        details: loginResult.details
                    };
                    logger.info(`${platformConfig.name} 检查完成`);
                } catch (error) {
                    logger.error(`${platformConfig.name} 检查失败:`, error);
                    loginStatus[platformConfig.name] = {
                        isLoggedIn: false,
                        status: 'error',
                        message: error instanceof Error ? error.message : '检查失败',
                        timestamp: Date.now()
                    };
                } finally {
                    if (page) {
                        try {
                            await page.close();
                            logger.info(`${platformConfig.name} 页面已关闭`);
                        } catch (closeError) {
                            logger.info(`${platformConfig.name} 关闭页面时出错:`, closeError);
                        }
                    }
                }
            });

            logger.info('等待所有平台检查完成...');
            await Promise.all(checkPromises);
            logger.info('所有平台检查完成，返回结果');

            this.loginStatusCache = loginStatus;
            this.cacheTimestamp = Date.now();
            this.cacheProfileKey = profileKey;
            logger.info('[缓存] 已更新', this.loginStatusCache, '时间戳:', this.cacheTimestamp);
            return loginStatus;
        } catch (overallError) {
            logger.error('登录状态检查整体过程出错:', overallError);
            const errorLoginStatus = buildEmptyLoginStatus(platformConfigs);

            for (const platformConfig of platformConfigs) {
                errorLoginStatus[platformConfig.name] = {
                    isLoggedIn: false,
                    status: 'error',
                    message: overallError instanceof Error ? overallError.message : '登录状态检查服务异常',
                    timestamp: Date.now()
                };
            }

            this.loginStatusCache = errorLoginStatus;
            this.cacheTimestamp = Date.now();
            this.cacheProfileKey = profileKey;
            logger.info('[缓存] catch分支已更新', this.loginStatusCache, '时间戳:', this.cacheTimestamp);
            return errorLoginStatus;
        }
    }
}

export default PlatformLoginService;

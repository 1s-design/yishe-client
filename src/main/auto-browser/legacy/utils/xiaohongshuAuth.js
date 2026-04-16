/**
 * 小红书认证工具 - 使用真实认证信息
 */

import {
    logger
} from './logger.js';
import {
    authDataParser
} from './authDataParser.js';

/**
 * 小红书认证管理类
 */
export class XiaohongshuAuth {
    constructor() {
        this.realCookies = [{
            name: 'abRequestId',
            value: '35328789-b536-51f7-952d-7867750a6dd4',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'a1',
            value: '199dad7771a8rzviphr8p5q1kiv1ezy9cig6fvf8p30000125998',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'webId',
            value: '5be556998523bb3cea465804755c0551',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'gid',
            value: 'yjjf0fWj4dS4yjjf0fWWW3hiy0YFuh3UxFYUkYU2AyT3hKq8yduvji888yJ2jjY8Dqi240SY',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'web_session',
            value: '040069b674b14d2468cc1a77d93a4b56c3ba5c',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'xsecappid',
            value: 'ugc',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'customer-sso-sid',
            value: '68c517565058608251437058hxpaclpo5lt28ue0',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'x-user-id-creator.xiaohongshu.com',
            value: '6700f205000000001d02389a',
            domain: 'creator.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'customerClientId',
            value: '177768468521187',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'access-token-creator.xiaohongshu.com',
            value: 'customer.creator.AT-68c517565058608251437059eudli7beb6egewuq',
            domain: 'creator.xiaohongshu.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'galaxy_creator_session_id',
            value: 'ffusSv4aGlsaeWmW2KdcOp6L4IGgXEX21CUM',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'galaxy.creator.beaker.session.id',
            value: '1761377465550066229511',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'websectiga',
            value: '3633fe24d49c7dd0eb923edc8205740f10fdb18b25d424d2a2322c6196d2a4ad',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'loadts',
            value: '1761379591896',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: false,
            sameSite: 'Lax'
        },
        {
            name: 'sec_poison_id',
            value: '58366717-1d2d-4342-b8e0-b50d7b939770',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'acw_tc',
            value: '0a4a8a3717613795963032135e8ed9b9fc2d361b23e59045593b939ca39fc9',
            domain: '.xiaohongshu.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        }
        ];
    }

    /**
     * 设置真实认证Cookie
     */
    async setRealCookies(page) {
        try {
            logger.info('设置小红书真实认证Cookie...');

            // 首先尝试从文件读取认证数据
            const fileCookies = authDataParser.getCookies();
            const cookiesToUse = fileCookies.length > 0 ? fileCookies : this.realCookies;

            logger.info(`使用${cookiesToUse.length}个Cookie进行认证`);

            // 先导航到小红书域名，确保Cookie能正确设置
            await page.goto('https://creator.xiaohongshu.com/', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // 等待页面加载
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 设置所有 Cookie 到 Context
            try {
                await page.context().addCookies(cookiesToUse);
                logger.debug('已批量注入所有 Cookie');
            } catch (error) {
                logger.error('注入 Cookie 失败:', error);
            }

            // 验证Cookie是否设置成功
            const setCookies = await page.context().cookies();
            const xiaohongshuCookies = setCookies.filter(c =>
                c.domain.includes('xiaohongshu.com')
            );

            logger.info(`实际设置了${xiaohongshuCookies.length}个小红书Cookie`);

            // 重新导航到发布页面，确保Cookie生效
            await page.goto('https://creator.xiaohongshu.com/publish/publish?target=image', {
                waitUntil: 'networkidle',
                timeout: 30000
            });

            // 等待页面加载
            await new Promise(resolve => setTimeout(resolve, 3000));

            logger.info('小红书认证Cookie设置完成');
            return true;
        } catch (error) {
            logger.error('设置认证Cookie失败:', error);
            return false;
        }
    }

    /**
     * 设置请求拦截器
     */
    async setupRequestInterceptor(page) {
        try {
            await page.setRequestInterception(true);

            page.on('request', (request) => {
                const url = request.url();

                if (url.includes('xiaohongshu.com') && url.includes('/web_api/')) {
                    logger.debug(`拦截小红书API请求: ${url}`);

                    // 从文件读取请求头，如果没有则使用默认值
                    const fileHeaders = authDataParser.getRequestHeaders();
                    const headers = {
                        ...request.headers(),
                        ...fileHeaders
                    };

                    request.continue({
                        headers
                    });
                } else {
                    request.continue();
                }
            });

            logger.info('小红书请求拦截器已设置');
            return true;
        } catch (error) {
            logger.error('设置请求拦截器失败:', error);
            return false;
        }
    }

    /**
     * 应用完整的小红书认证
     */
    async applyAuth(page) {
        try {
            logger.info('应用小红书真实认证...');

            // 设置Cookie
            const cookieSuccess = await this.setRealCookies(page);
            if (!cookieSuccess) {
                return false;
            }

            // 暂时跳过请求拦截器，直接使用Cookie认证
            logger.info('小红书认证应用成功（仅Cookie模式）');
            return true;
        } catch (error) {
            logger.error('应用小红书认证失败:', error);
            return false;
        }
    }
}

// 创建单例实例
export const xiaohongshuAuth = new XiaohongshuAuth();
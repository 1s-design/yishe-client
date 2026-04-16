/**
 * 快手认证工具 - 使用真实认证信息
 */

import {
    logger
} from './logger.js';
import {
    readFileSync,
    existsSync
} from 'fs';
import {
    join
} from 'path';

/**
 * 快手认证管理类
 */
export class KuaishouAuth {
    constructor() {
        this.authDataPath = join(process.cwd(), 'auth-data', 'kuaishou-auth.txt');
        this.cookies = [];
        this.headers = {};
    }

    /**
     * 解析认证数据文件
     */
    parseAuthData() {
        try {
            if (!existsSync(this.authDataPath)) {
                logger.warn('快手认证数据文件不存在:', this.authDataPath);
                return null;
            }

            const content = readFileSync(this.authDataPath, 'utf-8');
            const lines = content.split('\n').map(line => line.trim()).filter(line => line);

            let cookieString = '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // 跳过注释行
                if (line.startsWith('#') || line.startsWith('//')) {
                    continue;
                }

                // 解析Cookie
                if (line.toLowerCase().startsWith('cookie')) {
                    cookieString = lines[i + 1] || '';
                    this.cookies = this.parseCookies(cookieString);
                    i++;
                    continue;
                }

                // 解析其他请求头
                if (line.includes(':')) {
                    const [key, value] = line.split(':', 2);
                    if (key && value) {
                        this.headers[key.trim()] = value.trim();
                    }
                }
            }

            logger.info('快手认证数据解析完成');
            logger.debug('解析结果:', {
                cookieCount: this.cookies.length,
                headerCount: Object.keys(this.headers).length
            });

            return {
                cookies: this.cookies,
                headers: this.headers
            };

        } catch (error) {
            logger.error('解析快手认证数据失败:', error);
            return null;
        }
    }

    /**
     * 解析Cookie字符串
     */
    parseCookies(cookieString) {
        if (!cookieString) return [];

        const cookies = [];
        const cookiePairs = cookieString.split(';');

        for (const pair of cookiePairs) {
            const [name, value] = pair.trim().split('=', 2);
            if (name && value) {
                cookies.push({
                    name: name.trim(),
                    value: value.trim(),
                    domain: '.kuaishou.com',
                    path: '/',
                    httpOnly: false,
                    secure: true,
                    sameSite: 'Lax',
                    expires: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
                });
            }
        }

        return cookies;
    }

    /**
     * 设置快手认证Cookie
     */
    async setCookies(page) {
        try {
            logger.info('设置快手认证Cookie...');

            // 解析认证数据
            const authData = this.parseAuthData();
            if (!authData || authData.cookies.length === 0) {
                logger.warn('未找到快手认证数据，跳过Cookie设置');
                return false;
            }

            logger.info(`使用${authData.cookies.length}个Cookie进行认证`);

            // 先导航到快手域名
            await page.goto('https://cp.kuaishou.com/', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            await new Promise(resolve => setTimeout(resolve, 2000));

            // 设置所有 Cookie 到 Context
            try {
                await page.context().addCookies(authData.cookies);
                logger.debug('已批量注入快手 Cookie');
            } catch (error) {
                logger.error('注入快手 Cookie 失败:', error);
            }

            // 验证Cookie是否设置成功
            const setCookies = await page.context().cookies();
            const kuaishouCookies = setCookies.filter(c =>
                c.domain.includes('kuaishou.com')
            );

            logger.info(`实际设置了${kuaishouCookies.length}个快手Cookie`);

            return true;
        } catch (error) {
            logger.error('设置快手认证Cookie失败:', error);
            return false;
        }
    }

    /**
     * 获取请求头
     */
    getRequestHeaders() {
        const authData = this.parseAuthData();
        if (!authData) return {};

        return {
            'Accept': authData.headers.accept || 'application/json',
            'Accept-Encoding': authData.headers['accept-encoding'] || 'gzip, deflate, br',
            'Accept-Language': authData.headers['accept-language'] || 'zh-CN,zh;q=0.9',
            'Origin': authData.headers.origin || 'https://cp.kuaishou.com',
            'Referer': authData.headers.referer || 'https://cp.kuaishou.com/',
            'User-Agent': authData.headers['user-agent'] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        };
    }

    /**
     * 应用完整的快手认证
     */
    async applyAuth(page) {
        try {
            logger.info('应用快手认证...');
            const success = await this.setCookies(page);
            if (success) {
                logger.info('快手认证应用成功');
            }
            return success;
        } catch (error) {
            logger.error('应用快手认证失败:', error);
            return false;
        }
    }
}

// 创建单例实例
export const kuaishouAuth = new KuaishouAuth();

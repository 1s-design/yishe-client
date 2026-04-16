/**
 * 认证数据解析器 - 从txt文件解析小红书认证信息
 */

import {
    readFileSync,
    existsSync
} from 'fs';
import {
    join
} from 'path';
import {
    logger
} from './logger.js';

/**
 * 认证数据解析器类
 */
export class AuthDataParser {
    constructor() {
        this.authDataPath = join(process.cwd(), 'auth-data', 'xiaohongshu-auth.txt');
    }

    /**
     * 解析认证数据文件
     */
    parseAuthData() {
        try {
            if (!existsSync(this.authDataPath)) {
                logger.warn('认证数据文件不存在:', this.authDataPath);
                return null;
            }

            const content = readFileSync(this.authDataPath, 'utf-8');
            const lines = content.split('\n').map(line => line.trim()).filter(line => line);

            const authData = {
                cookies: [],
                headers: {},
                url: '',
                method: '',
                status: ''
            };

            let currentSection = '';
            let cookieString = '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // 跳过注释行
                if (line.startsWith('#') || line.startsWith('//')) {
                    continue;
                }

                // 解析URL
                if (line.startsWith('Request URL')) {
                    authData.url = lines[i + 1] || '';
                    i++;
                    continue;
                }

                // 解析方法
                if (line.startsWith('Request Method')) {
                    authData.method = lines[i + 1] || '';
                    i++;
                    continue;
                }

                // 解析状态码
                if (line.startsWith('Status Code')) {
                    authData.status = lines[i + 1] || '';
                    i++;
                    continue;
                }

                // 解析Cookie
                if (line.startsWith('cookie')) {
                    cookieString = lines[i + 1] || '';
                    authData.cookies = this.parseCookies(cookieString);
                    i++;
                    continue;
                }

                // 解析其他请求头
                if (line.includes(':') && !line.startsWith('Request') && !line.startsWith('Status')) {
                    const [key, value] = line.split(':', 2);
                    if (key && value) {
                        authData.headers[key.trim()] = value.trim();
                    }
                }
            }

            logger.info('认证数据解析完成');
            logger.debug('解析结果:', {
                url: authData.url,
                method: authData.method,
                status: authData.status,
                cookieCount: authData.cookies.length,
                headerCount: Object.keys(authData.headers).length
            });

            return authData;

        } catch (error) {
            logger.error('解析认证数据失败:', error);
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
                // 根据Cookie名称确定domain和httpOnly
                const domain = this.getCookieDomain(name);
                const httpOnly = this.isHttpOnlyCookie(name);

                // 设置过期时间（7天后）
                const expires = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

                cookies.push({
                    name: name.trim(),
                    value: value.trim(),
                    domain: domain,
                    path: '/',
                    httpOnly: httpOnly,
                    secure: true,
                    sameSite: 'Lax',
                    expires: expires
                });
            }
        }

        return cookies;
    }

    /**
     * 根据Cookie名称确定domain
     */
    getCookieDomain(name) {
        // 特殊处理某些Cookie的域名
        if (name.includes('creator.xiaohongshu.com')) {
            return 'creator.xiaohongshu.com';
        }
        if (name.includes('edith.xiaohongshu.com')) {
            return 'edith.xiaohongshu.com';
        }
        // 大部分Cookie使用主域名
        return '.xiaohongshu.com';
    }

    /**
     * 判断是否为HttpOnly Cookie
     */
    isHttpOnlyCookie(name) {
        const httpOnlyCookies = [
            'customer-sso-sid',
            'access-token-creator.xiaohongshu.com',
            'web_session'
        ];
        return httpOnlyCookies.some(cookieName => name.includes(cookieName));
    }

    /**
     * 获取请求头
     */
    getRequestHeaders() {
        const authData = this.parseAuthData();
        if (!authData) return {};

        return {
            'Accept': authData.headers.accept || 'application/json, text/plain, */*',
            'Accept-Encoding': authData.headers['accept-encoding'] || 'gzip, deflate, br, zstd',
            'Accept-Language': authData.headers['accept-language'] || 'zh-CN,zh;q=0.9',
            'Cache-Control': authData.headers['cache-control'] || 'no-cache',
            'Origin': authData.headers.origin || 'https://creator.xiaohongshu.com',
            'Pragma': authData.headers.pragma || 'no-cache',
            'Referer': authData.headers.referer || 'https://creator.xiaohongshu.com/',
            'Sec-Ch-Ua': authData.headers['sec-ch-ua'] || '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
            'Sec-Ch-Ua-Mobile': authData.headers['sec-ch-ua-mobile'] || '?0',
            'Sec-Ch-Ua-Platform': authData.headers['sec-ch-ua-platform'] || '"macOS"',
            'Sec-Fetch-Dest': authData.headers['sec-fetch-dest'] || 'empty',
            'Sec-Fetch-Mode': authData.headers['sec-fetch-mode'] || 'cors',
            'Sec-Fetch-Site': authData.headers['sec-fetch-site'] || 'same-site',
            'User-Agent': authData.headers['user-agent'] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
            'X-B3-Traceid': authData.headers['x-b3-traceid'] || '',
            'X-S': authData.headers['x-s'] || '',
            'X-S-Common': authData.headers['x-s-common'] || '',
            'X-T': authData.headers['x-t'] || '',
            'X-Xray-Traceid': authData.headers['x-xray-traceid'] || ''
        };
    }

    /**
     * 获取Cookie数组
     */
    getCookies() {
        const authData = this.parseAuthData();
        if (!authData) return [];
        return authData.cookies;
    }

    /**
     * 验证认证数据是否有效
     */
    validateAuthData() {
        const authData = this.parseAuthData();
        if (!authData) return false;

        // 检查必要的Cookie
        const requiredCookies = [
            'access-token-creator.xiaohongshu.com',
            'customer-sso-sid',
            'x-user-id-creator.xiaohongshu.com'
        ];

        const hasRequiredCookies = requiredCookies.every(name =>
            authData.cookies.some(cookie => cookie.name.includes(name))
        );

        // 检查必要的请求头
        const hasRequiredHeaders = authData.headers['x-s'] && authData.headers['x-s-common'];

        return hasRequiredCookies && hasRequiredHeaders;
    }

    /**
     * 更新认证数据文件
     */
    updateAuthData(newContent) {
        try {
            const fs = require('fs');
            fs.writeFileSync(this.authDataPath, newContent, 'utf-8');
            logger.info('认证数据文件已更新');
            return true;
        } catch (error) {
            logger.error('更新认证数据文件失败:', error);
            return false;
        }
    }
}

// 创建单例实例
export const authDataParser = new AuthDataParser();
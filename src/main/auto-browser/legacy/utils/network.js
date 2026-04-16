/**
 * 网络配置工具类
 * 处理 HTTPS 请求和证书验证
 */

import https from 'https';
import axios from 'axios';

/**
 * 创建安全的 HTTPS Agent
 */
export function createSecureHttpsAgent(options = {}) {
    const {
        rejectUnauthorized = true,
            timeout = 30000,
            keepAlive = true,
            maxSockets = 10
    } = options;

    return new https.Agent({
        rejectUnauthorized,
        timeout,
        keepAlive,
        maxSockets
    });
}

/**
 * 创建不安全的 HTTPS Agent（仅用于开发环境）
 */
export function createInsecureHttpsAgent(options = {}) {
    const {
        timeout = 30000,
            keepAlive = true,
            maxSockets = 10
    } = options;

    return new https.Agent({
        rejectUnauthorized: false,
        timeout,
        keepAlive,
        maxSockets
    });
}

/**
 * 创建配置好的 axios 实例
 */
export function createAxiosInstance(config = {}) {
    const {
        timeout = 0,
            useSecureHttps = true,
            httpsAgentOptions = {}
    } = config;

    // 根据环境决定是否使用安全的 HTTPS
    const shouldUseSecureHttps = useSecureHttps &&
        process.env.NODE_ENV !== 'development' &&
        process.env.DISABLE_TLS_VERIFY !== 'true' &&
        process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0';

    const httpsAgent = shouldUseSecureHttps ?
        createSecureHttpsAgent(httpsAgentOptions) :
        createInsecureHttpsAgent(httpsAgentOptions);

    const instance = axios.create({
        timeout,
        httpsAgent,
        // 添加请求拦截器
        transformRequest: [(data, headers) => {
            // 确保 Content-Type 正确设置
            if (data && typeof data === 'object' && !headers['Content-Type']) {
                headers['Content-Type'] = 'application/json';
                return JSON.stringify(data);
            }
            return data;
        }],
        // 添加响应拦截器
        transformResponse: [(data) => {
            try {
                return JSON.parse(data);
            } catch (e) {
                return data;
            }
        }]
    });

    // 添加请求拦截器
    instance.interceptors.request.use(
        (config) => {
            console.log(`🌐 发送请求: ${config.method?.toUpperCase()} ${config.url}`);
            return config;
        },
        (error) => {
            console.error('❌ 请求配置错误:', error.message);
            return Promise.reject(error);
        }
    );

    // 添加响应拦截器
    instance.interceptors.response.use(
        (response) => {
            console.log(`✅ 请求成功: ${response.status} ${response.config.url}`);
            return response;
        },
        (error) => {
            console.error(`❌ 请求失败: ${error.message}`);
            if (error.response) {
                console.error(`   状态码: ${error.response.status}`);
                console.error(`   响应数据:`, error.response.data);
            } else if (error.request) {
                console.error(`   网络错误: 无响应`);
            } else {
                console.error(`   配置错误: ${error.message}`);
            }
            return Promise.reject(error);
        }
    );

    return instance;
}

/**
 * 检查网络连接
 */
export async function checkNetworkConnection(url = 'https://www.baidu.com') {
    try {
        const response = await axios.get(url, {
            timeout: 5000
        });
        return {
            success: true,
            status: response.status,
            message: '网络连接正常'
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            message: '网络连接失败'
        };
    }
}

/**
 * 测试 HTTPS 连接
 */
export async function testHttpsConnection(url) {
    // 检查是否应该禁用 TLS 验证
    const shouldDisableTls = process.env.NODE_ENV === 'development' ||
        process.env.DISABLE_TLS_VERIFY === 'true' ||
        process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';

    try {
        // 如果应该禁用 TLS 验证，直接使用不安全模式
        if (shouldDisableTls) {
            const response = await axios.get(url, {
                timeout: 10000,
                httpsAgent: createInsecureHttpsAgent(),
                validateStatus: function(status) {
                    // 200-500 都认为是连接成功，因为服务器可能返回 404
                    return status >= 200 && status < 500;
                }
            });
            return {
                success: true,
                status: response.status,
                message: 'HTTPS 连接正常（证书验证已禁用）',
                warning: '证书验证已禁用'
            };
        }

        // 否则先尝试安全连接
        const response = await axios.get(url, {
            timeout: 10000,
            httpsAgent: createSecureHttpsAgent(),
            validateStatus: function(status) {
                return status >= 200 && status < 500;
            }
        });
        return {
            success: true,
            status: response.status,
            message: 'HTTPS 连接正常'
        };
    } catch (error) {
        // 如果安全连接失败，尝试不安全连接
        try {
            const response = await axios.get(url, {
                timeout: 10000,
                httpsAgent: createInsecureHttpsAgent(),
                validateStatus: function(status) {
                    return status >= 200 && status < 500;
                }
            });
            return {
                success: true,
                status: response.status,
                message: 'HTTPS 连接正常（使用不安全模式）',
                warning: '证书验证已禁用'
            };
        } catch (insecureError) {
            // 404 错误也认为服务器是可访问的
            if (insecureError.response && insecureError.response.status === 404) {
                return {
                    success: true,
                    status: 404,
                    message: '服务器可访问（端点不存在）',
                    warning: '返回 404，但服务器连接正常'
                };
            }

            console.error('详细错误信息:', {
                message: insecureError.message,
                code: insecureError.code,
                status: insecureError.response ? insecureError.response.status : undefined,
                errno: insecureError.errno,
                syscall: insecureError.syscall
            });
            return {
                success: false,
                error: insecureError.message,
                message: 'HTTPS 连接失败',
                details: insecureError.message
            };
        }
    }
}
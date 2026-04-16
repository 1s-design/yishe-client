/**
 * 统一发布服务 - API封装层
 * 提供统一的接口供前端和外部调用
 */

import {
    getPlatformCatalog as getRegistryPlatformCatalog,
    getSupportedPlatforms as getRegistrySupportedPlatforms,
    isPlatformSupported as isRegistryPlatformSupported,
    resolvePlatformCapability
} from '../config/platformRegistry.js';
import { logger } from '../utils/logger.js';

/**
 * 发布服务类
 */
class PublishService {
    /**
     * 执行单个平台能力
     * @param {string} platform - 平台ID
     * @param {Object} payload - 能力执行参数
     * @param {string} payload.action - 能力动作，默认 publish
     * @returns {Promise<Object>} 执行结果
     */
    async executePlatformAction(platform, payload = {}, runtimeOptions = {}) {
        try {
            const action = payload.action || 'publish';
            const run = async () => {
                logger.info(`开始执行平台能力: ${platform}.${action}`);

                const resolved = resolvePlatformCapability(platform, action);
                if (!resolved?.capability?.handler) {
                    throw new Error(`平台 ${platform} 不支持动作: ${action}`);
                }

                const result = await resolved.capability.handler(payload);

                logger.info(`平台 ${platform}.${action} 执行结果:`, result);

                return {
                    platform,
                    action,
                    ...result,
                    timestamp: new Date().toISOString()
                };
            };

            if (runtimeOptions?.taskLogHandler) {
                return await logger.runWithContext({
                    handler: runtimeOptions.taskLogHandler
                }, run);
            }

            return await run();

        } catch (error) {
            logger.error(`平台 ${platform} 执行动作失败:`, error);

            return {
                platform,
                action: payload.action || 'publish',
                success: false,
                message: error.message || '执行失败',
                error: error,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * 执行单个平台动作
     */
    async publishToPlatform(platform, publishInfo, runtimeOptions = {}) {
        return this.executePlatformAction(platform, {
            action: publishInfo?.action || 'publish',
            ...publishInfo
        }, runtimeOptions);
    }

    /**
     * 批量发布到多个平台
     * @param {Array<string>} platforms - 平台ID列表
     * @param {Object} payload - 动作执行参数
     * @param {Object} options - 选项
     * @returns {Promise<Object>} 批量发布结果
     */
    async batchPublish(platforms, payload, options = {}) {
        try {
            const action = payload?.action || 'publish';
            logger.info(`开始批量执行动作 ${action}，目标平台数: ${platforms.length}`);

            const results = [];
            const { concurrent = false, taskLogHandler } = options;

            if (concurrent) {
                logger.info('使用并发模式执行');
                const promises = platforms.map(platform =>
                    this.executePlatformAction(platform, payload, { taskLogHandler })
                );
                const platformResults = await Promise.allSettled(promises);

                platformResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        results.push(result.value);
                    } else {
                        results.push({
                            platform: platforms[index],
                            action,
                            success: false,
                            message: result.reason?.message || '执行失败',
                            error: result.reason,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
            } else {
                logger.info('使用顺序模式执行');
                for (const platform of platforms) {
                    const result = await this.executePlatformAction(platform, payload, { taskLogHandler });
                    results.push(result);

                    // 平台间间隔，避免频繁操作
                    if (platforms.indexOf(platform) < platforms.length - 1) {
                        await this.delay(2000);
                    }
                }
            }

            // 统计结果
            const successCount = results.filter(r => r.success).length;
            const failedCount = results.filter(r => !r.success).length;
            const allSuccess = successCount === platforms.length && platforms.length > 0;

            logger.info(`批量动作执行完成 ${action}: 成功 ${successCount}/${platforms.length}, 失败 ${failedCount}/${platforms.length}`);

            return {
                success: allSuccess,
                action,
                total: platforms.length,
                successCount,
                failedCount,
                results,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            logger.error('批量动作执行失败:', error);

            return {
                success: false,
                action: payload?.action || 'publish',
                message: error.message || '批量执行失败',
                error: error,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * 创建定时发布任务
     * @param {Array<string>} platforms - 平台ID列表
     * @param {Object} payload - 动作执行参数
     * @param {Date} scheduleTime - 定时时间
     * @returns {Promise<Object>} 任务创建结果
     */
    async createScheduleTask(platforms, payload, scheduleTime) {
        try {
            const action = payload?.action || 'publish';
            logger.info(`创建定时任务 ${action}，计划时间: ${scheduleTime}`);

            const taskId = `task_${Date.now()}`;
            const delay = new Date(scheduleTime).getTime() - Date.now();

            if (delay < 0) {
                throw new Error('定时时间必须是未来时间');
            }

            // 设置定时器
            setTimeout(async () => {
                logger.info(`执行定时任务: ${taskId}`);
                await this.batchPublish(platforms, payload);
            }, delay);

            return {
                success: true,
                taskId,
                action,
                scheduleTime,
                platforms,
                message: '定时任务创建成功'
            };

        } catch (error) {
            logger.error('创建定时任务失败:', error);

            return {
                success: false,
                message: error.message || '创建定时任务失败',
                error: error
            };
        }
    }

    /**
     * 获取支持的平台列表
     * @returns {Array<string>} 平台ID列表
     */
    getSupportedPlatforms() {
        return getRegistrySupportedPlatforms();
    }

    getPlatformCatalog() {
        return getRegistryPlatformCatalog();
    }

    /**
     * 检查平台是否支持
     * @param {string} platform - 平台ID
     * @returns {boolean} 是否支持
     */
    isPlatformSupported(platform) {
        return isRegistryPlatformSupported(platform);
    }

    /**
     * 延迟函数
     * @param {number} ms - 延迟毫秒数
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 创建单例实例
const publishService = new PublishService();

export default publishService;

/**
 * 导出便捷方法
 */
export const publishToPlatform = (platform, publishInfo) =>
    publishService.publishToPlatform(platform, publishInfo);

export const batchPublish = (platforms, publishInfo, options) =>
    publishService.batchPublish(platforms, publishInfo, options);

export const createScheduleTask = (platforms, publishInfo, scheduleTime) =>
    publishService.createScheduleTask(platforms, publishInfo, scheduleTime);

export const getSupportedPlatforms = () =>
    publishService.getSupportedPlatforms();

export const getPlatformCatalog = () =>
    publishService.getPlatformCatalog();

export const isPlatformSupported = (platform) =>
    publishService.isPlatformSupported(platform);

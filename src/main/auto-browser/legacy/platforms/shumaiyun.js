/**
 * 速卖通发布功能
 * 基于 AliExpress Seller Center
 */

import { getOrCreateBrowser } from '../services/BrowserService.js';
import { PageOperator } from '../services/PageOperator.js';
import { logger } from '../utils/logger.js';

class ShumaiyunPublisher {
    constructor() {
        this.platformName = '速卖通';
        this.uploadUrl = 'https://gshop.aliexpress.com/p/add';
        this.pageOperator = new PageOperator();
    }

    /**
     * 发布到速卖通
     */
    async publish(publishInfo) {
        let page = null;
        try {
            logger.info(`开始执行${this.platformName}发布操作`);

            // 1. 获取浏览器和页面
            const browser = await getOrCreateBrowser({ profileId: publishInfo?.profileId });
            page = await browser.newPage({ foreground: true });
            logger.info('新页面创建成功');

            // 2. 应用反检测
            await this.pageOperator.setupAntiDetection(page);
            logger.info('反检测脚本已应用');

            // 3. 导航到发布页面
            await page.goto(this.uploadUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            logger.info(`已打开${this.platformName}发布页面`);

            // 4. 检查登录状态
            const isLoggedIn = await this._checkLogin(page);
            if (!isLoggedIn) {
                logger.warn('未检测到登录状态，请先登录');
                return {
                    success: false,
                    message: '请先登录速卖通账号'
                };
            }

            // 5. 填充商品信息
            if (publishInfo.title) {
                await this.pageOperator.fillInput(
                    page,
                    'input[name*="productName"], input[placeholder*="商品标题"]',
                    publishInfo.title
                );
                logger.info('标题填充完成');
            }

            if (publishInfo.description) {
                await this.pageOperator.fillInput(
                    page,
                    'textarea[name*="productDescription"], textarea[placeholder*="商品描述"]',
                    publishInfo.description
                );
                logger.info('描述填充完成');
            }

            // 6. 上传图片
            if (publishInfo.images && publishInfo.images.length > 0) {
                await this.pageOperator.uploadFiles(page, 'input[type="file"]', publishInfo.images);
                logger.info(`已上传 ${publishInfo.images.length} 张图片`);
            }

            // 7. 点击保存/发布按钮
            const submitSelector = 'button[type="primary"], button.ant-btn-primary, button:has-text("保存"), button:has-text("发布")';
            await this.pageOperator.clickButton(page, submitSelector);
            logger.info('已点击保存/发布按钮');

            // 8. 等待发布完成
            await page.waitForNavigation({ timeout: 15000 }).catch(() => {
                logger.info('发布完成（未检测到导航）');
            });

            logger.info(`${this.platformName}发布成功`);
            return {
                success: true,
                message: '速卖通商品发布成功'
            };
        } catch (error) {
            logger.error(`${this.platformName}发布失败:`, error);
            return {
                success: false,
                message: `发布失败: ${error.message}`
            };
        } finally {
            if (page) {
                try {
                    await page.close();
                } catch (e) {
                    logger.error('关闭页面失败:', e);
                }
            }
        }
    }

    /**
     * 检查登录状态
     */
    async _checkLogin(page) {
        try {
            const loginElements = await page.$$('.login-btn, .login-button, .auth-btn, .login-text');
            return loginElements.length === 0;
        } catch (error) {
            logger.warn('检查登录状态失败:', error);
            return false;
        }
    }
}

export const shumaiyunPublisher = new ShumaiyunPublisher();

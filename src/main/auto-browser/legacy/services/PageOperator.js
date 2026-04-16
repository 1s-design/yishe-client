/**
 * 页面操作器 - 提供通用的页面操作工具
 */

import { logger } from '../utils/logger.js';

/**
 * 页面操作器类
 */
export class PageOperator {
    /**
     * 延迟执行
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 检查是否为致命错误（浏览器/页面已关闭）
     */
    isFatalError(error) {
        if (!error || !error.message) return false;
        const msg = error.message;
        return (
            msg.includes('Target page, context or browser has been closed') ||
            msg.includes('browser has been closed') ||
            msg.includes('context has been closed') ||
            msg.includes('Page closed') ||
            msg.includes('Browser closed')
        );
    }

    /**
     * 设置反检测脚本
     */
    async setupAntiDetection(_page) {
        logger.info('当前使用本地 Chrome/CDP 连接，不额外注入 stealth 补丁');
    }

    /**
     * 填写输入框
     * @param {import('playwright-core').Page} page
     * @param {string | string[]} selector - 单个选择器或备选选择器数组（按顺序尝试，直到有一个可见）
     * @param {string} text
     * @param {object} options
     */
    async fillInput(page, selector, text, options = {}) {
        const selectors = Array.isArray(selector) ? selector : [selector];
        const timeoutEach = Math.max(3000, Math.floor(10000 / selectors.length)); // 总等待约 10s 内分摊
        let resolvedSelector = null;

        for (const sel of selectors) {
            try {
                await page.waitForSelector(sel, { timeout: timeoutEach, state: 'visible' });
                resolvedSelector = sel;
                if (selectors.length > 1) {
                    logger.info(`fillInput: 使用选择器 ${sel}`);
                }
                break;
            } catch (e) {
                // 当前选择器超时，尝试下一个
                continue;
            }
        }

        if (!resolvedSelector) {
            throw new Error(`未找到可见的输入框，已尝试选择器: ${selectors.join(', ')}`);
        }

        const defaultOptions = {
            delay: 100,
            clear: true
        };

        const fillOptions = { ...defaultOptions, ...options };

        if (fillOptions.clear) {
            await page.click(resolvedSelector, { clickCount: 3 }); // 全选
            await page.keyboard.press('Backspace'); // 删除
        }

        await page.type(resolvedSelector, text, { delay: fillOptions.delay });
    }

    /**
     * 检查按钮是否可用
     */
    async isButtonEnabled(page, selector) {
        return await page.evaluate((sel) => {
            const button = document.querySelector(sel);
            if (!button) return false;

            const isDisabled = button.disabled;
            const hasDisabledClass = button.classList.contains('disabled') ||
                button.classList.contains('loading') ||
                button.classList.contains('uploading');
            const isVisible = window.getComputedStyle(button).display !== 'none' &&
                window.getComputedStyle(button).visibility !== 'hidden';

            return !isDisabled && !hasDisabledClass && isVisible;
        }, selector);
    }

    /**
     * 等待按钮变为可用状态
     */
    async waitForButtonEnabled(page, selector, timeout = 30000) {
        const maxWaitTime = timeout;
        const checkInterval = 1000;
        let elapsedTime = 0;

        logger.info('等待按钮变为可用状态...');

        while (elapsedTime < maxWaitTime) {
            try {
                const buttonStatus = await page.evaluate((sel) => {
                    const button = document.querySelector(sel);
                    if (!button) {
                        return { exists: false, enabled: false, reason: '按钮不存在' };
                    }

                    const isDisabled = button.disabled;
                    const hasDisabledClass = button.classList.contains('disabled') ||
                        button.classList.contains('loading') ||
                        button.classList.contains('uploading');
                    const isVisible = window.getComputedStyle(button).display !== 'none' &&
                        window.getComputedStyle(button).visibility !== 'hidden';

                    return {
                        exists: true,
                        enabled: !isDisabled && !hasDisabledClass && isVisible,
                        reason: isDisabled ? '按钮被禁用' :
                            hasDisabledClass ? '按钮有禁用类' :
                                !isVisible ? '按钮不可见' : '按钮可用'
                    };
                }, selector);

                if (buttonStatus.exists && buttonStatus.enabled) {
                    logger.info('按钮已可用');
                    return true;
                } else {
                    logger.info(`按钮状态: ${buttonStatus.reason}`);
                }

            } catch (error) {
                logger.warn('检查按钮状态时出错:', error);
            }

            await this.delay(checkInterval);
            elapsedTime += checkInterval;
        }

        logger.warn('等待按钮可用超时');
        return false;
    }

    /**
     * 等待元素出现
     */
    async waitForElement(page, selector, timeout = 10000) {
        try {
            await page.waitForSelector(selector, { timeout });
            return true;
        } catch (error) {
            logger.warn(`等待元素 ${selector} 超时`);
            return false;
        }
    }

    /**
     * 安全点击元素
     */
    async safeClick(page, selector, options = {}) {
        try {
            await page.waitForSelector(selector, { timeout: 10000 });

            // 先悬停
            await page.hover(selector);
            await this.delay(500);

            // 点击
            await page.click(selector, options);
            return true;
        } catch (error) {
            logger.error(`点击元素 ${selector} 失败:`, error);
            return false;
        }
    }

    /**
     * 执行页面内脚本
     */
    async executeScript(page, script, ...args) {
        try {
            return await page.evaluate(script, ...args);
        } catch (error) {
            logger.error('执行页面脚本失败:', error);
            throw error;
        }
    }

    /**
     * 检查元素是否存在
     */
    async elementExists(page, selector) {
        try {
            const element = await page.$(selector);
            return !!element;
        } catch (error) {
            return false;
        }
    }

    /**
     * 获取元素文本
     */
    async getElementText(page, selector) {
        try {
            return await page.$eval(selector, el => el.textContent);
        } catch (error) {
            logger.warn(`获取元素 ${selector} 文本失败:`, error);
            return '';
        }
    }

    /**
     * 滚动到元素
     */
    async scrollToElement(page, selector) {
        try {
            await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth' });
                }
            }, selector);
            await this.delay(1000);
        } catch (error) {
            logger.warn(`滚动到元素 ${selector} 失败:`, error);
        }
    }

    /**
     * 等待网络空闲
     */
    async waitForNetworkIdle(page, timeout = 30000) {
        try {
            await page.waitForLoadState('networkidle', { timeout });
        } catch (error) {
            logger.warn('等待网络空闲超时');
        }
    }

    /**
     * 截图
     */
    async takeScreenshot(page, filename) {
        try {
            const screenshot = await page.screenshot({
                path: filename,
                fullPage: true
            });
            logger.info(`截图已保存: ${filename}`);
            return screenshot;
        } catch (error) {
            logger.error('截图失败:', error);
            throw error;
        }
    }
}

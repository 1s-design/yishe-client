/**
 * 快手发布功能 - 完整实现
 * 参考 social-auto-upload 的 Python 实现
 */

import { getOrCreateBrowser } from '../services/BrowserService.js';
import { PageOperator } from '../services/PageOperator.js';
import { logger } from '../utils/logger.js';
import { kuaishouAuth } from '../utils/kuaishouAuth.js';

/**
 * 快手发布器类
 */
class KuaishouPublisher {
    constructor() {
        this.platformName = '快手';
        this.uploadUrl = 'https://cp.kuaishou.com/article/publish/video';
        this.pageOperator = new PageOperator();
        this.maxTags = 3; // 快手最多支持3个话题
    }

    /**
     * 发布到快手
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

            // 3. 应用认证 (如果是通过 CDP 连接且已登录，即使此处返回 false 也不影响发布)
            await kuaishouAuth.applyAuth(page);
            logger.info('快手认证处理完成');

            // 4. 导航到上传页面
            await page.goto(this.uploadUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            logger.info(`已打开${this.platformName}上传页面`);

            // 5. 等待并检查当前URL
            await this.pageOperator.delay(2000);
            const currentUrl = page.url();
            logger.info(`当前URL: ${currentUrl}`);

            // 6. 检查登录状态
            // 策略 1: 如果 URL 还是上传页，通常说明已登录
            if (currentUrl.includes('/article/publish/video')) {
                logger.info('登录状态检查通过 (处于上传页面)');
            } else {
                // 策略 2: 检查是否有登录按钮或登录界面的特征元素
                const loginCheckSelectors = [
                    'div.names div.container div.name:text("机构服务")', // 官网首页特征
                    'text=请先登录',
                    'text=登录/注册',
                    '.login-button',
                    'button:has-text("登录")'
                ];

                for (const selector of loginCheckSelectors) {
                    try {
                        const count = await page.locator(selector).count();
                        if (count > 0) {
                            throw new Error('快手未登录，请先登录');
                        }
                    } catch (e) {
                        if (e.message.includes('快手未登录')) throw e;
                    }
                }

                // 策略 3: 如果在官网首页且不在发布页，则视为未登录
                if (currentUrl === 'https://cp.kuaishou.com/' || currentUrl === 'https://cp.kuaishou.com') {
                    throw new Error('快手未登录，请先登录');
                }
            }
            logger.info('登录状态检查通过');

            // 7. 上传视频
            await this.uploadVideo(page, publishInfo.videoUrl || publishInfo.filePath);

            // 8. 等待进入编辑页面
            await this.pageOperator.delay(2000);

            // 9. 处理新功能提示
            await this.handleNewFeaturePrompt(page);

            // 10. 填写描述和话题
            await this.fillDescriptionAndTags(page, publishInfo);

            // 11. 等待视频上传完成
            await this.waitForVideoUploadComplete(page);

            // 12. 设置定时发布（如果有）
            if (publishInfo.scheduled && publishInfo.scheduleTime) {
                await this.setScheduleTime(page, publishInfo.scheduleTime);
            }

            // 13. 点击发布按钮
            await this.clickPublishButton(page);

            // 14. 等待发布完成
            await this.waitForPublishComplete(page);

            logger.success(`${this.platformName}发布成功`);

            return {
                success: true,
                message: `${this.platformName}发布成功`
            };

        } catch (error) {
            logger.error(`${this.platformName}发布过程出错:`, error);

            // 截图保存错误现场
            if (page) {
                try {
                    await page.screenshot({ path: `error_kuaishou_${Date.now()}.png`, fullPage: true });
                } catch (e) {
                    logger.warn('截图失败:', e);
                }
            }

            return {
                success: false,
                message: error.message || '未知错误',
                error: error
            };
        } finally {
            if (page) {
                try {
                    await page.close();
                    logger.info(`${this.platformName}页面已关闭`);
                } catch (closeError) {
                    logger.warn(`${this.platformName}关闭页面时出错:`, closeError);
                }
            }
        }
    }

    /**
     * 上传视频文件
     */
    async uploadVideo(page, filePath) {
        logger.info('开始上传视频文件');

        // 等待上传按钮出现 (兼容 button 和 div 等元素)
        const uploadSelectors = [
            "button[class*='upload-btn']",
            "div[class*='upload-btn']",
            "button:has-text('上传')",
            "div:has-text('上传视频')"
        ];

        let uploadButton = null;
        for (const selector of uploadSelectors) {
            try {
                const btn = page.locator(selector).first();
                if (await btn.count() > 0 && await btn.isVisible()) {
                    uploadButton = btn;
                    logger.info(`找到上传按钮: [${selector}]`);
                    break;
                }
            } catch (e) {
                // 继续尝试下一个
            }
        }

        if (!uploadButton) {
            throw new Error('未找到上传按钮，请确认页面是否已正确加载');
        }

        // 使用文件选择器上传
        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            uploadButton.click()
        ]);

        await fileChooser.setFiles(filePath);
        logger.info('视频文件已选择');

        await this.pageOperator.delay(2000);
    }

    /**
     * 处理新功能提示弹窗
     */
    async handleNewFeaturePrompt(page) {
        try {
            const newFeatureButton = page.locator('button[type="button"] span:text("我知道了")');
            const count = await newFeatureButton.count();

            if (count > 0) {
                await newFeatureButton.click();
                logger.info('已关闭新功能提示');
            }
        } catch (error) {
            if (this.pageOperator.isFatalError(error)) throw error;
            logger.debug('无新功能提示弹窗');
        }
    }

    /**
     * 填写描述和话题
     */
    async fillDescriptionAndTags(page, publishInfo) {
        logger.info('开始填充描述和话题...');

        // 1. 定位并激活输入区域
        // 根据快手后台结构，通常点击“描述”标签旁边的容器即可激活编辑器
        const descriptionArea = page.locator('text=描述').locator('xpath=following-sibling::div');

        try {
            await descriptionArea.first().click();
            logger.info('已点击描述区域以激活输入');
            await this.pageOperator.delay(1500); // 增加等待时间确保编辑器加载和聚焦
        } catch (e) {
            logger.warn('点击描述区域失败，尝试备用方案', e.message);
            // 备用方案：寻找 contenteditable 元素
            const ce = page.locator('[contenteditable="true"]').first();
            if (await ce.count() > 0) {
                await ce.click();
                await this.pageOperator.delay(1000);
            }
        }

        // 2. 清空现有内容
        logger.info('执行全选删除，清空现有内容');
        await page.keyboard.press('Control+KeyA');
        await this.pageOperator.delay(200);
        await page.keyboard.press('Delete');
        await this.pageOperator.delay(800);

        // 3. 输入新标题/描述
        const title = publishInfo.title || publishInfo.description || '';
        if (title) {
            logger.info(`正在输入内容: ${title.substring(0, 20)}...`);
            // 再次点击确保焦点仍然存在
            try { await page.keyboard.press('ArrowDown'); } catch (e) { } // 触发一下交互

            await page.keyboard.type(title, { delay: 60 });
            await this.pageOperator.delay(1000);
            // 输入换行符，为话题留出空间
            await page.keyboard.press('Enter');
            await this.pageOperator.delay(500);
        }

        // 4. 添加话题标签 (快手最多3个)
        if (publishInfo.tags && publishInfo.tags.length > 0) {
            const tagsToAdd = publishInfo.tags.slice(0, this.maxTags);
            logger.info(`准备添加话题标签: ${tagsToAdd.join(', ')}`);

            for (let i = 0; i < tagsToAdd.length; i++) {
                const tag = tagsToAdd[i];
                logger.info(`正在添加话题: #${tag}`);

                // 输入 # 触发联想
                await page.keyboard.type('#' + tag, { delay: 100 });
                await this.pageOperator.delay(2000); // 快手联想有时较慢，给足时间

                // 尝试按 Enter 确认联想
                await page.keyboard.press('Enter');
                await this.pageOperator.delay(1000);

                // 敲个空格确保形成标签块
                await page.keyboard.press('Space');
                await this.pageOperator.delay(1000);
            }
        }

        logger.info('描述与话题填充完成');
        await this.pageOperator.delay(2000);
    }

    /**
     * 等待视频上传完成
     */
    async waitForVideoUploadComplete(page) {
        logger.info('等待视频上传完成...');

        const maxRetries = 60; // 最多等待2分钟
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                // 检查"上传中"文本是否消失
                const uploadingCount = await page.locator('text=上传中').count();

                if (uploadingCount === 0) {
                    logger.success('视频上传完毕');
                    break;
                } else {
                    if (retryCount % 5 === 0) {
                        logger.info('视频上传中...');
                    }
                    await this.pageOperator.delay(2000);
                }
            } catch (error) {
                if (this.pageOperator.isFatalError(error)) throw error;
                logger.error('检查上传状态时发生错误:', error);
                await this.pageOperator.delay(2000);
            }

            retryCount++;
        }

        if (retryCount >= maxRetries) {
            logger.warn('超过最大重试次数，视频上传可能未完成');
        }
    }

    /**
     * 设置定时发布
     */
    async setScheduleTime(page, scheduleTime) {
        logger.info('开始设置定时发布...');

        try {
            // 点击定时发布单选框
            await page.locator("label:text('发布时间')")
                .locator('xpath=following-sibling::div')
                .locator('.ant-radio-input')
                .nth(1)
                .click();

            await this.pageOperator.delay(1000);

            // 格式化时间
            const publishDate = new Date(scheduleTime);
            const formattedTime = publishDate.toISOString().slice(0, 19).replace('T', ' ');

            // 点击日期时间选择器
            await page.locator('div.ant-picker-input input[placeholder="选择日期时间"]').click();
            await this.pageOperator.delay(1000);

            // 输入时间
            await page.keyboard.press('Control+KeyA');
            await page.keyboard.type(formattedTime);
            await page.keyboard.press('Enter');

            await this.pageOperator.delay(1000);
            logger.success('定时发布设置完成');
        } catch (error) {
            logger.error('设置定时发布失败:', error);
        }
    }

    /**
     * 点击发布按钮
     */
    async clickPublishButton(page) {
        logger.info('准备点击发布按钮...');

        // 第一步：点击"发布"按钮
        // 兼容不同的元素类型（button, div, span）以及特定的 class
        const publishSelectors = [
            'button:has-text("发布")',
            'div[class*="_button_"]:has-text("发布")',
            'div:has-text("发布")',
            'span:has-text("发布")'
        ];

        let publishClicked = false;
        for (const selector of publishSelectors) {
            try {
                const btn = page.locator(selector).filter({ hasText: /^发布$/ }).first();
                if (await btn.count() > 0) {
                    await btn.click();
                    logger.info(`已通过选择器 [${selector}] 点击发布按钮`);
                    publishClicked = true;
                    break;
                }
            } catch (e) {
                logger.debug(`尝试选择器 [${selector}] 失败: ${e.message}`);
            }
        }

        if (!publishClicked) {
            throw new Error('未找到发布按钮，请检查页面加载情况');
        }

        await this.pageOperator.delay(2000);

        // 第二步：点击"确认发布"按钮 (弹窗中的确认)
        const confirmSelectors = [
            'button:has-text("确认发布")',
            'div[class*="_button_"]:has-text("确认发布")',
            'div:has-text("确认发布")',
            'span:has-text("确认发布")'
        ];

        for (const selector of confirmSelectors) {
            try {
                const btn = page.locator(selector).first();
                if (await btn.count() > 0) {
                    await btn.click();
                    logger.info(`已通过选择器 [${selector}] 点击确认发布按钮`);
                    break;
                }
            } catch (e) {
                logger.debug(`尝试确认发布选择器 [${selector}] 失败: ${e.message}`);
            }
        }
    }

    /**
     * 等待发布完成
     */
    async waitForPublishComplete(page) {
        logger.info('等待发布完成...');

        const targetUrl = 'https://cp.kuaishou.com/article/manage/video**';
        const maxRetries = 60;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                // 检查是否跳转到作品管理页面
                await page.waitForURL(targetUrl, { timeout: 1000 });
                logger.success('发布成功，已跳转到作品管理页面');
                return true;
            } catch (error) {
                if (this.pageOperator.isFatalError(error)) throw error;
                logger.debug(`等待发布完成... (${retryCount + 1}/${maxRetries})`);

                // 截图记录
                if (retryCount % 10 === 0) {
                    try {
                        await page.screenshot({ path: `publishing_ks_${Date.now()}.png`, fullPage: true });
                    } catch (e) {
                        // 忽略截图错误
                    }
                }

                await this.pageOperator.delay(1000);
                retryCount++;
            }
        }

        throw new Error('发布超时');
    }
}

// 创建单例实例
const kuaishouPublisher = new KuaishouPublisher();

/**
 * 发布到快手
 */
export async function publishToKuaishou(publishInfo) {
    return await kuaishouPublisher.publish(publishInfo);
}

export default kuaishouPublisher;

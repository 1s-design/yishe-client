/**
 * 抖音发布功能 - 完整实现
 * 参考 social-auto-upload 的 Python 实现
 */

import { getOrCreateBrowser } from '../services/BrowserService.js';
import { PageOperator } from '../services/PageOperator.js';
import { logger } from '../utils/logger.js';

/**
 * 抖音发布器类
 */
class DouyinPublisher {
    constructor() {
        this.platformName = '抖音';
        this.uploadUrl = 'https://creator.douyin.com/creator-micro/content/upload';
        this.pageOperator = new PageOperator();
    }

    /**
     * 发布到抖音
     */
    async publish(publishInfo) {
        let page = null;
        try {
            logger.info(`开始执行${this.platformName}发布操作`);

            // 统一提取平台配置
            const settings = publishInfo.platformOptions || publishInfo.publishOptions || publishInfo.platformSettings?.douyin || {};

            // 1. 获取浏览器和页面
            const browser = await getOrCreateBrowser({ profileId: publishInfo?.profileId });
            page = await browser.newPage({ foreground: true });
            logger.info('新页面创建成功');

            // 2. 应用反检测（暂时禁用，因为会导致页面显示错误）
            // await this.pageOperator.setupAntiDetection(page);
            // logger.info('反检测脚本已应用');

            // 3. 导航到上传页面（浏览器应已通过CDP模式登录）
            logger.info(`正在导航至: ${this.uploadUrl}`);
            await page.goto(this.uploadUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 15000 // 缩短超时时间
            });
            logger.info(`已打开${this.platformName}上传页面`);

            // 4. 等待页面加载 (goto 已等待 domcontentloaded，此处检查重定向)
            await this.pageOperator.delay(1000);

            // 5. 检查登录状态
            const currentUrl = page.url();
            logger.info(`当前URL: ${currentUrl}`);

            // 如果被重定向到非上传页面，通常意味着未登录
            if (!currentUrl.includes('/content/upload') && !currentUrl.includes('/content/publish') && !currentUrl.includes('/content/post/video')) {
                logger.warn('检测到页面重定向，可能未登录');
                // 进一步检查页面内容
                const loginCheckSelectors = [
                    'text=手机号登录',
                    'text=扫码登录',
                    'text=密码登录',
                    '.login-mask',
                    '.login-container',
                    '[data-testid="login-button"]'
                ];

                for (const selector of loginCheckSelectors) {
                    try {
                        const count = await page.locator(selector).count();
                        if (count > 0) {
                            throw new Error('抖音未登录，请先登录');
                        }
                    } catch (e) {
                        // 忽略某些 selector 报错
                    }
                }

                // 如果 URL 不对且没有任何登录提示，但又不在上传页，也视为未登录或状态异常
                if (currentUrl.includes('creator.douyin.com') && !currentUrl.includes('/creator-micro/')) {
                    throw new Error('抖音登录状态异常或未登录，请先登录');
                }
            } else {
                logger.info('登录状态检查通过 (URL匹配)');
            }

            // 6. 上传视频
            await this.uploadVideo(page, publishInfo.videoUrl || publishInfo.filePath);

            // 7. 等待跳转到发布页面（兼容两种版本）
            await this.waitForPublishPage(page);

            // 8. 填写标题和话题
            await this.fillTitleAndTags(page, publishInfo);

            // 等待内容保存（重要：确保标题和标签已经填写完成并保存）
            logger.info('等待内容保存...');
            await this.pageOperator.delay(3000);

            // 9. 等待视频上传完成
            await this.waitForVideoUploadComplete(page);

            // 10. 设置商品链接（如果有）
            if (settings.productLink) {
                await this.setProductLink(page, settings);
            }

            // 11. 设置封面（如果有）
            if (settings.thumbnail) {
                await this.setThumbnail(page, settings.thumbnail);
            }

            // 12. 设置地理位置（如果有）
            if (settings.location) {
                await this.setLocation(page, settings.location);
            }

            // 13. 设置第三方平台同步
            if (settings.syncToutiao) {
                await this.setThirdPartySync(page, settings);
            }

            // 14. 设置定时发布（如果有）
            if (publishInfo.scheduled && publishInfo.scheduleTime) {
                await this.setScheduleTime(page, publishInfo.scheduleTime);
            }

            // 15. 点击发布按钮
            await this.clickPublishButton(page);

            // 16. 等待发布完成
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
                    await page.screenshot({ path: `error_douyin_${Date.now()}.png`, fullPage: true });
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

        // 等待选择器出现，增加超时控制
        const selector = "div[class^='container'] input";
        try {
            await page.waitForSelector(selector, { timeout: 10000 });
            const fileInput = await page.locator(selector).first();
            await fileInput.setInputFiles(filePath);
            logger.info('视频文件已选择');
        } catch (error) {
            logger.error('未找到视频上传输入框，可能未登录或页面结构已变', error.message);
            throw new Error('未找到视频上传入口，请确认是否已登录或页面是否正确加载');
        }
    }

    /**
     * 等待跳转到发布页面（兼容两种版本）
     */
    async waitForPublishPage(page) {
        logger.info('等待跳转到发布页面...');

        const version1Url = 'https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page';
        const version2Url = 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page';

        let entered = false;
        const maxRetries = 60; // 最多等待60秒

        for (let i = 0; i < maxRetries; i++) {
            try {
                // 尝试等待第一个URL
                await page.waitForURL(version1Url, { timeout: 1000 });
                logger.info('成功进入 version_1 发布页面');
                entered = true;
                break;
            } catch (e1) {
                try {
                    // 尝试等待第二个URL
                    await page.waitForURL(version2Url, { timeout: 1000 });
                    logger.info('成功进入 version_2 发布页面');
                    entered = true;
                    break;
                } catch (e2) {
                    if (this.pageOperator.isFatalError(e2)) throw e2;
                    logger.debug(`等待发布页面... (${i + 1}/${maxRetries})`);
                    await this.pageOperator.delay(500);
                }
            }
        }

        if (!entered) {
            throw new Error('超时未进入视频发布页面');
        }
    }

    /**
     * 填写标题、描述和话题
     */
    async fillTitleAndTags(page, publishInfo) {
        logger.info('开始填充标题、描述和话题...');

        // 等待页面稳定
        await this.pageOperator.delay(2000);

        logger.info(`准备填写标题: ${publishInfo.title || '(无)'}`);
        logger.info(`准备填写描述: ${publishInfo.description || publishInfo.content || '(无)'}`);
        logger.info(`准备填写标签: ${JSON.stringify(publishInfo.tags || [])}`);

        // ===== 1. 填写标题（第一个输入框）=====
        if (publishInfo.title) {
            try {
                logger.info('开始查找标题输入框...');

                let titleInput = null;

                // 策略 1: 通过 "作品标题" 文本定位
                try {
                    const titleLabel = page.locator('text=作品标题');
                    if (await titleLabel.count() > 0) {
                        const target = titleLabel.locator('..').locator('xpath=following-sibling::div[1]').locator('input');
                        if (await target.count() > 0) {
                            titleInput = target;
                            logger.info('已通过 "作品标题" 标签找到输入框');
                        }
                    }
                } catch (e) {
                    logger.debug('策略 1 (标签) 失败');
                }

                // 策略 2: 通过 placeholder 属性
                if (!titleInput) {
                    const selectors = [
                        'input[placeholder*="填写作品标题"]',
                        'input[placeholder*="作品标题"]',
                        'input[placeholder*="填写标题"]',
                        'input[placeholder*="添加标题"]',
                        'input[placeholder*="作品名称"]',
                        '.title-input input',
                        '.title-container input'
                    ];

                    for (const selector of selectors) {
                        try {
                            const target = page.locator(selector).first();
                            if (await target.count() > 0) {
                                titleInput = target;
                                logger.info(`已通过选择器 "${selector}" 找到输入框`);
                                break;
                            }
                        } catch (e) {
                            // 继续下一个
                        }
                    }
                }

                // 策略 3: 这里的输入框可能是第一个 input
                if (!titleInput) {
                    try {
                        const allInputs = page.locator('input[type="text"]');
                        const inputCount = await allInputs.count();
                        for (let i = 0; i < inputCount; i++) {
                            const placeholder = await allInputs.nth(i).getAttribute('placeholder') || '';
                            if (placeholder.includes('标题') || placeholder.includes('名称') || placeholder.includes('作品')) {
                                titleInput = allInputs.nth(i);
                                logger.info(`已通过遍历 input 找到疑似标题框: "${placeholder}"`);
                                break;
                            }
                        }
                    } catch (e) {
                        // 忽略
                    }
                }

                if (titleInput) {
                    await titleInput.click();
                    await this.pageOperator.delay(300);
                    // 清空并输入
                    await titleInput.fill('');
                    await this.pageOperator.delay(200);
                    // 抖音标题限制通常为 30 字
                    await titleInput.fill(publishInfo.title.substring(0, 30));
                    await this.pageOperator.delay(500);
                    logger.success(`标题填写成功: ${publishInfo.title.substring(0, 30)}`);
                } else {
                    logger.warn('未找到特定的标题输入框，尝试直接在当前焦点处输入');
                    // 如果没找到，尝试按 Tab 或者根据位置猜
                    // 但通常 description 框是 rich text，title 是普通 input
                }
            } catch (error) {
                logger.error('填写标题异常:', error.message);
            }
        }

        // ===== 2. 填写描述（.notranslate 或第二个输入区域）=====
        const description = publishInfo.description || publishInfo.content || publishInfo.title || '';
        if (description) {
            try {
                logger.info('开始填写描述...');

                // 方式1: 尝试通过 .notranslate 类定位描述框
                const descContainer = page.locator('.notranslate').first();
                const descCount = await descContainer.count();

                if (descCount > 0) {
                    logger.info('找到描述输入框（.notranslate）');

                    // 等待元素可见
                    await descContainer.waitFor({ timeout: 5000 });

                    // 点击激活
                    await descContainer.click();
                    await this.pageOperator.delay(500);

                    // 清空内容
                    await page.keyboard.press('Control+KeyA');
                    await this.pageOperator.delay(200);
                    await page.keyboard.press('Delete');
                    await this.pageOperator.delay(300);

                    // 输入描述
                    await page.keyboard.type(description, { delay: 30 });
                    await this.pageOperator.delay(500);

                    logger.success(`描述填写成功: ${description.substring(0, 50)}...`);
                } else {
                    logger.warn('未找到描述输入框');
                }
            } catch (error) {
                logger.error('填写描述失败:', error.message);
            }
        }

        // ===== 3. 填写话题标签 =====
        if (publishInfo.tags && publishInfo.tags.length > 0) {
            const tags = publishInfo.tags.slice(0, 5);
            logger.info(`开始填写话题标签（共 ${publishInfo.tags.length} 个，取前 ${tags.length} 个）`);

            try {
                const cssSelector = '.zone-container';

                // 等待话题输入区域出现
                await page.waitForSelector(cssSelector, { timeout: 5000 });

                // 只在开始时点击一次，并确保光标在末尾
                await page.locator(cssSelector).click();
                await this.pageOperator.delay(500);
                await page.keyboard.press('End');
                await this.pageOperator.delay(300);

                for (let i = 0; i < tags.length; i++) {
                    const tag = tags[i];
                    logger.info(`正在添加话题 ${i + 1}/${tags.length}: #${tag}`);

                    // 输入话题（带#号）
                    await page.keyboard.type(`#${tag}`, { delay: 50 });

                    // 等待话题建议窗口弹出
                    await this.pageOperator.delay(800);

                    // 按回车确认（回车通常比空格更可靠，能选中建议列表中的第一个或直接确认）
                    await page.keyboard.press('Enter');
                    await this.pageOperator.delay(500);

                    // 再次按空格/回车确保生成标签气泡
                    await page.keyboard.press('Space');
                    await this.pageOperator.delay(500);

                    logger.info(`话题 #${tag} 添加步骤已执行`);
                }

                logger.success(`总共添加了 ${publishInfo.tags.length} 个话题`);

                // 等待话题保存
                await this.pageOperator.delay(1000);
            } catch (error) {
                logger.error('填写话题标签失败:', error);
            }
        } else {
            logger.info('没有话题标签需要填写');
        }
    }

    /**
     * 等待视频上传完成
     */
    async waitForVideoUploadComplete(page) {
        logger.info('等待视频上传完成...');

        const maxRetries = 300; // 最多等待10分钟
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                // 检查"重新上传"按钮是否出现
                const reuploadButton = page.locator('[class^="long-card"] div:has-text("重新上传")');
                const count = await reuploadButton.count();

                if (count > 0) {
                    logger.success('视频上传完毕');
                    break;
                }

                // 检查是否上传失败
                const failedText = page.locator('div.progress-div > div:has-text("上传失败")');
                const failedCount = await failedText.count();

                if (failedCount > 0) {
                    logger.error('视频上传失败，尝试重新上传');
                    await this.handleUploadError(page);
                }

                if (retryCount % 10 === 0) {
                    logger.info('视频上传中...');
                }

                await this.pageOperator.delay(2000);
                retryCount++;

            } catch (error) {
                if (this.pageOperator.isFatalError(error)) throw error;
                logger.warn('检查上传状态时出错:', error.message);
                await this.pageOperator.delay(2000);
                retryCount++;
            }
        }

        if (retryCount >= maxRetries) {
            throw new Error('视频上传超时');
        }
    }

    /**
     * 处理上传错误
     */
    async handleUploadError(page) {
        logger.info('处理上传错误，重新上传视频');
        // 这里可以实现重新上传逻辑
        throw new Error('视频上传失败');
    }

    /**
     * 设置商品链接
     */
    async setProductLink(page, settings) {
        logger.info('开始设置商品链接...');

        try {
            await this.pageOperator.delay(2000);

            // 找到"添加标签"下拉框
            const dropdown = page.locator('text=添加标签')
                .locator('..')
                .locator('..')
                .locator('..')
                .locator('.semi-select')
                .first();

            await dropdown.click();
            await page.waitForSelector('[role="listbox"]', { timeout: 5000 });

            // 选择"购物车"选项
            await page.locator('[role="option"]:has-text("购物车")').click();
            logger.info('已选择购物车选项');

            // 输入商品链接
            await page.waitForSelector('input[placeholder="粘贴商品链接"]', { timeout: 5000 });
            const linkInput = page.locator('input[placeholder="粘贴商品链接"]');
            await linkInput.fill(settings.productLink);
            logger.info('已输入商品链接');

            // 点击"添加链接"按钮
            const addButton = page.locator('span:has-text("添加链接")');
            await addButton.click();
            logger.info('已点击添加链接按钮');

            await this.pageOperator.delay(2000);

            // 检查是否有错误提示
            const errorModal = page.locator('text=未搜索到对应商品');
            const errorCount = await errorModal.count();

            if (errorCount > 0) {
                logger.error('商品链接无效');
                const confirmButton = page.locator('button:has-text("确定")');
                await confirmButton.click();
                return false;
            }

            // 填写商品短标题
            await this.handleProductDialog(page, settings.productTitle);

            logger.success('商品链接设置完成');
            return true;

        } catch (error) {
            logger.error('设置商品链接失败:', error);
            return false;
        }
    }

    /**
     * 处理商品编辑弹窗
     */
    async handleProductDialog(page, productTitle) {
        await this.pageOperator.delay(2000);
        await page.waitForSelector('input[placeholder="请输入商品短标题"]', { timeout: 10000 });

        const shortTitleInput = page.locator('input[placeholder="请输入商品短标题"]');
        await shortTitleInput.fill(productTitle.substring(0, 10));

        await this.pageOperator.delay(1000);

        const finishButton = page.locator('button:has-text("完成编辑")');
        const buttonClass = await finishButton.getAttribute('class');

        if (!buttonClass.includes('disabled')) {
            await finishButton.click();
            logger.info('已点击完成编辑按钮');
            await page.waitForSelector('.semi-modal-content', { state: 'hidden', timeout: 5000 });
            return true;
        } else {
            logger.error('完成编辑按钮被禁用');
            const cancelButton = page.locator('button:has-text("取消")');
            await cancelButton.click();
            return false;
        }
    }

    /**
     * 设置封面
     */
    async setThumbnail(page, thumbnailPath) {
        if (!thumbnailPath) return;

        logger.info('开始设置视频封面...');

        try {
            await page.locator('text="选择封面"').click();
            await page.waitForSelector('div.dy-creator-content-modal', { timeout: 5000 });

            await page.locator('text="设置竖封面"').click();
            await this.pageOperator.delay(2000);

            // 上传封面图片
            const uploadInput = page.locator("div[class^='semi-upload upload'] >> input.semi-upload-hidden-input");
            await uploadInput.setInputFiles(thumbnailPath);

            await this.pageOperator.delay(2000);

            // 点击完成按钮
            await page.locator("div#tooltip-container button:visible:has-text('完成')").click();

            // 等待封面设置对话框关闭
            await page.waitForSelector('div.extractFooter', { state: 'detached', timeout: 5000 });

            logger.success('视频封面设置完成');
        } catch (error) {
            logger.error('设置封面失败:', error);
        }
    }

    /**
     * 设置地理位置
     */
    async setLocation(page, location) {
        if (!location) return;

        logger.info('开始设置地理位置...');

        try {
            await page.locator('div.semi-select span:has-text("输入地理位置")').click();
            await page.keyboard.press('Backspace');
            await this.pageOperator.delay(2000);

            await page.keyboard.type(location);
            await page.waitForSelector('div[role="listbox"] [role="option"]', { timeout: 5000 });

            await page.locator('div[role="listbox"] [role="option"]').first().click();

            logger.success('地理位置设置完成');
        } catch (error) {
            logger.error('设置地理位置失败:', error);
        }
    }

    /**
     * 设置第三方平台同步（头条/西瓜）
     */
    async setThirdPartySync(page, settings) {
        if (!settings?.syncToutiao) return;
        try {
            const thirdPartElement = '[class^="info"] > [class^="first-part"] div div.semi-switch';
            const count = await page.locator(thirdPartElement).count();

            if (count > 0) {
                const className = await page.locator(thirdPartElement).getAttribute('class');
                if (!className.includes('semi-switch-checked')) {
                    await page.locator(thirdPartElement).locator('input.semi-switch-native-control').click();
                    logger.info('已启用第三方平台同步');
                }
            }
        } catch (error) {
            logger.debug('第三方平台同步设置跳过');
        }
    }

    /**
     * 设置定时发布
     */
    async setScheduleTime(page, scheduleTime) {
        logger.info('开始设置定时发布...');

        try {
            // 点击定时发布单选框
            const labelElement = page.locator("[class^='radio']:has-text('定时发布')");
            await labelElement.click();
            await this.pageOperator.delay(1000);

            // 格式化时间
            const publishDate = new Date(scheduleTime);
            const formattedTime = publishDate.toISOString().slice(0, 16).replace('T', ' ');

            // 输入时间
            await page.locator('.semi-input[placeholder="日期和时间"]').click();
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

        const publishButton = page.locator('button:has-text("发布")').filter({ hasText: /^发布$/ });
        await publishButton.click();

        logger.info('已点击发布按钮');
    }

    /**
     * 等待发布完成
     */
    async waitForPublishComplete(page) {
        logger.info('等待发布完成...');

        const maxRetries = 60;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                // 检查是否跳转到作品管理页面
                await page.waitForURL('https://creator.douyin.com/creator-micro/content/manage**', { timeout: 1000 });
                logger.success('发布成功，已跳转到作品管理页面');
                return true;
            } catch (error) {
                if (this.pageOperator.isFatalError(error)) throw error;

                // 检查是否需要自动选择封面
                try {
                    await this.handleAutoVideoCover(page);
                } catch (e) {
                    if (this.pageOperator.isFatalError(e)) throw e;
                    // 忽略
                }

                logger.debug(`等待发布完成... (${retryCount + 1}/${maxRetries})`);

                // 截图记录
                if (retryCount % 10 === 0) {
                    try {
                        await page.screenshot({ path: `publishing_${Date.now()}.png`, fullPage: true });
                    } catch (e) {
                        // 忽略截图错误
                    }
                }

                await this.pageOperator.delay(500);
                retryCount++;
            }
        }

        throw new Error('发布超时');
    }

    /**
     * 处理自动选择封面
     */
    async handleAutoVideoCover(page) {
        // 检查是否出现"请设置封面后再发布"提示
        const coverPrompt = page.locator('text=请设置封面后再发布').first();
        const isVisible = await coverPrompt.isVisible().catch(() => false);

        if (isVisible) {
            logger.info('检测到需要设置封面提示，自动选择推荐封面');

            // 选择第一个推荐封面
            const recommendCover = page.locator('[class^="recommendCover-"]').first();
            const count = await recommendCover.count();

            if (count > 0) {
                await recommendCover.click();
                await this.pageOperator.delay(1000);

                // 处理确认弹窗
                const confirmText = 'text=是否确认应用此封面？';
                const confirmVisible = await page.locator(confirmText).first().isVisible().catch(() => false);

                if (confirmVisible) {
                    await page.locator('button:has-text("确定")').click();
                    logger.info('已确认应用封面');
                    await this.pageOperator.delay(1000);
                }

                logger.success('封面选择完成');
                return true;
            }
        }

        return false;
    }
}

// 创建单例实例
const douyinPublisher = new DouyinPublisher();

/**
 * 发布到抖音
 */
export async function publishToDouyin(publishInfo) {
    return await douyinPublisher.publish(publishInfo);
}

export default douyinPublisher;

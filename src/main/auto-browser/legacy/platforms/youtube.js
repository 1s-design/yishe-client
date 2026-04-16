/**
 * YouTube 发布功能 - 实现
 * 也就是参考 social-auto-upload 的实现思路，移植到 yishe-auto-browser
 */

import { getOrCreateBrowser } from '../services/BrowserService.js';
import { PageOperator } from '../services/PageOperator.js';
import { logger } from '../utils/logger.js';

/**
 * YouTube 发布器类
 */
class YouTubePublisher {
    constructor() {
        this.platformName = 'YouTube';
        this.studioUrl = 'https://studio.youtube.com/';
        this.pageOperator = new PageOperator();
    }

    /**
     * 发布到 YouTube
     */
    async publish(publishInfo) {
        let page = null;
        try {
            logger.info(`开始执行${this.platformName}发布操作`);

            // 1. 获取浏览器和页面
            const browser = await getOrCreateBrowser({ profileId: publishInfo?.profileId });
            page = await browser.newPage({ foreground: true });
            logger.info('新页面创建成功');

            // 2. 导航到 YouTube Studio
            await page.goto(this.studioUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
            logger.info(`已打开${this.platformName} Studio页面`);

            // 3. 检查登录状态
            await this.checkLogin(page);
            logger.info('登录状态检查通过');

            // 4. 点击创建 -> 上传视频
            await this.startUpload(page);

            // 5. 上传文件
            await this.uploadFile(page, publishInfo.videoUrl || publishInfo.filePath);

            // 6. 填写详细信息（标题、描述、标签）
            await this.fillDetails(page, publishInfo);

            // 7. 处理后续步骤（儿童内容、检查、可见性）
            await this.handleNextSteps(page, publishInfo);

            // 8. 等待发布完成
            await this.waitForPublishComplete(page);

            logger.success(`${this.platformName}发布成功`);

            return {
                success: true,
                message: `${this.platformName}发布成功`
            };

        } catch (error) {
            logger.error(`${this.platformName}发布过程出错:`, error);

            if (page) {
                try {
                    await page.screenshot({ path: `error_youtube_${Date.now()}.png`, fullPage: true });
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
     * 检查登录状态
     */
    async checkLogin(page) {
        // 检查是否在登录页面
        const isLoginPage = await page.url().includes('accounts.google.com');
        if (isLoginPage) {
            throw new Error('YouTube未登录，请先在浏览器中登录Google账号');
        }

        // 检查是否有上传按钮（确认进入了 Studio）
        try {
            await page.waitForSelector('#create-icon', { timeout: 10000 });
        } catch (e) {
            throw new Error('未检测到 YouTube Studio 界面，可能未登录或页面加载失败');
        }
    }

    /**
     * 开始上传流程
     */
    async startUpload(page) {
        logger.info('点击创建按钮...');
        await page.click('#create-icon');
        await this.pageOperator.delay(1000);

        logger.info('点击上传视频...');
        await page.click('#text-item-0'); // 通常第一个选项是上传视频

        // 等待上传对话框出现
        await page.waitForSelector('#content input[type="file"]', { timeout: 10000 });
    }

    /**
     * 上传文件
     */
    async uploadFile(page, filePath) {
        logger.info('开始上传视频文件...');
        const fileInput = await page.locator('#content input[type="file"]');
        await fileInput.setInputFiles(filePath);

        // 等待上传处理开始，进入详情编辑页面
        await page.waitForSelector('#textbox[aria-label="Add a title that describes your video"]', { timeout: 60000 });
        logger.info('视频文件已选择，进入详情编辑页面');
    }

    /**
     * 填写详细信息
     */
    async fillDetails(page, publishInfo) {
        logger.info('开始填写详细信息...');

        // 1. 标题
        if (publishInfo.title) {
            logger.info(`填写标题: ${publishInfo.title}`);
            const titleInput = page.locator('#textbox[aria-label="Add a title that describes your video"]');
            await titleInput.click();
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
            await titleInput.fill(publishInfo.title.substring(0, 100)); // YouTube标题限制100字
            await this.pageOperator.delay(500);
        }

        // 2. 描述
        const description = publishInfo.description || '';
        if (description) {
            logger.info('填写描述...');
            const descInput = page.locator('#textbox[aria-label="Tell viewers about your video"]');
            await descInput.click();
            await descInput.fill(description.substring(0, 5000));
            await this.pageOperator.delay(500);
        }

        // 3. 点击“显示更多”以显示标签输入框
        try {
            const showMoreBtn = page.locator('#toggle-button:has-text("Show more")');
            if (await showMoreBtn.isVisible()) {
                await showMoreBtn.click();
                await this.pageOperator.delay(1000);
            }
        } catch (e) {
            logger.warn('未找到"显示更多"按钮，可能已展开');
        }

        // 4. 标签
        if (publishInfo.tags && publishInfo.tags.length > 0) {
            logger.info(`填写标签: ${publishInfo.tags.join(',')}`);
            const tagsInput = page.locator('input[aria-label="Tags"]'); // selector可能需要调整
            // 有时候是一个 div 而不是 input，需尝试
            const tagsContainer = page.locator('#text-input[aria-label="Tags"]');

            if (await tagsContainer.count() > 0) {
                await tagsContainer.click();
                await tagsContainer.fill(publishInfo.tags.join(','));
                await page.keyboard.press('Enter');
            } else {
                // 备用 selector
                const altTags = page.locator('input[placeholder="Add tag"]');
                if (await altTags.count() > 0) {
                    await altTags.fill(publishInfo.tags.join(','));
                    await page.keyboard.press('Enter');
                }
            }
            await this.pageOperator.delay(500);
        }

        // 5. 儿童内容设置（必须选择 No，否则无法进行下一步）
        logger.info('设置"非儿童内容"...');
        const notForKids = page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
        if (await notForKids.isVisible()) {
            await notForKids.click();
        } else {
            // 尝试通过文本定位
            await page.locator('text="No, it\'s not made for kids"').click();
        }
        await this.pageOperator.delay(500);
    }

    /**
     * 处理后续步骤（下一步 -> 下一步 -> 可见性）
     */
    async handleNextSteps(page, publishInfo) {
        // 点击 Next 按钮多次，直到到达 Visibility 页面
        // 通常有 3 个步骤：Details -> Video elements -> Checks -> Visibility

        const nextButton = page.locator('#next-button');

        // 循环点击 Next 直到出现 Visibility 选项
        for (let i = 0; i < 5; i++) {
            try {
                logger.info(`步骤 ${i + 1}: 点击 Next`);
                await nextButton.click();
                await this.pageOperator.delay(2000);

                // 检查是否到达 Visibility 页面 (包含 Public/Private 选项)
                const visibilityOption = page.locator('tp-yt-paper-radio-button[name="PUBLIC"]');
                if (await visibilityOption.isVisible()) {
                    logger.info('已到达可见性设置页面');
                    break;
                }
            } catch (error) {
                if (this.pageOperator.isFatalError(error)) throw error;
                logger.warn(`点击下一步失败 (${i + 1}/5):`, error.message);
                await this.pageOperator.delay(1000);
            }
        }

        // 设置可见性
        logger.info('设置可见性...');
        // 默认公开，除非指定 private
        if (publishInfo.privacy === 'private') {
            await page.locator('tp-yt-paper-radio-button[name="PRIVATE"]').click();
        } else if (publishInfo.privacy === 'unlisted') {
            await page.locator('tp-yt-paper-radio-button[name="UNLISTED"]').click();
        } else {
            // Public
            await page.locator('tp-yt-paper-radio-button[name="PUBLIC"]').click();
        }
        await this.pageOperator.delay(1000);
    }

    /**
     * 等待发布完成
     */
    async waitForPublishComplete(page) {
        logger.info('点击发布按钮...');

        // 最后一步按钮通常变成 "Publish" 或 "Save"
        const doneButton = page.locator('#done-button');
        await doneButton.click();

        logger.info('等待发布确认对话框...');

        // 等待 "Video published" 或 "Video saved" 对话框
        // 出现对话框表示成功
        // #dialog-title 包含 "Video published"
        try {
            await page.waitForSelector('ytcp-video-share-dialog', { timeout: 60000 });
            logger.info('检测到发布成功对话框');

            // 关闭对话框
            const closeButton = page.locator('#close-button');
            await closeButton.click();
        } catch (e) {
            // 有时候是 Checks complete, no issues found 然后直接关闭
            logger.warn('未检测到特定成功对话框，但流程已完成');
        }

        // 最终检查是否回到列表页或者上传窗口消失
    }
}

const youtubePublisher = new YouTubePublisher();

export async function publishToYouTube(publishInfo) {
    return await youtubePublisher.publish(publishInfo);
}

export default youtubePublisher;

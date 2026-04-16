import { getOrCreateBrowser } from '../services/BrowserService.js';
import { PageOperator } from '../services/PageOperator.js';
import { logger } from '../utils/logger.js';

/**
 * TikTok 发布器类
 * 实现参考抖音逻辑，适配 TikTok Creator Center
 */
class TiktokPublisher {
    constructor() {
        this.platformName = 'TikTok';
        this.uploadUrl = 'https://www.tiktok.com/tiktokstudio/upload';
        this.pageOperator = new PageOperator();
    }

    /**
     * 发布到 TikTok
     */
    async publish(publishInfo) {
        let page = null;
        try {
            logger.info(`开始执行${this.platformName}发布操作`);

            // 1. 获取浏览器和页面
            const browser = await getOrCreateBrowser({ profileId: publishInfo?.profileId });
            page = await browser.newPage({ foreground: true });
            logger.info('新页面创建成功');

            // 2. 导航到上传页面
            logger.info(`正在导航至: ${this.uploadUrl}`);
            await page.goto(this.uploadUrl, {
                waitUntil: 'load',
                timeout: 60000
            });
            logger.info(`已打开${this.platformName}上传页面`);

            // 3. 检查登录状态
            const isLoggedIn = await this._checkLogin(page);
            if (!isLoggedIn) {
                throw new Error(`${this.platformName}未登录，请先登录`);
            }
            logger.info('登录状态检查通过');

            // 4. 上传视频
            await this._uploadVideo(page, publishInfo.filePath || publishInfo.videoUrl);

            // 5. 填写标题和话题 (TikTok Caption)
            await this._fillCaption(page, publishInfo);

            // 6. 等待视频上传和预处理完成（包含版权检查等）
            await this._waitForUploadComplete(page);

            // 7. 点击发布按钮
            await this._clickPostButton(page);

            // 8. 严格确认发布结果（不再静默失败）
            await this._waitForPostResult(page);

            logger.info(`${this.platformName}发布任务圆满完成`);
            return {
                success: true,
                message: `${this.platformName}发布成功`
            };

        } catch (error) {
            logger.error(`${this.platformName}发布失败:`, error);
            if (page) {
                try {
                    const screenshotPath = `error_tiktok_${Date.now()}.png`;
                    await page.screenshot({ path: screenshotPath, fullPage: true });
                    logger.info(`错误截图已保存至: ${screenshotPath}`);
                } catch (e) {
                    logger.warn('错误截图保存失败');
                }
            }
            return {
                success: false,
                message: error.message || '未知错误'
            };
        } finally {
            if (page) {
                try {
                    await page.close();
                } catch (e) {
                    logger.warn('清理页面失败');
                }
            }
        }
    }

    /**
     * 检查登录状态
     */
    async _checkLogin(page) {
        try {
            // TikTok Studio 如果未登录通常会重定向或显示登录按钮
            const loginSelectors = [
                'text=Log in',
                'text=登录',
                '[data-testid="login-button"]',
                '.login-card'
            ];

            await page.waitForTimeout(3000); // 等待页面稳定

            for (const selector of loginSelectors) {
                if (await page.locator(selector).count() > 0) {
                    return false;
                }
            }

            // 额外检查 URL，如果不在 tiktokstudio 路径下可能也是没登录
            if (!page.url().includes('tiktokstudio')) {
                return false;
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * 上传视频
     */
    async _uploadVideo(page, filePath) {
        logger.info(`开始上传视频文件: ${filePath}`);
        try {
            // 1. 优先定位隐藏的 input (Playwright 可直接操作)
            const inputSelector = 'input[type="file"]';
            const input = page.locator(inputSelector).first();

            // 先等待 input 存在（哪怕是隐藏的）
            await input.waitFor({ state: 'attached', timeout: 15000 });

            // 尝试直接设置文件
            try {
                await input.setInputFiles(filePath);
                logger.info('已成功通过 input 注入视频文件');
                return;
            } catch (e) {
                logger.warn('直接设置 input 失败，由于:', e.message);
            }

            // 2. 备选方案：点击按钮触发
            const buttonSelector = 'button[aria-label="选择视频"], button:has-text("选择视频"), .upload-btn-container button';
            logger.info('尝试点击"选择视频"按钮触发上传...');

            const [fileChooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 20000 }),
                page.click(buttonSelector, { timeout: 10000 })
            ]);
            await fileChooser.setFiles(filePath);
            logger.info('已通过文件选择器选取视频');
        } catch (error) {
            throw new Error(`视频上传启动失败: ${error.message} (请检查页面加载或"选择视频"按钮是否可见)`);
        }
    }

    /**
     * 填写标题和话题
     */
    async _fillCaption(page, publishInfo) {
        logger.info('正在填写标题和话题...');
        try {
            // 组合标题和标签
            const caption = (publishInfo.title || '') + ' ' + (publishInfo.tags || []).map(t => `#${t}`).join(' ');

            // TikTok Studio 的编辑器通常是 Rich Text
            const editorSelector = '[role="textbox"], .public-DraftEditor-content';
            await page.waitForSelector(editorSelector, { timeout: 15000 });
            const editor = page.locator(editorSelector).first();

            await editor.click();
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
            await page.keyboard.type(caption, { delay: 50 });

            logger.info('Caption 填写完成');
        } catch (error) {
            logger.warn(`填写 Caption 失败 (可能需要手动干预): ${error.message}`);
        }
    }

    /**
     * 等待上传完成
     */
    async _waitForUploadComplete(page) {
        logger.info('等待视频上传进度及前置处理...');
        // TikTok Studio 视频上传后会有：1. 上传进度 2. 预处理 (Transcoding) 3. 版权检查 (Copyright Check)

        try {
            // 等待 Post 按钮出现
            const postButton = page.getByRole('button', { name: /Post|发布/i });
            await postButton.waitFor({ state: 'visible', timeout: 45000 });

            // 等待上传完成（按钮从 disabled 变为可用）
            logger.info('监控发布按钮可用性...');
            await page.waitForFunction((btn) => {
                const isBusy = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.innerText.includes('Uploading');
                return !isBusy;
            }, await postButton.elementHandle(), { timeout: 600000 }); // 给10分钟宽容度

            // 检查确认：版权检查是否完成？
            // 如果页面上还有 "Checking..." 文字，再稍微等等
            logger.info('检查视频处理状态 (版权等)...');
            const checkingIndicator = page.locator('text=Checking..., text=正在检查版权...');
            if (await checkingIndicator.count() > 0) {
                logger.info('版权检查中，继续等待...');
                try {
                    await checkingIndicator.waitFor({ state: 'hidden', timeout: 60000 });
                } catch (e) {
                    logger.warn('版权检查较慢或选择器已变，尝试继续流程');
                }
            }

            logger.info('视频状态已就绪 (Ready to Post)');
            await page.waitForTimeout(2000); // 稳妥起见多停2秒
        } catch (error) {
            logger.warn('等待上传处理环节出现异常，尝试强行继续:', error.message);
        }
    }

    /**
     * 点击发布
     */
    async _clickPostButton(page) {
        const postButton = page.getByRole('button', { name: /Post|发布/i });
        await postButton.click();
        logger.info('已点击 Post 按钮');
    }

    /**
     * 等待发布成功提示
     */
    async _waitForPostResult(page) {
        logger.info('确认发布结果反馈...');
        try {
            // 1. 定义多种成功标识，使用 Promise.race 竞争
            const result = await Promise.race([
                // (1) URL 跳转到内容管理页 (更全面的路径匹配)
                page.waitForURL(url =>
                    url.href.includes('/manage/content') ||
                    url.href.includes('/tiktokstudio/content') ||
                    url.href.includes('/tiktokstudio/posts') ||
                    url.href.includes('/creator-center/content') ||
                    url.href.includes('/creator-center/posts'),
                    { timeout: 60000 }
                ).then(() => 'REDIRECT'),

                // (2) 明确的成功文本或模态框 (通过 evaluate 检查，避免无效 CSS 选择器)
                page.waitForFunction(() => {
                    const textPatterns = ['Post success', '发布成功', 'Your video has been uploaded', 'Manage your posts', 'View your video'];
                    const bodyText = document.body.innerText;
                    const hasModal = !!document.querySelector('[data-e2e="upload-success-modal"]');
                    return hasModal || textPatterns.some(p => bodyText.includes(p));
                }, { timeout: 60000 }).then(() => 'SUCCESS_TEXT'),

                // (3) 发布按钮消失也是一种成功的体现 (尤其是在跳转中)
                page.waitForFunction(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    // 查找主发布按钮：通常带有 primary 属性或特定文本
                    const postBtn = buttons.find(b => {
                        const txt = b.innerText || '';
                        return (txt.includes('Post') || txt.includes('发布')) &&
                            (b.classList.contains('arco-btn-primary') || b.offsetParent !== null);
                    });
                    // 如果找不到按钮或者按钮已隐藏，视为可能已成功（进入跳转流程）
                    return !postBtn || postBtn.offsetParent === null;
                }, { timeout: 60000 }).then(() => 'POST_BUTTON_HIDDEN')
            ]);

            logger.info(`检测到发布成功凭据: ${result}`);

            // 如果是文本模态框，可能需要点击一下 "Manage posts" 或关闭
            if (result === 'SUCCESS_TEXT') {
                try {
                    const manageBtn = page.locator('text="Manage your posts", text="管理作品"').first();
                    if (await manageBtn.count() > 0) {
                        await manageBtn.click();
                        logger.info('已点击模态框中的管理按钮');
                    }
                } catch (e) {
                    // 忽略处理成功模态框时的微小异常
                }
            }

            // 停留一会儿，确保状态稳定
            await page.waitForTimeout(3000);
            logger.success(`${this.platformName} 发布流程最终确认成功`);

        } catch (error) {
            // 兜底检查：如果是因为超时，但 URL 已经变了，仍然视为成功
            const currentUrl = page.url();
            if (currentUrl.includes('/content') || currentUrl.includes('/posts')) {
                logger.info(`虽然反馈确认超时，但当前URL [${currentUrl}] 显示已离开上传页，判定为成功`);
                return;
            }

            throw new Error(`发布结果确认异常: ${error.message || '超时'}. 当前页面URL: ${currentUrl}`);
        }
    }
}

export const tiktokPublisher = new TiktokPublisher();

export async function publishToTiktok(publishInfo) {
    return await tiktokPublisher.publish(publishInfo);
}

export default tiktokPublisher;

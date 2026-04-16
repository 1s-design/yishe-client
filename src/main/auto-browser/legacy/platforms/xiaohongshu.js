/**
 * 小红书发布功能 - 独立实现
 */

import {
    getOrCreateBrowser
} from '../services/BrowserService.js';
import {
    ImageManager
} from '../services/ImageManager.js';
import {
    PageOperator
} from '../services/PageOperator.js';
import {
    XiaohongshuLoginChecker
} from '../services/LoginChecker.js';
import {
    PLATFORM_CONFIGS
} from '../config/platforms.js';
import {
    logger
} from '../utils/logger.js';
import {
    xiaohongshuAuth
} from '../utils/xiaohongshuAuth.js';

/**
 * 小红书发布器类
 */
class XiaohongshuPublisher {
    constructor() {
        this.platformName = '小红书';
        this.config = PLATFORM_CONFIGS.xiaohongshu;
        this.imageManager = new ImageManager();
        this.pageOperator = new PageOperator();
        this.loginChecker = new XiaohongshuLoginChecker();
    }

    /**
     * 发布到小红书
     */
    async publish(publishInfo) {
        let page = null;
        try {
            logger.info(`开始执行${this.platformName}发布操作，参数:`, publishInfo);

            // 基本参数规范化：保证 images 为数组，title/content/tags 为字符串或数组
            publishInfo = publishInfo || {};

            // 规范 images 字段：支持字符串（逗号分隔）或数组
            if (publishInfo.images && !Array.isArray(publishInfo.images)) {
                if (typeof publishInfo.images === 'string') {
                    publishInfo.images = publishInfo.images.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
                } else if (typeof publishInfo.images === 'object') {
                    publishInfo.images = Object.values(publishInfo.images).map(String).filter(Boolean);
                } else {
                    publishInfo.images = [];
                }
            } else {
                publishInfo.images = publishInfo.images || [];
            }

            // 规范 title 与 content
            publishInfo.title = (publishInfo.title || publishInfo.description || publishInfo.content || '').toString();
            publishInfo.content = (publishInfo.content || publishInfo.description || '').toString();

            // 规范 tags：支持字符串（以空格或逗号分隔，或带#）或数组
            if (publishInfo.tags && !Array.isArray(publishInfo.tags)) {
                if (typeof publishInfo.tags === 'string') {
                    publishInfo.tags = publishInfo.tags.split(/[,，\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
                } else {
                    publishInfo.tags = [];
                }
            } else {
                publishInfo.tags = publishInfo.tags || [];
            }

            // 小红书此处仅支持图文发布，忽略视频相关字段并给出警告日志
            if ((publishInfo.videos && publishInfo.videos.length > 0) || publishInfo.filePath) {
                logger.warn('小红书发布当前只支持图文，已忽略视频相关字段 (videos/filePath)');
                delete publishInfo.videos;
                delete publishInfo.filePath;
            }

            // 1. 获取浏览器和页面
            const browser = await getOrCreateBrowser({ profileId: publishInfo?.profileId });
            page = await browser.newPage({ foreground: true });
            logger.info('新页面创建成功');

            // 2. 应用反检测（如果需要）
            if (this.config.antiDetection) {
                await this.pageOperator.setupAntiDetection(page);
                logger.info('反检测脚本已应用');
            }

            // 2.5. 应用小红书真实认证
            const authSuccess = await xiaohongshuAuth.applyAuth(page);
            if (!authSuccess) {
                return {
                    success: false,
                    message: '小红书认证设置失败',
                    data: {
                        error: '认证失败'
                    }
                };
            }
            logger.info('小红书认证已应用');

            // 3. 导航到发布页面
            await page.goto(this.config.uploadUrl, {
                waitUntil: this.config.waitUntil || 'domcontentloaded',
                timeout: this.config.timeout || 30000
            });
            logger.info(`已打开${this.platformName}发布页面`);

            // 4. 检查登录状态
            if (this.config.checkLogin) {
                const loginResult = await this.checkLoginStatus(page);
                if (!loginResult.isLoggedIn) {
                    return {
                        success: false,
                        message: `${this.platformName}未登录: ${loginResult.details?.reason || '未知原因'}`,
                        data: {
                            loginStatus: loginResult
                        }
                    };
                }
                logger.info(`${this.platformName}已登录，继续发布流程`);
            }

            // 5. 执行平台特定的预处理 (如果是视频任务且当前在图片页，则需要跳转)
            const isVideoTask = !!(publishInfo.filePath || (publishInfo.videos && publishInfo.videos.length > 0));
            const targetType = isVideoTask ? 'video' : 'image';
            const currentUrl = page.url();

            if (!currentUrl.includes(`target=${targetType}`)) {
                logger.info(`切换到${targetType === 'video' ? '视频' : '图片'}发布模式`);
                try {
                    // 基于配置的 uploadUrl 构造目标 URL，保留原有 query 并覆盖 target
                    const configUrl = this.config.uploadUrl || 'https://creator.xiaohongshu.com/publish/publish?target=' + targetType;
                    const [base, rawQuery] = configUrl.split('?');
                    const params = new URLSearchParams(rawQuery || '');
                    params.set('target', targetType);
                    const newUrl = `${base}?${params.toString()}`;
                    await page.goto(newUrl, { waitUntil: this.config.waitUntil || 'networkidle', timeout: this.config.timeout || 30000 });
                } catch (e) {
                    // 退回到默认行为
                    const newUrl = `https://creator.xiaohongshu.com/publish/publish?target=${targetType}`;
                    await page.goto(newUrl, { waitUntil: 'networkidle', timeout: 30000 });
                }
                await this.pageOperator.delay(2000);
            }

            // 6. 处理视频或图片上传
            if (isVideoTask) {
                const videoPath = publishInfo.filePath || (publishInfo.videos && publishInfo.videos[0]);
                await this.handleVideoUpload(page, videoPath);
            } else if (publishInfo.images && publishInfo.images.length > 0) {
                await this.handleImageUpload(page, publishInfo.images);
            } else {
                throw new Error('发布小红书缺少图片或视频资源');
            }

            // 7. 填写标题、正文和话题
            await this.fillContent(page, publishInfo);

            // 8. 执行平台特定的后处理
            if (this.config.postProcess) {
                await this.config.postProcess(page);
            }

            // 9. 点击发布按钮
            await this.clickPublishButton(page);

            // 10. 等待发布完成
            await this.waitForPublishComplete(page);

            return {
                success: true,
                message: `${this.platformName}发布成功`
            };

        } catch (error) {
            logger.error(`${this.platformName}发布过程出错:`, error);
            return {
                success: false,
                message: error ? error.message : '未知错误',
                data: error
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
     * 处理视频上传
     */
    async handleVideoUpload(page, videoPath) {
        logger.info(`开始上传视频: ${videoPath}`);

        // 如果是远程路径，先下载
        let actualPath = videoPath;
        if (typeof videoPath === 'string' && videoPath.startsWith('http')) {
            actualPath = await this.imageManager.downloadImage(videoPath, `xhs_video_${Date.now()}`);
        }

        try {
            // 等待上传按钮或直接定位 input
            const inputSelector = 'input[type="file"][accept*="video"]';
            const fileInput = page.locator(inputSelector).first();

            await fileInput.waitFor({ state: 'attached', timeout: 10000 });
            await fileInput.setInputFiles(actualPath);
            logger.info('视频文件已选择，等待上传及处理...');

            // 等待上传进度消失或出现完成标识
            // 小红书视频上传后会出现转码、版权检查等
            await page.waitForSelector('.video-upload-success, .video-preview, .upload-success', { timeout: 300000 }).catch(() => {
                logger.warn('等待视频上传完成超时，尝试继续');
            });

            await this.pageOperator.delay(3000);
        } catch (error) {
            logger.error('视频上传失败:', error);
            throw error;
        }
    }

    /**
     * 处理图片上传
     */
    async handleImageUpload(page, images) {
        logger.info(`开始上传 ${images.length} 张图片...`);

        // 等待页面完全加载
        await this.pageOperator.delay(3000);

        // 滚动到页面顶部，确保上传区域可见
        await page.evaluate(() => window.scrollTo(0, 0));
        await this.pageOperator.delay(1000);

        // 检查页面是否已进入图片上传状态
        const currentUrl = page.url();
        logger.info(`当前页面URL: ${currentUrl}`);

        const uploadResults = [];

        for (let i = 0; i < images.length; i++) {
            const imageUrl = images[i];
            let retryCount = 0;
            const maxRetries = 5; // 增加到5次重试
            let uploadSuccess = false;

            while (retryCount < maxRetries && !uploadSuccess) {
                let tempPath = null;
                try {
                    logger.info(`正在上传第 ${i + 1}/${images.length} 张图片: ${imageUrl} (尝试 ${retryCount + 1}/${maxRetries})`);

                    // 下载图片到临时目录
                    tempPath = await this.imageManager.downloadImage(imageUrl, `${this.platformName}_${Date.now()}_${i}`);

                    // 检查图片大小
                    const fs = await import('fs');
                    const stats = fs.statSync(tempPath);
                    const fileSizeInMB = stats.size / (1024 * 1024);
                    logger.info(`图片大小: ${fileSizeInMB.toFixed(2)} MB`);

                    if (fileSizeInMB > 20) {
                        logger.warn('图片过大，可能导致上传失败');
                    }

                    // 上传图片
                    await this.uploadSingleImage(page, tempPath, i);

                    uploadSuccess = true;
                    uploadResults.push({
                        index: i,
                        success: true,
                        url: imageUrl
                    });
                    logger.info(`第 ${i + 1} 张图片上传成功`);

                } catch (error) {
                    retryCount++;
                    logger.error(`处理图片 ${imageUrl} 时出错 (尝试 ${retryCount}/${maxRetries}):`, error.message);

                    // 清理临时文件
                    if (tempPath) {
                        try {
                            this.imageManager.deleteTempFile(tempPath);
                        } catch (e) {
                            logger.warn('清理临时文件失败:', e.message);
                        }
                    }

                    if (retryCount >= maxRetries) {
                        logger.error(`图片 ${imageUrl} 上传失败，已达到最大重试次数`);
                        uploadResults.push({
                            index: i,
                            success: false,
                            url: imageUrl,
                            error: error.message
                        });
                        // 不要抛出错误，继续上传其他图片
                        logger.warn(`跳过第 ${i + 1} 张图片，继续上传其他图片`);
                        break;
                    } else {
                        const waitTime = Math.min(retryCount * 2, 10); // 最长等待10秒
                        logger.info(`等待 ${waitTime} 秒后重试...`);
                        await this.pageOperator.delay(waitTime * 1000);

                        // 刷新页面到上传页面
                        try {
                            await page.goto(currentUrl, {
                                waitUntil: 'domcontentloaded',
                                timeout: 30000
                            });
                            await this.pageOperator.delay(2000);
                        } catch (refreshError) {
                            logger.warn('刷新页面失败，继续尝试:', refreshError.message);
                        }
                    }
                }
            }

            // 图片间间隔，让服务器有时间处理
            if (i < images.length - 1) {
                await this.pageOperator.delay(3000); // 增加到3秒
            }
        }

        // 检查上传结果
        const successCount = uploadResults.filter(r => r.success).length;
        const failCount = uploadResults.filter(r => !r.success).length;

        logger.info(`图片上传完成统计: 成功 ${successCount}/${images.length}，失败 ${failCount}/${images.length}`);

        if (failCount > 0) {
            logger.warn('部分图片上传失败:');
            uploadResults.filter(r => !r.success).forEach(r => {
                logger.warn(`  图片 ${r.index + 1}: ${r.error || '未知错误'}`);
            });
        }

        if (successCount === 0) {
            throw new Error('所有图片上传失败');
        }

        if (failCount > 0 && successCount > 0) {
            logger.warn(`${failCount} 张图片上传失败，但有 ${successCount} 张图片上传成功，继续发布流程`);
        }
    }

    /**
     * 上传单张图片
     */
    async uploadSingleImage(page, tempPath, imageIndex) {
        try {
            // 等待页面加载完成
            await this.pageOperator.delay(2000);

            // 滚动到页面顶部，确保上传区域可见
            await page.evaluate(() => window.scrollTo(0, 0));
            await this.pageOperator.delay(1000);

            // 查找文件输入框，尝试多种选择器
            const fileInputSelectors = [
                'input[type="file"]',
                'input[accept*="image"]',
                '.upload input[type="file"]',
                '.file-upload input[type="file"]',
                '[data-testid="file-input"]',
                '.upload-area input',
                '.drag-upload input'
            ];

            let fileInput = null;
            for (const selector of fileInputSelectors) {
                try {
                    const elements = await page.$$(selector);
                    if (elements && elements.length > 0) {
                        // If there are multiple, prioritize visible ones
                        for (let element of elements) {
                            const isVisible = await element.evaluate(el => {
                                return el.offsetParent !== null;
                            });
                            if (isVisible) {
                                fileInput = element;
                                logger.info(`找到可见的文件输入框: ${selector}`);
                                break;
                            }
                        }
                        if (!fileInput && elements.length > 0) {
                            fileInput = elements[0];
                            logger.info(`找到文件输入框: ${selector} (使用第一个)`);
                        }
                        if (fileInput) break;
                    }
                } catch (error) {
                    logger.debug(`选择器 ${selector} 未找到文件输入框: ${error.message}`);
                }
            }

            if (!fileInput) {
                // If file input not found, try clicking upload area
                logger.info('尝试点击上传区域');
                const uploadAreaSelectors = [
                    '.upload-area',
                    '.drag-upload',
                    '.upload-btn',
                    '.add-image',
                    '[data-testid="upload-area"]',
                    '.upload-zone',
                    '.reds-btn',
                    'button[type="button"]'
                ];

                for (const selector of uploadAreaSelectors) {
                    try {
                        const elements = await page.$$(selector);
                        for (let uploadArea of elements) {
                            try {
                                const text = await uploadArea.evaluate(el => el.textContent || el.innerText);
                                // Check if it's an upload button
                                if (text && (text.includes('上传') || text.includes('选择') || text.includes('添加'))) {
                                    logger.info(`点击上传按钮: ${selector}, 文本: ${text}`);
                                    await uploadArea.click({
                                        delay: 100
                                    });
                                    await this.pageOperator.delay(1500);

                                    // Try finding file input again
                                    const inputs = await page.$$('input[type="file"]');
                                    if (inputs && inputs.length > 0) {
                                        fileInput = inputs[inputs.length - 1]; // Use the last one (usually the newly appeared one)
                                        logger.info('找到文件输入框');
                                        break;
                                    }
                                }
                            } catch (e) {
                                logger.debug(`检查元素失败: ${e.message}`);
                            }
                        }
                        if (fileInput) break;
                    } catch (error) {
                        logger.debug(`上传区域 ${selector} 点击失败: ${error.message}`);
                    }
                }
            }

            if (!fileInput) {
                throw new Error('未找到文件选择器，请检查页面是否已加载完成');
            }

            // Upload file
            logger.info(`开始上传文件: ${tempPath}`);
            // Playwright: setInputFiles replaces Puppeteer's uploadFile
            await fileInput.setInputFiles(tempPath);
            logger.info(`文件已选择，等待上传...`);

            // Wait for image upload to complete
            await this.waitForImageUploadComplete(page, imageIndex);

        } catch (error) {
            logger.error(`上传图片 ${imageIndex + 1} 失败:`, error);
            throw error;
        }
    }

    /**
     * 等待图片上传完成
     */
    async waitForImageUploadComplete(page, imageIndex) {
        try {
            // Wait for image upload to complete, check for various possible completion states
            const uploadCompleteSelectors = [
                '.upload-success',
                '.image-preview',
                '.uploaded-image',
                '.image-item',
                '[data-testid="upload-success"]',
                '.upload-complete',
                '.reds-uploader__img',
                '.uploader-img'
            ];

            let uploadComplete = false;
            const maxWaitTime = 20000; // Increased to 20 seconds timeout
            const startTime = Date.now();
            let lastLoadingState = false;

            while (!uploadComplete && (Date.now() - startTime) < maxWaitTime) {
                // Check completion status
                for (const selector of uploadCompleteSelectors) {
                    try {
                        const elements = await page.$$(selector);
                        if (elements && elements.length > imageIndex + 1) {
                            logger.info(`图片上传完成，检测到 ${elements.length} 个已上传图片`);
                            uploadComplete = true;
                            break;
                        }
                    } catch (error) {
                        if (this.pageOperator.isFatalError(error)) throw error;
                        // Continue checking other selectors
                    }
                }

                if (!uploadComplete) {
                    // Check if there's still a loading state
                    const loadingSelectors = [
                        '.upload-loading',
                        '.loading',
                        '.spinner',
                        '[data-testid="loading"]',
                        '.reds-uploader__progress'
                    ];

                    let hasLoading = false;
                    for (const selector of loadingSelectors) {
                        try {
                            const loading = await page.$(selector);
                            if (loading) {
                                const isVisible = await loading.evaluate(el => {
                                    const style = window.getComputedStyle(el);
                                    return style.display !== 'none' && style.visibility !== 'hidden';
                                });
                                if (isVisible) {
                                    hasLoading = true;
                                    lastLoadingState = true;
                                    break;
                                }
                            }
                        } catch (error) {
                            if (this.pageOperator.isFatalError(error)) throw error;
                            // Continue checking
                        }
                    }

                    // If there was a loading state before and now it's gone, assume upload is complete
                    if (lastLoadingState && !hasLoading) {
                        logger.info('检测到loading状态消失，上传可能已完成');
                        uploadComplete = true;
                        break;
                    }

                    if (!hasLoading && (Date.now() - startTime) > 3000) {
                        // After 3 seconds, if no loading state, assume complete
                        uploadComplete = true;
                        logger.info('未检测到loading状态，假设上传完成');
                        break;
                    }

                    await this.pageOperator.delay(500);
                }
            }

            if (!uploadComplete) {
                logger.warn(`图片 ${imageIndex + 1} 上传超时，但继续执行`);
            } else {
                logger.info(`图片 ${imageIndex + 1} 上传完成确认`);
            }

            // Additional wait to ensure page stability
            await this.pageOperator.delay(1500);

        } catch (error) {
            if (this.pageOperator.isFatalError(error)) throw error;
            logger.warn(`等待图片上传完成时出错: ${error.message}`);
            // Continue execution even if error occurs
        }
    }

    /**
     * 填写内容
     */
    async fillContent(page, publishInfo) {
        // 1. 填写标题
        const title = publishInfo.title || publishInfo.description || '';
        if (title) {
            await this.pageOperator.fillInput(page, this.config.selectors.titleInput, title.substring(0, 20), {
                delay: 100
            });
            logger.info('已填写标题');
        }

        // 2. 填写正文内容 (小红书支持正文最后加话题)
        let content = publishInfo.content || publishInfo.description || '';

        // 附加话题
        if (publishInfo.tags && publishInfo.tags.length > 0) {
            const tagsStr = publishInfo.tags.map(t => `#${t}`).join(' ');
            content += '\n\n' + tagsStr;
        }

        if (content) {
            // 小红书编辑器有时是 ProseMirror，使用 pageOperator.fillInput 或 keyboard.type
            const editorSelector = this.config.selectors.contentInput;
            const editor = page.locator(editorSelector).first();
            await editor.click();
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
            await page.keyboard.type(content, { delay: 30 });
            logger.info('已填写正文内容（含话题）');
        }

        // 等待内容填写完成
        await this.pageOperator.delay(2000);
    }

    /**
     * 点击发布按钮
     */
    async clickPublishButton(page) {
        // 等待页面稳定
        await this.pageOperator.delay(2000);

        // 先点击页面空白处，让输入框失去焦点
        logger.info('点击页面空白处，让输入框失去焦点');
        await page.evaluate(() => {
            document.body.click();
        });

        await this.pageOperator.delay(500);

        // 尝试多种方式点击发布按钮
        try {
            // 方式1: 使用JavaScript直接点击
            logger.info('尝试方式1: 使用JavaScript点击');
            const clickResult = await page.evaluate(() => {
                // 查找所有可能的发布按钮
                const buttons = document.querySelectorAll('button');
                for (let button of buttons) {
                    const text = button.textContent || button.innerText;
                    if (text && (text.includes('发布') || text.includes('Post'))) {
                        console.log(`找到发布按钮: ${text}`);
                        button.click();
                        return true;
                    }
                }

                // 尝试使用常见的发布按钮选择器
                const selectors = [
                    '.submit button',
                    '.publish-btn',
                    '[data-testid="publish-btn"]',
                    'button[type="button"]'
                ];

                for (const selector of selectors) {
                    const button = document.querySelector(selector);
                    if (button) {
                        button.click();
                        return true;
                    }
                }

                return false;
            });

            if (clickResult) {
                logger.info('成功点击发布按钮');
            } else {
                logger.error('未找到发布按钮');
                throw new Error('未找到发布按钮');
            }

        } catch (error) {
            logger.error('点击发布按钮失败:', error.message);
            throw error;
        }

        logger.info('已点击发布按钮');
    }

    /**
     * 等待发布完成
     */
    async waitForPublishComplete(page) {
        logger.info('等待发布结果反馈...');
        try {
            await Promise.race([
                // (1) 等待跳转回内容管理页
                page.waitForURL(url => url.href.includes('/publish/manage'), { timeout: 45000 }),
                // (2) 等待成功提示出现
                page.waitForSelector('text=发布成功, text=Post success, .success-tip', { timeout: 45000 })
            ]);
            logger.info('检测到发布成功标识');
        } catch (error) {
            logger.warn('等待发布确认超时或失败，尝试检查当前URL:', page.url());
            if (page.url().includes('/publish/manage')) {
                logger.info('当前已在管理页，判定为发布成功');
            } else {
                throw new Error('未检测到发布成功标识，请手动检查');
            }
        }
    }

    /**
     * 检查登录状态
     */
    async checkLoginStatus(page) {
        return await this.loginChecker.checkLoginStatus(page);
    }
}

// 创建单例实例
const xiaohongshuPublisher = new XiaohongshuPublisher();

/**
 * 发布到小红书
 */
export async function publishToXiaohongshu(publishInfo) {
    return await xiaohongshuPublisher.publish(publishInfo);
}

/**
 * 专门检测小红书登录状态的方法（保持向后兼容）
 */
export async function checkXiaohongshuLoginStatus(page) {
    const xiaohongshuChecker = new XiaohongshuLoginChecker();
    return await xiaohongshuChecker.checkLoginStatus(page);
}

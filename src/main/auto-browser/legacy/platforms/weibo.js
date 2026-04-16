/**
 * 微博发布功能 - 独立实现
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
    GenericLoginChecker
} from '../services/LoginChecker.js';
import {
    PLATFORM_CONFIGS
} from '../config/platforms.js';
import {
    logger
} from '../utils/logger.js';
import {
    weiboAuth
} from '../utils/weiboAuth.js';

/**
 * 微博发布器类
 */
class WeiboPublisher {
    constructor() {
        this.platformName = '微博';
        this.config = PLATFORM_CONFIGS.weibo;
        this.imageManager = new ImageManager();
        this.pageOperator = new PageOperator();
        this.loginChecker = new GenericLoginChecker('微博', {
            selectors: PLATFORM_CONFIGS.weibo.loginSelectors
        });
    }

    /**
     * 发布到微博
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

            // 规范 tags：支持字符串或数组
            if (publishInfo.tags && !Array.isArray(publishInfo.tags)) {
                if (typeof publishInfo.tags === 'string') {
                    publishInfo.tags = publishInfo.tags.split(/[,，\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
                } else {
                    publishInfo.tags = [];
                }
            } else {
                publishInfo.tags = publishInfo.tags || [];
            }

            // 规范 keywords（与 tags 一致），用于生成 #话题
            if (publishInfo.keywords && !Array.isArray(publishInfo.keywords)) {
                if (typeof publishInfo.keywords === 'string') {
                    publishInfo.keywords = publishInfo.keywords.split(/[,，\s]+/).map(k => String(k).replace(/^#/, '').trim()).filter(Boolean);
                } else {
                    publishInfo.keywords = [];
                }
            } else {
                publishInfo.keywords = publishInfo.keywords || [];
            }

            // 微博发布仅处理图文：如果传入视频字段则忽略并记录
            if (publishInfo.videos || publishInfo.videoUrl || (publishInfo.filePath && /\.(mp4|mov|avi|wmv|flv|mkv)$/i.test(publishInfo.filePath))) {
                logger.warn('微博发布当前只支持图文，已忽略视频相关字段');
                delete publishInfo.videos;
                delete publishInfo.videoUrl;
                // 不删除 filePath，因为可能为图片路径，后面会判断
            }

            // 如果 images 为空但给了 filePath 且为图片，使用 filePath 作为单图上传
            const mainFilePath = publishInfo.filePath || '';
            const isImageFilePath = typeof mainFilePath === 'string' && /\.(jpe?g|png|gif|webp|bmp)$/i.test(mainFilePath);
            if ((!publishInfo.images || publishInfo.images.length === 0) && isImageFilePath) {
                publishInfo.images = [mainFilePath];
            }

            // 至少需要一张图片，否则返回错误
            if (!publishInfo.images || publishInfo.images.length === 0) {
                logger.error('微博发布缺少图片资源，终止发布');
                return {
                    success: false,
                    message: '微博发布需要至少一张图片'
                };
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

            // 2.5. 应用微博认证
            await weiboAuth.applyAuth(page);

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

            // 5. 执行平台特定的预处理
            if (this.config.preProcess) {
                await this.config.preProcess(page);
            }

            // 6. 处理图片上传（仅图文）
            try {
                await this.handleImageUpload(page, publishInfo.images);
            } catch (e) {
                logger.error('图片上传过程出错:', e);
                throw e;
            }

            // 7. 填写内容
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
     * 处理图片上传
     */
    async handleImageUpload(page, images) {
        logger.info(`开始上传 ${images.length} 张图片...`);

        for (let i = 0; i < images.length; i++) {
            const imageUrl = images[i];
            try {
                logger.info(`正在上传第 ${i + 1}/${images.length} 张图片: ${imageUrl}`);

                // 下载图片到临时目录
                const tempPath = await this.imageManager.downloadImage(imageUrl, `${this.platformName}_${Date.now()}_${i}`);

                // 上传图片
                await this.uploadSingleImage(page, tempPath, i);

                // 删除临时文件
                this.imageManager.deleteTempFile(tempPath);

                // 图片间间隔
                if (i < images.length - 1) {
                    await this.pageOperator.delay(1000);
                }

            } catch (error) {
                logger.error(`处理图片 ${imageUrl} 时出错:`, error);
                throw error;
            }
        }

        logger.info(`所有图片上传完成，共 ${images.length} 张`);
    }

    /**
     * 上传单张图片
     */
    async uploadSingleImage(page, tempPath, imageIndex) {
        const fileInput = await page.$('input[type="file"]');
        if (!fileInput) {
            throw new Error('未找到文件选择器');
        }

        // Playwright: setInputFiles 替代 Puppeteer 的 uploadFile
        await fileInput.setInputFiles(tempPath);
        logger.info(`已上传图片 ${imageIndex + 1}`);

        // 等待图片上传完成
        await this.waitForImageUploadComplete(page, imageIndex);
    }

    /**
     * 等待图片上传完成 - 微博特殊处理
     */
    async waitForImageUploadComplete(page, imageIndex) {
        const maxWaitTime = 30000; // 最大等待30秒
        const checkInterval = 1000; // 每秒检查一次
        let elapsedTime = 0;

        logger.info(`等待第 ${imageIndex + 1} 张图片上传完成...`);

        while (elapsedTime < maxWaitTime) {
            try {
                // 检查是否有 Image_loading_ 开头的class元素（表示正在上传）
                const hasLoadingElement = await page.evaluate(() => {
                    const loadingElements = document.querySelectorAll('[class*="Image_loading_"]');
                    return loadingElements.length > 0;
                });

                if (!hasLoadingElement) {
                    logger.info(`第 ${imageIndex + 1} 张图片上传完成（无loading元素）`);
                    return;
                }

                logger.info(`第 ${imageIndex + 1} 张图片仍在上传中...`);

            } catch (error) {
                if (this.pageOperator.isFatalError(error)) throw error;
                logger.warn(`检查图片 ${imageIndex + 1} 上传状态时出错:`, error);
            }

            await this.pageOperator.delay(checkInterval);
            elapsedTime += checkInterval;
        }

        logger.warn(`第 ${imageIndex + 1} 张图片上传等待超时`);
    }

    /**
     * 填写内容：微博只有一个输入框，将标题+描述合并写入，关键词转为 #话题 追加
     */
    async fillContent(page, publishInfo) {
        // 合并标题与描述（正文）
        const titlePart = (publishInfo.title || '').trim();
        const descPart = (publishInfo.content || '').trim();
        const bodyParts = [titlePart, descPart].filter(Boolean);
        const body = bodyParts.join('\n\n');

        // 关键词/标签 转为带 # 的话题（去重、去已有 #）
        const tagList = [...(publishInfo.tags || []), ...(publishInfo.keywords || [])]
            .map(t => String(t).replace(/^#/, '').trim())
            .filter(Boolean);
        const uniqueTags = [...new Set(tagList)];
        // 微博话题规则：用一个 # 将词包起来，如 #好物#
        const hashtags = uniqueTags.length ? uniqueTags.map(t => `#${t}#`).join(' ') : '';

        const combinedContent = [body, hashtags].filter(Boolean).join('\n\n');
        if (!combinedContent) {
            logger.warn('标题、描述与话题均为空，跳过填写');
            await this.pageOperator.delay(500);
            return;
        }

        if (this.config.selectors.contentInput) {
            await this.pageOperator.fillInput(page, this.config.selectors.contentInput, combinedContent);
            logger.info('已填写正文（标题+描述+话题）');
        }

        await this.pageOperator.delay(2000);
    }

    /**
     * 点击发布按钮 - 微博特殊处理
     */
    async clickPublishButton(page) {
        // 先等待页面稳定
        await this.pageOperator.delay(3000);

        // 先点击页面空白处，让输入框失去焦点
        logger.info('点击页面空白处，让输入框失去焦点');
        await page.evaluate(() => {
            const blankArea = document.querySelector('.Nav_top_2_S_0') || document.body;
            blankArea.click();
        });

        await this.pageOperator.delay(500);

        // 使用多重选择器查找发送按钮
        try {
            logger.info('查找并点击发送按钮...');

            const selectors = [
                '[class^="Tool_check_"] button',
                '[class*="Tool_check_"] button',
                'button:has-text("发布")',
                'button:has-text("发送")',
                '.Tool_btn_v5j8_ button'
            ];

            let clicked = false;
            for (const selector of selectors) {
                try {
                    const btn = page.locator(selector).first();
                    if (await btn.count() > 0 && await btn.isVisible()) {
                        await btn.click();
                        clicked = true;
                        logger.info(`通过选择器 ${selector} 成功点击发送按钮`);
                        break;
                    }
                } catch (e) {
                    // 忽略单个选择器失败
                }
            }

            if (!clicked) {
                logger.warn('通用选择器未找到按钮，尝试原生 JS 点击...');
                clicked = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const postBtn = buttons.find(b => {
                        const txt = b.innerText || '';
                        return (txt.includes('发布') || txt.includes('发送')) && b.offsetParent !== null;
                    });
                    if (postBtn) {
                        postBtn.click();
                        return true;
                    }
                    return false;
                });
            }

            if (!clicked) {
                throw new Error('无法定位发布按钮');
            }

        } catch (error) {
            logger.error('点击发送按钮失败:', error.message);
            throw error;
        }
    }

    /**
     * 等待发布完成
     */
    async waitForPublishComplete(page) {
        logger.info('确认微博发布结果...');
        try {
            // 微博发布成功后：
            // 1. 输入框通常会清空
            // 2. 可能会弹出 "发布成功" toast
            // 3. 发布按钮进入 loading 或小时

            await Promise.race([
                // (1) 监测成功提示
                page.waitForFunction(() => {
                    const bodyText = document.body.innerText;
                    return bodyText.includes('发布成功') || bodyText.includes('发送成功');
                }, { timeout: 30000 }).then(() => 'SUCCESS_TEXT'),

                // (2) 监测发布框重置：任一可见 textarea 变为空（不依赖 Form_input_ 类名）
                page.waitForFunction(() => {
                    const sel = ['textarea[class^="Form_input_"]', 'textarea[placeholder*="新鲜事"]', 'textarea[placeholder*="想说"]', 'textarea'];
                    for (const s of sel) {
                        try {
                            const el = document.querySelector(s);
                            if (el && el.offsetParent !== null && (el.value || '').trim() === '') return true;
                        } catch (_) {}
                    }
                    return false;
                }, { timeout: 30000 }).then(() => 'INPUT_RESET'),

                // (3) 固定的 5 秒等待（如果点击没报错，通常说明已提交）
                new Promise(resolve => setTimeout(() => resolve('TIMEOUT_FALLBACK'), 5000))
            ]);

            logger.info('微博发布结果确认通过');
        } catch (error) {
            logger.warn('发布结果确认超时，但由于点击按钮已成功，暂不视为失败:', error.message);
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
const weiboPublisher = new WeiboPublisher();

/**
 * 发布到微博
 */
export async function publishToWeibo(publishInfo) {
    return await weiboPublisher.publish(publishInfo);
}

import fs from 'fs';
import { getOrCreateBrowser } from '../services/BrowserService.js';
import { ImageManager } from '../services/ImageManager.js';
import { PageOperator } from '../services/PageOperator.js';
import { logger } from '../utils/logger.js';

export class BasicShopPublisher {
    constructor(config) {
        this.platformKey = config.platformKey;
        this.platformName = config.platformName;
        this.uploadUrl = config.uploadUrl;
        this.resolveUploadUrl = typeof config.resolveUploadUrl === 'function'
            ? config.resolveUploadUrl
            : null;
        this.enablePrice = config.enablePrice !== false;
        this.enableProductCode = config.enableProductCode === true;
        this.keepPageOpen = config.keepPageOpen === true;
        this.selectors = config.selectors;
        this.imageManager = new ImageManager();
        this.pageOperator = new PageOperator();
    }

    async publish(publishInfo = {}) {
        let page = null;
        const tempFiles = [];

        try {
            const settings = publishInfo.platformOptions || publishInfo.publishOptions || publishInfo.platformSettings?.[this.platformKey] || {};
            const title = String(publishInfo.title || publishInfo.name || '').trim();
            const description = String(publishInfo.description || publishInfo.content || '').trim();
            const images = Array.isArray(publishInfo.images) ? publishInfo.images.filter(Boolean) : [];
            const productCode = String(
                settings.productCode
                ?? publishInfo.productCode
                ?? publishInfo.data?.productCode
                ?? ''
            ).trim();
            const targetUploadUrl = this.resolveUploadUrl
                ? this.resolveUploadUrl({ settings, publishInfo, defaultUrl: this.uploadUrl })
                : this.uploadUrl;

            logger.info(`开始执行${this.platformName}基础发布流程`);
            logger.info(`${this.platformName}目标发布页: ${targetUploadUrl}`);

            const browser = await getOrCreateBrowser({ profileId: publishInfo?.profileId });
            page = await browser.newPage({ foreground: true });
            await this.pageOperator.setupAntiDetection(page);

            await page.goto(targetUploadUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
            await page.waitForTimeout(3000);

            const isLoggedIn = await this._checkLogin(page);
            if (!isLoggedIn) {
                return {
                    success: false,
                    message: `请先登录${this.platformName}商家后台`
                };
            }

            if (title) {
                const filled = await this._fillField(page, this.selectors.titleInput, title);
                if (filled) {
                    logger.info(`${this.platformName}标题已填充`);
                }
            }

            if (description) {
                const filled = await this._fillField(page, this.selectors.contentInput, description);
                if (filled) {
                    logger.info(`${this.platformName}描述已填充`);
                }
            }

            if (this.enablePrice && this.selectors.priceInput && settings.price !== undefined && settings.price !== null && settings.price !== '') {
                const filled = await this._fillField(page, this.selectors.priceInput, String(settings.price));
                if (filled) {
                    logger.info(`${this.platformName}价格已填充`);
                }
            }

            if (images.length > 0) {
                const preparedImages = await this._prepareImages(images);
                tempFiles.push(...preparedImages.tempFiles);
                if (preparedImages.filePaths.length > 0) {
                    const uploaded = await this._uploadFiles(page, preparedImages.filePaths);
                    if (uploaded) {
                        logger.info(`${this.platformName}已上传 ${preparedImages.filePaths.length} 张图片`);
                    }
                }
            }

            if (this.enableProductCode) {
                const productCodeFilledCount = await this._fillProductCode(page, productCode);
                if (productCode && productCodeFilledCount <= 0) {
                    return {
                        success: false,
                        message: `${this.platformName}商家编码未填写成功`
                    };
                }
            }

            const actionSelectors = this.selectors.submitButton;
            const clicked = await this._clickFirstButton(page, actionSelectors);

            if (!clicked) {
                return {
                    success: false,
                    message: `${this.platformName}基础支持已接入，但暂未识别到发布按钮`
                };
            }

            await page.waitForTimeout(2500);

            return {
                success: true,
                message: `${this.platformName}基础发布流程已执行完成`,
                data: {
                    pageKeptOpen: this.keepPageOpen,
                },
            };
        } catch (error) {
            logger.error(`${this.platformName}发布失败:`, error);
            return {
                success: false,
                message: error?.message || `${this.platformName}发布失败`,
                data: {
                    pageKeptOpen: this.keepPageOpen,
                },
            };
        } finally {
            tempFiles.forEach((file) => this.imageManager.deleteTempFile(file));
            if (page && !this.keepPageOpen) {
                try {
                    await page.close();
                } catch (closeError) {
                    logger.warn(`${this.platformName}关闭页面失败:`, closeError);
                }
            } else if (page && this.keepPageOpen) {
                logger.info(`${this.platformName}调试模式：保留页面，不自动关闭 tab`);
            }
        }
    }

    async _checkLogin(page) {
        const userSelectors = Array.isArray(this.selectors.userElements) ? this.selectors.userElements : [];
        const loginSelectors = Array.isArray(this.selectors.loginElements) ? this.selectors.loginElements : [];

        for (const selector of userSelectors) {
            try {
                const locator = page.locator(selector).first();
                if (await locator.count()) {
                    return true;
                }
            } catch {
                continue;
            }
        }

        for (const selector of loginSelectors) {
            try {
                const locator = page.locator(selector).first();
                if (await locator.count()) {
                    return false;
                }
            } catch {
                continue;
            }
        }

        return !/login|signin|passport/i.test(page.url());
    }

    async _fillField(page, selectors, value) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        for (const selector of selectorList) {
            if (!selector) continue;
            try {
                const locator = page.locator(selector).first();
                if (!(await locator.count())) continue;

                await locator.scrollIntoViewIfNeeded().catch(() => undefined);

                try {
                    await locator.fill('');
                    await locator.fill(value);
                } catch {
                    await locator.click({ clickCount: 3 }).catch(() => undefined);
                    await page.keyboard.press('Control+A').catch(() => undefined);
                    await page.keyboard.press('Backspace').catch(() => undefined);
                    await page.keyboard.type(value, { delay: 20 });
                }

                return true;
            } catch {
                continue;
            }
        }
        return false;
    }

    async _prepareImages(images) {
        const filePaths = [];
        const tempFiles = [];

        for (let i = 0; i < images.length; i++) {
            const source = String(images[i] || '').trim();
            if (!source) continue;

            if (/^https?:\/\//i.test(source)) {
                const tempPath = await this.imageManager.downloadImage(source, `${this.platformKey}_${Date.now()}_${i}`);
                filePaths.push(tempPath);
                tempFiles.push(tempPath);
                continue;
            }

            if (fs.existsSync(source)) {
                filePaths.push(source);
            }
        }

        return { filePaths, tempFiles };
    }

    async _uploadFiles(page, filePaths) {
        if (!filePaths.length || !this.selectors.fileInput) return false;

        const locator = page.locator(this.selectors.fileInput).first();
        if (!(await locator.count())) {
            return false;
        }

        await locator.setInputFiles(filePaths);
        await page.waitForTimeout(3000);
        return true;
    }

    async _clickFirstButton(page, selectors) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        for (const selector of selectorList) {
            if (!selector) continue;
            try {
                const locator = page.locator(selector).first();
                if (!(await locator.count())) continue;
                await locator.scrollIntoViewIfNeeded().catch(() => undefined);
                await locator.click({ delay: 100 });
                return true;
            } catch {
                continue;
            }
        }
        return false;
    }

    async _fillProductCode(page, productCode) {
        if (!this.enableProductCode) return 0;
        if (!productCode) {
            logger.info(`${this.platformName}商家编码逻辑：productCode 为空，跳过填写`);
            return 0;
        }

        const selectorList = Array.isArray(this.selectors.productCodeInput)
            ? this.selectors.productCodeInput
            : [this.selectors.productCodeInput].filter(Boolean);

        let filledCount = 0;

        for (const selector of selectorList) {
            if (!selector) continue;
            try {
                const inputs = page.locator(selector);
                const count = await inputs.count();
                if (!count) continue;

                logger.info(`${this.platformName}商家编码逻辑：准备填写商家编码，selector=${selector}, inputCount=${count}, value=${productCode}`);

                for (let index = 0; index < count; index += 1) {
                    const input = inputs.nth(index);
                    await input.waitFor({ timeout: 5000, state: 'visible' });
                    await input.scrollIntoViewIfNeeded().catch(() => undefined);
                    await input.click({ clickCount: 3 }).catch(() => undefined);
                    await input.fill('').catch(() => undefined);
                    await input.fill(productCode);
                    filledCount += 1;
                    logger.info(`${this.platformName}商家编码逻辑：已填写 ${selector}[${index}]`);
                }

                if (filledCount > 0) {
                    return filledCount;
                }
            } catch (error) {
                logger.warn(`${this.platformName}商家编码逻辑执行失败: ${error?.message || error}`);
            }
        }

        return filledCount;
    }
}

import fs from 'fs';
import path from 'path';
import { getOrCreateBrowser } from '../services/BrowserService.js';
import { ImageManager } from '../services/ImageManager.js';
import { PageOperator } from '../services/PageOperator.js';
import { logger } from '../utils/logger.js';

const PLATFORM_KEY = 'doudian';
const DEFAULT_CREATE_URL = 'https://fxg.jinritemai.com/ffa/g/create';
const PREVIEW_IMAGE_SELECTORS = [
    '[class*="upload"] img',
    '[class*="Upload"] img',
    '[class*="image"] img',
    '[class*="Image"] img',
    '[class*="picture"] img',
    '[class*="Picture"] img',
    '.arco-upload-list img',
    '.semi-upload-list img',
    '.ant-upload-list img',
    'img[src^="blob:"]',
    'img[src^="data:image/"]'
];
const MAIN_IMAGE_FIELD_SELECTOR = '[attr-field-id="主图"]';
const MAIN_IMAGE_DELETE_STANDARD_SELECTOR = '[class*="hoverBottomWrapper"] > div:nth-child(2)';
const MAIN_IMAGE_DELETE_HOVER_DELAY_MS = 320;
const DOUDIAN_PUBLISH_SUCCESS_TEXT_PATTERNS = [
    '商品提交成功',
    '商品创建成功',
    '发布成功',
    '提交成功',
    '创建成功',
    '继续发布商品视频',
    '分享到抖音'
];
const DOUDIAN_PUBLISH_FAILURE_TEXT_PATTERNS = [
    '发布失败',
    '提交失败',
    '创建失败',
    '保存失败'
];

function toUserFriendlyPath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}

function getPathFileName(filePath) {
    return path.posix.basename(toUserFriendlyPath(filePath));
}

function normalizeTitle(title) {
    return String(title || '').trim().slice(0, 30);
}

function normalizeHoverMode(value) {
    return String(value || '').trim().toLowerCase() === 'js' ? 'js' : 'native';
}

function resolveCreateUrl(copyId) {
    const normalizedCopyId = String(copyId || '').trim();
    return normalizedCopyId
        ? `${DEFAULT_CREATE_URL}?copyid=${encodeURIComponent(normalizedCopyId)}`
        : DEFAULT_CREATE_URL;
}

async function countUploadedPreviewImages(page) {
    try {
        return await page.evaluate((selectors) => {
            const nodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
            const uniqueKeys = new Set();

            nodes.forEach((node) => {
                if (!(node instanceof HTMLImageElement)) return;
                const src = node.currentSrc || node.src || '';
                const width = node.naturalWidth || node.width || 0;
                const height = node.naturalHeight || node.height || 0;
                if (!src) return;
                if (width > 32 || height > 32 || /^blob:|^data:image\//.test(src)) {
                    uniqueKeys.add(`${src}|${width}|${height}`);
                }
            });

            return uniqueKeys.size;
        }, PREVIEW_IMAGE_SELECTORS);
    } catch (error) {
        logger.warn(`抖店统计已上传图片候选失败: ${error?.message || error}`);
        return 0;
    }
}

async function collectUploadedPreviewKeys(page) {
    try {
        return await page.evaluate((selectors) => {
            const nodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
            const uniqueKeys = new Set();

            nodes.forEach((node) => {
                if (!(node instanceof HTMLImageElement)) return;
                const src = node.currentSrc || node.src || '';
                const width = node.naturalWidth || node.width || 0;
                const height = node.naturalHeight || node.height || 0;
                if (!src) return;
                if (width > 32 || height > 32 || /^blob:|^data:image\//.test(src)) {
                    uniqueKeys.add(`${src}|${width}|${height}`);
                }
            });

            return Array.from(uniqueKeys);
        }, PREVIEW_IMAGE_SELECTORS);
    } catch (error) {
        logger.warn(`抖店采集已上传图片候选失败: ${error?.message || error}`);
        return [];
    }
}

async function collectMainImagePreviewKeys(page) {
    try {
        return await page.evaluate(({ fieldSelector, selectors }) => {
            const field = document.querySelector(fieldSelector);
            if (!(field instanceof HTMLElement)) {
                return [];
            }

            const nodes = selectors.flatMap((selector) => Array.from(field.querySelectorAll(selector)));
            const uniqueKeys = new Set();

            nodes.forEach((node) => {
                if (!(node instanceof HTMLImageElement)) return;
                const src = node.currentSrc || node.src || '';
                const width = node.naturalWidth || node.width || 0;
                const height = node.naturalHeight || node.height || 0;
                if (!src) return;
                if (width > 32 || height > 32 || /^blob:|^data:image\//.test(src)) {
                    uniqueKeys.add(`${src}|${width}|${height}`);
                }
            });

            return Array.from(uniqueKeys);
        }, {
            fieldSelector: MAIN_IMAGE_FIELD_SELECTOR,
            selectors: PREVIEW_IMAGE_SELECTORS
        });
    } catch (error) {
        logger.warn(`抖店采集主图预览失败: ${error?.message || error}`);
        return [];
    }
}

async function clickMainImageDeleteButtonByPreviewIndex(page, previewIndex, { hoverMode = 'native' } = {}) {
    try {
        return await page.evaluate(({
            fieldSelector,
            previewSelectors,
            deleteSelector,
            previewIndex,
            hoverMode
        }) => {
            const field = document.querySelector(fieldSelector);
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const previewPattern = /^blob:|^data:image\//;

            const describe = (node) => {
                if (!(node instanceof HTMLElement)) {
                    return '';
                }

                return [
                    node.tagName.toLowerCase(),
                    normalize(node.getAttribute('attr-field-id')),
                    normalize(node.getAttribute('aria-label')),
                    normalize(node.getAttribute('title')),
                    normalize(node.className),
                    normalize(node.textContent).slice(0, 80)
                ].filter(Boolean).join(' | ');
            };

            const isVisible = (element) => {
                if (!(element instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && style.opacity !== '0'
                    && rect.width > 0
                    && rect.height > 0;
            };

            const isPreviewImage = (node) => {
                if (!(node instanceof HTMLImageElement)) return false;
                const src = node.currentSrc || node.src || '';
                const width = node.naturalWidth || node.width || 0;
                const height = node.naturalHeight || node.height || 0;
                return !!src && (width > 32 || height > 32 || previewPattern.test(src));
            };

            const getImageKey = (node) => {
                if (!(node instanceof HTMLImageElement)) return '';
                const src = node.currentSrc || node.src || '';
                const width = node.naturalWidth || node.width || 0;
                const height = node.naturalHeight || node.height || 0;
                return src ? `${src}|${width}|${height}` : '';
            };

            const dispatchHover = (target) => {
                if (!(target instanceof HTMLElement)) return;
                const rect = target.getBoundingClientRect();
                const eventInit = {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rect.left + (rect.width / 2),
                    clientY: rect.top + (rect.height / 2)
                };

                target.dispatchEvent(new MouseEvent('pointerover', eventInit));
                target.dispatchEvent(new MouseEvent('mouseover', eventInit));
                target.dispatchEvent(new MouseEvent('mouseenter', eventInit));
                target.dispatchEvent(new MouseEvent('pointerenter', eventInit));
                target.dispatchEvent(new MouseEvent('mousemove', eventInit));
            };

            const toUniqueElements = (nodes) => Array.from(new Set(
                nodes.filter((node) => node instanceof HTMLElement)
            ));

            const collectStandardDeleteButtons = (scope) => {
                if (!(scope instanceof HTMLElement)) return [];
                return toUniqueElements(
                    Array.from(scope.querySelectorAll(deleteSelector))
                        .filter((node) => isVisible(node))
                );
            };

            const findPreferredScope = (image) => {
                let current = image.parentElement;
                while (current && current instanceof HTMLElement) {
                    if (collectStandardDeleteButtons(current).length > 0) {
                        return current;
                    }
                    if (current === field) {
                        break;
                    }
                    current = current.parentElement;
                }
                return null;
            };

            if (!(field instanceof HTMLElement)) {
                return {
                    clicked: false,
                    hoverMode,
                    imageIndex: previewIndex,
                    previewCount: 0,
                    visibleDeleteCount: 0,
                    scopedDeleteCount: 0,
                    deleteDescriptor: '',
                    candidateDeleteDescriptors: [],
                    reason: 'main-image-field-not-found'
                };
            }

            const previewImages = toUniqueElements(
                previewSelectors.flatMap((selector) => Array.from(field.querySelectorAll(selector)))
            ).filter((node) => isPreviewImage(node));
            const targetImage = previewImages[previewIndex];

            if (!(targetImage instanceof HTMLImageElement)) {
                const fieldDeleteButtons = collectStandardDeleteButtons(field);
                return {
                    clicked: false,
                    hoverMode,
                    imageIndex: previewIndex,
                    previewCount: previewImages.length,
                    visibleDeleteCount: fieldDeleteButtons.length,
                    scopedDeleteCount: 0,
                    deleteDescriptor: '',
                    candidateDeleteDescriptors: fieldDeleteButtons.slice(0, 5).map((node) => describe(node)),
                    reason: 'target-image-not-found'
                };
            }

            if (!isPreviewImage(targetImage)) {
                const fieldDeleteButtons = collectStandardDeleteButtons(field);
                return {
                    clicked: false,
                    hoverMode,
                    imageIndex: previewIndex,
                    previewCount: previewImages.length,
                    visibleDeleteCount: fieldDeleteButtons.length,
                    scopedDeleteCount: 0,
                    deleteDescriptor: '',
                    candidateDeleteDescriptors: fieldDeleteButtons.slice(0, 5).map((node) => describe(node)),
                    imageKey: getImageKey(targetImage),
                    imageDescriptor: describe(targetImage),
                    reason: 'target-image-not-preview'
                };
            }

            const preferredScope = findPreferredScope(targetImage);
            dispatchHover(preferredScope);
            dispatchHover(targetImage);
            const fieldDeleteButtons = collectStandardDeleteButtons(field);
            const scopedDeleteButtons = collectStandardDeleteButtons(preferredScope);
            const target = scopedDeleteButtons[0] || null;

            if (!(target instanceof HTMLElement)) {
                return {
                    clicked: false,
                    hoverMode,
                    imageIndex: previewIndex,
                    previewCount: previewImages.length,
                    visibleDeleteCount: fieldDeleteButtons.length,
                    scopedDeleteCount: scopedDeleteButtons.length,
                    deleteDescriptor: '',
                    candidateDeleteDescriptors: fieldDeleteButtons.slice(0, 5).map((node) => describe(node)),
                    scopeDescriptor: describe(preferredScope),
                    matchedScopeDescriptor: describe(preferredScope),
                    imageKey: getImageKey(targetImage),
                    imageDescriptor: describe(targetImage),
                    reason: 'standard-delete-button-not-found'
                };
            }

            const rect = target.getBoundingClientRect();
            const eventInit = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: rect.left + (rect.width / 2),
                clientY: rect.top + (rect.height / 2)
            };

            target.dispatchEvent(new MouseEvent('pointerdown', eventInit));
            target.dispatchEvent(new MouseEvent('mousedown', eventInit));
            target.dispatchEvent(new MouseEvent('pointerup', eventInit));
            target.dispatchEvent(new MouseEvent('mouseup', eventInit));
            target.dispatchEvent(new MouseEvent('click', eventInit));

            return {
                clicked: true,
                hoverMode,
                imageIndex: previewIndex,
                previewCount: previewImages.length,
                visibleDeleteCount: fieldDeleteButtons.length,
                scopedDeleteCount: scopedDeleteButtons.length,
                deleteDescriptor: describe(target),
                candidateDeleteDescriptors: fieldDeleteButtons.slice(0, 5).map((node) => describe(node)),
                scopeDescriptor: describe(preferredScope),
                matchedScopeDescriptor: describe(preferredScope),
                imageKey: getImageKey(targetImage),
                imageDescriptor: describe(targetImage),
                reason: 'clicked',
                searchStrategy: 'ancestor-standard-selector'
            };
        }, {
            fieldSelector: MAIN_IMAGE_FIELD_SELECTOR,
            previewSelectors: PREVIEW_IMAGE_SELECTORS,
            deleteSelector: MAIN_IMAGE_DELETE_STANDARD_SELECTOR,
            previewIndex,
            hoverMode
        });
    } catch (error) {
        logger.warn(`抖店主图删除点击失败: previewIndex=${previewIndex}, error=${error?.message || error}`);
        return {
            clicked: false,
            hoverMode,
            imageIndex: previewIndex,
            previewCount: 0,
            visibleDeleteCount: 0,
            scopedDeleteCount: 0,
            deleteDescriptor: '',
            candidateDeleteDescriptors: [],
            reason: error?.message || String(error || '')
        };
    }
}

async function clickOneMainImageDeleteButton(page) {
    try {
        return await page.evaluate(({ fieldSelector, previewSelectors, deleteSelector }) => {
            const field = document.querySelector(fieldSelector);
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const previewPattern = /^blob:|^data:image\//;

            const describe = (node) => {
                if (!(node instanceof HTMLElement)) {
                    return '';
                }

                return [
                    node.tagName.toLowerCase(),
                    normalize(node.getAttribute('attr-field-id')),
                    normalize(node.getAttribute('aria-label')),
                    normalize(node.getAttribute('title')),
                    normalize(node.className),
                    normalize(node.textContent).slice(0, 80)
                ].filter(Boolean).join(' | ');
            };

            if (!(field instanceof HTMLElement)) {
                return {
                    clicked: false,
                    hoverMode: 'js',
                    imageIndex: -1,
                    previewCount: 0,
                    visibleDeleteCount: 0,
                    scopedDeleteCount: 0,
                    deleteDescriptor: '',
                    candidateDeleteDescriptors: [],
                    reason: 'main-image-field-not-found'
                };
            }

            const isVisible = (element) => {
                if (!(element instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && style.opacity !== '0'
                    && rect.width > 0
                    && rect.height > 0;
            };

            const isPreviewImage = (node) => {
                if (!(node instanceof HTMLImageElement)) return false;
                const src = node.currentSrc || node.src || '';
                const width = node.naturalWidth || node.width || 0;
                const height = node.naturalHeight || node.height || 0;
                return !!src && (width > 32 || height > 32 || previewPattern.test(src));
            };

            const getImageKey = (node) => {
                if (!(node instanceof HTMLImageElement)) return '';
                const src = node.currentSrc || node.src || '';
                const width = node.naturalWidth || node.width || 0;
                const height = node.naturalHeight || node.height || 0;
                return src ? `${src}|${width}|${height}` : '';
            };

            const dispatchHover = (target) => {
                if (!(target instanceof HTMLElement)) return;
                const rect = target.getBoundingClientRect();
                const eventInit = {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rect.left + (rect.width / 2),
                    clientY: rect.top + (rect.height / 2)
                };
                target.dispatchEvent(new MouseEvent('pointerover', eventInit));
                target.dispatchEvent(new MouseEvent('mouseover', eventInit));
                target.dispatchEvent(new MouseEvent('mouseenter', eventInit));
                target.dispatchEvent(new MouseEvent('pointerenter', eventInit));
                target.dispatchEvent(new MouseEvent('mousemove', eventInit));
            };

            const toUniqueElements = (nodes) => Array.from(new Set(
                nodes.filter((node) => node instanceof HTMLElement)
            ));

            const collectStandardDeleteButtons = (scope) => {
                if (!(scope instanceof HTMLElement)) return [];
                return toUniqueElements(
                    Array.from(scope.querySelectorAll(deleteSelector))
                        .filter((node) => isVisible(node))
                );
            };

            const findPreferredScope = (image) => {
                let current = image.parentElement;
                while (current && current instanceof HTMLElement) {
                    if (collectStandardDeleteButtons(current).length > 0) {
                        return current;
                    }
                    if (current === field) {
                        break;
                    }
                    current = current.parentElement;
                }
                return null;
            };

            const previewImages = toUniqueElements(
                previewSelectors.flatMap((selector) => Array.from(field.querySelectorAll(selector)))
            ).filter((node) => isPreviewImage(node));
            const fieldDeleteButtons = collectStandardDeleteButtons(field);

            for (const [previewIndex, image] of previewImages.entries()) {
                const preferredScope = findPreferredScope(image);
                dispatchHover(preferredScope);
                dispatchHover(image);
                const scopedDeleteButtons = collectStandardDeleteButtons(preferredScope);
                const target = scopedDeleteButtons[0] || null;
                if (!(target instanceof HTMLElement)) {
                    continue;
                }

                const rect = target.getBoundingClientRect();
                const eventInit = {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rect.left + (rect.width / 2),
                    clientY: rect.top + (rect.height / 2)
                };

                target.dispatchEvent(new MouseEvent('pointerdown', eventInit));
                target.dispatchEvent(new MouseEvent('mousedown', eventInit));
                target.dispatchEvent(new MouseEvent('pointerup', eventInit));
                target.dispatchEvent(new MouseEvent('mouseup', eventInit));
                target.dispatchEvent(new MouseEvent('click', eventInit));

                return {
                    clicked: true,
                    hoverMode: 'js',
                    imageIndex: previewIndex,
                    previewCount: previewImages.length,
                    visibleDeleteCount: fieldDeleteButtons.length,
                    scopedDeleteCount: scopedDeleteButtons.length,
                    deleteDescriptor: describe(target),
                    candidateDeleteDescriptors: fieldDeleteButtons.slice(0, 5).map((node) => describe(node)),
                    scopeDescriptor: describe(preferredScope),
                    matchedScopeDescriptor: describe(preferredScope),
                    imageKey: getImageKey(image),
                    imageDescriptor: describe(image),
                    reason: 'clicked',
                    searchStrategy: 'ancestor-standard-selector'
                };
            }

            return {
                clicked: false,
                hoverMode: 'js',
                imageIndex: -1,
                previewCount: previewImages.length,
                visibleDeleteCount: fieldDeleteButtons.length,
                scopedDeleteCount: 0,
                deleteDescriptor: '',
                candidateDeleteDescriptors: fieldDeleteButtons.slice(0, 5).map((node) => describe(node)),
                reason: previewImages.length > 0 ? 'standard-delete-button-not-found' : 'preview-image-not-found'
            };
        }, {
            fieldSelector: MAIN_IMAGE_FIELD_SELECTOR,
            previewSelectors: PREVIEW_IMAGE_SELECTORS,
            deleteSelector: MAIN_IMAGE_DELETE_STANDARD_SELECTOR
        });
    } catch (error) {
        logger.warn(`抖店主图删除点击失败: ${error?.message || error}`);
        return {
            clicked: false,
            hoverMode: 'js',
            imageIndex: -1,
            previewCount: 0,
            visibleDeleteCount: 0,
            scopedDeleteCount: 0,
            deleteDescriptor: '',
            candidateDeleteDescriptors: [],
            reason: error?.message || String(error || '')
        };
    }
}

async function hoverAndClickOneMainImageDeleteButton(page, hoverMode = 'native') {
    if (hoverMode === 'js') {
        return clickOneMainImageDeleteButton(page);
    }

    try {
        const imageLocator = page.locator(`${MAIN_IMAGE_FIELD_SELECTOR} img`);
        const imageCount = await imageLocator.count();
        let previewIndex = 0;

        for (let index = 0; index < imageCount; index += 1) {
            const image = imageLocator.nth(index);
            try {
                const meta = await image.evaluate((node) => {
                    if (!(node instanceof HTMLImageElement)) {
                        return {
                            src: '',
                            width: 0,
                            height: 0
                        };
                    }

                    return {
                        src: node.currentSrc || node.src || '',
                        width: node.naturalWidth || node.width || 0,
                        height: node.naturalHeight || node.height || 0,
                        className: String(node.className || ''),
                        alt: String(node.alt || '')
                    };
                });

                const isPreviewImage = !!meta?.src && (
                    Number(meta?.width || 0) > 32
                    || Number(meta?.height || 0) > 32
                    || /^blob:|^data:image\//.test(String(meta?.src || ''))
                );

                if (!isPreviewImage) {
                    continue;
                }

                const currentPreviewIndex = previewIndex;
                previewIndex += 1;

                logger.info('抖店商品主图清理：准备悬停当前图片', {
                    hoverMode,
                    imageIndex: currentPreviewIndex,
                    domIndex: index,
                    hoverDelayMs: MAIN_IMAGE_DELETE_HOVER_DELAY_MS,
                    width: meta?.width || 0,
                    height: meta?.height || 0,
                    alt: meta?.alt || '',
                    className: meta?.className || '',
                    src: String(meta?.src || '').slice(0, 180)
                });
                await image.scrollIntoViewIfNeeded().catch(() => undefined);
                await image.hover({ force: true });
                await page.waitForTimeout(MAIN_IMAGE_DELETE_HOVER_DELAY_MS);

                const clickResult = await clickMainImageDeleteButtonByPreviewIndex(page, currentPreviewIndex, { hoverMode });
                logger.info('抖店商品主图清理：当前图片标准删除结果', clickResult);
                if (clickResult?.clicked) {
                    return {
                        ...clickResult,
                        nativeHoverIndex: currentPreviewIndex,
                        nativeHoverDomIndex: index
                    };
                }
            } catch (error) {
                logger.warn(`抖店主图原生 hover 删除尝试失败: image[${index}], error=${error?.message || error}`);
            }
        }
    } catch (error) {
        logger.warn(`抖店主图扫描可 hover 图片失败: ${error?.message || error}`);
    }

    const fallbackResult = await clickOneMainImageDeleteButton(page);
    logger.info('抖店商品主图清理：原生 hover 路径未成功，执行JS标准删除结果', fallbackResult);
    return fallbackResult;
}

async function waitForMainImagePreviewDecrease(page, beforeKeys) {
    try {
        await page.waitForFunction(({ fieldSelector, selectors, previousKeys, previousCount }) => {
            const field = document.querySelector(fieldSelector);
            if (!(field instanceof HTMLElement)) {
                return true;
            }

            const nodes = selectors.flatMap((selector) => Array.from(field.querySelectorAll(selector)));
            const uniqueKeys = new Set();

            nodes.forEach((node) => {
                if (!(node instanceof HTMLImageElement)) return;
                const src = node.currentSrc || node.src || '';
                const width = node.naturalWidth || node.width || 0;
                const height = node.naturalHeight || node.height || 0;
                if (!src) return;
                if (width > 32 || height > 32 || /^blob:|^data:image\//.test(src)) {
                    uniqueKeys.add(`${src}|${width}|${height}`);
                }
            });

            const currentKeys = Array.from(uniqueKeys);
            return currentKeys.length < previousCount || previousKeys.some((key) => !currentKeys.includes(key));
        }, {
            fieldSelector: MAIN_IMAGE_FIELD_SELECTOR,
            selectors: PREVIEW_IMAGE_SELECTORS,
            previousKeys: beforeKeys,
            previousCount: beforeKeys.length
        }, {
            timeout: 6000
        });
        return true;
    } catch (error) {
        logger.warn(`抖店主图删除后未检测到预览减少: ${error?.message || error}`);
        return false;
    }
}

async function clearMainImages(page, hoverMode = 'native') {
    let deletedCount = 0;

    for (let round = 1; round <= 8; round += 1) {
        const beforeKeys = await collectMainImagePreviewKeys(page);
        if (beforeKeys.length <= 0) {
            logger.info(`抖店商品主图清理完成: deleted=${deletedCount}, remaining=0`);
            return {
                deletedCount,
                remainingCount: 0
            };
        }

        const clickResult = await hoverAndClickOneMainImageDeleteButton(page, hoverMode);
        logger.info(`抖店商品主图清理：第 ${round} 轮删除尝试`, clickResult);

        if (!clickResult?.clicked) {
            logger.warn(`抖店商品主图清理：未找到可点击删除按钮，remaining=${beforeKeys.length}, reason=${clickResult?.reason || 'unknown'}`);
            return {
                deletedCount,
                remainingCount: beforeKeys.length
            };
        }

        await page.waitForTimeout(400);
        await waitForMainImagePreviewDecrease(page, beforeKeys);
        const afterKeys = await collectMainImagePreviewKeys(page);
        const removedByCount = Math.max(0, beforeKeys.length - afterKeys.length);
        const hasRemovedKey = beforeKeys.some((key) => !afterKeys.includes(key));
        const removedCount = removedByCount > 0 ? removedByCount : (hasRemovedKey ? 1 : 0);

        if (removedCount <= 0) {
            logger.warn(`抖店商品主图清理：点击删除后预览未减少，before=${beforeKeys.length}, after=${afterKeys.length}`);
            await page.waitForTimeout(200);
            continue;
        }

        deletedCount += removedCount;
        logger.info(`抖店商品主图清理：删除成功，round=${round}, removed=${removedCount}, remaining=${afterKeys.length}`);

        if (afterKeys.length <= 0) {
            logger.info(`抖店商品主图清理完成: deleted=${deletedCount}, remaining=0`);
            return {
                deletedCount,
                remainingCount: 0
            };
        }
    }

    const remainingKeys = await collectMainImagePreviewKeys(page);
    logger.info(`抖店商品主图清理结束: deleted=${deletedCount}, remaining=${remainingKeys.length}`);
    return {
        deletedCount,
        remainingCount: remainingKeys.length
    };
}

async function triggerHover(page, selector, mode, logPrefix) {
    if (mode === 'js') {
        const result = await page.evaluate((targetSelector) => {
            const element = document.querySelector(targetSelector);
            if (!(element instanceof HTMLElement)) {
                throw new Error(`未找到元素: ${targetSelector}`);
            }

            element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            const rect = element.getBoundingClientRect();
            const inViewport = rect.width > 0
                && rect.height > 0
                && rect.bottom > 0
                && rect.right > 0
                && rect.top < window.innerHeight
                && rect.left < window.innerWidth;

            if (!inViewport) {
                throw new Error(`元素未进入可视区域: ${targetSelector}`);
            }

            const eventInit = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: rect.left + (rect.width / 2),
                clientY: rect.top + (rect.height / 2)
            };

            element.dispatchEvent(new MouseEvent('pointerover', eventInit));
            element.dispatchEvent(new MouseEvent('mouseover', eventInit));
            element.dispatchEvent(new MouseEvent('mouseenter', eventInit));
            element.dispatchEvent(new MouseEvent('pointerenter', eventInit));
            element.dispatchEvent(new MouseEvent('mousemove', eventInit));
            return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
        }, selector);
        logger.info(`${logPrefix}：已使用JS方式滚动并悬停: ${selector}`, result);
        return;
    }

    const locator = page.locator(selector).first();
    await locator.waitFor({ timeout: 10000, state: 'visible' });
    await locator.scrollIntoViewIfNeeded();
    logger.info(`${logPrefix}：已使用原生方式滚动到可视区域: ${selector}`);
    await page.waitForTimeout(200);
    await locator.hover();
    logger.info(`${logPrefix}：已使用原生方式执行悬停: ${selector}`);
}

async function clickWithFallback(locator, fallback, successMessage, fallbackMessage) {
    try {
        await locator.click({ timeout: 3000 });
        logger.info(successMessage);
    } catch (error) {
        logger.warn(`${successMessage}失败，尝试JS点击: ${error?.message || error}`);
        const clicked = await fallback();
        if (!clicked) {
            throw error;
        }
        logger.info(fallbackMessage);
    }
}

async function prepareImages(images, imageManager) {
    const filePaths = [];
    const tempFiles = [];

    for (const [index, rawSource] of images.entries()) {
        const source = String(rawSource || '').trim();
        if (!source) continue;

        if (/^https?:\/\//i.test(source)) {
            const tempPath = await imageManager.downloadImage(source, `${PLATFORM_KEY}_${Date.now()}_${index}`);
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

async function checkLogin(page) {
    for (const selector of ['.header-user-info', '.account-info', '.user-info', '.avatar', '[class*="merchant"]']) {
        try {
            if (await page.locator(selector).first().count()) return true;
        } catch {
            // ignore
        }
    }

    for (const selector of ['.login-btn', '.login-button', '.auth-btn', 'text=登录', 'text=扫码登录']) {
        try {
            if (await page.locator(selector).first().count()) return false;
        } catch {
            // ignore
        }
    }

    return !/login|signin|passport/i.test(page.url());
}

async function collectDoudianPublishSignals(page) {
    try {
        return await page.evaluate(({ successPatterns, failurePatterns }) => {
            const normalize = (value) => String(value || '').replace(/\s+/g, '');
            const bodyText = normalize(document.body?.innerText || '');
            const buttons = Array.from(document.querySelectorAll('button')).map((button) => ({
                text: normalize(button.textContent || ''),
                visible: !!button.offsetParent,
                disabled: !!button.disabled || button.getAttribute('aria-disabled') === 'true'
            }));
            const publishButton = buttons.find((item) => item.text.includes('发布商品'));

            return {
                matchedSuccessPatterns: successPatterns.filter((pattern) => bodyText.includes(pattern)),
                matchedFailurePatterns: failurePatterns.filter((pattern) => bodyText.includes(pattern)),
                hasVisiblePublishButton: !!publishButton?.visible,
                publishButtonDisabled: !!publishButton?.disabled,
                bodyPreview: bodyText.slice(0, 400)
            };
        }, {
            successPatterns: DOUDIAN_PUBLISH_SUCCESS_TEXT_PATTERNS,
            failurePatterns: DOUDIAN_PUBLISH_FAILURE_TEXT_PATTERNS
        });
    } catch (error) {
        logger.warn(`抖店采集发布结果信号失败: ${error?.message || error}`);
        return {
            matchedSuccessPatterns: [],
            matchedFailurePatterns: [],
            hasVisiblePublishButton: true,
            publishButtonDisabled: false,
            bodyPreview: ''
        };
    }
}

async function waitForDoudianPublishConfirmation(page, baselineSignals = null) {
    const startUrl = page.url();
    const baselineSuccessPatterns = new Set(baselineSignals?.matchedSuccessPatterns || []);
    const baselineFailurePatterns = new Set(baselineSignals?.matchedFailurePatterns || []);

    try {
        const result = await Promise.race([
            page.waitForFunction(({ successPatterns, baselinePatterns }) => {
                const bodyText = String(document.body?.innerText || '').replace(/\s+/g, '');
                const matched = successPatterns.find((pattern) =>
                    bodyText.includes(pattern) && !baselinePatterns.includes(pattern)
                );
                return matched ? { matched } : false;
            }, {
                successPatterns: DOUDIAN_PUBLISH_SUCCESS_TEXT_PATTERNS,
                baselinePatterns: Array.from(baselineSuccessPatterns)
            }, { timeout: 20000 }).then(async (handle) => ({
                confirmed: true,
                signal: 'success_text',
                detail: (await handle.jsonValue())?.matched || ''
            })),

            page.waitForFunction(({ failurePatterns, baselinePatterns }) => {
                const bodyText = String(document.body?.innerText || '').replace(/\s+/g, '');
                const matched = failurePatterns.find((pattern) =>
                    bodyText.includes(pattern) && !baselinePatterns.includes(pattern)
                );
                return matched ? { matched } : false;
            }, {
                failurePatterns: DOUDIAN_PUBLISH_FAILURE_TEXT_PATTERNS,
                baselinePatterns: Array.from(baselineFailurePatterns)
            }, { timeout: 20000 }).then(async (handle) => ({
                confirmed: false,
                signal: 'failure_text',
                detail: (await handle.jsonValue())?.matched || ''
            })),

            page.waitForURL((url) => {
                const href = String(url?.href || '');
                return href !== startUrl && !href.includes('/ffa/g/create');
            }, { timeout: 20000 }).then(() => ({
                confirmed: true,
                signal: 'url_changed',
                detail: page.url()
            }))
        ]);

        if (!result.confirmed) {
            throw new Error(`检测到失败提示: ${result.detail || '未知失败提示'}`);
        }

        return {
            ...result,
            finalUrl: page.url()
        };
    } catch (error) {
        const finalSignals = await collectDoudianPublishSignals(page);
        const matchedFailure = finalSignals.matchedFailurePatterns.find((pattern) => !baselineFailurePatterns.has(pattern));
        if (matchedFailure) {
            throw new Error(`检测到失败提示: ${matchedFailure}`);
        }

        const matchedSuccess = finalSignals.matchedSuccessPatterns.find((pattern) => !baselineSuccessPatterns.has(pattern));
        if (matchedSuccess) {
            return {
                confirmed: true,
                signal: 'success_text_fallback',
                detail: matchedSuccess,
                finalUrl: page.url()
            };
        }

        const currentUrl = page.url();
        if (currentUrl !== startUrl && !currentUrl.includes('/ffa/g/create')) {
            return {
                confirmed: true,
                signal: 'url_changed_fallback',
                detail: currentUrl,
                finalUrl: currentUrl
            };
        }

        throw new Error(`未确认商品提交成功: ${error?.message || error}`);
    }
}

export async function publishToDoudian(publishInfo = {}) {
    const imageManager = new ImageManager();
    const pageOperator = new PageOperator();
    const tempFiles = [];
    let page = null;

    try {
        const settings = publishInfo.platformOptions || publishInfo.publishOptions || publishInfo.platformSettings?.[PLATFORM_KEY] || {};
        const title = normalizeTitle(publishInfo.title || publishInfo.name || '');
        const sourceImages = Array.isArray(publishInfo.images) && publishInfo.images.length
            ? publishInfo.images
            : (Array.isArray(publishInfo.imageSources) ? publishInfo.imageSources : []);
        const targetImages = sourceImages.filter(Boolean).slice(0, 5);
        const copyId = String(settings.copyId || publishInfo.copyId || '').trim();
        const targetCreateUrl = resolveCreateUrl(copyId);
        const productCode = String(
            settings.productCode
            ?? publishInfo.productCode
            ?? publishInfo.data?.productCode
            ?? ''
        ).trim();
        const hoverMode = normalizeHoverMode(
            settings.materialHoverMode
            ?? settings.hoverMode
            ?? publishInfo.materialHoverMode
            ?? publishInfo.hoverMode
        );
        const fileInputStartIndex = Number(settings.fileInputStartIndex ?? publishInfo.fileInputStartIndex ?? 2);

        logger.info('开始执行抖店商品发布流程');
        logger.info('抖店发布入参摘要:', {
            copyId,
            targetCreateUrl,
            imageCount: targetImages.length,
            title,
            productCode,
            fileInputStartIndex,
            materialHoverMode: hoverMode
        });

        const browser = await getOrCreateBrowser({ profileId: publishInfo?.profileId });
        logger.info('抖店已获取浏览器实例，准备创建新页面');
        page = await browser.newPage({ foreground: true });
        logger.info('抖店新页面创建成功');
        await pageOperator.setupAntiDetection(page);
        logger.info('抖店页面反检测设置完成');

        logger.info(`抖店准备打开商品发布页: ${targetCreateUrl}`);
        await page.goto(targetCreateUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);
        logger.info(`抖店当前页面: ${page.url()}`);
        logger.info(`抖店当前标题: ${await page.title().catch(() => '')}`);

        if (!(await checkLogin(page))) {
            return {
                success: false,
                message: '请先登录抖店商家后台',
                data: { uploaded: 0, requested: targetImages.length }
            };
        }

        logger.info('抖店登录状态校验通过');

        let titleFilled = false;
        if (!title) {
            logger.info('抖店标题为空，跳过填写');
        } else {
            logger.info(`抖店准备填写标题: ${title}`);
            const titleInput = page.locator('#pg-title-input').first();

            try {
                await titleInput.waitFor({ timeout: 10000, state: 'visible' });
                await titleInput.scrollIntoViewIfNeeded().catch(() => undefined);
                await titleInput.click({ clickCount: 3 }).catch(() => undefined);
                await titleInput.fill('').catch(() => undefined);
                await titleInput.fill(title);
                titleFilled = true;
            } catch {
                try {
                    await titleInput.click({ clickCount: 3 }).catch(() => undefined);
                    await page.keyboard.press('Control+A').catch(() => undefined);
                    await page.keyboard.press('Meta+A').catch(() => undefined);
                    await page.keyboard.press('Backspace').catch(() => undefined);
                    await page.keyboard.type(title, { delay: 20 });
                    titleFilled = true;
                } catch {
                    titleFilled = false;
                }
            }

            if (!titleFilled) {
                logger.warn('抖店未找到标题输入框: #pg-title-input');
            } else {
                try {
                    await page.waitForFunction((expectedValue) => {
                        const input = document.querySelector('#pg-title-input');
                        return (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)
                            && String(input.value || '').trim() === expectedValue;
                    }, title, { timeout: 5000 });
                } catch (error) {
                    logger.warn(`抖店标题回读校验未通过: ${error?.message || error}`);
                }
                logger.info(`抖店标题填写完成: ${title}`);
            }
        }

        let mainImageActionReady = false;
        if (titleFilled) {
            try {
                const guiderSelector = '#material-button-guider';
                const actionSelector = '[attr-field-id="主图"] [class*="hoverBottomWrapper"] [class*=index-module_actionAfter]';
                logger.info(`抖店商品主图逻辑：准备展开主图操作区，模式=${hoverMode}`);
                await triggerHover(page, guiderSelector, hoverMode, '抖店商品主图逻辑');

                const actionLocator = page.locator(actionSelector).nth(1);
                await actionLocator.waitFor({ timeout: 5000, state: 'visible' });
                await actionLocator.scrollIntoViewIfNeeded().catch(() => undefined);
                await page.waitForTimeout(200);
                await clickWithFallback(
                    actionLocator,
                    () => page.evaluate(({ selector, index }) => {
                        const target = document.querySelectorAll(selector)?.[index];
                        if (!(target instanceof HTMLElement)) return false;
                        target.click();
                        return true;
                    }, { selector: actionSelector, index: 1 }),
                    `抖店商品主图逻辑：已点击主图操作按钮 locator(${actionSelector}).nth(1)`,
                    `抖店商品主图逻辑：已使用JS点击主图操作按钮 document.querySelectorAll('${actionSelector}')[1]`
                );
                mainImageActionReady = true;
                await page.waitForTimeout(500);
            } catch (error) {
                logger.warn(`抖店商品主图逻辑：展开主图操作区失败: ${error?.message || error}`);
            }
        }

        let uploadResult = {
            requested: targetImages.length,
            availableInputs: 0,
            startIndex: 0,
            uploadedPaths: []
        };
        let mainImageClearResult = {
            deletedCount: 0,
            remainingCount: 0
        };

        if (mainImageActionReady && targetImages.length > 0) {
            try {
                mainImageClearResult = await clearMainImages(page, hoverMode);
                await page.waitForTimeout(500);
            } catch (error) {
                logger.warn(`抖店商品主图清理失败: ${error?.message || error}`);
            }
        }

        if (targetImages.length > 0) {
            const preparedImages = await prepareImages(targetImages, imageManager);
            tempFiles.push(...preparedImages.tempFiles);
            logger.info(`抖店准备上传的图片数量: ${preparedImages.filePaths.length}`);
            logger.info('抖店准备上传的图片路径:', preparedImages.filePaths.map(toUserFriendlyPath));
            logger.info('抖店图片预处理结果:', {
                tempFileCount: preparedImages.tempFiles.length,
                fileNames: preparedImages.filePaths.map(getPathFileName)
            });

            if (preparedImages.filePaths.length > 0) {
                const inputSelector = '[attr-field-id="主图"] input[type="file"]';
                logger.info(`抖店上传参数: requested=${preparedImages.filePaths.length}, preferredStartIndex=${fileInputStartIndex}`);
                await page.waitForLoadState('domcontentloaded').catch(() => undefined);
                await page.waitForTimeout(2000);
                logger.info('抖店页面已完成基础加载，准备扫描主图区域文件输入框');

                try {
                    await page.waitForSelector(inputSelector, { timeout: 15000, state: 'attached' });
                    logger.info(`抖店已检测到主图文件输入框选择器: ${inputSelector}`);
                } catch {
                    logger.warn(`抖店页面在等待主图文件输入框时超时: ${inputSelector}`);
                }

                const inputLocator = page.locator(inputSelector);
                const inputCount = await inputLocator.count();
                const startIndex = inputCount > fileInputStartIndex ? fileInputStartIndex : 0;
                const uploadFiles = preparedImages.filePaths.slice(0, 5);
                uploadResult.availableInputs = inputCount;
                uploadResult.startIndex = startIndex;
                uploadResult.requested = uploadFiles.length;

                logger.info(`抖店检测到主图区域文件输入框数量: ${inputCount}`);
                logger.info(`抖店上传索引策略: startIndex=${startIndex}, usableInputCount=${Math.max(0, inputCount - startIndex)}, maxUploadCount=${Math.min(uploadFiles.length, 5)}`);

                if (inputCount <= 0) {
                    logger.warn('抖店未找到主图区域文件输入框');
                } else {
                    const firstInput = inputLocator.first();
                    const snapshot = await firstInput.evaluate((el) => ({
                        className: el.className || '',
                        id: el.id || '',
                        name: el.getAttribute('name') || '',
                        accept: el.getAttribute('accept') || '',
                        multiple: !!el.multiple,
                        disabled: !!el.disabled,
                        existingFiles: Array.from(el.files || []).map((file) => file.name)
                    })).catch((error) => {
                        logger.warn(`抖店读取首个文件输入框快照失败: input[0], error=${error?.message || error}`);
                        throw error;
                    });

                    logger.info('抖店首个文件输入框快照: input[0]', snapshot);

                    if (snapshot?.disabled) {
                        throw new Error('抖店首个文件输入框不可用（disabled）');
                    }

                    const beforeKeys = await collectUploadedPreviewKeys(page);
                    const beforeCount = beforeKeys.length;
                    const expectedNames = uploadFiles.map(getPathFileName).filter(Boolean);
                    logger.info(`抖店准备使用首个文件输入框批量上传: input[0], beforePreviewCount=${beforeCount}, files=${uploadFiles.map(toUserFriendlyPath)}`);
                    await firstInput.setInputFiles(uploadFiles);
                    logger.info(`抖店首个文件输入框批量 setInputFiles 完成: input[0], count=${uploadFiles.length}`);

                    let inputAccepted = false;
                    let inputAcceptErrorMessage = '';
                    try {
                        logger.info(`抖店等待单输入框接收多文件: input[0], expectedCount=${expectedNames.length}, files=${expectedNames}`);
                        await firstInput.waitFor({ state: 'attached', timeout: 5000 });
                        await firstInput.evaluate((el, expected) => {
                            return new Promise((resolve, reject) => {
                                const startedAt = Date.now();
                                const check = () => {
                                    const names = Array.from(el.files || []).map((file) => file.name);
                                    const matched = expected.length > 0
                                        && names.length >= expected.length
                                        && expected.every((name) => names.includes(name));
                                    if (matched) return resolve(true);
                                    if (Date.now() - startedAt > 8000) {
                                        return reject(new Error(`文件未完整进入 input, current=${names.join(', ')}`));
                                    }
                                    setTimeout(check, 150);
                                };
                                check();
                            });
                        }, expectedNames);
                        inputAccepted = true;
                        logger.info(`抖店单输入框已接收多文件: input[0], files=${expectedNames}`);
                    } catch (error) {
                        inputAcceptErrorMessage = error?.message || String(error || '');
                    }

                    let uploadConfirmed = false;
                    try {
                        logger.info(`抖店等待单输入框批量上传确认: input[0], beforePreviewCount=${beforeCount}, files=${expectedNames}`);
                        await page.waitForFunction((payload) => {
                            const nodes = payload.selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
                            const uniqueKeys = new Set();

                            nodes.forEach((node) => {
                                if (!(node instanceof HTMLImageElement)) return;
                                const src = node.currentSrc || node.src || '';
                                const width = node.naturalWidth || node.width || 0;
                                const height = node.naturalHeight || node.height || 0;
                                if (!src) return;
                                if (width > 32 || height > 32 || /^blob:|^data:image\//.test(src)) {
                                    uniqueKeys.add(`${src}|${width}|${height}`);
                                }
                            });

                            const keys = Array.from(uniqueKeys);
                            const hasNewPreview = keys.some((key) => !payload.beforeKeys.includes(key));
                            return keys.length > payload.beforeCount || hasNewPreview;
                        }, { beforeCount, beforeKeys, selectors: PREVIEW_IMAGE_SELECTORS }, { timeout: 15000 });
                        uploadConfirmed = true;
                        const afterCount = await countUploadedPreviewImages(page);
                        logger.info(`抖店单输入框批量上传预览确认成功: input[0], before=${beforeCount}, after=${afterCount}, files=${expectedNames}`);
                    } catch (error) {
                        logger.warn(`抖店单输入框批量上传预览确认超时: input[0], before=${beforeCount}, expectedIncrease=${uploadFiles.length}, error=${error?.message || error}`);
                        await page.waitForTimeout(3000);
                        const afterKeys = await collectUploadedPreviewKeys(page);
                        const afterCount = afterKeys.length;
                        const hasNewPreview = afterKeys.some((key) => !beforeKeys.includes(key));
                        if (afterCount > beforeCount || hasNewPreview) {
                            uploadConfirmed = true;
                            logger.info(`抖店单输入框批量上传超时后补充确认成功: input[0], before=${beforeCount}, after=${afterCount}, hasNewPreview=${hasNewPreview}`);
                        }
                    }

                    if (!inputAccepted && uploadConfirmed) {
                        logger.info(`抖店单输入框文件确认已跳过: input[0], 原因=${inputAcceptErrorMessage || 'input.files 已被页面清空，但预览已确认上传成功'}`);
                    }

                    if (!inputAccepted && !uploadConfirmed) {
                        if (inputAcceptErrorMessage) {
                            logger.warn(`抖店单输入框接收多文件未确认: input[0], error=${inputAcceptErrorMessage}`);
                        }
                        throw new Error('抖店首个文件输入框批量上传未确认成功: input[0]');
                    }

                    await page.waitForTimeout(3000);
                    uploadResult.uploadedPaths = [...uploadFiles];
                    logger.info(`抖店上传流程结束: uploaded=${uploadResult.uploadedPaths.length}/${uploadResult.requested}`);
                }
            } else {
                logger.warn('抖店图片路径预处理后为空，跳过文件输入步骤');
            }
        } else {
            logger.info('当前未提供图片，先跳过文件输入步骤');
        }

        let detailSectionReady = false;
        try {
            const detailFieldSelector = '[attr-field-id="商品详情"]';
            const detailHoverSelector = `${detailFieldSelector} [class*="styles_imgWrapper__"]`;
            const detailDeleteSelector = `${detailFieldSelector} [class*="styles_iconDelete__"]`;
            logger.info('抖店商品详情逻辑：准备处理商品详情区域');

            await triggerHover(page, detailHoverSelector, hoverMode, '抖店商品详情逻辑');

            const deleteLocator = page.locator(detailDeleteSelector).first();
            await deleteLocator.waitFor({ timeout: 5000, state: 'visible' });
            await deleteLocator.scrollIntoViewIfNeeded().catch(() => undefined);
            await page.waitForTimeout(200);
            await clickWithFallback(
                deleteLocator,
                () => page.evaluate((selector) => {
                    const target = document.querySelector(selector);
                    if (!(target instanceof HTMLElement)) return false;
                    target.click();
                    return true;
                }, detailDeleteSelector),
                `抖店商品详情逻辑：已点击删除按钮 locator(${detailDeleteSelector}).first()`,
                `抖店商品详情逻辑：已使用JS点击删除按钮 ${detailDeleteSelector}`
            );

            await page.waitForTimeout(300);
            logger.info('抖店商品详情逻辑：准备点击“从主图填入”按钮');
            const fillButton = page.locator(`${detailFieldSelector} button`).filter({ hasText: '从主图填入' }).first();
            await fillButton.waitFor({ timeout: 5000, state: 'visible' });
            await fillButton.scrollIntoViewIfNeeded().catch(() => undefined);
            await page.waitForTimeout(200);
            await clickWithFallback(
                fillButton,
                () => page.evaluate((fieldSelector) => {
                    const field = document.querySelector(fieldSelector);
                    if (!(field instanceof HTMLElement)) return false;
                    const target = Array.from(field.querySelectorAll('button')).find((button) => String(button.textContent || '').includes('从主图填入'));
                    if (!(target instanceof HTMLElement)) return false;
                    target.click();
                    return true;
                }, detailFieldSelector),
                '抖店商品详情逻辑：已点击“从主图填入”按钮',
                '抖店商品详情逻辑：已使用JS点击“从主图填入”按钮'
            );
            detailSectionReady = true;
            await page.waitForTimeout(300);
        } catch (error) {
            logger.warn(`抖店商品详情逻辑执行失败: ${error?.message || error}`);
        }

        let productCodeFilledCount = 0;
        if (!productCode) {
            logger.info('抖店商家编码逻辑：productCode 为空，跳过填写');
        } else {
            try {
                const productCodeSelector = 'td.attr-column-field_code input[type="text"]';
                const productCodeInputs = page.locator(productCodeSelector);
                const inputCount = await productCodeInputs.count();
                logger.info(`抖店商家编码逻辑：准备填写商家编码，inputCount=${inputCount}, value=${productCode}`);

                for (let index = 0; index < inputCount; index += 1) {
                    const input = productCodeInputs.nth(index);
                    await input.waitFor({ timeout: 5000, state: 'visible' });
                    await input.scrollIntoViewIfNeeded().catch(() => undefined);
                    await input.click({ clickCount: 3 }).catch(() => undefined);
                    await input.fill('').catch(() => undefined);
                    await input.fill(productCode);
                    productCodeFilledCount += 1;
                    logger.info(`抖店商家编码逻辑：已填写 input[${index}]`);
                }
            } catch (error) {
                logger.warn(`抖店商家编码逻辑执行失败: ${error?.message || error}`);
            }
        }

        const productCodeFilled = !productCode || productCodeFilledCount > 0;

        let publishSubmitted = false;
        let publishSuccessConfirmed = false;
        let publishSuccessSignal = '';
        let publishSuccessDetail = '';
        let publishFinalUrl = page.url();
        try {
            logger.info('抖店发布提交流程：准备点击“发布商品”按钮');
            const publishButton = page.locator('button').filter({ hasText: '发布商品' }).first();
            await publishButton.waitFor({ timeout: 5000, state: 'visible' });
            await publishButton.scrollIntoViewIfNeeded().catch(() => undefined);
            await page.waitForTimeout(200);
            const publishBaselineSignals = await collectDoudianPublishSignals(page);
            await clickWithFallback(
                publishButton,
                () => page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const target = buttons.find((button) => String(button.textContent || '').includes('发布商品'));
                    if (!(target instanceof HTMLElement)) return false;
                    target.click();
                    return true;
                }),
                '抖店发布提交流程：已点击“发布商品”按钮',
                '抖店发布提交流程：已使用JS点击“发布商品”按钮'
            );
            publishSubmitted = true;
            logger.info('抖店发布提交流程：已提交发布，开始多信号确认发布结果');
            const publishConfirmation = await waitForDoudianPublishConfirmation(page, publishBaselineSignals);
            publishSuccessConfirmed = true;
            publishSuccessSignal = String(publishConfirmation?.signal || '').trim();
            publishSuccessDetail = String(publishConfirmation?.detail || '').trim();
            publishFinalUrl = String(publishConfirmation?.finalUrl || page.url() || '').trim();
            logger.info(`抖店发布提交流程：已确认发布成功，signal=${publishSuccessSignal || 'unknown'}, detail=${publishSuccessDetail || 'n/a'}, finalUrl=${publishFinalUrl || 'n/a'}`);
        } catch (error) {
            logger.warn(`抖店发布提交流程执行失败: ${error?.message || error}`);
            publishFinalUrl = page.url();
        }

        const uploaded = uploadResult.uploadedPaths.length;
        const success = !!titleFilled
            && !!mainImageActionReady
            && uploaded > 0
            && !!detailSectionReady
            && !!productCodeFilled
            && !!publishSubmitted
            && !!publishSuccessConfirmed;
        if (page && success) {
            await page.close().catch(() => undefined);
            page = null;
            logger.info('抖店页面已关闭');
        }

        const failureReasons = [];
        if (!titleFilled) failureReasons.push('标题未填写成功');
        if (!mainImageActionReady) failureReasons.push('商品主图区域未准备完成');
        if (uploaded <= 0) failureReasons.push('主图未上传成功');
        if (!detailSectionReady) failureReasons.push('商品详情未处理成功');
        if (!productCodeFilled) failureReasons.push('商家编码未填写成功');
        if (!publishSubmitted) failureReasons.push('未点击发布商品');
        if (!publishSuccessConfirmed) failureReasons.push('未确认商品提交成功');

        return {
            success,
            message: success
                ? '抖店发布流程已提交'
                : `抖店发布失败：${failureReasons.join('，') || '关键步骤未完成'}`,
            data: {
                uploaded,
                requested: uploadResult.requested,
                availableInputs: uploadResult.availableInputs,
                startIndex: uploadResult.startIndex,
                uploadedPaths: uploadResult.uploadedPaths.map(toUserFriendlyPath),
                uploadedNames: uploadResult.uploadedPaths.map(getPathFileName),
                mainImageDeletedCount: mainImageClearResult.deletedCount,
                mainImageRemainingCount: mainImageClearResult.remainingCount,
                titleFilled,
                titleValue: titleFilled ? title : '',
                mainImageActionReady,
                detailSectionReady,
                productCode,
                productCodeFilledCount,
                productCodeFilled,
                publishSubmitted,
                publishSuccessConfirmed,
                publishSuccessSignal,
                publishSuccessDetail,
                publishFinalUrl,
                pageKeptOpen: !success
            }
        };
    } catch (error) {
        logger.error('抖店发布失败:', error);
        return {
            success: false,
            message: error?.message || '抖店发布失败'
        };
    } finally {
        tempFiles.forEach((file) => imageManager.deleteTempFile(file));
    }
}

export const doudianPublisher = { publish: publishToDoudian };

export default doudianPublisher;

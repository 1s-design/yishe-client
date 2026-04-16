import fs from 'fs';
import { getOrCreateBrowser } from '../services/BrowserService.js';
import { ImageManager } from '../services/ImageManager.js';
import { PageOperator } from '../services/PageOperator.js';
import { logger } from '../utils/logger.js';

const PLATFORM_KEY = 'kuaishou_shop';
const PLATFORM_NAME = '快手小店';
const DEFAULT_CREATE_URL = 'https://s.kwaixiaodian.com/zone/goods/nexus/self/release/add';
const BASE_INFO_TITLE_SELECTOR = '#BaseInfo > :nth-child(2) input';
const BASE_INFO_SHORT_TITLE_SELECTOR = '#BaseInfo > :nth-child(3) input';
const GOODS_IMAGE_UPLOAD_CONTAINER_SELECTOR = '#GoodsImg > :nth-child(2)';
const GOODS_DETAIL_IMAGE_UPLOAD_CONTAINER_SELECTOR = '#GoodsImg > :nth-child(6)';
const SKU_AND_PRICE_CONTAINER_SELECTOR = '#SkuAndPrice > :nth-child(4)';
const TABLE_FILL_PER_INPUT_TIMEOUT_MS = 8000;
const TABLE_FILL_TOTAL_TIMEOUT_MS = 45000;
const UPLOAD_WAIT_TIMEOUT_MS = 120000;
const UPLOAD_WAIT_POLL_INTERVAL_MS = 1000;
const UPLOAD_WAIT_LOG_INTERVAL_MS = 5000;
const SUBMIT_AUDIT_RETRY_COUNT = 5;
const SUBMIT_AUDIT_RETRY_DELAY_MS = 5000;
const SUBMIT_AUDIT_WAIT_TIMEOUT_MS = 15000;
const SUBMIT_AUDIT_WAIT_POLL_INTERVAL_MS = 500;
const SUBMIT_AUDIT_SUCCESS_TEXTS = [
    '发布成功',
    '商品上传成功',
    '提交审核成功',
    '提交成功'
];
const GOODS_IMAGE_DELETE_CONTAINER_SELECTORS = [
    '#GoodsImg > :nth-child(2)',
    '#GoodsImg > :nth-child(3)',
    '#GoodsImg > :nth-child(4)',
    '#GoodsImg > :nth-child(6)'
];
const LOGIN_USER_SELECTORS = ['.user-info', '.account-info', '.avatar', '.header-user', '[class*="merchant"]'];
const LOGIN_BUTTON_SELECTORS = ['.login-btn', '.login-button', '.auth-btn', 'text=登录', 'text=扫码登录'];

function resolveCreateUrl(sameId) {
    const normalizedSameId = String(sameId || '').trim();
    return normalizedSameId
        ? `${DEFAULT_CREATE_URL}?sameId=${encodeURIComponent(normalizedSameId)}`
        : DEFAULT_CREATE_URL;
}

function normalizeLimitedText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

async function inspectSubmitAuditSuccess(page) {
    return page.evaluate((successTexts) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const bodyText = normalize(document.body?.textContent || '');
        const matchedText = successTexts.find((text) => bodyText.includes(text));

        return {
            success: !!matchedText,
            matchedText: matchedText || '',
            bodySnippet: bodyText.slice(0, 500),
            pageUrl: String(window.location.href || '')
        };
    }, SUBMIT_AUDIT_SUCCESS_TEXTS).catch((error) => ({
        success: false,
        matchedText: '',
        bodySnippet: '',
        pageUrl: page.url(),
        error: error?.message || String(error || '')
    }));
}

async function waitForSubmitAuditSuccess(page, { timeoutMs = SUBMIT_AUDIT_WAIT_TIMEOUT_MS, pollingMs = SUBMIT_AUDIT_WAIT_POLL_INTERVAL_MS } = {}) {
    const startedAt = Date.now();
    let lastSnapshot = null;

    while (Date.now() - startedAt < timeoutMs) {
        lastSnapshot = await inspectSubmitAuditSuccess(page);
        if (lastSnapshot?.success) {
            return {
                ...lastSnapshot,
                type: 'success',
                signal: 'success_text',
                text: lastSnapshot.matchedText,
                elapsedMs: Date.now() - startedAt
            };
        }
        await page.waitForTimeout(pollingMs);
    }

    return {
        ...(lastSnapshot || {}),
        success: false,
        type: 'timeout',
        signal: 'success_text_not_found',
        text: lastSnapshot?.matchedText || '',
        elapsedMs: Date.now() - startedAt
    };
}

async function checkLogin(page) {
    for (const selector of LOGIN_USER_SELECTORS) {
        try {
            const locator = page.locator(selector).first();
            if (await locator.count()) {
                return true;
            }
        } catch {
            continue;
        }
    }

    for (const selector of LOGIN_BUTTON_SELECTORS) {
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

async function fillExactInput(page, selector, value, fieldLabel) {
    try {
        const input = page.locator(selector).first();
        await input.waitFor({ timeout: 10000, state: 'visible' });
        await input.scrollIntoViewIfNeeded().catch(() => undefined);
        await input.click({ clickCount: 3 }).catch(() => undefined);
        await input.fill('').catch(() => undefined);
        await input.fill(value);
        logger.info(`${PLATFORM_NAME}${fieldLabel}已填写: ${value}`);
        return true;
    } catch (error) {
        logger.warn(`${PLATFORM_NAME}${fieldLabel}填写失败: ${error?.message || error}`);
        return false;
    }
}

async function clearGoodsImages(page) {
    try {
        await page.waitForTimeout(500);
        const deleteCount = await page.evaluate((selectors) => {
            let count = 0;

            selectors.forEach((selector) => {
                const container = document.querySelector(selector);
                if (!(container instanceof HTMLElement)) return;

                const targets = Array.from(container.querySelectorAll('[aria-label="close-circle"]'));
                targets.forEach((target) => {
                    if (!(target instanceof HTMLElement)) return;
                    target.dispatchEvent(new MouseEvent('mousedown', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                    count += 1;
                });
            });

            return count;
        }, GOODS_IMAGE_DELETE_CONTAINER_SELECTORS);

        if (deleteCount > 0) {
            await page.waitForTimeout(500);
        }

        logger.info(`${PLATFORM_NAME}商品主图逻辑：已执行原图删除，deleteCount=${deleteCount}`);
        return deleteCount;
    } catch (error) {
        logger.warn(`${PLATFORM_NAME}商品主图逻辑：原图删除执行失败: ${error?.message || error}`);
        return 0;
    }
}

async function prepareImages(images, imageManager) {
    const filePaths = [];
    const tempFiles = [];

    for (let i = 0; i < images.length; i += 1) {
        const source = String(images[i] || '').trim();
        if (!source) continue;

        if (/^https?:\/\//i.test(source)) {
            const tempPath = await imageManager.downloadImage(source, `${PLATFORM_KEY}_${Date.now()}_${i}`);
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

async function scanGoodsUploadContainers(page) {
    return page.evaluate(() => {
        const root = document.querySelector('#GoodsImg');
        if (!(root instanceof HTMLElement)) {
            return {
                rootFound: false,
                containers: []
            };
        }

        const containers = Array.from(root.children).map((child, index) => {
            if (!(child instanceof HTMLElement)) {
                return null;
            }
            const fileInputCount = child.querySelectorAll('input[type="file"]').length;
            return {
                index: index + 1,
                selector: `#GoodsImg > :nth-child(${index + 1})`,
                tagName: child.tagName.toLowerCase(),
                className: child.className || '',
                textSnippet: String(child.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
                fileInputCount,
                uploadedCount: child.querySelectorAll('[aria-label="close-circle"]').length,
                loadingCount: child.querySelectorAll('.loading,[class*="loading"],[class*="uploading"],[class*="progress"]').length
            };
        }).filter(Boolean);

        return {
            rootFound: true,
            containers
        };
    }).catch(() => ({
        rootFound: false,
        containers: []
    }));
}

async function resolveUploadContainerSelector(page, {
    preferredSelector,
    candidateIndex,
    logPrefix
}) {
    const scanResult = await scanGoodsUploadContainers(page);
    logger.info(`${PLATFORM_NAME}${logPrefix}：上传区域扫描结果`, scanResult);

    if (preferredSelector) {
        const preferredInfo = scanResult.containers.find((item) => item.selector === preferredSelector);
        if (preferredInfo?.fileInputCount > 0) {
            return preferredSelector;
        }
    }

    const candidates = scanResult.containers.filter((item) => item.fileInputCount > 0);
    if (candidates[candidateIndex]) {
        logger.info(`${PLATFORM_NAME}${logPrefix}：使用动态识别上传区域`, candidates[candidateIndex]);
        return candidates[candidateIndex].selector;
    }

    if (candidates.length > 0) {
        const fallbackCandidate = candidates[candidates.length - 1];
        logger.warn(`${PLATFORM_NAME}${logPrefix}：未命中预期上传区域，回退到最后一个可上传区域`, fallbackCandidate);
        return fallbackCandidate.selector;
    }

    logger.warn(`${PLATFORM_NAME}${logPrefix}：未扫描到任何可上传区域，回退到默认 selector=${preferredSelector || ''}`);
    return preferredSelector;
}

async function waitForUploadCompletion(page, {
    containerSelector,
    targetCount,
    logPrefix
}) {
    const startedAt = Date.now();
    let lastLogAt = 0;

    while (Date.now() - startedAt < UPLOAD_WAIT_TIMEOUT_MS) {
        const state = await page.evaluate((selector) => {
            const container = document.querySelector(selector);
            if (!(container instanceof HTMLElement)) {
                return {
                    containerFound: false,
                    uploadedCount: 0,
                    textSnippet: ''
                };
            }
            const uploadedCount = container.querySelectorAll('[aria-label="close-circle"]').length;
            return {
                containerFound: true,
                uploadedCount,
                textSnippet: String(container.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200)
            };
        }, containerSelector).catch(() => ({
            containerFound: false,
            uploadedCount: 0,
            textSnippet: ''
        }));

        if (state.containerFound && state.uploadedCount >= targetCount) {
            logger.info(`${PLATFORM_NAME}${logPrefix}：上传确认完成`, {
                targetCount,
                uploadedCount: state.uploadedCount,
                elapsedMs: Date.now() - startedAt
            });
            return state.uploadedCount;
        }

        if (Date.now() - lastLogAt >= UPLOAD_WAIT_LOG_INTERVAL_MS) {
            lastLogAt = Date.now();
            logger.info(`${PLATFORM_NAME}${logPrefix}：上传等待中`, {
                targetCount,
                containerFound: state.containerFound,
                uploadedCount: state.uploadedCount,
                elapsedMs: Date.now() - startedAt,
                textSnippet: state.textSnippet
            });
        }

        await page.waitForTimeout(UPLOAD_WAIT_POLL_INTERVAL_MS);
    }

    const finalState = await page.evaluate((selector) => {
        const container = document.querySelector(selector);
        if (!(container instanceof HTMLElement)) {
            return {
                containerFound: false,
                uploadedCount: 0,
                htmlSnippet: ''
            };
        }
        return {
            containerFound: true,
            uploadedCount: container.querySelectorAll('[aria-label="close-circle"]').length,
            htmlSnippet: String(container.outerHTML || '').replace(/\s+/g, ' ').slice(0, 600)
        };
    }, containerSelector).catch(() => ({
        containerFound: false,
        uploadedCount: 0,
        htmlSnippet: ''
    }));

    logger.warn(`${PLATFORM_NAME}${logPrefix}：上传确认超时`, {
        targetCount,
        elapsedMs: Date.now() - startedAt,
        ...finalState
    });
    return finalState.uploadedCount || 0;
}

async function uploadGoodsImages(page, filePaths) {
    if (!filePaths.length) {
        return 0;
    }

    try {
        const containerSelector = await resolveUploadContainerSelector(page, {
            preferredSelector: GOODS_IMAGE_UPLOAD_CONTAINER_SELECTOR,
            candidateIndex: 0,
            logPrefix: '商品主图逻辑'
        });
        const beforeCount = await page.locator(`${containerSelector} [aria-label="close-circle"]`).count().catch(() => 0);
        const fileInput = page.locator(`${containerSelector} input[type="file"]`).first();
        await fileInput.waitFor({ timeout: 10000, state: 'attached' });
        await fileInput.setInputFiles(filePaths);
        logger.info(`${PLATFORM_NAME}商品主图逻辑：已触发商品图上传，beforeCount=${beforeCount}, expectedAdd=${filePaths.length}, containerSelector=${containerSelector}`);
        const uploadedCount = await waitForUploadCompletion(page, {
            containerSelector,
            targetCount: beforeCount + filePaths.length,
            logPrefix: '商品主图逻辑'
        });
        logger.info(`${PLATFORM_NAME}商品主图逻辑：商品图上传确认完成，uploadedCount=${uploadedCount}, expectedTotal=${beforeCount + filePaths.length}`);
        return Math.max(0, uploadedCount - beforeCount);
    } catch (error) {
        logger.warn(`${PLATFORM_NAME}商品主图逻辑：商品图上传失败: ${error?.message || error}`);
        return 0;
    }
}

async function uploadGoodsDetailImages(page, filePaths) {
    if (!filePaths.length) {
        return 0;
    }

    try {
        const containerSelector = await resolveUploadContainerSelector(page, {
            preferredSelector: GOODS_DETAIL_IMAGE_UPLOAD_CONTAINER_SELECTOR,
            candidateIndex: 1,
            logPrefix: '商品详情图逻辑'
        });
        const beforeCount = await page.locator(`${containerSelector} [aria-label="close-circle"]`).count().catch(() => 0);
        const fileInput = page.locator(`${containerSelector} input[type="file"]`).first();
        await fileInput.waitFor({ timeout: 10000, state: 'attached' });
        await fileInput.setInputFiles(filePaths);
        logger.info(`${PLATFORM_NAME}商品详情图逻辑：已触发详情图上传，beforeCount=${beforeCount}, expectedAdd=${filePaths.length}, containerSelector=${containerSelector}`);
        logger.info(`${PLATFORM_NAME}商品详情图逻辑：上传触发后重新扫描区域`, await scanGoodsUploadContainers(page));
        const uploadedCount = await waitForUploadCompletion(page, {
            containerSelector,
            targetCount: beforeCount + filePaths.length,
            logPrefix: '商品详情图逻辑'
        });
        logger.info(`${PLATFORM_NAME}商品详情图逻辑：详情图上传确认完成，uploadedCount=${uploadedCount}, expectedTotal=${beforeCount + filePaths.length}`);
        return Math.max(0, uploadedCount - beforeCount);
    } catch (error) {
        logger.warn(`${PLATFORM_NAME}商品详情图逻辑：详情图上传失败: ${error?.message || error}`);
        return 0;
    }
}

async function clickSubmitAudit(page) {
    try {
        logger.info(`${PLATFORM_NAME}提交流程：等待“提交审核”按钮进入可点击状态`);
        const buttonScan = await page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll('button'));
            return nodes
                .map((node, index) => {
                    if (!(node instanceof HTMLButtonElement)) return null;
                    const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
                    if (text !== '提交审核') return null;
                    const rect = node.getBoundingClientRect();
                    return {
                        index,
                        tagName: node.tagName.toLowerCase(),
                        text,
                        className: node.className || '',
                        disabled: node.hasAttribute('disabled')
                            || node.getAttribute('aria-disabled') === 'true'
                            || node.classList.contains('disabled')
                            || rect.width <= 0
                            || rect.height <= 0,
                        rect: {
                            x: Math.round(rect.x),
                            y: Math.round(rect.y),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height)
                        },
                        outerHtmlSnippet: String(node.outerHTML || '').replace(/\s+/g, ' ').slice(0, 320)
                    };
                })
                .filter(Boolean);
        });
        logger.info(`${PLATFORM_NAME}提交流程：提交审核按钮扫描结果`, buttonScan);

        const button = page.locator('button').filter({ hasText: /^提交审核$/ }).first();
        await button.waitFor({ timeout: 10000, state: 'visible' });
        await button.scrollIntoViewIfNeeded().catch(() => undefined);

        const readyHandle = await page.waitForFunction(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find((node) => {
                if (!(node instanceof HTMLButtonElement)) return false;
                const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
                return text === '提交审核';
            });
            if (!(target instanceof HTMLButtonElement)) return false;
            const rect = target.getBoundingClientRect();
            const disabled = target.hasAttribute('disabled')
                || target.getAttribute('aria-disabled') === 'true'
                || target.classList.contains('disabled')
                || rect.width <= 0
                || rect.height <= 0;
            return !disabled;
        }, { timeout: 30000, polling: 500 });

        const readyState = await readyHandle.jsonValue().then(async () => {
            return button.evaluate((node) => {
                if (!(node instanceof HTMLButtonElement)) {
                    return {
                        ready: false,
                        reason: 'button_not_found'
                    };
                }
                const rect = node.getBoundingClientRect();
                return {
                    ready: true,
                    text: String(node.textContent || '').replace(/\s+/g, ' ').trim(),
                    className: node.className || '',
                    disabled: node.hasAttribute('disabled')
                        || node.getAttribute('aria-disabled') === 'true'
                        || node.classList.contains('disabled')
                        || rect.width <= 0
                        || rect.height <= 0,
                    rect: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    }
                };
            });
        }).catch(async (error) => {
            const lastState = await button.evaluate((node) => {
                if (!(node instanceof HTMLButtonElement)) {
                    return {
                        ready: false,
                        reason: 'button_not_found'
                    };
                }
                const rect = node.getBoundingClientRect();
                return {
                    ready: false,
                    text: String(node.textContent || '').replace(/\s+/g, ' ').trim(),
                    className: node.className || '',
                    disabled: node.hasAttribute('disabled')
                        || node.getAttribute('aria-disabled') === 'true'
                        || node.classList.contains('disabled')
                        || rect.width <= 0
                        || rect.height <= 0,
                    rect: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    },
                    error: error?.message || String(error || '')
                };
            }).catch(() => ({
                ready: false,
                reason: 'button_state_read_failed',
                error: error?.message || String(error || '')
            }));
            return lastState;
        });
        logger.info(`${PLATFORM_NAME}提交流程：按钮就绪状态`, readyState);

        if (!readyState?.ready) {
            logger.warn(`${PLATFORM_NAME}提交流程：等待超时，提交审核按钮仍不可点击`, readyState);
            return false;
        }

        const beforeState = await button.evaluate((node) => {
            if (!(node instanceof HTMLButtonElement)) {
                return { found: false };
            }
            const rect = node.getBoundingClientRect();
            return {
                found: true,
                text: String(node.textContent || '').replace(/\s+/g, ' ').trim(),
                className: node.className || '',
                disabled: node.hasAttribute('disabled')
                    || node.getAttribute('aria-disabled') === 'true'
                    || node.classList.contains('disabled'),
                rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                }
            };
        }).catch((error) => ({
            found: false,
            error: error?.message || String(error || '')
        }));
        logger.info(`${PLATFORM_NAME}提交流程：点击前按钮状态`, beforeState);

        if (beforeState.disabled) {
            logger.warn(`${PLATFORM_NAME}提交流程：提交审核按钮当前不可点击`, beforeState);
            return false;
        }

        for (let attempt = 1; attempt <= SUBMIT_AUDIT_RETRY_COUNT; attempt += 1) {
            const currentButton = page.locator('button').filter({ hasText: /^提交审核$/ }).first();
            const currentButtonCount = await currentButton.count().catch(() => 0);
            if (!currentButtonCount) {
                logger.warn(`${PLATFORM_NAME}提交流程：第${attempt}次提交前未找到“提交审核”按钮，先等待成功文案确认`, {
                    waitTimeoutMs: SUBMIT_AUDIT_WAIT_TIMEOUT_MS
                });
                const submitResult = await waitForSubmitAuditSuccess(page);
                logger.info(`${PLATFORM_NAME}提交流程：按钮缺失后的成功文案检查结果`, { attempt, ...submitResult });
                return !!submitResult?.success;
            }

            let clickMethod = 'locator.click';
            try {
                await currentButton.click({ delay: 100, timeout: 5000 });
            } catch (clickError) {
                logger.warn(`${PLATFORM_NAME}提交流程：第${attempt}次常规点击失败，尝试 DOM click`, {
                    message: clickError?.message || String(clickError || '')
                });
                clickMethod = 'dom.click';
                const domClickResult = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const target = buttons.find((node) => {
                        if (!(node instanceof HTMLButtonElement)) return false;
                        return String(node.textContent || '').replace(/\s+/g, ' ').trim() === '提交审核';
                    });

                    if (!(target instanceof HTMLButtonElement)) {
                        return {
                            clicked: false,
                            reason: 'button_not_found'
                        };
                    }

                    target.click();
                    return {
                        clicked: true
                    };
                }).catch((domClickError) => ({
                    clicked: false,
                    reason: 'dom_click_failed',
                    error: domClickError?.message || String(domClickError || '')
                }));

                if (!domClickResult?.clicked) {
                    logger.warn(`${PLATFORM_NAME}提交流程：第${attempt}次 DOM click 未执行成功`, {
                        domClickResult
                    });
                    return false;
                }
            }

            logger.info(`${PLATFORM_NAME}提交流程：已触发“提交审核”按钮点击`, { attempt, clickMethod });
            logger.info(`${PLATFORM_NAME}提交流程：等待成功页面文案`, {
                attempt,
                successTexts: SUBMIT_AUDIT_SUCCESS_TEXTS,
                timeoutMs: SUBMIT_AUDIT_WAIT_TIMEOUT_MS
            });

            const submitResult = await waitForSubmitAuditSuccess(page);

            logger.info(`${PLATFORM_NAME}提交流程：提交结果`, { attempt, ...submitResult });
            if (submitResult?.success) {
                return true;
            }

            if (attempt < SUBMIT_AUDIT_RETRY_COUNT) {
                logger.warn(`${PLATFORM_NAME}提交流程：第${attempt}次提交未成功，等待后重试`, {
                    nextRetryInMs: SUBMIT_AUDIT_RETRY_DELAY_MS,
                    submitResult
                });
                await page.waitForTimeout(SUBMIT_AUDIT_RETRY_DELAY_MS);
            } else {
                logger.warn(`${PLATFORM_NAME}提交流程：${SUBMIT_AUDIT_RETRY_COUNT}次提交均未成功`, submitResult);
            }
        }

        return false;
    } catch (error) {
        logger.warn(`${PLATFORM_NAME}提交流程执行失败或超时: ${error?.message || error}`);
        return false;
    }
}

async function fillTableColumnInputs(page, { containerSelector, columnKeyword, value, logPrefix }) {
    const startedAt = Date.now();
    try {
        const result = await page.evaluate(({ containerSelector, columnKeyword, markerPrefix }) => {
            const getNodePath = (node) => {
                if (!(node instanceof Element)) return '';
                const parts = [];
                let current = node;
                while (current && current instanceof Element && parts.length < 6) {
                    let part = current.tagName.toLowerCase();
                    if (current.id) {
                        part += `#${current.id}`;
                    } else if (current.classList.length) {
                        part += `.${Array.from(current.classList).slice(0, 2).join('.')}`;
                    }
                    const parent = current.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
                        if (siblings.length > 1) {
                            part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
                        }
                    }
                    parts.unshift(part);
                    current = current.parentElement;
                }
                return parts.join(' > ');
            };
            const getInputSelector = (node) => {
                if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return '';
                if (node.id) return `#${node.id}`;
                const path = [];
                let current = node;
                while (current && current instanceof Element && path.length < 8) {
                    let part = current.tagName.toLowerCase();
                    if (current.classList.length) {
                        part += `.${Array.from(current.classList).slice(0, 2).join('.')}`;
                    }
                    const parent = current.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
                        if (siblings.length > 1) {
                            part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
                        }
                    }
                    path.unshift(part);
                    current = current.parentElement;
                    if (current?.id) {
                        path.unshift(`#${current.id}`);
                        break;
                    }
                }
                return path.join(' > ');
            };
            const getOuterHtmlSnippet = (node) => {
                if (!(node instanceof Element)) return '';
                return String(node.outerHTML || '').replace(/\s+/g, ' ').slice(0, 320);
            };
            const getRectInfo = (node) => {
                if (!(node instanceof Element)) return null;
                const rect = node.getBoundingClientRect();
                return {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                };
            };
            const container = document.querySelector(containerSelector);
            if (!(container instanceof HTMLElement)) {
                throw new Error(`未找到 SKU 区域: ${containerSelector}`);
            }

            const normalizedKeyword = String(columnKeyword || '').trim().toLowerCase();
            const keywordAliases = normalizedKeyword === 'sku'
                ? ['sku', 'sku编码', '商品编码', '商家编码', '货号', '编码']
                : normalizedKeyword === '库存'
                    ? ['库存', '库存数量', '可售库存', '库存数']
                    : [normalizedKeyword];

            const headerRoot = container.querySelector('.kwaishop-goods-nexus-pc-table-header')
                || container.querySelector('[class*="table-header"]')
                || container.querySelector('thead');
            const bodyRoot = container.querySelector('.kwaishop-goods-nexus-pc-table-body')
                || container.querySelector('[class*="table-body"]')
                || container.querySelector('tbody');
            if (!(headerRoot instanceof HTMLElement)) {
                throw new Error('未找到 SKU 表头区域');
            }
            if (!(bodyRoot instanceof HTMLElement)) {
                throw new Error('未找到 SKU 表体区域');
            }

            const headerTable = headerRoot.querySelector('table');
            const bodyTable = bodyRoot.querySelector('table');
            const headerCells = Array.from((headerTable || headerRoot).querySelectorAll('th,[role="columnheader"],.header-cell,.table-cell,[class*="header-cell"]'));
            const columnIndex = headerCells.findIndex((cell) => {
                const text = String(cell.textContent || '').trim().toLowerCase();
                return keywordAliases.some((keyword) => text === keyword || text.includes(keyword));
            });
            if (columnIndex < 0) {
                throw new Error(`未找到“${columnKeyword}”列，headers=${headerCells.map((cell) => String(cell.textContent || '').trim()).join(' | ')}`);
            }

            const headerCell = headerCells[columnIndex];
            const bodyRows = Array.from((bodyTable || bodyRoot).querySelectorAll('tr,[role="row"],.table-row,[class*="table-row"]')).filter((row) => {
                return row.querySelectorAll('td,[role="cell"],.table-cell,[class*="table-cell"]').length > columnIndex;
            });
            const columnInputs = [];
            const candidateInputs = [];
            const taggedInputIds = [];

            for (const row of bodyRows) {
                const cells = Array.from(row.querySelectorAll('td,[role="cell"],.table-cell,[class*="table-cell"]'));
                const cell = cells[columnIndex];
                if (!(cell instanceof HTMLElement)) continue;

                const inputs = Array.from(cell.querySelectorAll('input, textarea'));
                inputs.forEach((input) => {
                    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
                        const inputId = `${markerPrefix}-${Math.random().toString(36).slice(2, 10)}`;
                        input.setAttribute('data-yishe-sku-code-id', inputId);
                        columnInputs.push(input);
                        taggedInputIds.push(inputId);
                        candidateInputs.push({
                            source: 'table-column',
                            tagName: input.tagName.toLowerCase(),
                            value: input.value,
                            placeholder: input.getAttribute('placeholder') || '',
                            name: input.getAttribute('name') || '',
                            type: input.getAttribute('type') || '',
                            className: input.className || '',
                            path: getNodePath(input),
                            selector: getInputSelector(input),
                            tempSelector: `[data-yishe-sku-code-id="${inputId}"]`,
                            rect: getRectInfo(input),
                            cellText: String(cell.textContent || '').trim().slice(0, 180),
                            outerHtmlSnippet: getOuterHtmlSnippet(input)
                        });
                    }
                });
            }

            if (!columnInputs.length) {
                const fallbackInputs = Array.from(container.querySelectorAll('input, textarea')).filter((input) => input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement);
                fallbackInputs.forEach((input) => {
                    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
                        const ariaLabel = String(input.getAttribute('aria-label') || '');
                        const placeholder = String(input.getAttribute('placeholder') || '');
                        const name = String(input.getAttribute('name') || '');
                        const dataLabel = String(input.getAttribute('data-label') || '');
                        const nearbyText = String(input.parentElement?.textContent || '');
                        if (
                            keywordAliases.some((keyword) => ariaLabel.toLowerCase().includes(keyword))
                            || keywordAliases.some((keyword) => placeholder.toLowerCase().includes(keyword))
                            || keywordAliases.some((keyword) => name.toLowerCase().includes(keyword))
                            || keywordAliases.some((keyword) => dataLabel.toLowerCase().includes(keyword))
                            || keywordAliases.some((keyword) => nearbyText.toLowerCase().includes(keyword))
                        ) {
                            const inputId = `${markerPrefix}-${Math.random().toString(36).slice(2, 10)}`;
                            input.setAttribute('data-yishe-sku-code-id', inputId);
                            columnInputs.push(input);
                            taggedInputIds.push(inputId);
                            candidateInputs.push({
                                source: 'fallback-search',
                                tagName: input.tagName.toLowerCase(),
                                value: input.value,
                                placeholder,
                                name,
                                type: input.getAttribute('type') || '',
                                className: input.className || '',
                                ariaLabel,
                                dataLabel,
                                path: getNodePath(input),
                                selector: getInputSelector(input),
                                tempSelector: `[data-yishe-sku-code-id="${inputId}"]`,
                                rect: getRectInfo(input),
                                cellText: nearbyText.trim().slice(0, 180),
                                outerHtmlSnippet: getOuterHtmlSnippet(input)
                            });
                        }
                    }
                });
            }

            return {
                containerFound: true,
                tableFound: !!headerTable || !!bodyTable,
                headerRootFound: true,
                bodyRootFound: true,
                containerSelector,
                keywordAliases,
                columnIndex,
                rowCount: bodyRows.length,
                headerText: String(headerCell?.textContent || '').trim(),
                headerTexts: headerCells.map((cell) => String(cell.textContent || '').trim()),
                candidateInputCount: columnInputs.length,
                candidateInputs,
                taggedInputIds
            };
        }, {
            containerSelector,
            columnKeyword: String(columnKeyword || '').trim().toLowerCase(),
            markerPrefix: `yishe-${String(columnKeyword || 'column').trim().toLowerCase()}`
        });

        logger.info(`${PLATFORM_NAME}${logPrefix}：容器和表格扫描结果`, {
            containerSelector: result.containerSelector,
            containerFound: result.containerFound,
            tableFound: result.tableFound,
            headerRootFound: result.headerRootFound,
            bodyRootFound: result.bodyRootFound,
            keywordAliases: result.keywordAliases,
            headerTexts: result.headerTexts,
            columnIndex: result.columnIndex,
            headerText: result.headerText,
            rowCount: result.rowCount,
            candidateInputCount: result.candidateInputCount,
            value
        });
        logger.info(`${PLATFORM_NAME}${logPrefix}：候选输入框明细`, result.candidateInputs || []);

        const fillDebug = [];
        let filledCount = 0;
        const targetValue = String(value);
        for (const inputId of result.taggedInputIds || []) {
            const elapsedMs = Date.now() - startedAt;
            if (elapsedMs > TABLE_FILL_TOTAL_TIMEOUT_MS) {
                logger.warn(`${PLATFORM_NAME}${logPrefix}：达到总超时时间，提前结束填写`, {
                    elapsedMs,
                    filledCount,
                    candidateCount: result.taggedInputIds?.length || 0
                });
                break;
            }
            const tempSelector = `[data-yishe-sku-code-id="${inputId}"]`;
            try {
                const entryResult = await page.evaluate(({ selector, nextValue }) => {
                    const node = document.querySelector(selector);
                    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
                        return {
                            ok: false,
                            reason: 'node_not_found'
                        };
                    }
                    const beforeValue = node.value;
                    const prototype = node instanceof HTMLInputElement
                        ? window.HTMLInputElement.prototype
                        : window.HTMLTextAreaElement.prototype;
                    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
                    if (descriptor?.set) {
                        descriptor.set.call(node, nextValue);
                    } else {
                        node.value = nextValue;
                    }
                    node.dispatchEvent(new Event('input', { bubbles: true }));
                    node.dispatchEvent(new Event('change', { bubbles: true }));
                    node.dispatchEvent(new Event('blur', { bubbles: true }));
                    const afterValue = node.value;
                    return {
                        ok: String(afterValue).trim() === String(nextValue).trim(),
                        beforeValue,
                        afterValue,
                        visible: (() => {
                            const rect = node.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        })()
                    };
                }, {
                    selector: tempSelector,
                    nextValue: targetValue
                });
                fillDebug.push({
                    tempSelector,
                    ...entryResult
                });
                if (entryResult?.ok) {
                    filledCount += 1;
                } else {
                    logger.warn(`${PLATFORM_NAME}${logPrefix}：输入框值校验未通过`, {
                        tempSelector,
                        ...entryResult,
                        expectedValue: targetValue
                    });
                }
            } catch (error) {
                fillDebug.push({
                    tempSelector,
                    error: error?.message || String(error || '')
                });
            }
        }

        await page.evaluate(() => {
            document.querySelectorAll('[data-yishe-sku-code-id]').forEach((node) => {
                if (node instanceof HTMLElement) {
                    node.removeAttribute('data-yishe-sku-code-id');
                }
            });
        }).catch(() => undefined);

        logger.info(`${PLATFORM_NAME}${logPrefix}：输入执行明细`, fillDebug);
        logger.info(`${PLATFORM_NAME}${logPrefix}：填写结果汇总`, {
            filledCount,
            candidateCount: result.taggedInputIds?.length || 0,
            elapsedMs: Date.now() - startedAt
        });
        return filledCount;
    } catch (error) {
        logger.warn(`${PLATFORM_NAME}${logPrefix}执行失败: ${error?.message || error}`);
        return 0;
    }
}

export async function publishToKuaishouShop(publishInfo = {}) {
    const imageManager = new ImageManager();
    const pageOperator = new PageOperator();
    const tempFiles = [];
    let page = null;

    try {
        const settings = publishInfo.platformOptions || publishInfo.publishOptions || publishInfo.platformSettings?.[PLATFORM_KEY] || {};
        const sameId = String(settings.sameId || publishInfo.sameId || '').trim();
        const targetUploadUrl = resolveCreateUrl(sameId);
        const title = normalizeLimitedText(publishInfo.title || publishInfo.name || '', 30);
        const shortTitle = normalizeLimitedText(settings.shortTitle ?? publishInfo.shortTitle ?? title, 10);
        const images = Array.isArray(publishInfo.images) ? publishInfo.images.filter(Boolean) : [];
        const productCode = String(
            settings.productCode
            ?? publishInfo.productCode
            ?? publishInfo.data?.productCode
            ?? ''
        ).trim();
        const inventoryValue = '999';

        logger.info(`开始执行${PLATFORM_NAME}发布流程`);
        logger.info(`${PLATFORM_NAME}目标发布页: ${targetUploadUrl}`);

        const browser = await getOrCreateBrowser({ profileId: publishInfo?.profileId });
        page = await browser.newPage({ foreground: true });
        await pageOperator.setupAntiDetection(page);

        await page.goto(targetUploadUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await page.waitForTimeout(3000);

        const isLoggedIn = await checkLogin(page);
        if (!isLoggedIn) {
            return {
                success: false,
                message: `请先登录${PLATFORM_NAME}商家后台`,
                data: {
                    pageKeptOpen: true
                }
            };
        }

        const titleFilled = title
            ? await fillExactInput(page, BASE_INFO_TITLE_SELECTOR, title, '商品标题')
            : false;
        const shortTitleFilled = shortTitle
            ? await fillExactInput(page, BASE_INFO_SHORT_TITLE_SELECTOR, shortTitle, '短标题')
            : false;

        let deletedCount = 0;
        let preparedImageCount = 0;
        let uploadedImageCount = 0;
        let uploadedDetailImageCount = 0;
        let productCodeFilledCount = 0;
        let inventoryFilledCount = 0;
        let submitAuditClicked = false;
        if (images.length > 0) {
            deletedCount = await clearGoodsImages(page);
            const preparedImages = await prepareImages(images, imageManager);
            tempFiles.push(...preparedImages.tempFiles);
            preparedImageCount = preparedImages.filePaths.length;
            logger.info(`${PLATFORM_NAME}图片已预处理完成，count=${preparedImageCount}`);
            uploadedImageCount = await uploadGoodsImages(page, preparedImages.filePaths);
            if (uploadedImageCount < preparedImageCount) {
                return {
                    success: false,
                    message: `${PLATFORM_NAME}商品图上传未完成`,
                    data: {
                        pageKeptOpen: true,
                        deletedCount,
                        preparedImageCount,
                        uploadedImageCount
                    }
                };
            }
            uploadedDetailImageCount = await uploadGoodsDetailImages(page, preparedImages.filePaths);
            if (uploadedDetailImageCount < preparedImageCount) {
                return {
                    success: false,
                    message: `${PLATFORM_NAME}商品详情图上传未完成`,
                    data: {
                        pageKeptOpen: true,
                        deletedCount,
                        preparedImageCount,
                        uploadedImageCount,
                        uploadedDetailImageCount
                    }
                };
            }
        }

        if (!productCode) {
            logger.info(`${PLATFORM_NAME}SKU编码逻辑：productCode 为空，跳过填写`);
        } else {
            productCodeFilledCount = await fillTableColumnInputs(page, {
                containerSelector: SKU_AND_PRICE_CONTAINER_SELECTOR,
                columnKeyword: 'sku',
                value: productCode,
                logPrefix: 'SKU编码逻辑'
            });
            if (productCodeFilledCount <= 0) {
                logger.error(`${PLATFORM_NAME}SKU编码逻辑：未成功填写任何 SKU 编码输入框`, {
                    productCode,
                    pageUrl: page.url()
                });
                return {
                    success: false,
                    message: `${PLATFORM_NAME}SKU编码未填写成功`,
                    data: {
                        pageKeptOpen: true,
                        titleFilled,
                        shortTitleFilled,
                        titleValue: title,
                        shortTitleValue: shortTitle,
                        deletedCount,
                        preparedImageCount,
                        uploadedImageCount,
                        uploadedDetailImageCount,
                        productCode,
                        productCodeFilledCount,
                        inventoryValue,
                        inventoryFilledCount,
                        pageUrl: page.url()
                    }
                };
            }
        }

        inventoryFilledCount = await fillTableColumnInputs(page, {
            containerSelector: SKU_AND_PRICE_CONTAINER_SELECTOR,
            columnKeyword: '库存',
            value: inventoryValue,
            logPrefix: '库存逻辑'
        });
        if (inventoryFilledCount <= 0) {
            logger.error(`${PLATFORM_NAME}库存逻辑：未成功填写任何库存输入框`, {
                inventoryValue,
                pageUrl: page.url()
            });
            return {
                success: false,
                message: `${PLATFORM_NAME}库存未填写成功`,
                data: {
                    pageKeptOpen: true,
                    titleFilled,
                    shortTitleFilled,
                    titleValue: title,
                    shortTitleValue: shortTitle,
                    deletedCount,
                    preparedImageCount,
                    uploadedImageCount,
                    uploadedDetailImageCount,
                    productCode,
                    productCodeFilledCount,
                    inventoryValue,
                    inventoryFilledCount,
                    pageUrl: page.url()
                }
            };
        }

        submitAuditClicked = await clickSubmitAudit(page);

        const success = !!titleFilled
            && !!shortTitleFilled
            && (!productCode || productCodeFilledCount > 0)
            && inventoryFilledCount > 0
            && !!submitAuditClicked;
        const failureReasons = [];
        if (!titleFilled) failureReasons.push('商品标题未填写成功');
        if (!shortTitleFilled) failureReasons.push('短标题未填写成功');
        if (productCode && productCodeFilledCount <= 0) failureReasons.push('SKU编码未填写成功');
        if (inventoryFilledCount <= 0) failureReasons.push('库存未填写成功');
        if (!submitAuditClicked) failureReasons.push('未确认提交审核成功');

        return {
            success,
            message: success
                ? `${PLATFORM_NAME}发布流程已提交`
                : `${PLATFORM_NAME}发布流程未完成：${failureReasons.join('，') || '关键步骤未完成'}`,
            data: {
                pageKeptOpen: true,
                titleFilled,
                shortTitleFilled,
                titleValue: title,
                shortTitleValue: shortTitle,
                deletedCount,
                preparedImageCount,
                uploadedImageCount,
                uploadedDetailImageCount,
                productCode,
                productCodeFilledCount,
                inventoryValue,
                inventoryFilledCount,
                submitAuditClicked,
                pageUrl: page?.url?.()
            }
        };
    } catch (error) {
        logger.error(`${PLATFORM_NAME}发布失败:`, error);
        return {
            success: false,
            message: error?.message || `${PLATFORM_NAME}发布失败`,
            data: {
                pageKeptOpen: true
            }
        };
    } finally {
        tempFiles.forEach((file) => imageManager.deleteTempFile(file));
        if (page) {
            logger.info(`${PLATFORM_NAME}调试模式：保留页面，不自动关闭 tab`);
        }
    }
}

export const kuaishouShopPublisher = { publish: publishToKuaishouShop };

export default kuaishouShopPublisher;

import fs from 'fs';
import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { ImageManager } from '../../services/ImageManager.js';
import { logger } from '../../utils/logger.js';
import {
    PLATFORM_NAME,
    TEMU_DEFAULT_UPLOAD_REFERER,
    TEMU_IMAGE_UPLOAD_SIGNATURE_TAG,
    TEMU_IMAGE_UPLOAD_SIGNATURE_URL,
    TEMU_STORE_IMAGE_URL
} from './constants.js';
import { getTemuCurrentSessionContext } from './session.js';
import { clickClickableByText } from './page.js';

const TEMU_IMAGE_TRIGGER_LABELS = [
    '选择图片',
    '从图库选择',
    '从图片空间选择',
    '图片空间',
    '图库',
    '选择素材',
    '添加图片',
    '添加商品图',
    '添加详情图',
    '管理图片'
];

const TEMU_IMAGE_SECTION_KEYWORDS = [
    '商品图',
    '商品图片',
    '主图',
    '轮播图',
    '详情图',
    '详情图片',
    '图文详情',
    '产品图片',
    '图片信息'
];

const TEMU_IMAGE_PICKER_CONFIRM_LABELS = ['确定', '确认', '完成', '选择', '提交', '保存'];

function normalizeText(value) {
    return String(value || '').trim();
}

function dedupeStrings(values = []) {
    return Array.from(new Set(values.map((item) => normalizeText(item)).filter(Boolean)));
}

function summarizeImageSourceForLog(value = '') {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }

    try {
        const url = new URL(normalized);
        const fileName = normalizeText(url.pathname.split('/').pop() || '');
        return fileName || normalized.slice(0, 160);
    } catch {
        return basename(normalized) || normalized.slice(0, 160);
    }
}

function escapeForHasText(value = '') {
    return String(value || '').replace(/(["\\])/g, '\\$1');
}

function extractImageSource(item) {
    if (typeof item === 'string') {
        return normalizeText(item);
    }

    if (!item || typeof item !== 'object') {
        return '';
    }

    const candidates = [
        item.source,
        item.url,
        item.src,
        item.path,
        item.filePath,
        item.image,
        item.imageUrl,
        item.image_url,
        item.ossUrl,
        item.oss_image_url
    ];

    return candidates.map((value) => normalizeText(value)).find(Boolean) || '';
}

function flattenImageSources(input) {
    if (Array.isArray(input)) {
        return input.map(extractImageSource).filter(Boolean);
    }

    if (typeof input === 'string') {
        const normalized = normalizeText(input);
        if (!normalized) {
            return [];
        }
        if (/^https?:\/\//i.test(normalized) || /^[a-zA-Z]:[\\/]/.test(normalized)) {
            return [normalized];
        }

        return normalized
            .split(/[\n,，]/)
            .map((item) => normalizeText(item))
            .filter(Boolean);
    }

    if (input && typeof input === 'object') {
        const directSource = extractImageSource(input);
        if (directSource) {
            return [directSource];
        }
        return Object.values(input).map(extractImageSource).filter(Boolean);
    }

    return [];
}

function collectImageSources(input) {
    if (Array.isArray(input)) {
        return input.flatMap((item) => collectImageSources(item));
    }

    return flattenImageSources(input);
}

export function normalizeTemuImageSources(input = []) {
    return dedupeStrings(collectImageSources(input));
}

export function resolveTemuPublishImageSources(publishInfo = {}) {
    const candidateLists = [
        publishInfo.images,
        publishInfo.imageUrls,
        publishInfo.imageSources,
        publishInfo.assets?.images,
        publishInfo.media?.images,
        publishInfo.data?.images,
        publishInfo.data?.imageUrls,
        publishInfo.data?.imageSources,
        publishInfo.meta?.images,
        publishInfo.metadata?.images
    ];

    return normalizeTemuImageSources(candidateLists);
}

function inferMimeType(filePath = '') {
    const extension = extname(String(filePath || '')).replace('.', '').toLowerCase();
    switch (extension) {
        case 'png':
            return 'image/png';
        case 'webp':
            return 'image/webp';
        case 'gif':
            return 'image/gif';
        case 'bmp':
            return 'image/bmp';
        case 'avif':
            return 'image/avif';
        case 'jpeg':
        case 'jpg':
        default:
            return 'image/jpeg';
    }
}

async function prepareTemuImageFiles(imageSources = []) {
    const imageManager = new ImageManager();
    const fileEntries = [];
    const tempFiles = [];

    try {
        for (let index = 0; index < imageSources.length; index += 1) {
            const source = normalizeText(imageSources[index]);
            if (!source) {
                continue;
            }

            if (/^https?:\/\//i.test(source)) {
                const tempPath = await imageManager.downloadImage(
                    source,
                    `temu_publish_${Date.now()}_${index}`
                );
                fileEntries.push({
                    source,
                    filePath: tempPath,
                    fileName: basename(tempPath),
                    isTempFile: true
                });
                tempFiles.push(tempPath);
                continue;
            }

            if (fs.existsSync(source)) {
                fileEntries.push({
                    source,
                    filePath: source,
                    fileName: basename(source),
                    isTempFile: false
                });
                continue;
            }

            throw new Error(`图片资源不存在: ${source}`);
        }

        return {
            success: true,
            fileEntries,
            tempFiles,
            cleanup() {
                tempFiles.forEach((filePath) => imageManager.deleteTempFile(filePath));
            }
        };
    } catch (error) {
        tempFiles.forEach((filePath) => imageManager.deleteTempFile(filePath));
        return {
            success: false,
            message: error?.message || String(error),
            fileEntries,
            tempFiles,
            cleanup() {}
        };
    }
}

function buildCookieHeader(cookies = {}) {
    return Object.entries(cookies)
        .filter(([name, value]) => normalizeText(name) && value !== undefined && value !== null)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
}

function buildTemuUploadHeaderCandidates(sessionContext = {}, requestCaptureState = {}) {
    const cookieHeader = normalizeText(
        sessionContext.cookieHeader || buildCookieHeader(sessionContext.cookies || {})
    );
    const baseHeaders = {
        accept: 'application/json, text/plain, */*',
        cookie: cookieHeader,
        origin: normalizeText(
            requestCaptureState.origin || sessionContext.headers?.origin || 'https://agentseller.temu.com'
        ),
        referer: normalizeText(
            requestCaptureState.referer
            || sessionContext.currentUrl
            || sessionContext.headers?.referer
            || TEMU_DEFAULT_UPLOAD_REFERER
        )
    };

    const userAgent = normalizeText(
        requestCaptureState.userAgent || sessionContext.userAgent || sessionContext.headers?.['user-agent']
    );
    const mallId = normalizeText(
        requestCaptureState.mallId || sessionContext.mallId || sessionContext.headers?.mallid
    );
    const antiContent = normalizeText(
        requestCaptureState.antiContent
        || sessionContext.antiContent
        || sessionContext.headers?.['anti-content']
    );

    if (userAgent) {
        baseHeaders['user-agent'] = userAgent;
    }
    if (mallId) {
        baseHeaders.mallid = mallId;
    }

    const headerCandidates = [];
    if (antiContent) {
        headerCandidates.push({
            ...baseHeaders,
            'anti-content': antiContent
        });
    }
    headerCandidates.push(baseHeaders);

    return {
        cookieHeader,
        headerCandidates: headerCandidates.filter((headers, index, list) => {
            return list.findIndex((item) => JSON.stringify(item) === JSON.stringify(headers)) === index;
        })
    };
}

function normalizeTemuUploadSessionContext(sessionContext = {}) {
    if (!sessionContext || typeof sessionContext !== 'object') {
        return null;
    }

    if (sessionContext.success) {
        return sessionContext;
    }

    const cookies = sessionContext.cookies && typeof sessionContext.cookies === 'object'
        ? sessionContext.cookies
        : {};
    const headers = sessionContext.headers && typeof sessionContext.headers === 'object'
        ? sessionContext.headers
        : (sessionContext.headersTemplate && typeof sessionContext.headersTemplate === 'object'
            ? sessionContext.headersTemplate
            : {});
    const cookieHeader = normalizeText(
        sessionContext.cookieHeader || buildCookieHeader(cookies)
    );
    const cookieCount = Number(sessionContext.cookieCount);

    return {
        success: !!cookieHeader,
        message: cookieHeader ? '' : '当前 Temu 会话缺少 cookies',
        currentUrl: normalizeText(
            sessionContext.currentUrl || headers.referer || headers.origin || ''
        ),
        cookies,
        cookieHeader,
        headers,
        userAgent: normalizeText(sessionContext.userAgent || headers['user-agent'] || ''),
        mallId: normalizeText(sessionContext.mallId || headers.mallid || ''),
        antiContent: normalizeText(sessionContext.antiContent || headers['anti-content'] || ''),
        cookieCount: Number.isFinite(cookieCount) && cookieCount > 0
            ? cookieCount
            : Object.keys(cookies).length,
        effectiveRegion: normalizeText(sessionContext.effectiveRegion || 'global') || 'global'
    };
}

async function parseJsonResponse(response) {
    const rawText = await response.text();

    try {
        return {
            payload: rawText ? JSON.parse(rawText) : null,
            rawText
        };
    } catch {
        return {
            payload: null,
            rawText
        };
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60_000) {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new Error(`request timeout after ${timeoutMs}ms`)),
        timeoutMs
    );

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

async function requestTemuUploadSignature(headerCandidates = []) {
    let lastError = null;

    for (const headers of headerCandidates) {
        try {
            const response = await fetchWithTimeout(
                TEMU_IMAGE_UPLOAD_SIGNATURE_URL,
                {
                    method: 'POST',
                    headers: {
                        ...headers,
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        tag: TEMU_IMAGE_UPLOAD_SIGNATURE_TAG
                    })
                },
                20_000
            );
            const { payload, rawText } = await parseJsonResponse(response);
            const uploadSign = normalizeText(payload?.result);

            if (response.ok && payload?.success === true && uploadSign) {
                return {
                    success: true,
                    uploadSign,
                    headers
                };
            }

            lastError = new Error(
                payload?.errorMsg
                || payload?.message
                || rawText
                || `获取图片上传签名失败，状态码 ${response.status}`
            );
        } catch (error) {
            lastError = error;
        }
    }

    return {
        success: false,
        message: lastError?.message || '获取图片上传签名失败'
    };
}

function normalizeUploadedImageRecord(payload = {}, fileEntry = {}) {
    const url = normalizeText(
        payload?.url
        || payload?.result?.url
        || payload?.data?.url
        || payload?.result?.image_url
        || payload?.data?.image_url
        || payload?.image_url
    );

    const widthValue = payload?.width ?? payload?.result?.width ?? payload?.data?.width;
    const heightValue = payload?.height ?? payload?.result?.height ?? payload?.data?.height;

    return {
        source: fileEntry.source || '',
        filePath: fileEntry.filePath || '',
        fileName: fileEntry.fileName || '',
        url,
        width: Number.isFinite(Number(widthValue)) ? Number(widthValue) : null,
        height: Number.isFinite(Number(heightValue)) ? Number(heightValue) : null,
        raw: payload
    };
}

function extractFileNameHints(value = '') {
    const normalized = normalizeText(value);
    if (!normalized) {
        return [];
    }

    try {
        const url = new URL(normalized);
        const pathname = normalizeText(url.pathname.split('/').pop() || '');
        const pathnameNoExt = pathname.replace(/\.[^.]+$/, '');
        return dedupeStrings([pathname, pathnameNoExt]);
    } catch {
        const filename = normalizeText(basename(normalized));
        const filenameNoExt = filename.replace(/\.[^.]+$/, '');
        return dedupeStrings([filename, filenameNoExt]);
    }
}

async function uploadSingleTemuImage(fileEntry, headerCandidates = []) {
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const signatureResult = await requestTemuUploadSignature(headerCandidates);
        if (!signatureResult.success) {
            lastError = new Error(signatureResult.message || '获取图片上传签名失败');
            continue;
        }

        for (const headers of headerCandidates) {
            try {
                const fileBuffer = await readFile(fileEntry.filePath);
                const formData = new FormData();
                formData.set('upload_sign', signatureResult.uploadSign);
                formData.set('url_width_height', 'true');
                formData.append(
                    'image',
                    new Blob([fileBuffer], { type: inferMimeType(fileEntry.filePath) }),
                    fileEntry.fileName
                );

                const response = await fetchWithTimeout(
                    TEMU_STORE_IMAGE_URL,
                    {
                        method: 'POST',
                        headers,
                        body: formData
                    },
                    90_000
                );
                const { payload, rawText } = await parseJsonResponse(response);
                const normalized = normalizeUploadedImageRecord(payload, fileEntry);

                if (response.ok && normalized.url) {
                    return {
                        success: true,
                        uploadedImage: normalized
                    };
                }

                lastError = new Error(
                    payload?.errorMsg
                    || payload?.message
                    || rawText
                    || `上传图片失败，状态码 ${response.status}`
                );
            } catch (error) {
                lastError = error;
            }
        }
    }

    return {
        success: false,
        message: lastError?.message || `上传图片失败: ${fileEntry.fileName || fileEntry.source || ''}`
    };
}

export function createTemuLiveRequestCapture(context) {
    if (!context || typeof context.on !== 'function') {
        return {
            state: {
                requestCount: 0,
                antiContent: '',
                mallId: '',
                origin: '',
                referer: '',
                userAgent: '',
                lastRequestUrl: ''
            },
            dispose() {}
        };
    }

    const state = {
        requestCount: 0,
        antiContent: '',
        mallId: '',
        origin: '',
        referer: '',
        userAgent: '',
        lastRequestUrl: ''
    };

    const onRequest = (request) => {
        try {
            const url = normalizeText(request.url());
            const resourceType = normalizeText(request.resourceType());
            if (!/temu\.com|kuajingmaihuo\.com/i.test(url)) {
                return;
            }
            if (!['xhr', 'fetch', 'document'].includes(resourceType)) {
                return;
            }

            const headers = request.headers();
            const normalizedHeaders = Object.fromEntries(
                Object.entries(headers || {}).map(([key, value]) => [
                    String(key || '').toLowerCase(),
                    normalizeText(value)
                ])
            );

            state.requestCount += 1;
            state.lastRequestUrl = url;
            if (normalizedHeaders['anti-content']) {
                state.antiContent = normalizedHeaders['anti-content'];
            }
            if (normalizedHeaders.mallid && normalizedHeaders.mallid !== 'undefined') {
                state.mallId = normalizedHeaders.mallid;
            }
            if (normalizedHeaders.origin) {
                state.origin = normalizedHeaders.origin;
            }
            if (normalizedHeaders.referer) {
                state.referer = normalizedHeaders.referer;
            }
            if (normalizedHeaders['user-agent']) {
                state.userAgent = normalizedHeaders['user-agent'];
            }
        } catch {
            // ignore request capture failures
        }
    };

    context.on('request', onRequest);

    return {
        state,
        dispose() {
            context.off('request', onRequest);
        }
    };
}

async function findTemuImageTriggerCandidates(page) {
    return page.evaluate(({ triggerLabels, sectionKeywords }) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0;
        };

        const sectionSelector = [
            'section',
            'form',
            'fieldset',
            '[class*="section"]',
            '[class*="panel"]',
            '[class*="card"]',
            '[class*="block"]',
            '[class*="group"]',
            '[class*="wrapper"]',
            '[class*="container"]'
        ].join(',');

        const occurrenceMap = new Map();
        const clickables = Array.from(
            document.querySelectorAll('button,[role="button"],a,span,div')
        ).filter(isVisible);

        return clickables
            .map((element) => {
                const text = normalize(element.innerText || element.textContent);
                if (!text) {
                    return null;
                }

                const matchedLabel = triggerLabels.find((label) => text.includes(label));
                if (!matchedLabel) {
                    return null;
                }

                const section = element.closest(sectionSelector);
                const sectionText = normalize(section?.textContent || '');
                const sectionKeyword = sectionKeywords.find((keyword) => {
                    return sectionText.includes(keyword) || text.includes(keyword);
                }) || '';
                const tagName = element.tagName.toLowerCase();
                const key = `${tagName}::${matchedLabel}`;
                const sameTextIndex = occurrenceMap.get(key) || 0;
                occurrenceMap.set(key, sameTextIndex + 1);

                return {
                    tagName,
                    label: matchedLabel,
                    sameTextIndex,
                    text: text.slice(0, 120),
                    sectionKeyword,
                    className: normalize(element.className || '').slice(0, 160)
                };
            })
            .filter(Boolean)
            .sort((left, right) => {
                const leftSectionScore = left.sectionKeyword ? 0 : 1;
                const rightSectionScore = right.sectionKeyword ? 0 : 1;
                const leftButtonScore = left.tagName === 'button' ? 0 : 1;
                const rightButtonScore = right.tagName === 'button' ? 0 : 1;
                return leftSectionScore - rightSectionScore
                    || leftButtonScore - rightButtonScore
                    || left.sameTextIndex - right.sameTextIndex;
            })
            .slice(0, 12);
    }, {
        triggerLabels: TEMU_IMAGE_TRIGGER_LABELS,
        sectionKeywords: TEMU_IMAGE_SECTION_KEYWORDS
    }).catch(() => []);
}

async function clickTemuImageTriggerCandidate(page, candidate) {
    const safeLabel = escapeForHasText(candidate?.label || '');
    const tagName = normalizeText(candidate?.tagName || '').toLowerCase();
    const sameTextIndex = Number(candidate?.sameTextIndex || 0);
    const selectorCandidates = [];

    if (tagName) {
        selectorCandidates.push(`${tagName}:has-text("${safeLabel}")`);
    }
    selectorCandidates.push(`button:has-text("${safeLabel}")`);
    selectorCandidates.push(`[role="button"]:has-text("${safeLabel}")`);
    selectorCandidates.push(`a:has-text("${safeLabel}")`);
    selectorCandidates.push(`span:has-text("${safeLabel}")`);
    selectorCandidates.push(`div:has-text("${safeLabel}")`);

    for (const selector of selectorCandidates) {
        try {
            const locator = page.locator(selector);
            const count = await locator.count();
            if (!count || count <= sameTextIndex) {
                continue;
            }

            const target = locator.nth(sameTextIndex);
            if (!(await target.isVisible().catch(() => false))) {
                continue;
            }

            await target.scrollIntoViewIfNeeded().catch(() => undefined);
            await target.click({ timeout: 5_000 }).catch(async () => {
                await target.click({ timeout: 5_000, force: true });
            });

            return {
                success: true,
                selector,
                sameTextIndex,
                label: candidate.label
            };
        } catch {
            continue;
        }
    }

    return {
        success: false,
        reason: 'trigger_not_found',
        label: candidate?.label || ''
    };
}

async function selectTemuImagesInPicker(page, uploadedImages = [], limit = uploadedImages.length) {
    const matcherHints = dedupeStrings(
        uploadedImages.flatMap((item) => [
            item?.url,
            item?.source,
            ...(extractFileNameHints(item?.url)),
            ...(extractFileNameHints(item?.source))
        ])
    );

    return page.evaluate(({ matchers, maxCount }) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0;
        };
        const isSelected = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const className = normalize(element.className || '').toLowerCase();
            return element.getAttribute('aria-checked') === 'true'
                || element.getAttribute('aria-selected') === 'true'
                || className.includes('selected')
                || className.includes('checked')
                || className.includes('active')
                || className.includes('is-selected');
        };
        const resolveClickable = (img) =>
            img.closest(
                'label,button,[role="button"],li,[class*="card"],[class*="item"],[class*="image"],[class*="checkbox"]'
            ) || img;

        const containerCandidates = Array.from(
            document.querySelectorAll(
                '[role="dialog"],[class*="dialog"],[class*="modal"],[class*="drawer"],body'
            )
        ).filter(isVisible);

        const enrichedContainers = containerCandidates.map((container) => {
            const images = Array.from(container.querySelectorAll('img')).filter(isVisible);
            return {
                container,
                imageCount: images.length
            };
        });

        enrichedContainers.sort((left, right) => right.imageCount - left.imageCount);
        const activeContainer = enrichedContainers[0]?.container || document.body;

        const cards = [];
        const cardSet = new Set();
        for (const img of Array.from(activeContainer.querySelectorAll('img')).filter(isVisible)) {
            const card = resolveClickable(img);
            if (!(card instanceof HTMLElement) || cardSet.has(card)) {
                continue;
            }
            cardSet.add(card);
            const srcText = normalize(
                img.getAttribute('src')
                || img.getAttribute('data-src')
                || img.getAttribute('data-lazy-src')
                || img.currentSrc
            );
            const altText = normalize(img.getAttribute('alt') || '');
            const cardText = normalize(card.innerText || card.textContent || '');
            const haystack = `${srcText} ${altText} ${cardText}`.toLowerCase();
            const score = matchers.reduce((acc, matcher) => {
                const normalizedMatcher = normalize(matcher).toLowerCase();
                return normalizedMatcher && haystack.includes(normalizedMatcher) ? acc + 1 : acc;
            }, 0);

            cards.push({
                card,
                srcText,
                cardText,
                selected: isSelected(card),
                score
            });
        }

        cards.sort((left, right) => right.score - left.score);
        const preferredCards = cards.filter((item) => !item.selected && item.score > 0);
        const fallbackCards = cards.filter((item) => !item.selected && item.score <= 0);
        const targets = preferredCards.concat(fallbackCards).slice(0, maxCount);

        let selectedCount = 0;
        for (const item of targets) {
            item.card.click();
            selectedCount += 1;
        }

        return {
            selectedCount,
            matchedCount: preferredCards.slice(0, maxCount).length,
            candidateCount: cards.length,
            usedFallback: preferredCards.length < Math.min(cards.length, maxCount)
        };
    }, {
        matchers: matcherHints,
        maxCount: Math.max(0, Number(limit || 0))
    }).catch(() => ({
        selectedCount: 0,
        matchedCount: 0,
        candidateCount: 0,
        usedFallback: false
    }));
}

async function confirmTemuImagePicker(page) {
    const clicked = await clickClickableByText(page, TEMU_IMAGE_PICKER_CONFIRM_LABELS, {
        selector: 'button,[role="button"],a,span,div',
        exact: false
    });

    if (!clicked) {
        return {
            success: false,
            reason: 'confirm_button_not_found'
        };
    }

    await page.waitForTimeout(1_500);
    return {
        success: true,
        detail: clicked
    };
}

export async function bindTemuUploadedImagesToEditPage(page, uploadedImages = []) {
    const images = Array.isArray(uploadedImages) ? uploadedImages.filter((item) => item?.url) : [];
    if (!images.length) {
        return {
            success: true,
            skipped: true,
            message: '没有可回填到编辑页的 Temu 图片'
        };
    }

    const triggerCandidates = await findTemuImageTriggerCandidates(page);
    if (!triggerCandidates.length) {
        return {
            success: false,
            message: '未识别到 Temu 编辑页图片入口',
            triggerCandidates: []
        };
    }

    const attemptResults = [];
    const usedCandidateKeys = new Set();

    for (const candidate of triggerCandidates) {
        const candidateKey = `${candidate.tagName}::${candidate.label}::${candidate.sameTextIndex}`;
        if (usedCandidateKeys.has(candidateKey)) {
            continue;
        }
        usedCandidateKeys.add(candidateKey);

        const clickResult = await clickTemuImageTriggerCandidate(page, candidate);
        if (!clickResult.success) {
            attemptResults.push({
                candidate,
                success: false,
                reason: clickResult.reason || 'trigger_click_failed'
            });
            continue;
        }

        await page.waitForTimeout(1_500);
        const selectionResult = await selectTemuImagesInPicker(page, images, images.length);
        if (!selectionResult.selectedCount) {
            attemptResults.push({
                candidate,
                success: false,
                reason: 'picker_images_not_selected',
                selectionResult
            });
            continue;
        }

        const confirmResult = await confirmTemuImagePicker(page);
        attemptResults.push({
            candidate,
            success: !!confirmResult.success,
            reason: confirmResult.success ? '' : confirmResult.reason || 'picker_confirm_failed',
            selectionResult,
            confirmResult
        });

        if (confirmResult.success) {
            return {
                success: true,
                skipped: false,
                selectedCount: selectionResult.selectedCount || 0,
                matchedCount: selectionResult.matchedCount || 0,
                usedFallback: !!selectionResult.usedFallback,
                candidate,
                attemptResults
            };
        }
    }

    return {
        success: false,
        skipped: false,
        message: 'Temu 编辑页图片回填未成功',
        triggerCandidates,
        attemptResults
    };
}

export async function uploadTemuPublishImages(page, publishInfo = {}, options = {}) {
    return await uploadTemuImagesToCloud(
        page,
        resolveTemuPublishImageSources(publishInfo),
        {
            ...options,
            resourceLabel: options.resourceLabel || '商品图片',
            emptyMessage: options.emptyMessage || `${PLATFORM_NAME}发布数据未提供图片，跳过图片上传`
        }
    );
}

export async function uploadTemuImagesToCloud(page, imageSources = [], options = {}) {
    const normalizedImageSources = normalizeTemuImageSources(imageSources);
    const resourceLabel = normalizeText(options.resourceLabel || '图片');
    const emptyMessage = normalizeText(options.emptyMessage || '')
        || `${PLATFORM_NAME}未提供需要上传的${resourceLabel}，跳过上传`;

    if (!normalizedImageSources.length) {
        logger.info(`${PLATFORM_NAME}未检测到需要上传到Temu云的${resourceLabel}`, {
            resourceLabel,
            requestedImageCount: 0
        });
        return {
            success: true,
            skipped: true,
            message: emptyMessage,
            requestedImageCount: 0,
            requestedSourceCount: 0,
            uploadedCount: 0,
            uploadedImages: [],
            failedImages: []
        };
    }

    const sessionContext = normalizeTemuUploadSessionContext(options.sessionContext)
        || await getTemuCurrentSessionContext(page, {
            region: 'global',
            headersTemplate: {
                origin: options.requestCaptureState?.origin || 'https://agentseller.temu.com',
                referer:
                    options.requestCaptureState?.referer
                    || normalizeText(page?.url?.())
                    || TEMU_DEFAULT_UPLOAD_REFERER,
                'user-agent': options.requestCaptureState?.userAgent || '',
                'anti-content': options.requestCaptureState?.antiContent || '',
                mallid: options.requestCaptureState?.mallId || ''
            }
        });

    if (!sessionContext?.success) {
        logger.error(`${PLATFORM_NAME}${resourceLabel}上传前获取会话失败`, {
            requestedImageCount: normalizedImageSources.length,
            message: sessionContext?.message || 'session_context_unavailable'
        });
        return {
            success: false,
            message: sessionContext?.message || `获取当前 Temu 会话失败，无法上传${resourceLabel}`,
            requestedImageCount: normalizedImageSources.length,
            requestedSourceCount: normalizedImageSources.length,
            uploadedCount: 0,
            uploadedImages: [],
            failedImages: normalizedImageSources.map((source) => ({
                source,
                error: 'session_context_unavailable'
            }))
        };
    }

    const { cookieHeader, headerCandidates } = buildTemuUploadHeaderCandidates(
        sessionContext,
        options.requestCaptureState
    );

    if (!cookieHeader || !headerCandidates.length) {
        logger.error(`${PLATFORM_NAME}${resourceLabel}上传前未获得可用会话头`, {
            requestedImageCount: normalizedImageSources.length,
            cookieCount: sessionContext.cookieCount || 0,
            mallId: sessionContext.mallId || '',
            antiContentReady: !!sessionContext.antiContent
        });
        return {
            success: false,
            message: `当前 Temu 页面未获取到可用 cookies，无法上传${resourceLabel}`,
            requestedImageCount: normalizedImageSources.length,
            requestedSourceCount: normalizedImageSources.length,
            uploadedCount: 0,
            uploadedImages: [],
            failedImages: normalizedImageSources.map((source) => ({
                source,
                error: 'cookies_missing'
            }))
        };
    }

    logger.info(`${PLATFORM_NAME}开始上传${resourceLabel}到Temu云文件`, {
        requestedImageCount: normalizedImageSources.length,
        mallId: sessionContext.mallId || '',
        cookieCount: sessionContext.cookieCount || 0,
        antiContentReady: !!sessionContext.antiContent
    });

    const preparedResult = await prepareTemuImageFiles(normalizedImageSources);
    if (!preparedResult.success) {
        logger.error(`${PLATFORM_NAME}${resourceLabel}上传前文件准备失败`, {
            requestedImageCount: normalizedImageSources.length,
            message: preparedResult.message || 'prepare_failed'
        });
        return {
            success: false,
            message: preparedResult.message || `准备 Temu ${resourceLabel}文件失败`,
            requestedImageCount: normalizedImageSources.length,
            requestedSourceCount: normalizedImageSources.length,
            uploadedCount: 0,
            uploadedImages: [],
            failedImages: normalizedImageSources.map((source) => ({
                source,
                error: 'prepare_failed'
            }))
        };
    }

    const uploadedImages = [];
    const failedImages = [];

    try {
        logger.info(`${PLATFORM_NAME}${resourceLabel}本地文件准备完成`, {
            preparedCount: preparedResult.fileEntries.length,
            requestedImageCount: normalizedImageSources.length
        });

        for (let index = 0; index < preparedResult.fileEntries.length; index += 1) {
            const fileEntry = preparedResult.fileEntries[index];
            const current = index + 1;
            const total = preparedResult.fileEntries.length;
            logger.info(`${PLATFORM_NAME}开始上传${resourceLabel}到Temu云文件 ${current}/${total}`, {
                source: fileEntry.source,
                sourceName: summarizeImageSourceForLog(fileEntry.source),
                fileName: fileEntry.fileName,
                current,
                total
            });

            const uploadResult = await uploadSingleTemuImage(fileEntry, headerCandidates);
            if (!uploadResult.success) {
                failedImages.push({
                    source: fileEntry.source,
                    fileName: fileEntry.fileName,
                    error: uploadResult.message || 'upload_failed'
                });
                logger.error(`${PLATFORM_NAME}${resourceLabel}上传到Temu云文件失败 ${current}/${total}`, {
                    source: fileEntry.source,
                    sourceName: summarizeImageSourceForLog(fileEntry.source),
                    fileName: fileEntry.fileName,
                    current,
                    total,
                    message: uploadResult.message || 'upload_failed'
                });
                continue;
            }

            uploadedImages.push(uploadResult.uploadedImage);
            logger.info(`${PLATFORM_NAME}${resourceLabel}上传到Temu云文件成功 ${current}/${total}`, {
                source: fileEntry.source,
                sourceName: summarizeImageSourceForLog(fileEntry.source),
                fileName: fileEntry.fileName,
                current,
                total,
                url: uploadResult.uploadedImage.url,
                width: uploadResult.uploadedImage.width,
                height: uploadResult.uploadedImage.height
            });
        }
    } finally {
        preparedResult.cleanup();
    }

    const success = failedImages.length === 0 && uploadedImages.length === normalizedImageSources.length;
    const summaryPayload = {
        requestedImageCount: normalizedImageSources.length,
        uploadedCount: uploadedImages.length,
        failedCount: failedImages.length,
        mallId: sessionContext.mallId || ''
    };
    if (success) {
        logger.info(`${PLATFORM_NAME}${resourceLabel}上传到Temu云文件完成`, summaryPayload);
    } else {
        logger.warn(`${PLATFORM_NAME}${resourceLabel}上传到Temu云文件未全部成功`, {
            ...summaryPayload,
            failedImages
        });
    }
    return {
        success,
        message: success ? `${PLATFORM_NAME}${resourceLabel}上传完成` : `${PLATFORM_NAME}${resourceLabel}上传未完成`,
        requestedImageCount: normalizedImageSources.length,
        requestedSourceCount: normalizedImageSources.length,
        uploadedCount: uploadedImages.length,
        uploadedImages,
        failedImages,
        sessionContext: {
            currentUrl: sessionContext.currentUrl || '',
            cookieCount: sessionContext.cookieCount || 0,
            mallId: sessionContext.mallId || '',
            effectiveRegion: sessionContext.effectiveRegion || 'global'
        }
    };
}

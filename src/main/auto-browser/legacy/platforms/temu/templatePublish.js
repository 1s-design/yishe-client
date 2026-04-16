import { logger } from '../../utils/logger.js';
import { PLATFORM_KEY, PLATFORM_NAME } from './constants.js';
import { resolveTemuPublishBasicInfo } from './editForm.js';
import {
    resolveTemuPublishImageSources,
    uploadTemuImagesToCloud
} from './imageUpload.js';
import { collectTemuSessionBundle } from './session.js';
import { normalizeText, pushTrace } from './utils.js';

const TEMU_PRODUCT_ADD_URL = 'https://agentseller.temu.com/visage-agent-seller/product/add';
const TEMU_PRODUCT_SUBMIT_TIMEOUT_MS = 60_000;

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function limitLogText(value = '', maxLength = 120) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }

    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength)}...`
        : normalized;
}

function cloneSerializable(value) {
    if (value === undefined) {
        return undefined;
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return undefined;
    }
}

function parseTemplateCandidate(value) {
    if (isPlainObject(value)) {
        return cloneSerializable(value);
    }

    if (typeof value !== 'string') {
        return null;
    }

    const raw = value.trim();
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw);
        return isPlainObject(parsed) ? cloneSerializable(parsed) : null;
    } catch {
        return null;
    }
}

export function resolveTemuProductTemplate(publishInfo = {}) {
    const settings = publishInfo.platformOptions
        || publishInfo.publishOptions
        || publishInfo.platformSettings?.[PLATFORM_KEY]
        || {};

    const candidates = [
        publishInfo.productTemplate,
        settings.productTemplate,
        publishInfo.data?.productTemplate,
        publishInfo.meta?.productTemplate,
        publishInfo.metadata?.productTemplate
    ];

    for (const candidate of candidates) {
        const parsed = parseTemplateCandidate(candidate);
        if (parsed) {
            return parsed;
        }
    }

    return null;
}

export function hasTemuProductTemplate(publishInfo = {}) {
    return !!resolveTemuProductTemplate(publishInfo);
}

function resolveTemuTemplatePublishSettings(publishInfo = {}) {
    const settings = publishInfo.platformOptions
        || publishInfo.publishOptions
        || publishInfo.platformSettings?.[PLATFORM_KEY]
        || {};
    const submitUrl = normalizeText(
        settings.productTemplateSubmitUrl
        || settings.temuProductTemplateSubmitUrl
        || settings.temuProductSubmitUrl
        || TEMU_PRODUCT_ADD_URL
    ) || TEMU_PRODUCT_ADD_URL;

    return {
        submitUrl
    };
}

function buildCookieHeader(cookies = {}) {
    return Object.entries(cookies)
        .filter(([name, value]) => normalizeText(name) && value !== undefined && value !== null)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
}

function buildSubmitHeaderCandidates(sessionBundle = {}) {
    const cookieHeader = normalizeText(buildCookieHeader(sessionBundle.cookies || {}));
    const headersTemplate = isPlainObject(sessionBundle.headersTemplate)
        ? sessionBundle.headersTemplate
        : {};
    const baseHeaders = {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        origin: normalizeText(headersTemplate.origin || 'https://agentseller.temu.com'),
        referer: normalizeText(headersTemplate.referer || 'https://agentseller.temu.com/'),
        cookie: cookieHeader
    };

    const userAgent = normalizeText(headersTemplate['user-agent'] || sessionBundle.userAgent);
    const mallId = normalizeText(headersTemplate.mallid || sessionBundle.mallId);
    const antiContent = normalizeText(headersTemplate['anti-content'] || sessionBundle.antiContent);

    if (userAgent) {
        baseHeaders['user-agent'] = userAgent;
    }
    if (mallId) {
        baseHeaders.mallid = mallId;
    }

    const candidates = [];
    if (antiContent) {
        candidates.push({
            ...baseHeaders,
            'anti-content': antiContent
        });
    }
    candidates.push(baseHeaders);

    return {
        cookieHeader,
        headerCandidates: candidates.filter((headers, index, list) => {
            return list.findIndex((item) => JSON.stringify(item) === JSON.stringify(headers)) === index;
        })
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

async function fetchWithTimeout(url, options = {}, timeoutMs = TEMU_PRODUCT_SUBMIT_TIMEOUT_MS) {
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

function summarizeTemuTemplatePayload(payload = {}) {
    const skcList = Array.isArray(payload.productSkcReqs) ? payload.productSkcReqs : [];
    const skuCount = skcList.reduce((count, item) => {
        const skuList = Array.isArray(item?.productSkuReqs) ? item.productSkuReqs : [];
        return count + skuList.length;
    }, 0);

    return {
        productName: normalizeText(payload.productName),
        categoryIds: [
            payload.cat1Id,
            payload.cat2Id,
            payload.cat3Id,
            payload.cat4Id,
            payload.cat5Id,
            payload.cat6Id,
            payload.cat7Id,
            payload.cat8Id,
            payload.cat9Id,
            payload.cat10Id
        ].filter((item) => Number(item) > 0),
        propertyCount: Array.isArray(payload.productPropertyReqs)
            ? payload.productPropertyReqs.length
            : 0,
        skcCount: skcList.length,
        skuCount,
        carouselImageCount: Array.isArray(payload.carouselImageUrls)
            ? payload.carouselImageUrls.length
            : 0,
        outerPackageImageCount: Array.isArray(payload.productOuterPackageImageReqs)
            ? payload.productOuterPackageImageReqs.length
            : 0
    };
}

function fillTemplateTitle(payload = {}, title = '') {
    const nextPayload = isPlainObject(payload) ? { ...payload } : {};
    const normalizedTitle = normalizeText(title);
    if (!normalizedTitle) {
        return nextPayload;
    }

    nextPayload.productName = normalizedTitle;

    return nextPayload;
}

function assignTemplateImages(payload = {}, uploadedImageUrls = []) {
    const nextPayload = isPlainObject(payload) ? { ...payload } : {};
    const imageUrls = uploadedImageUrls.map((item) => normalizeText(item)).filter(Boolean);
    if (!imageUrls.length) {
        return nextPayload;
    }

    nextPayload.carouselImageUrls = [...imageUrls];
    nextPayload.materialImgUrl = imageUrls[0];

    if (!Array.isArray(nextPayload.productSkcReqs)) {
        return nextPayload;
    }

    const totalSkuCount = nextPayload.productSkcReqs.reduce((count, skc) => {
        const skuList = Array.isArray(skc?.productSkuReqs) ? skc.productSkuReqs : [];
        return count + skuList.length;
    }, 0);
    const skuImagePool = totalSkuCount > 0 && imageUrls.length >= totalSkuCount
        ? imageUrls.slice(-totalSkuCount)
        : imageUrls;
    let skuImageIndex = 0;

    nextPayload.productSkcReqs = nextPayload.productSkcReqs.map((skc) => {
        const nextSkc = isPlainObject(skc) ? { ...skc } : {};
        const skuList = Array.isArray(nextSkc.productSkuReqs) ? nextSkc.productSkuReqs : [];
        let skcPreviewUrl = '';

        nextSkc.productSkuReqs = skuList.map((sku) => {
            const nextSku = isPlainObject(sku) ? { ...sku } : {};
            const assignedThumbUrl = normalizeText(
                skuImagePool[skuImageIndex]
                || imageUrls[skuImageIndex]
                || imageUrls[0]
            );
            skuImageIndex += 1;

            if (assignedThumbUrl) {
                nextSku.thumbUrl = assignedThumbUrl;
                if (!skcPreviewUrl) {
                    skcPreviewUrl = assignedThumbUrl;
                }
            }

            return nextSku;
        });

        if (skcPreviewUrl) {
            nextSkc.previewImgUrls = [skcPreviewUrl];
        } else if (imageUrls[0]) {
            nextSkc.previewImgUrls = [imageUrls[0]];
        }

        return nextSkc;
    });

    return nextPayload;
}

function syncSuggestedPricesFromSupplierFields(payload = {}) {
    const nextPayload = isPlainObject(payload) ? { ...payload } : {};
    if (!Array.isArray(nextPayload.productSkcReqs)) {
        return nextPayload;
    }

    nextPayload.productSkcReqs = nextPayload.productSkcReqs.map((skc) => {
        const nextSkc = isPlainObject(skc) ? { ...skc } : {};
        const skuList = Array.isArray(nextSkc.productSkuReqs) ? nextSkc.productSkuReqs : [];

        nextSkc.productSkuReqs = skuList.map((sku) => {
            const nextSku = isPlainObject(sku) ? { ...sku } : {};
            const suggestedPriceReq = isPlainObject(nextSku.productSkuSuggestedPriceReq)
                ? { ...nextSku.productSkuSuggestedPriceReq }
                : null;

            if (!suggestedPriceReq) {
                return nextSku;
            }

            if (Object.prototype.hasOwnProperty.call(suggestedPriceReq, 'suggestedPrice')) {
                const supplierPrice = Number(nextSku.supplierPrice);
                if (Number.isFinite(supplierPrice)) {
                    suggestedPriceReq.suggestedPrice = supplierPrice;
                }
            }

            if (
                Object.prototype.hasOwnProperty.call(
                    suggestedPriceReq,
                    'suggestedPriceCurrencyType'
                )
            ) {
                const currencyType = normalizeText(
                    nextSku.currencyType || suggestedPriceReq.suggestedPriceCurrencyType
                );
                if (currencyType) {
                    suggestedPriceReq.suggestedPriceCurrencyType = currencyType;
                }
            }

            nextSku.productSkuSuggestedPriceReq = suggestedPriceReq;
            return nextSku;
        });

        return nextSkc;
    });

    return nextPayload;
}

function stripTemuTemplateSubmissionFields(payload = {}) {
    const nextPayload = isPlainObject(payload) ? { ...payload } : {};
    delete nextPayload.productDraftId;
    return nextPayload;
}

function buildTemuTemplatePublishPayload(productTemplate = {}, options = {}) {
    const templatePayload = cloneSerializable(productTemplate) || {};
    const titleAppliedPayload = fillTemplateTitle(templatePayload, options.title);
    const imageAppliedPayload = assignTemplateImages(titleAppliedPayload, options.uploadedImageUrls || []);
    const priceSyncedPayload = syncSuggestedPricesFromSupplierFields(imageAppliedPayload);
    return stripTemuTemplateSubmissionFields(priceSyncedPayload);
}

async function submitTemuTemplatePayload(payload = {}, sessionBundle = {}, options = {}) {
    const submitUrl = normalizeText(options.submitUrl || TEMU_PRODUCT_ADD_URL) || TEMU_PRODUCT_ADD_URL;
    const { cookieHeader, headerCandidates } = buildSubmitHeaderCandidates(sessionBundle);
    if (!cookieHeader || !headerCandidates.length) {
        return {
            success: false,
            message: '当前 Temu 环境未获取到可用 cookies，无法提交商品发布'
        };
    }

    let lastError = null;

    for (const headers of headerCandidates) {
        try {
            const response = await fetchWithTimeout(
                submitUrl,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload)
                },
                TEMU_PRODUCT_SUBMIT_TIMEOUT_MS
            );
            const { payload: responsePayload, rawText } = await parseJsonResponse(response);
            const explicitFailed = responsePayload?.success === false || responsePayload?.status === false;
            if (response.ok && !explicitFailed) {
                return {
                    success: true,
                    status: response.status,
                    submitUrl,
                    headersUsed: headers,
                    response: responsePayload,
                    rawText
                };
            }

            lastError = new Error(
                responsePayload?.errorMsg
                || responsePayload?.message
                || rawText
                || `Temu 商品提交失败，状态码 ${response.status}`
            );
        } catch (error) {
            lastError = error;
        }
    }

    return {
        success: false,
        message: lastError?.message || 'Temu 商品提交失败'
    };
}

function buildTemplatePublishResult({
    success,
    message,
    page,
    executionTrace,
    sessionBundle,
    publishImageUploadResult,
    submitResult,
    payloadSummary,
    shouldKeepPageOpen
}) {
    return {
        success,
        message,
        data: {
            frameworkReady: true,
            frameworkStage: 'template_api_publish',
            publishMode: 'temu_template_api',
            currentUrl: page?.url?.() || '',
            sessionContext: sessionBundle
                ? {
                    mallId: sessionBundle.mallId || '',
                    mallName: sessionBundle.mallName || '',
                    antiContentReady: !!sessionBundle.antiContent,
                    cookieCount: Object.keys(sessionBundle.cookies || {}).length
                }
                : null,
            uploadedPublishImages: publishImageUploadResult?.uploadedImages || [],
            publishImageUploadCompleted:
                !!publishImageUploadResult?.success && !publishImageUploadResult?.skipped,
            publishImageUploadSkipped: !!publishImageUploadResult?.skipped,
            publishImageUploadRequestedCount: publishImageUploadResult?.requestedImageCount || 0,
            publishImageUploadUploadedCount: publishImageUploadResult?.uploadedCount || 0,
            publishImageUploadFailedImages: publishImageUploadResult?.failedImages || [],
            productTemplatePayloadSummary: payloadSummary || null,
            publishSubmitResult: submitResult
                ? {
                    success: !!submitResult.success,
                    status: submitResult.status || 0,
                    submitUrl: submitResult.submitUrl || '',
                    response: submitResult.response || null,
                    rawText: submitResult.rawText || ''
                }
                : null,
            executionTrace,
            pageKeptOpen: shouldKeepPageOpen
        }
    };
}

export async function publishTemuByProductTemplate(
    page,
    publishInfo = {},
    options = {}
) {
    const executionTrace = Array.isArray(options.executionTrace) ? options.executionTrace : [];
    const shouldKeepPageOpen = !!options.shouldKeepPageOpen;
    const productTemplate = resolveTemuProductTemplate(publishInfo);
    if (!productTemplate) {
        logger.error(`${PLATFORM_NAME}模板直发缺少 productTemplate`, {
            hasPlatformOptions: !!publishInfo.platformOptions,
            hasPublishOptions: !!publishInfo.publishOptions
        });
        pushTrace(executionTrace, 'resolve_product_template', 'failed', {
            message: '缺少 Temu productTemplate'
        });
        return buildTemplatePublishResult({
            success: false,
            message: `${PLATFORM_NAME}发布缺少 productTemplate 模板数据`,
            page,
            executionTrace,
            shouldKeepPageOpen
        });
    }

    const templateSettings = resolveTemuTemplatePublishSettings(publishInfo);
    const basicInfo = resolveTemuPublishBasicInfo(publishInfo);
    const resolvedTitle = normalizeText(
        basicInfo.title
        || publishInfo.text?.title
        || publishInfo.candidateTitles?.[0]
        || productTemplate.productName
    );

    logger.info(`${PLATFORM_NAME}准备执行模板直发`, {
        submitUrl: templateSettings.submitUrl,
        hasResolvedTitle: !!resolvedTitle,
        titlePreview: limitLogText(resolvedTitle, 80)
    });
    pushTrace(executionTrace, 'resolve_product_template', 'success', {
        submitUrl: templateSettings.submitUrl
    });
    pushTrace(executionTrace, 'resolve_publish_basic_info', resolvedTitle ? 'success' : 'pending', {
        titleLength: resolvedTitle.length
    });

    logger.info(`${PLATFORM_NAME}模板直发已解析发布基础信息`, {
        titleLength: resolvedTitle.length,
        titlePreview: limitLogText(resolvedTitle, 80),
        imageCount: resolveTemuPublishImageSources(publishInfo).length
    });

    const sessionResult = await collectTemuSessionBundle(page, {
        collectRegionCookies: false
    });
    if (!sessionResult?.success || !sessionResult.sessionBundle) {
        logger.error(`${PLATFORM_NAME}模板直发采集会话失败`, {
            message: sessionResult?.message || 'session_bundle_unavailable'
        });
        pushTrace(executionTrace, 'collect_session_bundle', 'failed', {
            message: sessionResult?.message || 'session_bundle_unavailable'
        });
        return buildTemplatePublishResult({
            success: false,
            message: sessionResult?.message || `${PLATFORM_NAME}当前环境未登录，无法执行模板直发`,
            page,
            executionTrace,
            shouldKeepPageOpen
        });
    }

    const sessionBundle = sessionResult.sessionBundle;
    pushTrace(executionTrace, 'collect_session_bundle', 'success', {
        mallId: sessionBundle.mallId || '',
        antiContentReady: !!sessionBundle.antiContent,
        cookieCount: Object.keys(sessionBundle.cookies || {}).length
    });
    logger.info(`${PLATFORM_NAME}模板直发会话采集完成`, {
        mallId: sessionBundle.mallId || '',
        mallName: sessionBundle.mallName || '',
        cookieCount: Object.keys(sessionBundle.cookies || {}).length,
        antiContentReady: !!sessionBundle.antiContent,
        warningCount: Array.isArray(sessionBundle.warnings) ? sessionBundle.warnings.length : 0
    });
    if (Array.isArray(sessionBundle.warnings) && sessionBundle.warnings.length > 0) {
        logger.warn(`${PLATFORM_NAME}模板直发会话采集存在警告`, {
            warnings: sessionBundle.warnings
        });
    }

    const publishImageSources = resolveTemuPublishImageSources(publishInfo);
    logger.info(`${PLATFORM_NAME}模板直发准备上传商品图片到Temu云`, {
        imageCount: publishImageSources.length
    });

    const publishImageUploadResult = await uploadTemuImagesToCloud(
        page,
        publishImageSources,
        {
            sessionContext: sessionBundle,
            requestCaptureState: {
                origin: sessionBundle.headersTemplate?.origin || '',
                referer: sessionBundle.headersTemplate?.referer || page?.url?.() || '',
                userAgent: sessionBundle.headersTemplate?.['user-agent'] || sessionBundle.userAgent || '',
                antiContent: sessionBundle.headersTemplate?.['anti-content'] || sessionBundle.antiContent || '',
                mallId: sessionBundle.headersTemplate?.mallid || sessionBundle.mallId || ''
            },
            resourceLabel: '商品图片',
            emptyMessage: `${PLATFORM_NAME}模板直发缺少商品图片，无法继续提交`
        }
    );

    pushTrace(
        executionTrace,
        'upload_publish_images',
        publishImageUploadResult?.success
            ? publishImageUploadResult?.skipped ? 'pending' : 'success'
            : 'failed',
        {
            requestedImageCount: publishImageUploadResult?.requestedImageCount || 0,
            uploadedCount: publishImageUploadResult?.uploadedCount || 0,
            message: publishImageUploadResult?.message || ''
        }
    );

    if (!publishImageUploadResult?.success || publishImageUploadResult?.skipped) {
        logger.error(`${PLATFORM_NAME}模板直发商品图片上传失败`, {
            requestedImageCount: publishImageUploadResult?.requestedImageCount || 0,
            uploadedCount: publishImageUploadResult?.uploadedCount || 0,
            failedImages: publishImageUploadResult?.failedImages || [],
            message: publishImageUploadResult?.message || ''
        });
        return buildTemplatePublishResult({
            success: false,
            message: publishImageUploadResult?.skipped
                ? `${PLATFORM_NAME}模板直发缺少商品图片，无法继续提交`
                : publishImageUploadResult?.message || `${PLATFORM_NAME}模板直发图片上传失败`,
            page,
            executionTrace,
            sessionBundle,
            publishImageUploadResult,
            shouldKeepPageOpen
        });
    }

    const uploadedImageUrls = (publishImageUploadResult.uploadedImages || [])
        .map((item) => normalizeText(item?.url))
        .filter(Boolean);
    if (!uploadedImageUrls.length) {
        logger.error(`${PLATFORM_NAME}模板直发图片上传后未得到有效云文件地址`, {
            uploadedCount: publishImageUploadResult?.uploadedCount || 0
        });
        pushTrace(executionTrace, 'build_publish_payload', 'failed', {
            message: 'uploaded_image_urls_empty'
        });
        return buildTemplatePublishResult({
            success: false,
            message: `${PLATFORM_NAME}模板直发未获得有效上传图片地址`,
            page,
            executionTrace,
            sessionBundle,
            publishImageUploadResult,
            shouldKeepPageOpen
        });
    }

    logger.info(`${PLATFORM_NAME}模板直发商品图片已上传到Temu云`, {
        uploadedCount: uploadedImageUrls.length,
        firstImageUrl: uploadedImageUrls[0] || ''
    });

    const finalPayload = buildTemuTemplatePublishPayload(productTemplate, {
        title: resolvedTitle,
        uploadedImageUrls
    });
    logger.info(`${PLATFORM_NAME}模板直发最终提交类目`, {
        cat1Id: finalPayload.cat1Id ?? null,
        cat2Id: finalPayload.cat2Id ?? null,
        cat3Id: finalPayload.cat3Id ?? null,
        cat4Id: finalPayload.cat4Id ?? null,
        cat5Id: finalPayload.cat5Id ?? null,
        cat6Id: finalPayload.cat6Id ?? null,
        cat7Id: finalPayload.cat7Id ?? null,
        cat8Id: finalPayload.cat8Id ?? null,
        cat9Id: finalPayload.cat9Id ?? null,
        cat10Id: finalPayload.cat10Id ?? null
    });
    logger.info(`${PLATFORM_NAME}模板直发最终提交模板`, finalPayload);
    const payloadSummary = summarizeTemuTemplatePayload(finalPayload);
    pushTrace(executionTrace, 'build_publish_payload', 'success', payloadSummary);
    logger.info(`${PLATFORM_NAME}模板直发已完成发布参数组装`, {
        payloadSummary,
        titlePreview: limitLogText(finalPayload.productName, 80)
    });

    logger.info(`${PLATFORM_NAME}模板直发准备调用Temu商品提交接口`, {
        submitUrl: templateSettings.submitUrl,
        productName: limitLogText(finalPayload.productName, 80),
        carouselImageCount: Array.isArray(finalPayload.carouselImageUrls)
            ? finalPayload.carouselImageUrls.length
            : 0
    });
    const submitResult = await submitTemuTemplatePayload(finalPayload, sessionBundle, {
        submitUrl: templateSettings.submitUrl
    });
    pushTrace(
        executionTrace,
        'submit_publish_payload',
        submitResult.success ? 'success' : 'failed',
        {
            submitUrl: templateSettings.submitUrl,
            status: submitResult.status || 0,
            message: submitResult.message || ''
        }
    );

    if (!submitResult.success) {
        logger.error(`${PLATFORM_NAME}模板直发提交失败`, {
            submitUrl: templateSettings.submitUrl,
            message: submitResult.message || 'submit_failed',
            response: submitResult.response || null,
            rawText: limitLogText(submitResult.rawText || '', 300)
        });
        return buildTemplatePublishResult({
            success: false,
            message: submitResult.message || `${PLATFORM_NAME}模板直发提交失败`,
            page,
            executionTrace,
            sessionBundle,
            publishImageUploadResult,
            submitResult,
            payloadSummary,
            shouldKeepPageOpen
        });
    }

    logger.info(`${PLATFORM_NAME}模板直发提交成功`, {
        submitUrl: submitResult.submitUrl,
        status: submitResult.status || 0,
        payloadSummary,
        response: submitResult.response || null
    });

    return buildTemplatePublishResult({
        success: true,
        message: `${PLATFORM_NAME}模板直发已完成图片上传并提交发布接口`,
        page,
        executionTrace,
        sessionBundle,
        publishImageUploadResult,
        submitResult,
        payloadSummary,
        shouldKeepPageOpen
    });
}

export default {
    hasTemuProductTemplate,
    resolveTemuProductTemplate,
    publishTemuByProductTemplate
};

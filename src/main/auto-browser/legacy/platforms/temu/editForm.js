import { logger } from '../../utils/logger.js';
import { PLATFORM_KEY, PLATFORM_NAME } from './constants.js';
import { normalizeText } from './utils.js';

const TEMU_EDIT_FIELD_DATA_ATTR = 'data-yishe-temu-edit-field';

const TEMU_TITLE_FIELD_KEYWORDS = [
    '商品标题',
    '商品名称',
    '产品标题',
    '产品名称',
    '标题',
    '名称'
];

const TEMU_TITLE_FIELD_NEGATIVE_KEYWORDS = [
    '短标题',
    '副标题',
    'seo',
    '关键词',
    '关键字',
    '搜索词',
    '货号',
    'sku',
    '品牌',
    '卖点',
    '描述',
    '详情',
    '备注',
    '型号',
    '规格'
];

const TEMU_DESCRIPTION_FIELD_KEYWORDS = [
    '商品描述',
    '产品描述',
    '详情描述',
    '详情',
    '商品详情',
    '图文详情',
    '描述',
    '卖点'
];

const TEMU_DESCRIPTION_FIELD_NEGATIVE_KEYWORDS = [
    '标题',
    '名称',
    '短标题',
    '副标题',
    'seo',
    '关键词',
    '关键字',
    '货号',
    'sku',
    '品牌'
];

function normalizeMultilineText(value, maxLength = 4000) {
    if (Array.isArray(value)) {
        return value
            .map((item) => normalizeMultilineText(item, maxLength))
            .filter(Boolean)
            .join('\n')
            .slice(0, maxLength);
    }

    const normalized = String(value || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return normalized.slice(0, maxLength);
}

function resolveTextCandidate(entries = [], options = {}) {
    const { multiline = false, maxLength = multiline ? 4000 : 200 } = options;
    for (const entry of entries) {
        const normalized = multiline
            ? normalizeMultilineText(entry, maxLength)
            : normalizeText(Array.isArray(entry) ? entry.find(Boolean) : entry).slice(0, maxLength);
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

export function resolveTemuPublishBasicInfo(publishInfo = {}) {
    const settings = publishInfo.platformOptions
        || publishInfo.publishOptions
        || publishInfo.platformSettings?.[PLATFORM_KEY]
        || {};

    const title = resolveTextCandidate([
        settings.fixedTitle,
        settings.title,
        settings.productTitle,
        publishInfo.title,
        publishInfo.name,
        publishInfo.productName,
        publishInfo.productTitle,
        publishInfo.candidateTitles,
        publishInfo.data?.title,
        publishInfo.data?.name,
        publishInfo.data?.productTitle,
        publishInfo.meta?.title,
        publishInfo.meta?.fixedTitle,
        publishInfo.meta?.titleConfig?.fixedTitle,
        publishInfo.metadata?.title,
        publishInfo.metadata?.fixedTitle,
        publishInfo.metadata?.titleConfig?.fixedTitle
    ], {
        multiline: false,
        maxLength: 200
    });

    const description = resolveTextCandidate([
        settings.description,
        settings.productDescription,
        publishInfo.description,
        publishInfo.content,
        publishInfo.desc,
        publishInfo.productDescription,
        publishInfo.detail,
        publishInfo.detailText,
        publishInfo.sellingPoints,
        publishInfo.data?.description,
        publishInfo.data?.content,
        publishInfo.data?.detail,
        publishInfo.meta?.description,
        publishInfo.metadata?.description
    ], {
        multiline: true,
        maxLength: 4000
    });

    return {
        title,
        description: description && description !== title ? description : ''
    };
}

async function collectTemuEditFieldCandidates(page) {
    return await page.evaluate(({ dataAttr }) => {
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
        const resolveLabel = (element) => {
            if (!(element instanceof HTMLElement)) return '';
            const labelledById = normalize(element.getAttribute('aria-labelledby') || '');
            if (labelledById) {
                const labelledByElement = document.getElementById(labelledById);
                const labelledByText = normalize(labelledByElement?.textContent || '');
                if (labelledByText) {
                    return labelledByText;
                }
            }

            const explicitForLabel = element.id
                ? normalize(document.querySelector(`label[for="${element.id}"]`)?.textContent || '')
                : '';
            if (explicitForLabel) {
                return explicitForLabel;
            }

            const nearestContainer = element.closest(
                'label,[class*="form-item"],[class*="field"],[class*="row"],[class*="item"],[class*="wrapper"]'
            );
            return normalize(
                nearestContainer?.querySelector(
                    'label,[class*="label"],[class*="title"],[class*="name"],[class*="heading"]'
                )?.textContent || ''
            );
        };
        const resolveSectionTitle = (element) => {
            const section = element.closest(
                'section,form,[class*="section"],[class*="panel"],[class*="card"],[class*="block"],[class*="group"]'
            );
            return normalize(
                section?.querySelector(
                    'h1,h2,h3,h4,label,[class*="title"],[class*="name"],[class*="heading"]'
                )?.textContent || ''
            );
        };
        const resolveContextText = (element) => {
            const container = element.closest(
                '[class*="form-item"],[class*="field"],[class*="row"],[class*="item"],[class*="editor"],[class*="textarea"],section,form'
            );
            return normalize(container?.textContent || '').slice(0, 220);
        };

        let counter = 0;
        const selector = [
            'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])',
            'textarea',
            '[contenteditable="true"]',
            '[contenteditable="plaintext-only"]'
        ].join(',');

        return Array.from(document.querySelectorAll(selector))
            .filter(isVisible)
            .map((element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }

                const fieldId = element.getAttribute(dataAttr) || `temu-edit-field-${Date.now()}-${counter += 1}`;
                element.setAttribute(dataAttr, fieldId);

                const tagName = element.tagName.toLowerCase();
                const isInput = element instanceof HTMLInputElement;
                const isTextarea = element instanceof HTMLTextAreaElement;
                const isContentEditable = element.getAttribute('contenteditable') === 'true'
                    || element.getAttribute('contenteditable') === 'plaintext-only';
                const currentValue = isInput || isTextarea
                    ? element.value || ''
                    : (element.innerText || element.textContent || '');

                return {
                    fieldId,
                    tagName,
                    inputType: normalize(element.getAttribute('type') || ''),
                    label: resolveLabel(element),
                    placeholder: normalize(element.getAttribute('placeholder') || ''),
                    ariaLabel: normalize(element.getAttribute('aria-label') || ''),
                    name: normalize(element.getAttribute('name') || ''),
                    className: normalize(element.className || '').slice(0, 200),
                    sectionTitle: resolveSectionTitle(element),
                    contextText: resolveContextText(element),
                    multiline: isTextarea || isContentEditable,
                    isContentEditable,
                    disabled: element.hasAttribute('disabled')
                        || element.getAttribute('aria-disabled') === 'true',
                    readOnly: element.hasAttribute('readonly')
                        || element.getAttribute('aria-readonly') === 'true',
                    maxLength: Number(element.getAttribute('maxlength') || 0) || 0,
                    currentValueLength: normalize(currentValue).length
                };
            })
            .filter(Boolean)
            .slice(0, 80);
    }, {
        dataAttr: TEMU_EDIT_FIELD_DATA_ATTR
    }).catch(() => []);
}

function scoreFieldPart(text, keywords = [], exactWeight = 20, includeWeight = 10) {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) {
        return 0;
    }

    let score = 0;
    for (const keyword of keywords) {
        const normalizedKeyword = normalizeText(keyword).toLowerCase();
        if (!normalizedKeyword) {
            continue;
        }
        if (normalized === normalizedKeyword) {
            score += exactWeight;
            continue;
        }
        if (normalized.includes(normalizedKeyword)) {
            score += includeWeight;
        }
    }

    return score;
}

function scoreTemuFieldCandidate(field, spec = {}) {
    if (!field || field.disabled || field.readOnly) {
        return -1000;
    }

    const positiveKeywords = spec.positiveKeywords || [];
    const negativeKeywords = spec.negativeKeywords || [];
    const allText = [
        field.label,
        field.placeholder,
        field.ariaLabel,
        field.name,
        field.className,
        field.sectionTitle,
        field.contextText
    ]
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .join(' | ');

    let score = 0;
    score += scoreFieldPart(field.label, positiveKeywords, 40, 24);
    score += scoreFieldPart(field.placeholder, positiveKeywords, 32, 18);
    score += scoreFieldPart(field.ariaLabel, positiveKeywords, 26, 14);
    score += scoreFieldPart(field.name, positiveKeywords, 18, 10);
    score += scoreFieldPart(field.sectionTitle, positiveKeywords, 18, 10);
    score += scoreFieldPart(field.contextText, positiveKeywords, 12, 6);
    score -= scoreFieldPart(allText, negativeKeywords, 30, 14);

    if (spec.preferMultiline === true) {
        score += field.multiline ? 16 : -12;
    } else if (spec.preferMultiline === false) {
        score += field.multiline ? -10 : 12;
    }

    if (Array.isArray(spec.preferTags) && spec.preferTags.includes(field.tagName)) {
        score += 10;
    }
    if (field.isContentEditable && spec.preferContentEditable) {
        score += 10;
    }

    if (spec.expectMaxLength === 'short') {
        if (field.maxLength > 0 && field.maxLength <= 200) {
            score += 8;
        } else if (field.maxLength > 200) {
            score -= 4;
        }
    } else if (spec.expectMaxLength === 'long') {
        if (!field.maxLength || field.maxLength > 200) {
            score += 6;
        }
    }

    return score;
}

function pickBestTemuFieldCandidate(fields = [], spec = {}, options = {}) {
    const excludedFieldIds = new Set(
        Array.isArray(options.excludedFieldIds) ? options.excludedFieldIds.filter(Boolean) : []
    );

    const ranked = fields
        .filter((field) => field?.fieldId && !excludedFieldIds.has(field.fieldId))
        .map((field) => ({
            ...field,
            score: scoreTemuFieldCandidate(field, spec)
        }))
        .sort((left, right) => {
            return right.score - left.score
                || Number(left.multiline) - Number(right.multiline)
                || left.currentValueLength - right.currentValueLength;
        });

    return {
        selected: ranked[0]?.score > 0 ? ranked[0] : null,
        ranked: ranked.slice(0, 8)
    };
}

async function readTemuFieldValue(page, fieldId) {
    return await page.evaluate(({ dataAttr, targetFieldId }) => {
        const element = document.querySelector(`[${dataAttr}="${targetFieldId}"]`);
        if (!(element instanceof HTMLElement)) {
            return '';
        }

        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            return String(element.value || '');
        }

        return String(element.innerText || element.textContent || '');
    }, {
        dataAttr: TEMU_EDIT_FIELD_DATA_ATTR,
        targetFieldId: fieldId
    }).catch(() => '');
}

async function setTemuFieldValue(page, field, value) {
    if (!field?.fieldId) {
        return {
            success: false,
            reason: 'field_missing'
        };
    }

    return await page.evaluate(({ dataAttr, targetFieldId, nextValue }) => {
        const element = document.querySelector(`[${dataAttr}="${targetFieldId}"]`);
        if (!(element instanceof HTMLElement)) {
            return {
                success: false,
                reason: 'field_not_found'
            };
        }

        const normalize = (input) => String(input || '').replace(/\s+/g, ' ').trim();
        const dispatchInputEvents = (node) => {
            node.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            node.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: nextValue
            }));
            node.dispatchEvent(new Event('change', { bubbles: true }));
            node.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        };

        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const descriptor = element instanceof HTMLTextAreaElement
                ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
                : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (descriptor?.set) {
                descriptor.set.call(element, nextValue);
            } else {
                element.value = nextValue;
            }
            dispatchInputEvents(element);
            const afterValue = String(element.value || '');
            return {
                success: normalize(afterValue) === normalize(nextValue),
                beforeValueLength: String(element.value || '').length,
                afterValue
            };
        }

        if (element.getAttribute('contenteditable') === 'true'
            || element.getAttribute('contenteditable') === 'plaintext-only') {
            element.focus();
            element.textContent = nextValue;
            dispatchInputEvents(element);
            const afterValue = String(element.innerText || element.textContent || '');
            return {
                success: normalize(afterValue) === normalize(nextValue),
                afterValue
            };
        }

        return {
            success: false,
            reason: 'unsupported_field_type'
        };
    }, {
        dataAttr: TEMU_EDIT_FIELD_DATA_ATTR,
        targetFieldId: field.fieldId,
        nextValue: value
    }).catch((error) => ({
        success: false,
        reason: error?.message || String(error)
    }));
}

async function typeTemuFieldValue(page, field, value) {
    if (!field?.fieldId) {
        return {
            success: false,
            reason: 'field_missing'
        };
    }

    const locator = page.locator(`[${TEMU_EDIT_FIELD_DATA_ATTR}="${field.fieldId}"]`).first();

    try {
        await locator.waitFor({ timeout: 8_000, state: 'visible' });
        await locator.scrollIntoViewIfNeeded().catch(() => undefined);
        await locator.click({ clickCount: field.multiline ? 1 : 3 }).catch(async () => {
            await locator.click({ clickCount: 1, force: true });
        });
        await page.keyboard.press('Control+A').catch(() => undefined);
        await page.keyboard.press('Meta+A').catch(() => undefined);
        await page.keyboard.press('Backspace').catch(() => undefined);

        if (field.tagName === 'input' || field.tagName === 'textarea') {
            await locator.fill('').catch(() => undefined);
            await locator.fill(value).catch(async () => {
                await page.keyboard.type(value, { delay: 20 });
            });
        } else {
            await page.keyboard.type(value, { delay: 20 });
        }

        await page.waitForTimeout(250);
        const finalValue = await readTemuFieldValue(page, field.fieldId);
        return {
            success: normalizeText(finalValue) === normalizeText(value),
            afterValue: finalValue
        };
    } catch (error) {
        return {
            success: false,
            reason: error?.message || String(error)
        };
    }
}

async function cleanupTaggedTemuFields(page) {
    await page.evaluate((dataAttr) => {
        document.querySelectorAll(`[${dataAttr}]`).forEach((element) => {
            if (element instanceof HTMLElement) {
                element.removeAttribute(dataAttr);
            }
        });
    }, TEMU_EDIT_FIELD_DATA_ATTR).catch(() => undefined);
}

async function fillTemuFieldCandidate(page, field, value) {
    const directSetResult = await setTemuFieldValue(page, field, value);
    if (directSetResult?.success) {
        return {
            success: true,
            method: 'dom_setter',
            afterValue: directSetResult.afterValue || value
        };
    }

    const typedResult = await typeTemuFieldValue(page, field, value);
    if (typedResult?.success) {
        return {
            success: true,
            method: 'keyboard_type',
            afterValue: typedResult.afterValue || value
        };
    }

    return {
        success: false,
        reason: typedResult?.reason || directSetResult?.reason || 'fill_failed',
        directSetResult,
        typedResult
    };
}

export async function fillTemuPublishBasicInfo(page, publishInfo = {}) {
    const basicInfo = resolveTemuPublishBasicInfo(publishInfo);
    if (!basicInfo.title && !basicInfo.description) {
        return {
            success: true,
            skipped: true,
            message: 'Temu 发布数据未提供标题或描述，跳过基础信息填写'
        };
    }

    const fields = await collectTemuEditFieldCandidates(page);
    if (!fields.length) {
        return {
            success: false,
            skipped: false,
            message: '未识别到 Temu 编辑页可填写字段',
            availableFieldCount: 0
        };
    }

    logger.info(`${PLATFORM_NAME}编辑页字段识别完成`, {
        availableFieldCount: fields.length,
        fields: fields.slice(0, 10).map((field) => ({
            tagName: field.tagName,
            label: field.label,
            placeholder: field.placeholder,
            sectionTitle: field.sectionTitle,
            multiline: field.multiline
        }))
    });

    const titleSelection = basicInfo.title
        ? pickBestTemuFieldCandidate(fields, {
            positiveKeywords: TEMU_TITLE_FIELD_KEYWORDS,
            negativeKeywords: TEMU_TITLE_FIELD_NEGATIVE_KEYWORDS,
            preferMultiline: false,
            preferTags: ['input', 'textarea'],
            expectMaxLength: 'short'
        })
        : { selected: null, ranked: [] };

    const descriptionSelection = basicInfo.description
        ? pickBestTemuFieldCandidate(fields, {
            positiveKeywords: TEMU_DESCRIPTION_FIELD_KEYWORDS,
            negativeKeywords: TEMU_DESCRIPTION_FIELD_NEGATIVE_KEYWORDS,
            preferMultiline: true,
            preferTags: ['textarea', 'div'],
            preferContentEditable: true,
            expectMaxLength: 'long'
        }, {
            excludedFieldIds: [titleSelection.selected?.fieldId].filter(Boolean)
        })
        : { selected: null, ranked: [] };

    let titleFillResult = {
        success: !basicInfo.title,
        skipped: !basicInfo.title,
        reason: !basicInfo.title ? 'title_empty' : 'title_field_not_matched'
    };
    let descriptionFillResult = {
        success: !basicInfo.description,
        skipped: !basicInfo.description,
        reason: !basicInfo.description ? 'description_empty' : 'description_field_not_matched'
    };

    try {
        if (basicInfo.title && titleSelection.selected) {
            titleFillResult = await fillTemuFieldCandidate(page, titleSelection.selected, basicInfo.title);
        }

        if (basicInfo.description && descriptionSelection.selected) {
            descriptionFillResult = await fillTemuFieldCandidate(
                page,
                descriptionSelection.selected,
                basicInfo.description
            );
        }
    } finally {
        await cleanupTaggedTemuFields(page);
    }

    const success = (!basicInfo.title || titleFillResult.success)
        && (!basicInfo.description || descriptionFillResult.success);

    const result = {
        success,
        skipped: false,
        titleValue: basicInfo.title,
        descriptionValue: basicInfo.description,
        titleFilled: !!titleFillResult.success,
        descriptionFilled: !!descriptionFillResult.success,
        titleFieldCandidate: titleSelection.selected || null,
        descriptionFieldCandidate: descriptionSelection.selected || null,
        titleCandidateRanking: titleSelection.ranked || [],
        descriptionCandidateRanking: descriptionSelection.ranked || [],
        availableFieldCount: fields.length,
        titleFillResult,
        descriptionFillResult,
        message: success
            ? `${PLATFORM_NAME}编辑页基础信息填写完成`
            : `${PLATFORM_NAME}编辑页基础信息未完全填写成功`
    };

    logger.info(`${PLATFORM_NAME}编辑页基础信息填写结果`, {
        success: result.success,
        titleFilled: result.titleFilled,
        descriptionFilled: result.descriptionFilled,
        titleCandidate: result.titleFieldCandidate
            ? {
                label: result.titleFieldCandidate.label,
                placeholder: result.titleFieldCandidate.placeholder,
                sectionTitle: result.titleFieldCandidate.sectionTitle,
                score: result.titleFieldCandidate.score
            }
            : null,
        descriptionCandidate: result.descriptionFieldCandidate
            ? {
                label: result.descriptionFieldCandidate.label,
                placeholder: result.descriptionFieldCandidate.placeholder,
                sectionTitle: result.descriptionFieldCandidate.sectionTitle,
                score: result.descriptionFieldCandidate.score
            }
            : null
    });

    return result;
}

import {
    PLATFORM_KEY,
    TEMU_CREATE_URL,
    TEMU_LOGIN_URL
} from './constants.js';

function normalizeBoolean(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function limitText(value, maxLength = 80) {
    const normalized = normalizeText(value);
    return normalized.slice(0, maxLength);
}

function dedupeStrings(values = []) {
    return Array.from(new Set(values.map((item) => normalizeText(item)).filter(Boolean)));
}

function normalizeOrderedStringList(values = []) {
    return values.map((item) => normalizeText(item)).filter(Boolean);
}

function splitCategoryPath(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return [];
    }

    const tryParseJsonArray = (text) => {
        try {
            const parsed = JSON.parse(text);
            return Array.isArray(parsed)
                ? dedupeStrings(parsed.map((item) => normalizeText(item)))
                : [];
        } catch {
            return [];
        }
    };

    const parsedJsonArray = tryParseJsonArray(normalized);
    if (parsedJsonArray.length > 0) {
        return parsedJsonArray;
    }

    const parsedSingleQuotedArray = tryParseJsonArray(normalized.replace(/'/g, '"'));
    if (parsedSingleQuotedArray.length > 0) {
        return parsedSingleQuotedArray;
    }

    return dedupeStrings(normalized.split(/\s*(?:>|\/|\\|\||,|，|;|；|→|->)\s*/g));
}

export function buildTraceEvent(step, status, detail = {}) {
    return {
        step,
        status,
        time: new Date().toISOString(),
        ...detail
    };
}

export function pushTrace(trace, step, status, detail = {}) {
    trace.push(buildTraceEvent(step, status, detail));
}

function extractKeywordCandidates(entries = []) {
    const directValues = [];
    const pathSegments = [];
    const sourceSummary = [];

    for (const entry of entries) {
        const source = entry?.source || 'unknown';
        const value = entry?.value;
        if (value === undefined || value === null) {
            continue;
        }

        if (Array.isArray(value)) {
            const items = dedupeStrings(value);
            if (items.length > 0) {
                directValues.push(...items);
                pathSegments.push(...items);
                sourceSummary.push({ source, value: items.join(' | ') });
            }
            continue;
        }

        const normalized = limitText(value, 120);
        if (!normalized) {
            continue;
        }

        directValues.push(normalized);
        const segments = splitCategoryPath(normalized);
        if (segments.length > 1) {
            pathSegments.push(...segments);
        }
        sourceSummary.push({ source, value: normalized });
    }

    return {
        directValues: dedupeStrings(directValues),
        pathSegments: dedupeStrings(pathSegments),
        sourceSummary
    };
}

export function normalizeTemuSettings(publishInfo = {}) {
    const settings = publishInfo.platformOptions || publishInfo.publishOptions || publishInfo.platformSettings?.[PLATFORM_KEY] || {};
    return {
        account: String(settings.account || publishInfo.account || '').trim(),
        password: String(settings.password || publishInfo.password || '').trim(),
        needLogin: normalizeBoolean(settings.needLogin ?? publishInfo.needLogin),
        keepPageOpen: normalizeBoolean(settings.keepPageOpen ?? publishInfo.keepPageOpen),
        createUrl: String(settings.createUrl || publishInfo.createUrl || TEMU_CREATE_URL).trim() || TEMU_CREATE_URL,
        loginUrl: String(settings.loginUrl || publishInfo.loginUrl || TEMU_LOGIN_URL).trim() || TEMU_LOGIN_URL
    };
}

export function resolveTemuCategoryIntent(publishInfo = {}) {
    const settings = publishInfo.platformOptions || publishInfo.publishOptions || publishInfo.platformSettings?.[PLATFORM_KEY] || {};
    const orderedCategoryPathCandidates = [
        settings.categoryPath,
        settings.temuCategoryPath,
        publishInfo.categoryPath,
        publishInfo.temuCategoryPath,
        publishInfo.data?.categoryPath,
        publishInfo.meta?.categoryPath,
        publishInfo.metadata?.categoryPath
    ];
    const orderedCategoryPathSegments = orderedCategoryPathCandidates
        .map((value) => Array.isArray(value) ? normalizeOrderedStringList(value) : splitCategoryPath(value))
        .find((items) => Array.isArray(items) && items.length > 0) || [];
    const explicitSources = extractKeywordCandidates([
        { source: 'platformOptions.categoryKeyword', value: settings.categoryKeyword },
        { source: 'platformOptions.categoryName', value: settings.categoryName },
        { source: 'platformOptions.categoryPath', value: settings.categoryPath },
        { source: 'platformOptions.temuCategoryKeyword', value: settings.temuCategoryKeyword },
        { source: 'platformOptions.temuCategoryName', value: settings.temuCategoryName },
        { source: 'platformOptions.temuCategoryPath', value: settings.temuCategoryPath },
        { source: 'publishInfo.categoryKeyword', value: publishInfo.categoryKeyword },
        { source: 'publishInfo.categoryName', value: publishInfo.categoryName },
        { source: 'publishInfo.categoryPath', value: publishInfo.categoryPath },
        { source: 'publishInfo.category', value: publishInfo.category },
        { source: 'publishInfo.productCategory', value: publishInfo.productCategory },
        { source: 'publishInfo.productCategoryName', value: publishInfo.productCategoryName },
        { source: 'publishInfo.temuCategoryKeyword', value: publishInfo.temuCategoryKeyword },
        { source: 'publishInfo.temuCategoryName', value: publishInfo.temuCategoryName },
        { source: 'publishInfo.temuCategoryPath', value: publishInfo.temuCategoryPath },
        { source: 'publishInfo.data.categoryKeyword', value: publishInfo.data?.categoryKeyword },
        { source: 'publishInfo.data.categoryName', value: publishInfo.data?.categoryName },
        { source: 'publishInfo.data.categoryPath', value: publishInfo.data?.categoryPath },
        { source: 'publishInfo.data.productCategory', value: publishInfo.data?.productCategory },
        { source: 'publishInfo.data.productCategoryName', value: publishInfo.data?.productCategoryName },
        { source: 'publishInfo.meta.categoryName', value: publishInfo.meta?.categoryName },
        { source: 'publishInfo.meta.categoryPath', value: publishInfo.meta?.categoryPath },
        { source: 'publishInfo.metadata.categoryName', value: publishInfo.metadata?.categoryName },
        { source: 'publishInfo.metadata.categoryPath', value: publishInfo.metadata?.categoryPath }
    ]);

    const fallbackSources = extractKeywordCandidates([
        { source: 'publishInfo.title', value: publishInfo.title },
        { source: 'publishInfo.name', value: publishInfo.name },
        { source: 'publishInfo.description', value: publishInfo.description },
        { source: 'publishInfo.content', value: publishInfo.content },
        { source: 'publishInfo.data.title', value: publishInfo.data?.title },
        { source: 'publishInfo.data.name', value: publishInfo.data?.name }
    ]);

    const preferredSearchKeywords = dedupeStrings([
        ...explicitSources.directValues,
        ...explicitSources.pathSegments.slice(-2),
        ...fallbackSources.directValues
    ]).map((item) => limitText(item, 60));

    const selectionTexts = dedupeStrings([
        ...orderedCategoryPathSegments,
        ...explicitSources.pathSegments,
        ...explicitSources.directValues
    ]);

    return {
        primaryKeyword: preferredSearchKeywords[0] || '',
        searchKeywords: preferredSearchKeywords,
        selectionTexts,
        categoryPathSegments: orderedCategoryPathSegments.length > 0 ? orderedCategoryPathSegments : explicitSources.pathSegments,
        explicitCategoryDetected: explicitSources.directValues.length > 0 || explicitSources.pathSegments.length > 0 || orderedCategoryPathSegments.length > 0,
        sourceSummary: [...explicitSources.sourceSummary, ...fallbackSources.sourceSummary].slice(0, 12)
    };
}

export {
    normalizeBoolean,
    normalizeText,
    normalizeOrderedStringList,
    limitText,
    dedupeStrings,
    splitCategoryPath,
    extractKeywordCandidates
};

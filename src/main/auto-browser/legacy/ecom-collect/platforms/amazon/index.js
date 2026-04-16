import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildSearchSuggestionsSceneCapability,
    buildShopHotProductsSceneCapability,
    buildSelectField,
    createOutputField,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';
import { DEFAULT_PAGE_TIMEOUT_MS } from '../../common/constants.js';
import {
    buildKeywordList,
    buildSerializableSceneConfig,
    extractDetailRecord,
} from '../../common/extractors.js';
import {
    captureScreenshot,
    prepareCollectionPage,
} from '../../common/navigation.js';
import {
    normalizePriceText,
    normalizeRecordKey,
    normalizeSourceUrlForStorage,
    sanitizeText,
    sanitizeUrl,
} from '../../common/runtime.js';
import {
    amazonProductDetailScene,
    amazonSearchScene,
    amazonShopHotProductsScene,
} from './selectors.js';

const AMAZON_DETAIL_WAIT_SELECTORS = [
    ...(amazonProductDetailScene.titleSelectors || []),
    ...(amazonProductDetailScene.priceSelectors || []),
    ...(amazonProductDetailScene.imageSelectors || []),
];

const AMAZON_SUGGESTION_HTTP_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
};

const AMAZON_MARKETPLACE_CONFIGS = {
    US: {
        code: 'US',
        label: '美国',
        homeUrl: 'https://www.amazon.com/',
        searchUrl: 'https://www.amazon.com/s?k=',
        suggestionEndpoint: 'https://completion.amazon.com/api/2017/suggestions',
        alias: 'aps',
        mid: 'ATVPDKIKX0DER',
        acceptLanguage: 'en-US,en;q=0.9',
    },
    UK: {
        code: 'UK',
        label: '英国',
        homeUrl: 'https://www.amazon.co.uk/',
        searchUrl: 'https://www.amazon.co.uk/s?k=',
        suggestionEndpoint: 'https://completion.amazon.com/api/2017/suggestions',
        alias: 'aps',
        mid: 'A1F83G8C2ARO7P',
        acceptLanguage: 'en-GB,en;q=0.9',
    },
    DE: {
        code: 'DE',
        label: '德国',
        homeUrl: 'https://www.amazon.de/',
        searchUrl: 'https://www.amazon.de/s?k=',
        suggestionEndpoint: 'https://completion.amazon.com/api/2017/suggestions',
        alias: 'aps',
        mid: 'A1PA6795UKMFR9',
        acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8',
    },
    JP: {
        code: 'JP',
        label: '日本',
        homeUrl: 'https://www.amazon.co.jp/',
        searchUrl: 'https://www.amazon.co.jp/s?k=',
        suggestionEndpoint: 'https://completion.amazon.com/api/2017/suggestions',
        alias: 'aps',
        mid: 'AN1VRQENFRJN5',
        acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8',
    },
};

const AMAZON_MARKETPLACE_OPTIONS = Object.values(AMAZON_MARKETPLACE_CONFIGS).map((item) => ({
    label: item.label,
    value: item.code,
    description: `${item.label} 站点搜索联想词`,
}));

const AMAZON_SEARCH_RECORD_FIELDS_EXTRA = [
    createOutputField('asin', 'ASIN', {
        description: 'Amazon 商品唯一标识，适合用于跨列表和详情关联。',
        stability: 'platform',
        examples: ['B0C1234567'],
    }),
    createOutputField('originalSourceUrl', '原始链接', {
        description: '保留跳转前或带追踪参数的原始页面链接。',
        valueType: 'url',
        stability: 'platform',
    }),
    createOutputField('detailFetchStatus', '详情补抓状态', {
        description: 'search 场景补抓详情页时的执行状态，如 success / blocked / failed。',
        stability: 'platform',
        examples: ['success'],
    }),
    createOutputField('detailFetchError', '详情补抓异常', {
        description: '详情页补抓失败时的错误摘要。',
        stability: 'platform',
    }),
    createOutputField('detailRisk', '详情风险对象', {
        description: '命中登录、验证码或风控时返回的风险对象。',
        valueType: 'object',
        stability: 'platform',
    }),
    createOutputField('listingData', '列表原始对象', {
        description: '列表页原始卡片快照，便于和详情页补抓结果对照。',
        valueType: 'object',
        stability: 'platform',
    }),
    createOutputField('detailData', '详情原始对象', {
        description: '详情页保真结果，search 场景会在补抓成功后挂载在这里。',
        valueType: 'object',
        stability: 'platform',
    }),
    createOutputField('detailRecordKey', '详情记录标识', {
        description: '详情页层级的记录主键。',
        stability: 'platform',
    }),
    createOutputField('detailCapturedAt', '详情采集时间', {
        description: '详情页补抓完成时间。',
        valueType: 'datetime',
        stability: 'platform',
    }),
    createOutputField('brand', '品牌', {
        description: '从详情页同步回搜索记录的品牌字段。',
        stability: 'platform',
    }),
    createOutputField('sellerName', '卖家', {
        description: 'Amazon 卖家或 merchant 名称。',
        stability: 'platform',
    }),
    createOutputField('availabilityText', '库存文本', {
        description: '详情页可售状态、库存状态等文本。',
        stability: 'platform',
    }),
    createOutputField('deliveryText', '配送文本', {
        description: '配送承诺、到货时间等原始文本。',
        stability: 'platform',
    }),
];

const AMAZON_DETAIL_RECORD_FIELDS_EXTRA = [
    createOutputField('asin', 'ASIN', {
        description: 'Amazon 商品唯一标识。',
        stability: 'platform',
        examples: ['B0C1234567'],
    }),
    createOutputField('originalSourceUrl', '原始链接', {
        description: '详情页跳转前的原始链接，必要时保留追踪参数。',
        valueType: 'url',
        stability: 'platform',
    }),
    createOutputField('sellerName', '卖家', {
        description: '卖家或 merchant 名称。',
        stability: 'platform',
    }),
    createOutputField('merchantInfoText', '商家信息文本', {
        description: 'Amazon 商家说明、发货方说明等原始文本。',
        stability: 'platform',
    }),
    createOutputField('deliveryText', '配送文本', {
        description: '配送承诺、到货时间等原始文本。',
        stability: 'platform',
    }),
    createOutputField('pageTitle', '页面标题', {
        description: '浏览器页面 title，适合辅助判断页面是否跳流。',
        stability: 'platform',
    }),
    createOutputField('bulletPointsText', '卖点摘要文本', {
        description: 'bulletPoints 的拼接摘要，适合轻量分析和 AI 输入。',
        valueType: 'text',
        stability: 'platform',
    }),
    createOutputField('breadcrumbText', '类目路径文本', {
        description: 'breadcrumb 的拼接摘要。',
        stability: 'platform',
    }),
    createOutputField('specSummaryText', '规格摘要文本', {
        description: 'specPairs 的拼接摘要。',
        valueType: 'text',
        stability: 'platform',
    }),
];

const AMAZON_SUGGESTION_RECORD_FIELDS_EXTRA = [
    createOutputField('sourceType', '来源类型', {
        description: '当前记录属于搜索联想信号。',
        stability: 'platform',
        examples: ['keyword_suggestion'],
    }),
    createOutputField('signalType', '信号类型', {
        description: '信号子类型，当前为 search_suggestion。',
        stability: 'platform',
        examples: ['search_suggestion'],
    }),
    createOutputField('marketplace', '站点代码', {
        description: 'Amazon 站点代码，例如 US / UK / DE / JP。',
        stability: 'platform',
        examples: ['US'],
    }),
    createOutputField('marketplaceLabel', '站点名称', {
        description: '站点的人类可读名称。',
        stability: 'platform',
        examples: ['美国'],
    }),
    createOutputField('suggestionSource', '建议来源', {
        description: '来自 API 还是 UI 回退抓取。',
        stability: 'platform',
        examples: ['api'],
    }),
    createOutputField('strategyId', '策略 ID', {
        description: 'Amazon 联想词接口返回的策略标识。',
        stability: 'platform',
    }),
    createOutputField('candidateSources', '候选来源', {
        description: '联想词候选来源标记。',
        stability: 'platform',
    }),
    createOutputField('refTag', '引用标签', {
        description: '联想词接口返回的 refTag 等来源上下文。',
        stability: 'platform',
    }),
    createOutputField('prior', '优先级', {
        description: '联想词优先级或排序权重。',
        valueType: 'number',
        stability: 'platform',
    }),
    createOutputField('uiSeen', '页面可见', {
        description: '该联想词是否也在 UI 下拉中被看到。',
        valueType: 'boolean',
        stability: 'platform',
    }),
];

function buildAmazonListingData(record = {}) {
    return {
        recordKey: record.recordKey || '',
        title: record.title || '',
        subtitle: record.subtitle || '',
        priceText: record.priceText || '',
        shopName: record.shopName || '',
        badgeText: record.badgeText || '',
        sourceUrl: record.sourceUrl || '',
        originalSourceUrl: record.originalSourceUrl || '',
        imageUrl: record.imageUrl || '',
        cardText: record.cardText || '',
        capturedAt: record.capturedAt || '',
    };
}

function extractAmazonAsin(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    if (/^[A-Z0-9]{10}$/i.test(raw)) {
        return raw.toUpperCase();
    }

    const decodedCandidates = [raw];
    try {
        const decoded = decodeURIComponent(raw);
        if (decoded && decoded !== raw) {
            decodedCandidates.push(decoded);
        }
    } catch {
        // ignore malformed URI content
    }

    const patterns = [
        /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
        /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
        /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?]|$)/i,
        /\/exec\/obidos\/ASIN\/([A-Z0-9]{10})(?:[/?]|$)/i,
        /[?&]asin=([A-Z0-9]{10})(?:[&#]|$)/i,
        /[?&]pd_rd_i=([A-Z0-9]{10})(?:[&#]|$)/i,
    ];

    for (const candidate of decodedCandidates) {
        for (const pattern of patterns) {
            const matched = candidate.match(pattern);
            if (matched?.[1]) {
                return matched[1].toUpperCase();
            }
        }
    }

    return '';
}

function resolveAmazonOrigin(...values) {
    for (const value of values) {
        const raw = String(value || '').trim();
        if (!raw) {
            continue;
        }

        try {
            const parsed = new URL(raw);
            if (/amazon\./i.test(parsed.hostname)) {
                return `${parsed.protocol}//${parsed.host}`;
            }
        } catch {
            // ignore non-url values
        }
    }

    return 'https://www.amazon.com';
}

function resolveAmazonDetailUrl(record = {}, pageUrl = '') {
    const origin = resolveAmazonOrigin(
        record.originalSourceUrl,
        record.sourceUrl,
        pageUrl,
    );
    const asin = extractAmazonAsin(record.recordKey)
        || extractAmazonAsin(record.originalSourceUrl)
        || extractAmazonAsin(record.sourceUrl);

    if (asin) {
        return `${origin}/dp/${asin}`;
    }

    const fallbackSourceUrl = String(
        record.originalSourceUrl || record.sourceUrl || '',
    ).trim();
    if (!fallbackSourceUrl) {
        return '';
    }

    try {
        return new URL(fallbackSourceUrl, origin).toString();
    } catch {
        return fallbackSourceUrl;
    }
}

function buildAmazonDetailStage(record = {}, suffix = 'detail') {
    const asin = extractAmazonAsin(record.recordKey)
        || extractAmazonAsin(record.originalSourceUrl)
        || extractAmazonAsin(record.sourceUrl)
        || 'amazon-item';

    return `amazon-detail-${asin}-${suffix}`;
}

function findLatestSnapshotByStage(snapshots = [], stage = '') {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
        const item = snapshots[index];
        if (item?.stage === stage) {
            return item;
        }
    }
    return null;
}

function dedupeTextList(values = [], limit = 20) {
    const normalized = [];
    const visited = new Set();

    values.forEach((item) => {
        const text = sanitizeText(item);
        if (!text || visited.has(text)) {
            return;
        }
        visited.add(text);
        normalized.push(text);
    });

    return normalized.slice(0, limit);
}

function normalizeSpecPairs(specPairs = []) {
    if (!Array.isArray(specPairs)) {
        return [];
    }

    const normalized = [];
    const visited = new Set();

    specPairs.forEach((item) => {
        if (!item || typeof item !== 'object') {
            return;
        }

        const label = sanitizeText(item.label);
        const value = sanitizeText(item.value);
        if (!label || !value) {
            return;
        }

        const uniqueKey = `${label}::${value}`;
        if (visited.has(uniqueKey)) {
            return;
        }
        visited.add(uniqueKey);
        normalized.push({ label, value });
    });

    return normalized.slice(0, 80);
}

async function extractAmazonDetailData(page, detailUrl = '') {
    return page.evaluate(({ detailUrl: targetUrl }) => {
        const toText = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
        const pickText = (selectors = []) => {
            for (const selector of selectors || []) {
                const node = document.querySelector(selector);
                const text = toText(node?.textContent || '');
                if (text) return text;
            }
            return '';
        };

        const collectTextList = (selectors = [], limit = 50) => {
            const result = [];
            const visited = new Set();

            for (const selector of selectors || []) {
                document.querySelectorAll(selector).forEach((node) => {
                    const text = toText(node?.textContent || '');
                    if (!text || visited.has(text) || result.length >= limit) {
                        return;
                    }
                    visited.add(text);
                    result.push(text);
                });
                if (result.length >= limit) {
                    break;
                }
            }

            return result;
        };

        const collectSpecPairs = (tableSelectors = [], listSelectors = []) => {
            const pairs = [];
            const visited = new Set();

            const pushPair = (label, value) => {
                const normalizedLabel = toText(label);
                const normalizedValue = toText(value);
                if (!normalizedLabel || !normalizedValue) {
                    return;
                }

                const uniqueKey = `${normalizedLabel}::${normalizedValue}`;
                if (visited.has(uniqueKey)) {
                    return;
                }

                visited.add(uniqueKey);
                pairs.push({
                    label: normalizedLabel,
                    value: normalizedValue,
                });
            };

            for (const selector of tableSelectors || []) {
                document.querySelectorAll(selector).forEach((row) => {
                    const label =
                        row.querySelector('th, td:first-child, .prodDetSectionEntry')?.textContent || '';
                    const value =
                        row.querySelector('td:last-child, td:nth-child(2), .prodDetAttrValue')?.textContent || '';
                    pushPair(label, value);
                });
            }

            for (const selector of listSelectors || []) {
                document.querySelectorAll(selector).forEach((item) => {
                    const labelNode = item.querySelector('.a-text-bold, .a-text-bold span');
                    const label = labelNode?.textContent || '';
                    const cloned = item.cloneNode(true);
                    if (labelNode && cloned instanceof HTMLElement) {
                        const clonedLabelNode = cloned.querySelector('.a-text-bold, .a-text-bold span');
                        clonedLabelNode?.remove();
                    }
                    const value = cloned instanceof HTMLElement ? cloned.textContent || '' : item.textContent || '';
                    pushPair(label.replace(/[:：]\s*$/, ''), value.replace(/^[\s:：-]+/, ''));
                });
            }

            return pairs;
        };

        const collectImageUrls = () => {
            const urls = [];
            const visited = new Set();

            const pushUrl = (value) => {
                const text = toText(value);
                if (!text || visited.has(text)) {
                    return;
                }
                visited.add(text);
                urls.push(text);
            };

            const landingImageNode = document.querySelector('#landingImage, #imgTagWrapperId img');
            const dynamicImageRaw =
                landingImageNode?.getAttribute('data-a-dynamic-image') ||
                landingImageNode?.getAttribute('data-old-hires') ||
                '';

            if (dynamicImageRaw && dynamicImageRaw.startsWith('{')) {
                try {
                    const parsed = JSON.parse(dynamicImageRaw);
                    Object.keys(parsed || {}).forEach((key) => pushUrl(key));
                } catch {
                    // ignore malformed JSON
                }
            }

            document.querySelectorAll(
                '#altImages img, #main-image-container img, #imgTagWrapperId img, #landingImage, [data-csa-c-type="image"] img',
            ).forEach((node) => {
                pushUrl(
                    node.getAttribute('src') ||
                    node.getAttribute('data-src') ||
                    node.getAttribute('data-old-hires') ||
                    node.currentSrc,
                );
            });

            return urls.slice(0, 20);
        };

        const breadcrumb = collectTextList([
            '#wayfinding-breadcrumbs_feature_div ul li a',
            '#wayfinding-breadcrumbs_container ul li a',
            '#wayfinding-breadcrumbs_feature_div li span.a-list-item',
        ], 12);
        const bulletPoints = collectTextList([
            '#feature-bullets li span.a-list-item',
            '#feature-bullets ul li span',
        ], 30);
        const descriptionBlocks = collectTextList([
            '#productDescription span',
            '#productDescription p',
            '#aplus_feature_div p',
            '#aplus_feature_div li',
            '#productFactsDesktop_feature_div tr',
        ], 60);
        const specPairs = collectSpecPairs(
            [
                '#productDetails_techSpec_section_1 tr',
                '#productDetails_detailBullets_sections1 tr',
                '#technicalSpecifications_section_1 tr',
                '.prodDetTable tr',
            ],
            [
                '#detailBullets_feature_div li',
                '#detailBulletsWrapper_feature_div li',
                '#glance_icons_div li',
            ],
        );
        const imageUrls = collectImageUrls();
        const asin =
            toText(document.querySelector('#ASIN')?.getAttribute('value') || '') ||
            toText(document.querySelector('input[name="ASIN"]')?.getAttribute('value') || '') ||
            (() => {
                const matched = String(location.href || targetUrl || '').match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i);
                return matched?.[1] ? matched[1].toUpperCase() : '';
            })();

        const title = pickText(['#productTitle']);
        const priceText = pickText([
            '#corePrice_feature_div .a-price .a-offscreen',
            '.priceToPay .a-offscreen',
            '.apexPriceToPay .a-offscreen',
            '#tp_price_block_total_price_ww .a-offscreen',
            '.a-price .a-offscreen',
        ]);
        const originalPriceText = pickText([
            '.basisPrice .a-offscreen',
            '.a-text-price .a-offscreen',
            '#listPrice .a-price .a-offscreen',
        ]);
        const brand = pickText(['#bylineInfo', '#brand', 'a#bylineInfo']);
        const sellerName = pickText([
            '#sellerProfileTriggerId',
            '#merchant-info a',
            '#merchantInfoFeature_feature_div a',
        ]);
        const merchantInfoText = pickText([
            '#merchant-info',
            '#merchantInfoFeature_feature_div',
        ]);
        const ratingText = pickText([
            '#acrPopover .a-icon-alt',
            '#averageCustomerReviews .a-icon-alt',
        ]);
        const reviewCountText = pickText([
            '#acrCustomerReviewText',
            '#acrCustomerReviewLink #acrCustomerReviewText',
        ]);
        const availabilityText = pickText([
            '#availability span',
            '#availabilityInsideBuyBox_feature_div span',
        ]);
        const deliveryText = pickText([
            '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE span',
            '#deliveryBlockMessage',
            '#mir-layout-DELIVERY_BLOCK-slot-DELIVERY_MESSAGE',
            '#exports_desktop_qualifiedBuyBox_delivery_promise_feature_div',
        ]);

        return {
            recordKey: asin || location.href || targetUrl || '',
            asin,
            sourceUrl: location.href || targetUrl || '',
            title,
            priceText,
            originalPriceText,
            brand,
            shopName: brand || sellerName || merchantInfoText,
            sellerName,
            merchantInfoText,
            ratingText,
            reviewCountText,
            availabilityText,
            deliveryText,
            bulletPoints,
            bulletPointsText: bulletPoints.join('；'),
            breadcrumb,
            breadcrumbText: breadcrumb.join(' / '),
            descriptionText: [...bulletPoints, ...descriptionBlocks].join('\n').slice(0, 6000),
            specPairs,
            specSummaryText: specPairs.map((item) => `${item.label}: ${item.value}`).join('；').slice(0, 4000),
            imageUrls,
            pageTitle: document.title || '',
            capturedAt: new Date().toISOString(),
        };
    }, { detailUrl });
}

function normalizeAmazonDetailData(record = {}, detailUrl = '') {
    const rawSourceUrl = sanitizeUrl(record.sourceUrl, detailUrl);
    const { sourceUrl, originalSourceUrl } = normalizeSourceUrlForStorage(rawSourceUrl);
    const imageUrls = Array.isArray(record.imageUrls)
        ? record.imageUrls
            .map((item) => sanitizeUrl(item, sourceUrl || detailUrl))
            .filter(Boolean)
        : [];

    return {
        ...record,
        recordKey: normalizeRecordKey(record.recordKey, originalSourceUrl || sourceUrl || detailUrl),
        sourceUrl: sourceUrl || detailUrl,
        ...(originalSourceUrl ? { originalSourceUrl } : {}),
        asin: sanitizeText(record.asin),
        title: sanitizeText(record.title),
        priceText: normalizePriceText(record.priceText),
        originalPriceText: normalizePriceText(record.originalPriceText),
        brand: sanitizeText(record.brand),
        shopName: sanitizeText(record.shopName),
        sellerName: sanitizeText(record.sellerName),
        merchantInfoText: sanitizeText(record.merchantInfoText),
        ratingText: sanitizeText(record.ratingText),
        reviewCountText: sanitizeText(record.reviewCountText),
        availabilityText: sanitizeText(record.availabilityText),
        deliveryText: sanitizeText(record.deliveryText),
        bulletPoints: dedupeTextList(record.bulletPoints, 30),
        bulletPointsText: sanitizeText(record.bulletPointsText).slice(0, 3000),
        breadcrumb: dedupeTextList(record.breadcrumb, 12),
        breadcrumbText: sanitizeText(record.breadcrumbText).slice(0, 1000),
        descriptionText: sanitizeText(record.descriptionText).slice(0, 6000),
        specPairs: normalizeSpecPairs(record.specPairs),
        specSummaryText: sanitizeText(record.specSummaryText).slice(0, 4000),
        pageTitle: sanitizeText(record.pageTitle),
        imageUrls,
        imageUrl: imageUrls[0] || '',
        capturedAt: record.capturedAt || '',
    };
}

function normalizeAmazonMarketplace(value = '') {
    const normalized = String(value || '').trim().toUpperCase();
    return AMAZON_MARKETPLACE_CONFIGS[normalized]
        ? normalized
        : 'US';
}

function buildAmazonSuggestionUrl(marketplaceConfig, keyword = '', limit = 10) {
    const url = new URL(marketplaceConfig.suggestionEndpoint);
    url.searchParams.set('limit', String(Math.max(1, Math.min(20, limit))));
    url.searchParams.set('prefix', keyword);
    url.searchParams.set('alias', marketplaceConfig.alias || 'aps');
    url.searchParams.set('mid', marketplaceConfig.mid || '');
    return url.toString();
}

function slugifyAmazonSuggestionValue(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

async function fetchAmazonSuggestionApi(keyword, marketplaceConfig, limit) {
    const response = await fetch(
        buildAmazonSuggestionUrl(marketplaceConfig, keyword, limit),
        {
            headers: {
                ...AMAZON_SUGGESTION_HTTP_HEADERS,
                'accept-language': marketplaceConfig.acceptLanguage || 'en-US,en;q=0.9',
            },
        },
    );

    if (!response.ok) {
        throw new Error(`Amazon 联想词接口请求失败: ${response.status}`);
    }

    const payload = await response.json();
    return Array.isArray(payload?.suggestions)
        ? payload.suggestions
        : [];
}

async function extractAmazonSuggestionTextsFromPage(page) {
    return page.evaluate(() => {
        const selectors = [
            '.s-suggestion',
            '.s-suggestion-container .s-suggestion',
            '.left-pane-results-container .s-suggestion',
            '.two-pane-results-container .s-suggestion',
            '#nav-flyout-searchAjax [role="option"]',
            'div[role="listbox"] [role="option"]',
        ];
        const results = [];
        const seen = new Set();

        const pushText = (value) => {
            const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
            if (!text || text.length > 120 || seen.has(text)) {
                return;
            }
            seen.add(text);
            results.push(text);
        };

        selectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((node) => {
                pushText(
                    node.getAttribute?.('aria-label') ||
                    node.textContent ||
                    '',
                );
            });
        });

        return results.slice(0, 20);
    });
}

async function collectAmazonSuggestionUi(context, keyword, marketplaceConfig) {
    const { page, runtime, taskConfig } = context;
    const timeoutMs = Number(taskConfig?.timeoutMs) || DEFAULT_PAGE_TIMEOUT_MS;
    const snapshotStage = `amazon-suggestions-${slugifyAmazonSuggestionValue(keyword) || 'keyword'}`;

    try {
        const prepareResult = await prepareCollectionPage(page, runtime, {
            url: marketplaceConfig.homeUrl,
            timeoutMs,
            blockedStage: `${snapshotStage}-blocked`,
            waitSelectors: ['#twotabsearchtextbox', 'input[name="field-keywords"]'],
        });

        if (prepareResult.blocked) {
            return {
                status: 'blocked',
                suggestions: [],
                risk: prepareResult.risk || null,
            };
        }

        const inputLocator = page.locator('#twotabsearchtextbox, input[name="field-keywords"]').first();
        await inputLocator.click({ timeout: 5_000 }).catch(() => {});
        await inputLocator.fill('').catch(() => {});
        await inputLocator.fill(keyword, { timeout: 10_000 });
        await page.waitForTimeout(1_200);

        const suggestions = await extractAmazonSuggestionTextsFromPage(page);
        const snapshot = await captureScreenshot(
            page,
            runtime.snapshotDir,
            snapshotStage,
            runtime.snapshots,
            runtime.captureSnapshots === true,
        );

        return {
            status: suggestions.length > 0 ? 'success' : 'empty',
            suggestions,
            snapshotPath: snapshot?.path || '',
        };
    } catch (error) {
        return {
            status: 'failed',
            suggestions: [],
            error: error?.message || String(error),
        };
    }
}

function mergeAmazonSuggestionCandidates(apiSuggestions = [], uiSuggestions = []) {
    const merged = [];
    const seen = new Set();
    const uiSeen = new Set(
        uiSuggestions
            .map((item) => sanitizeText(item).toLowerCase())
            .filter(Boolean),
    );

    const pushCandidate = (candidate, fallbackRank, source) => {
        const value = sanitizeText(
            candidate?.value ||
            candidate?.keyword ||
            candidate?.text ||
            candidate,
        );
        if (!value) {
            return;
        }

        const normalizedValue = value.toLowerCase();
        if (seen.has(normalizedValue)) {
            return;
        }
        seen.add(normalizedValue);

        merged.push({
            value,
            source,
            rank: Number.isFinite(Number(candidate?.rank))
                ? Number(candidate.rank)
                : fallbackRank,
            suggestionType: sanitizeText(candidate?.type || candidate?.suggType || 'KEYWORD'),
            strategyId: sanitizeText(candidate?.strategyId || source),
            candidateSources: sanitizeText(candidate?.candidateSources || source),
            refTag: sanitizeText(candidate?.refTag),
            prior: Number.isFinite(Number(candidate?.prior))
                ? Number(candidate.prior)
                : null,
            uiSeen: uiSeen.has(normalizedValue),
        });
    };

    apiSuggestions.forEach((item, index) => {
        pushCandidate(item, index + 1, 'api');
    });
    uiSuggestions.forEach((item, index) => {
        pushCandidate(item, apiSuggestions.length + index + 1, 'ui');
    });

    return merged;
}

function buildAmazonSuggestionRecord(candidate, seedKeyword, marketplaceConfig) {
    const title = sanitizeText(candidate?.value);

    return {
        recordKey: [
            'amazon-suggestion',
            marketplaceConfig.code,
            slugifyAmazonSuggestionValue(seedKeyword) || 'seed',
            slugifyAmazonSuggestionValue(title) || 'candidate',
        ].join(':'),
        title,
        subtitle: `${marketplaceConfig.label} | 种子词: ${seedKeyword}`,
        priceText: '',
        shopName: '',
        badgeText: candidate?.suggestionType || 'KEYWORD',
        sourceUrl: `${marketplaceConfig.searchUrl}${encodeURIComponent(title)}`,
        imageUrl: '',
        cardText: `${seedKeyword} -> ${title}`.slice(0, 500),
        capturedAt: new Date().toISOString(),
        sourceType: 'keyword_suggestion',
        signalType: 'search_suggestion',
        seedKeyword,
        marketplace: marketplaceConfig.code,
        marketplaceLabel: marketplaceConfig.label,
        rank: Number.isFinite(Number(candidate?.rank))
            ? Number(candidate.rank)
            : null,
        suggestionType: sanitizeText(candidate?.suggestionType),
        strategyId: sanitizeText(candidate?.strategyId),
        candidateSources: sanitizeText(candidate?.candidateSources),
        refTag: sanitizeText(candidate?.refTag),
        prior:
            Number.isFinite(Number(candidate?.prior))
                ? Number(candidate.prior)
                : null,
        uiSeen: candidate?.uiSeen === true,
        suggestionSource: sanitizeText(candidate?.source),
    };
}

async function collectAmazonSearchSuggestions(context) {
    const { taskConfig, runtime } = context;
    const keywords = buildKeywordList(taskConfig?.configData || {});
    if (!keywords.length) {
        throw new Error('search_suggestions 场景缺少 keyword/keywords');
    }

    const marketplace = normalizeAmazonMarketplace(taskConfig?.configData?.marketplace);
    const marketplaceConfig = AMAZON_MARKETPLACE_CONFIGS[marketplace];
    const maxItems = Math.max(1, Math.min(100, Number(taskConfig?.configData?.maxItems) || 20));
    const apiLimit = Math.max(5, Math.min(20, maxItems));
    const records = [];
    const keywordSummaries = [];

    for (const keyword of keywords) {
        if (records.length >= maxItems) {
            break;
        }

        let apiSuggestions = [];
        let apiError = '';
        try {
            apiSuggestions = await fetchAmazonSuggestionApi(keyword, marketplaceConfig, apiLimit);
        } catch (error) {
            apiError = error?.message || String(error);
        }

        let uiResult = {
            status: runtime.captureSnapshots === true ? 'not_run' : 'disabled',
            suggestions: [],
            snapshotPath: '',
            risk: null,
            error: '',
        };

        if (runtime.captureSnapshots === true || apiSuggestions.length === 0) {
            uiResult = await collectAmazonSuggestionUi(context, keyword, marketplaceConfig);
        }

        const mergedCandidates = mergeAmazonSuggestionCandidates(
            apiSuggestions,
            uiResult.suggestions,
        );

        const remainingCount = Math.max(0, maxItems - records.length);
        mergedCandidates
            .slice(0, remainingCount)
            .forEach((candidate) => {
                records.push(
                    buildAmazonSuggestionRecord(candidate, keyword, marketplaceConfig),
                );
            });

        keywordSummaries.push({
            keyword,
            apiSuggestionCount: apiSuggestions.length,
            uiSuggestionCount: uiResult.suggestions.length,
            mergedSuggestionCount: mergedCandidates.length,
            uiStatus: uiResult.status,
            uiRisk: uiResult.risk || null,
            uiError: uiResult.error || null,
            snapshotPath: uiResult.snapshotPath || '',
            apiError: apiError || null,
        });
    }

    return {
        status: records.length > 0 ? 'success' : 'failed',
        message: records.length > 0 ? 'Amazon 搜索联想词采集完成' : 'Amazon 未返回有效联想词',
        records,
        summary: {
            keywords,
            marketplace: marketplaceConfig.code,
            marketplaceLabel: marketplaceConfig.label,
            recordsCount: records.length,
            keywordSummaries,
        },
    };
}

async function getAmazonDetailPage(searchPage, runtime, timeoutMs) {
    const existingPage = runtime.amazonDetailPage;
    if (existingPage && typeof existingPage.isClosed === 'function' && !existingPage.isClosed()) {
        return existingPage;
    }

    const detailPage = await searchPage.context().newPage();
    await detailPage.setExtraHTTPHeaders({
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }).catch(() => {});
    await detailPage.setViewportSize({ width: 1440, height: 960 }).catch(() => {});
    detailPage.setDefaultTimeout(Math.min(timeoutMs, DEFAULT_PAGE_TIMEOUT_MS));
    detailPage.setDefaultNavigationTimeout(Math.min(timeoutMs, DEFAULT_PAGE_TIMEOUT_MS));

    runtime.amazonDetailPage = detailPage;
    if (!Array.isArray(runtime.cleanupPages)) {
        runtime.cleanupPages = [];
    }
    runtime.cleanupPages.push(detailPage);

    return detailPage;
}

async function enrichAmazonSearchRecord(record, context) {
    const detailUrl = resolveAmazonDetailUrl(record, context.page?.url?.() || '');
    const listingData = buildAmazonListingData(record);
    const listingStage = buildAmazonDetailStage(record, 'listing');
    const blockedStage = buildAmazonDetailStage(record, 'blocked');
    const detailStage = buildAmazonDetailStage(record, 'detail');
    const listingSnapshot = await captureScreenshot(
        context.page,
        context.runtime.snapshotDir,
        listingStage,
        context.runtime.snapshots,
        context.runtime.captureSnapshots === true,
    );
    const listingSnapshots = listingSnapshot ? [listingSnapshot] : [];

    if (!detailUrl) {
        return {
            ...record,
            listingData: {
                ...listingData,
                snapshots: listingSnapshots,
            },
            detailData: null,
            detailFetchStatus: 'missing_link',
            detailFetchError: '缺少详情页链接',
            detailRisk: null,
            snapshots: listingSnapshots,
        };
    }

    const detailPage = await getAmazonDetailPage(
        context.page,
        context.runtime,
        Number(context.taskConfig?.timeoutMs) || DEFAULT_PAGE_TIMEOUT_MS,
    );

    const prepareResult = await prepareCollectionPage(detailPage, context.runtime, {
        url: detailUrl,
        timeoutMs: Number(context.taskConfig?.timeoutMs) || DEFAULT_PAGE_TIMEOUT_MS,
        blockedStage,
        waitSelectors: AMAZON_DETAIL_WAIT_SELECTORS,
    });

    if (prepareResult.blocked) {
        const blockedSnapshot = findLatestSnapshotByStage(
            context.runtime.snapshots,
            blockedStage,
        );
        const recordSnapshots = blockedSnapshot ? [blockedSnapshot] : [];

        return {
            ...record,
            listingData: {
                ...listingData,
                snapshots: listingSnapshots,
            },
            detailData: null,
            detailFetchStatus: 'blocked',
            detailFetchError: `详情页受限: ${prepareResult.risk?.riskKind || 'unknown'}`,
            detailRisk: prepareResult.risk || null,
            snapshots: [...listingSnapshots, ...recordSnapshots],
            detailSnapshots: recordSnapshots,
        };
    }

    let detailRecord = await extractAmazonDetailData(detailPage, detailUrl);
    if (!detailRecord?.title && !detailRecord?.descriptionText && !detailRecord?.imageUrls?.length) {
        const fallbackResult = await extractDetailRecord(
            detailPage,
            buildSerializableSceneConfig(amazonProductDetailScene),
        );
        detailRecord = Array.isArray(fallbackResult?.records) ? fallbackResult.records[0] : null;
    }

    if (!detailRecord) {
        const emptySnapshot = await captureScreenshot(
            detailPage,
            context.runtime.snapshotDir,
            `${detailStage}-empty`,
            context.runtime.snapshots,
            context.runtime.captureSnapshots === true,
        );
        const recordSnapshots = emptySnapshot ? [emptySnapshot] : [];

        return {
            ...record,
            listingData: {
                ...listingData,
                snapshots: listingSnapshots,
            },
            detailData: null,
            detailFetchStatus: 'empty',
            detailFetchError: '详情页未提取到有效数据',
            detailRisk: null,
            snapshots: [...listingSnapshots, ...recordSnapshots],
            detailSnapshots: recordSnapshots,
        };
    }

    const detailData = normalizeAmazonDetailData(detailRecord, detailUrl);
    const detailSnapshot = await captureScreenshot(
        detailPage,
        context.runtime.snapshotDir,
        detailStage,
        context.runtime.snapshots,
        context.runtime.captureSnapshots === true,
    );
    const recordSnapshots = detailSnapshot ? [detailSnapshot] : [];

    return {
        ...record,
        title: detailData.title || record.title,
        priceText: detailData.priceText || record.priceText,
        shopName: detailData.shopName || record.shopName,
        sourceUrl: detailData.sourceUrl || record.sourceUrl,
        imageUrl: detailData.imageUrl || record.imageUrl,
        imageUrls: detailData.imageUrls,
        descriptionText: detailData.descriptionText || '',
        pageTitle: detailData.pageTitle || '',
        detailRecordKey: detailData.recordKey || '',
        detailCapturedAt: detailData.capturedAt || '',
        asin: detailData.asin || '',
        brand: detailData.brand || '',
        sellerName: detailData.sellerName || '',
        merchantInfoText: detailData.merchantInfoText || '',
        ratingText: detailData.ratingText || '',
        reviewCountText: detailData.reviewCountText || '',
        availabilityText: detailData.availabilityText || '',
        deliveryText: detailData.deliveryText || '',
        originalPriceText: detailData.originalPriceText || '',
        bulletPoints: detailData.bulletPoints,
        bulletPointsText: detailData.bulletPointsText || '',
        breadcrumb: detailData.breadcrumb,
        breadcrumbText: detailData.breadcrumbText || '',
        specPairs: detailData.specPairs,
        specSummaryText: detailData.specSummaryText || '',
        listingData: {
            ...listingData,
            snapshots: listingSnapshots,
        },
        detailData: {
            ...detailData,
            snapshots: recordSnapshots,
        },
        detailFetchStatus: 'success',
        detailFetchError: null,
        detailRisk: null,
        snapshots: [...listingSnapshots, ...recordSnapshots],
        detailSnapshots: recordSnapshots,
    };
}

const amazonPlatform = {
    platform: 'amazon',
    label: 'Amazon',
    supportedScenes: [...DEFAULT_SUPPORTED_SCENES, 'search_suggestions'],
    search: amazonSearchScene,
    productDetail: amazonProductDetailScene,
    shopHotProducts: amazonShopHotProductsScene,
    verification: {
        search: 'verified',
        product_detail: 'verified',
        shop_hot_products: 'verified',
        search_suggestions: 'verified',
    },
    customTaskTypeExecutors: {
        'amazon.search_suggestions': collectAmazonSearchSuggestions,
    },
    hooks: {
        async normalizeRecord(context) {
            const { record, collectScene } = context;
            if (collectScene !== 'search') {
                return record;
            }

            try {
                return await enrichAmazonSearchRecord(record, context);
            } catch (error) {
                return {
                    ...record,
                    listingData: buildAmazonListingData(record),
                    detailData: null,
                    detailFetchStatus: 'failed',
                    detailFetchError: error?.message || String(error),
                    detailRisk: null,
                    snapshots: [],
                };
            }
        },
    },
    capability: buildPlatformCapability({
        regions: ['global'],
        status: 'available',
        access: {
            login: 'optional',
            captcha: 'possible',
            antiBot: 'medium',
            notes: ['Amazon 公开列表和详情通常可访问，但长时间运行、频繁翻页或切站点后可能进入登录或验证码流。'],
        },
        overview:
            'Amazon 当前是首批优先平台，搜索、详情、店铺热门商品三类场景都已做过真实 DOM 调试。',
        notes: [
            '适合先作为稳定平台上线，后续再逐步扩更多跨境站点。',
            '当前以原始数据保真入库为主，不强行在采集时做深度结构化。',
        ],
        moduleDir: 'src/ecom-collect/platforms/amazon',
        selectorFile: 'src/ecom-collect/platforms/amazon/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/amazon/README.md',
        maintenanceNotes: [
            '页面结构改动时，优先修复 selectors.js 中的卡片根节点与字段候选选择器。',
            '如果命中地区跳转，可在平台 hook 中单独补交互，不要把特例塞进通用流程。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'verified',
                availability: 'available',
                recordFieldsExtra: AMAZON_SEARCH_RECORD_FIELDS_EXTRA,
                access: {
                    login: 'optional',
                    captcha: 'possible',
                    antiBot: 'medium',
                    notes: ['搜索场景较稳定，但批量翻页或高频请求时仍要保留 login/captcha 风险退出。'],
                },
                keywordPlaceholder: '例如：wireless earbuds',
                keywordsPlaceholder: '一行一个关键词，可按细分类目拆分',
                overview: '进入 Amazon 搜索页后先抓取商品卡片，再按商品链接逐个进入详情页补抓详情信息。',
                notes: [
                    '推荐先从搜索场景验证平台是否可用。',
                    '支持 keyword 与 keywords 两种入参，keywords 适合批量跑词。',
                    '搜索结果会保留原始卡片数据，同时新增详情页字段，方便比对列表信息与详情信息。',
                ],
                examples: [
                    {
                        title: 'Amazon 搜索采集',
                        description: '按关键词抓取搜索结果卡片。',
                        payload: {
                            platform: 'amazon',
                            collectScene: 'search',
                            configData: {
                                keyword: 'wireless earbuds',
                                keywords: ['wireless earbuds', 'bluetooth headphones'],
                                maxPages: 2,
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
            buildSearchSuggestionsSceneCapability({
                verification: 'verified',
                availability: 'available',
                recordFieldsExtra: AMAZON_SUGGESTION_RECORD_FIELDS_EXTRA,
                access: {
                    login: 'none',
                    captcha: 'none',
                    antiBot: 'low',
                    notes: ['联想词优先走公开接口，适合作为低风险的趋势信号源。'],
                },
                keywordPlaceholder: '例如：wireless earbuds',
                keywordsPlaceholder: '一行一个种子词，也支持逗号分隔',
                extraFields: [
                    buildSelectField('marketplace', '站点', {
                        required: true,
                        defaultValue: 'US',
                        description: '按 Amazon 站点获取对应语言和市场的联想词。',
                        options: AMAZON_MARKETPLACE_OPTIONS,
                    }),
                ],
                overview:
                    '根据输入关键词抓取 Amazon 搜索联想词，可作为热搜词和需求验证的轻量信号源。',
                notes: [
                    '优先通过公开联想接口获取结果，必要时再回退到页面搜索框补抓。',
                    '适合作为趋势词到商品采集之间的中间层信号。',
                ],
                examples: [
                    {
                        title: 'Amazon 搜索联想词采集',
                        payload: {
                            platform: 'amazon',
                            collectScene: 'search_suggestions',
                            configData: {
                                marketplace: 'US',
                                keyword: 'wireless earbuds',
                                maxItems: 20,
                                captureSnapshots: false,
                            },
                        },
                    },
                ],
            }),
            buildProductDetailSceneCapability({
                verification: 'verified',
                availability: 'available',
                recordFieldsExtra: AMAZON_DETAIL_RECORD_FIELDS_EXTRA,
                access: {
                    login: 'optional',
                    captcha: 'possible',
                    antiBot: 'medium',
                    notes: ['详情页通常可抓，但地区跳转、库存校验和登录提示仍可能打断执行。'],
                },
                targetUrlPlaceholder: '填写 Amazon 商品详情页链接',
                overview: '打开商品详情页，尽量保真地提取标题、主图、描述等详情原始数据。',
                notes: ['如果跳国家站点，优先补详情页 URL 规范化和地区选择逻辑。'],
                examples: [
                    {
                        title: 'Amazon 商品详情采集',
                        payload: {
                            platform: 'amazon',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.amazon.com/dp/B0C1234567',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'verified',
                availability: 'available',
                access: {
                    login: 'optional',
                    captcha: 'possible',
                    antiBot: 'medium',
                    notes: ['榜单和店铺页对目标链接稳定性更敏感，仍建议保留异常页截图。'],
                },
                targetUrlPlaceholder: '填写 Amazon 店铺页、Best Sellers 或榜单页链接',
                overview: '打开店铺热门商品页或榜单页，提取卡片原始数据。',
                notes: ['店铺热门商品场景更依赖目标页链接的稳定性。'],
                examples: [
                    {
                        title: 'Amazon 店铺热门商品采集',
                        payload: {
                            platform: 'amazon',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://www.amazon.com/best-sellers-electronics/zgbs',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default amazonPlatform;

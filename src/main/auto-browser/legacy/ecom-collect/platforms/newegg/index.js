import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';
import {
    normalizePriceText,
    normalizeRecordKey,
    sanitizeText,
    sanitizeUrl,
} from '../../common/runtime.js';
import {
    neweggProductDetailScene,
    neweggSearchScene,
    neweggShopHotProductsScene,
} from './selectors.js';

function buildNeweggListingData(record = {}) {
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

function extractNeweggItemId(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    const patterns = [
        /\/p\/([A-Z0-9-]+)(?:[/?#]|$)/i,
        /[?&]Item=([A-Z0-9]+)(?:[&#]|$)/i,
    ];

    for (const pattern of patterns) {
        const matched = text.match(pattern);
        if (matched?.[1]) {
            return matched[1].toUpperCase();
        }
    }

    return '';
}

function resolveNeweggOrigin(...values) {
    for (const value of values) {
        const raw = String(value || '').trim();
        if (!raw) {
            continue;
        }

        try {
            const parsed = new URL(raw);
            if (/newegg\./i.test(parsed.hostname)) {
                return `${parsed.protocol}//${parsed.host}`;
            }
        } catch {
            // ignore non-url values
        }
    }

    return 'https://www.newegg.com';
}

function normalizeNeweggItemUrl(value = '', pageUrl = '') {
    const raw = sanitizeUrl(value, pageUrl);
    if (!raw) {
        return '';
    }

    const itemId = extractNeweggItemId(raw);
    if (itemId) {
        return `${resolveNeweggOrigin(raw, pageUrl)}/p/${itemId}`;
    }

    try {
        const parsed = new URL(raw);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return raw;
    }
}

function sanitizeUrlList(values = [], baseUrl = '', limit = 30) {
    if (!Array.isArray(values)) {
        return [];
    }

    const normalized = [];
    const visited = new Set();

    values.forEach((item) => {
        const url = sanitizeUrl(item, baseUrl);
        if (!url || visited.has(url) || normalized.length >= limit) {
            return;
        }
        visited.add(url);
        normalized.push(url);
    });

    return normalized;
}

function dedupeTextList(values = [], limit = 50) {
    if (!Array.isArray(values)) {
        return [];
    }

    const normalized = [];
    const visited = new Set();

    values.forEach((item) => {
        const text = sanitizeText(item);
        if (!text || visited.has(text) || normalized.length >= limit) {
            return;
        }
        visited.add(text);
        normalized.push(text);
    });

    return normalized;
}

function normalizeSpecPairs(values = [], limit = 100) {
    if (!Array.isArray(values)) {
        return [];
    }

    const normalized = [];
    const visited = new Set();

    values.forEach((item) => {
        if (!item || typeof item !== 'object') {
            return;
        }

        const label = sanitizeText(item.label);
        const value = sanitizeText(item.value);
        if (!label || !value) {
            return;
        }

        const key = `${label}::${value}`;
        if (visited.has(key) || normalized.length >= limit) {
            return;
        }

        visited.add(key);
        normalized.push({ label, value });
    });

    return normalized;
}

function normalizeAvailability(value = '') {
    const text = sanitizeText(value);
    if (!text) {
        return '';
    }

    const normalized = text.match(/([^/]+)$/);
    return normalized?.[1] ? sanitizeText(normalized[1]) : text;
}

async function extractNeweggDetailData(page, detailUrl = '') {
    return page.evaluate(({ detailUrl: targetUrl }) => {
        const toText = (value) => (
            typeof value === 'string'
                ? value.replace(/\s+/g, ' ').trim()
                : ''
        );

        const pickText = (selectors = []) => {
            for (const selector of selectors || []) {
                const node = document.querySelector(selector);
                const text = toText(node?.textContent || '');
                if (text) {
                    return text;
                }
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

        const collectImageUrls = (selectors = [], limit = 30) => {
            const result = [];
            const visited = new Set();

            for (const selector of selectors || []) {
                document.querySelectorAll(selector).forEach((node) => {
                    const src =
                        node.getAttribute?.('src') ||
                        node.getAttribute?.('data-src') ||
                        node.getAttribute?.('data-lazy-src');
                    if (!src || visited.has(src) || result.length >= limit) {
                        return;
                    }
                    visited.add(src);
                    result.push(src);
                });

                if (result.length >= limit) {
                    break;
                }
            }

            return result;
        };

        const collectSpecPairs = (selectors = [], limit = 100) => {
            const pairs = [];
            const visited = new Set();

            for (const selector of selectors || []) {
                document.querySelectorAll(selector).forEach((row) => {
                    const cells = Array.from(row.querySelectorAll('th, td'));
                    if (cells.length < 2 || pairs.length >= limit) {
                        return;
                    }

                    const label = toText(cells[0]?.textContent || '');
                    const value = toText(cells.slice(1).map((cell) => cell.textContent || '').join(' '));
                    if (!label || !value) {
                        return;
                    }

                    const key = `${label}::${value}`;
                    if (visited.has(key)) {
                        return;
                    }

                    visited.add(key);
                    pairs.push({ label, value });
                });

                if (pairs.length >= limit) {
                    break;
                }
            }

            return pairs;
        };

        const parseJsonLdProducts = () => {
            const nodes = [];

            document.querySelectorAll('script[type="application/ld+json"]').forEach((scriptNode) => {
                const raw = scriptNode.textContent || '';
                if (!raw.trim()) {
                    return;
                }

                try {
                    const parsed = JSON.parse(raw);
                    nodes.push(parsed);
                } catch {
                    // ignore invalid json-ld blocks
                }
            });

            const queue = [...nodes];
            const flattened = [];

            while (queue.length > 0) {
                const current = queue.shift();
                if (!current) {
                    continue;
                }

                if (Array.isArray(current)) {
                    queue.push(...current);
                    continue;
                }

                if (current['@graph'] && Array.isArray(current['@graph'])) {
                    queue.push(...current['@graph']);
                }

                flattened.push(current);
            }

            return flattened.find((item) => {
                const typeValue = item?.['@type'];
                if (Array.isArray(typeValue)) {
                    return typeValue.includes('Product');
                }
                return typeValue === 'Product';
            }) || null;
        };

        const productSchema = parseJsonLdProducts();
        const brandValue =
            typeof productSchema?.brand === 'string'
                ? productSchema.brand
                : toText(productSchema?.brand?.name || '');
        const offerValue = productSchema?.offers && typeof productSchema.offers === 'object'
            ? productSchema.offers
            : {};
        const aggregateRating = productSchema?.aggregateRating && typeof productSchema.aggregateRating === 'object'
            ? productSchema.aggregateRating
            : {};

        const bulletPoints = collectTextList([
            '.product-bullets li',
            '#overview-content li',
            '#overview-content p',
        ], 60);
        const specPairs = collectSpecPairs([
            '#product-details table tr',
            '#product-specs table tr',
            '.tab-panes table tr',
        ], 120);

        const descriptionParts = [
            ...bulletPoints,
            ...collectTextList([
                '#overview-content p',
                '#overview-content .a-plus-title',
                '#product-overview .article',
            ], 80),
        ];

        const structuredData = productSchema
            ? {
                name: toText(productSchema.name || ''),
                description: toText(productSchema.description || ''),
                sku: toText(productSchema.sku || ''),
                mpn: toText(productSchema.mpn || ''),
                model: toText(productSchema.Model || productSchema.model || ''),
                brand: brandValue,
                gtin12: toText(productSchema.gtin12 || ''),
                color: toText(productSchema.color || ''),
                width: toText(productSchema.width || ''),
                height: toText(productSchema.height || ''),
                weight: toText(productSchema.weight || ''),
                itemCondition: toText(productSchema.itemCondition || ''),
                offer: {
                    price: offerValue?.price ?? '',
                    priceCurrency: toText(offerValue?.priceCurrency || ''),
                    availability: toText(offerValue?.availability || ''),
                },
                aggregateRating: {
                    ratingValue: aggregateRating?.ratingValue ?? '',
                    reviewCount: aggregateRating?.reviewCount ?? '',
                },
            }
            : null;

        return {
            sourceUrl: targetUrl || location.href,
            title:
                pickText(['h1.product-title']) ||
                toText(productSchema?.name || ''),
            priceText:
                pickText([
                    '.product-buy-box .price-current',
                    '.product-wrap .price-current',
                    'li.price-current',
                ]) ||
                (productSchema?.offers?.price !== undefined
                    ? `${toText(productSchema?.offers?.priceCurrency || '$')} ${toText(String(productSchema.offers.price || ''))}`
                    : ''),
            shopName: pickText([
                'a[href*="/Seller-Store/"] strong',
                'a[href*="/Seller-Store/"]',
                '.seller-store-link',
            ]),
            descriptionText: descriptionParts.join(' ').slice(0, 8000),
            imageUrls: collectImageUrls([
                '.product-view-img-original',
                '#product-overview img',
                '.swiper-slide img',
            ], 30),
            bulletPoints,
            specPairs,
            brand: brandValue,
            sku: toText(productSchema?.sku || ''),
            mpn: toText(productSchema?.mpn || ''),
            model: toText(productSchema?.Model || productSchema?.model || ''),
            gtin12: toText(productSchema?.gtin12 || ''),
            color: toText(productSchema?.color || ''),
            weight: toText(productSchema?.weight || ''),
            ratingText:
                aggregateRating?.ratingValue !== undefined && aggregateRating?.ratingValue !== null
                    ? toText(String(aggregateRating.ratingValue))
                    : pickText([
                        '.product-rating [title*="out of 5"]',
                        '.product-rating',
                    ]),
            reviewCountText:
                aggregateRating?.reviewCount !== undefined && aggregateRating?.reviewCount !== null
                    ? toText(String(aggregateRating.reviewCount))
                    : pickText([
                        '.product-reviews .item-rating-num',
                        '.product-rating .item-rating-num',
                    ]),
            availabilityText: toText(productSchema?.offers?.availability || ''),
            structuredData,
        };
    }, { detailUrl });
}

async function normalizeNeweggRecord(context = {}) {
    const collectScene = String(context.collectScene || '').trim();
    const pageUrl = context.pageUrl || context.page?.url?.() || '';
    const record = context.record && typeof context.record === 'object'
        ? context.record
        : {};
    const incomingUrl = sanitizeUrl(
        record.originalSourceUrl || record.sourceUrl,
        pageUrl,
    );
    const sourceUrl = normalizeNeweggItemUrl(incomingUrl, pageUrl);
    const itemId =
        extractNeweggItemId(record.recordKey) ||
        extractNeweggItemId(incomingUrl) ||
        extractNeweggItemId(sourceUrl);
    const baseRecord = {
        ...record,
        title: sanitizeText(record.title),
        subtitle: sanitizeText(record.subtitle),
        shopName: sanitizeText(record.shopName),
        badgeText: sanitizeText(record.badgeText),
        sourceUrl: sourceUrl || record.sourceUrl || '',
        ...(incomingUrl && sourceUrl && incomingUrl !== sourceUrl
            ? { originalSourceUrl: incomingUrl }
            : {}),
        ...(itemId ? { itemId } : {}),
        recordKey: itemId
            ? `p:${itemId}`
            : normalizeRecordKey(record.recordKey, sourceUrl || incomingUrl),
    };

    if (collectScene === 'product_detail' && context.page) {
        const detailData = await extractNeweggDetailData(context.page, sourceUrl || incomingUrl);
        const bulletPoints = dedupeTextList(detailData.bulletPoints, 60);
        const specPairs = normalizeSpecPairs(detailData.specPairs, 120);
        const specSummaryText = specPairs
            .map((item) => `${item.label}: ${item.value}`)
            .join(' | ')
            .slice(0, 4000);

        return {
            ...baseRecord,
            title: sanitizeText(detailData.title) || baseRecord.title,
            priceText: normalizePriceText(detailData.priceText) || baseRecord.priceText,
            shopName: sanitizeText(detailData.shopName) || baseRecord.shopName,
            descriptionText: sanitizeText(detailData.descriptionText) || baseRecord.descriptionText || '',
            imageUrls: sanitizeUrlList(detailData.imageUrls, sourceUrl || incomingUrl, 30),
            brand: sanitizeText(detailData.brand),
            sku: sanitizeText(detailData.sku) || itemId,
            mpn: sanitizeText(detailData.mpn),
            model: sanitizeText(detailData.model),
            gtin12: sanitizeText(detailData.gtin12),
            color: sanitizeText(detailData.color),
            weight: sanitizeText(detailData.weight),
            ratingText: sanitizeText(detailData.ratingText),
            reviewCountText: sanitizeText(detailData.reviewCountText),
            availabilityText: normalizeAvailability(detailData.availabilityText),
            bulletPoints,
            bulletPointsText: bulletPoints.join(' | ').slice(0, 3000),
            specPairs,
            specSummaryText,
            listingData: null,
            detailData: {
                ...detailData,
                sourceUrl: sourceUrl || detailData.sourceUrl || baseRecord.sourceUrl,
                priceText: normalizePriceText(detailData.priceText),
                descriptionText: sanitizeText(detailData.descriptionText),
                imageUrls: sanitizeUrlList(detailData.imageUrls, sourceUrl || incomingUrl, 30),
                bulletPoints,
                specPairs,
                ratingText: sanitizeText(detailData.ratingText),
                reviewCountText: sanitizeText(detailData.reviewCountText),
                availabilityText: normalizeAvailability(detailData.availabilityText),
            },
        };
    }

    return {
        ...baseRecord,
        listingData: buildNeweggListingData(baseRecord),
        detailData: null,
    };
}

const neweggPlatform = {
    platform: 'newegg',
    label: 'Newegg',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: neweggSearchScene,
    productDetail: neweggProductDetailScene,
    shopHotProducts: neweggShopHotProductsScene,
    verification: {
        search: 'heuristic',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    hooks: {
        async normalizeRecord(context) {
            return normalizeNeweggRecord(context);
        },
    },
    capability: buildPlatformCapability({
        regions: ['global', 'us'],
        status: 'heuristic',
        overview:
            'Newegg 已接入独立平台模块，覆盖搜索、商品详情与列表页场景，适合承接公开可抓取的 3C/电子商品数据。',
        notes: [
            '搜索页结构稳定，已优先命中 `.item-cell`、`.item-title`、`.price-current` 等核心节点。',
            '详情页除了可见 DOM，还会补抓 JSON-LD、要点 bullet 和规格表，让明细信息更完整。',
        ],
        moduleDir: 'src/ecom-collect/platforms/newegg',
        selectorFile: 'src/ecom-collect/platforms/newegg/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/newegg/README.md',
        maintenanceNotes: [
            '优先保持 `.item-cell`、`.item-title`、`.product-title`、`.product-bullets`、`#product-details table tr` 这些选择器可用。',
            '若详情页规格表或卖家块调整，优先修正平台 hook，不要把 Newegg 特定字段抽到公共层。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                keywordPlaceholder: '例如：wireless earbuds',
                keywordsPlaceholder: '一行一个关键词，适合按品类或品牌分批跑',
                overview: '进入 Newegg 搜索结果页，提取商品卡片标题、价格、促销、卖家与局部特征文本。',
                notes: [
                    '搜索记录会尽量规范化为 `https://www.newegg.com/p/{itemId}`，减少推广参数干扰。',
                ],
                examples: [
                    {
                        title: 'Newegg 搜索采集',
                        payload: {
                            platform: 'newegg',
                            collectScene: 'search',
                            configData: {
                                keyword: 'wireless earbuds',
                                maxPages: 2,
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
            buildProductDetailSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 Newegg 商品详情页链接',
                overview: '打开 Newegg 商品详情页，补充标题、价格、图集、卖家、规格和要点说明。',
                notes: [
                    '详情页会尽量合并页面可见内容与 JSON-LD 结构化信息，便于后续比对商品卡片与详情差异。',
                ],
                examples: [
                    {
                        title: 'Newegg 商品详情采集',
                        payload: {
                            platform: 'newegg',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.newegg.com/p/0TH-06BS-00094',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 Newegg 卖家店铺页、类目页或榜单页链接',
                overview: '打开 Newegg 任意商品列表页，提取热门商品卡片原始数据。',
                notes: [
                    '卖家店铺、类目页、搜索页基本复用同一套卡片结构，后续只需要按目标 URL 持续回归即可。',
                ],
                examples: [
                    {
                        title: 'Newegg 列表页采集',
                        payload: {
                            platform: 'newegg',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://www.newegg.com/p/pl?d=wireless+earbuds',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default neweggPlatform;

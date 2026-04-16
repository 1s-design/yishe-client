import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';
import {
    normalizeRecordKey,
    sanitizeText,
    sanitizeUrl,
} from '../../common/runtime.js';
import {
    walmartProductDetailScene,
    walmartSearchScene,
    walmartShopHotProductsScene,
} from './selectors.js';

function buildWalmartListingData(record = {}) {
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

function extractWalmartItemId(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    const patterns = [
        /\/ip(?:\/[^/?#]+)?\/(\d+)(?:[/?#]|$)/i,
        /[?&]athcpid=(\d+)(?:[&#]|$)/i,
    ];

    for (const pattern of patterns) {
        const matched = text.match(pattern);
        if (matched?.[1]) {
            return matched[1];
        }
    }

    return '';
}

function resolveWalmartOrigin(...values) {
    for (const value of values) {
        const raw = String(value || '').trim();
        if (!raw) {
            continue;
        }

        try {
            const parsed = new URL(raw);
            if (/walmart\./i.test(parsed.hostname)) {
                return `${parsed.protocol}//${parsed.host}`;
            }
        } catch {
            // ignore non-url values
        }
    }

    return 'https://www.walmart.com';
}

function resolveNestedWalmartItemUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    try {
        const parsed = new URL(raw);
        const redirected = parsed.searchParams.get('rd') || parsed.searchParams.get('redirect');
        if (redirected && /walmart\.com\/ip\//i.test(redirected)) {
            return redirected;
        }
    } catch {
        // ignore malformed urls
    }

    return raw;
}

function normalizeWalmartItemUrl(value = '', pageUrl = '') {
    const resolved = resolveNestedWalmartItemUrl(value);
    const raw = sanitizeUrl(resolved, pageUrl);
    if (!raw) {
        return '';
    }

    const itemId = extractWalmartItemId(raw);
    if (itemId) {
        return `${resolveWalmartOrigin(raw, pageUrl)}/ip/${itemId}`;
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

function normalizeWalmartRecord(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(
        record.originalSourceUrl || record.sourceUrl,
        pageUrl,
    );
    const sourceUrl = normalizeWalmartItemUrl(incomingUrl, pageUrl);
    const itemId =
        extractWalmartItemId(record.recordKey) ||
        extractWalmartItemId(incomingUrl) ||
        extractWalmartItemId(sourceUrl);
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
            ? `ip:${itemId}`
            : normalizeRecordKey(record.recordKey, sourceUrl || incomingUrl),
    };

    return {
        ...baseRecord,
        listingData: buildWalmartListingData(baseRecord),
        detailData: null,
    };
}

const walmartPlatform = {
    platform: 'walmart',
    label: 'Walmart',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: walmartSearchScene,
    productDetail: walmartProductDetailScene,
    shopHotProducts: walmartShopHotProductsScene,
    verification: {
        search: 'heuristic',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    hooks: {
        async normalizeRecord(context) {
            return normalizeWalmartRecord(
                context.record,
                context.pageUrl || context.page?.url?.() || '',
            );
        },
    },
    capability: buildPlatformCapability({
        regions: ['global', 'us'],
        status: 'heuristic',
        overview:
            'Walmart 已接入独立平台模块，当前先覆盖搜索、商品详情和通用列表页，方便后续在真实浏览器上下文里继续回归验证。',
        notes: [
            '当前首版选择器主要基于公开页面结构与商品卡片语义属性，适合先在有真实浏览器环境和正常 Cookie 的上下文里试跑。',
            'Walmart 较容易触发机器人校验，运行期如果被拦截，会由通用风险检测流程返回 `skipped/failed` 结果。',
        ],
        moduleDir: 'src/ecom-collect/platforms/walmart',
        selectorFile: 'src/ecom-collect/platforms/walmart/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/walmart/README.md',
        maintenanceNotes: [
            '搜索页优先关注 `div[role=\"group\"][data-item-id]`、`h3[data-automation-id=\"product-title\"]`、`a[href*=\"/ip/\"]`。',
            '如果推广位跳转链接继续变化，优先修正平台内 URL 规范化逻辑，保持 `ip:{itemId}` 的 recordKey 稳定。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                keywordPlaceholder: '例如：wireless earbuds',
                keywordsPlaceholder: '一行一个关键词，适合按大类或价格带试跑',
                overview: '进入 Walmart 搜索结果页，提取商品卡片标题、价格、评分、卖家与基础卡片信息。',
                notes: [
                    '搜索链接会尽量规范化为 `https://www.walmart.com/ip/{itemId}`，减少追踪参数和推广跳转影响。',
                ],
                examples: [
                    {
                        title: 'Walmart 搜索采集',
                        payload: {
                            platform: 'walmart',
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
                targetUrlPlaceholder: '填写 Walmart 商品详情页链接',
                overview: '打开 Walmart 商品详情页，抓取标题、价格、图集、卖家与页面正文摘要。',
                notes: [
                    '详情页可用性更依赖真实浏览器环境；如遇机器人页，建议在实际运行环境里多回归几次。',
                ],
                examples: [
                    {
                        title: 'Walmart 商品详情采集',
                        payload: {
                            platform: 'walmart',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.walmart.com/ip/631193073',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 Walmart 列表页、店铺页或专题商品流链接',
                overview: '打开 Walmart 任意商品列表页，提取热门商品卡片原始数据。',
                notes: [
                    '店铺页与专题页仍需要结合真实目标链接继续验证，但可以先沿用统一列表卡片抽取逻辑。',
                ],
                examples: [
                    {
                        title: 'Walmart 列表页采集',
                        payload: {
                            platform: 'walmart',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://www.walmart.com/search?q=wireless+earbuds',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default walmartPlatform;

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
    ozonProductDetailScene,
    ozonSearchScene,
    ozonShopHotProductsScene,
} from './selectors.js';

function extractOzonProductId(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const patterns = [
        /\/product\/[^/]*-(\d+)\//i,
        /\/product\/(\d+)/i,
        /\/product\/[^/]+-(\d+)/i,
    ];
    for (const pattern of patterns) {
        const matched = raw.match(pattern);
        if (matched?.[1]) return matched[1];
    }
    return '';
}

function normalizeOzonItemUrl(value = '', pageUrl = '') {
    const raw = sanitizeUrl(value, pageUrl);
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        if (/ozon\.ru/i.test(parsed.hostname)) {
            parsed.search = '';
            parsed.hash = '';
            return parsed.toString();
        }
    } catch {}
    return raw;
}

const OZON_SHORT_TITLES = new Set([
    'распродажа', 'sale', 'хит', 'new', 'новинка', 'акция', 'скидка',
    'рассрочка', 'бесплатная доставка', 'бестселлер', 'trend',
]);

function isOzonProductTitle(title = '') {
    const raw = String(title || '').trim();
    if (!raw) return false;
    if (raw.length < 6) return false;
    return !OZON_SHORT_TITLES.has(raw.toLowerCase());
}

function normalizeOzonRecord(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(record.originalSourceUrl || record.sourceUrl, pageUrl);
    const sourceUrl = normalizeOzonItemUrl(incomingUrl, pageUrl);
    const productId =
        extractOzonProductId(record.recordKey) ||
        extractOzonProductId(incomingUrl) ||
        extractOzonProductId(sourceUrl);
    const nextRecordKey = productId
        ? `ozon:${productId}`
        : normalizeRecordKey(record.recordKey, sourceUrl || incomingUrl);

    const title = sanitizeText(record.title);
    const normalizedTitle = isOzonProductTitle(title) ? title : '';

    return {
        ...record,
        title: normalizedTitle,
        shopName: sanitizeText(record.shopName),
        sourceUrl: sourceUrl || record.sourceUrl || '',
        ...(incomingUrl && sourceUrl && incomingUrl !== sourceUrl
            ? { originalSourceUrl: incomingUrl }
            : {}),
        ...(productId ? { productId } : {}),
        recordKey: nextRecordKey,
    };
}

const ozonPlatform = {
    platform: 'ozon',
    label: 'Ozon',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: ozonSearchScene,
    productDetail: ozonProductDetailScene,
    shopHotProducts: ozonShopHotProductsScene,
    verification: {
        search: 'verified',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    hooks: {
        normalizeRecord({ record, collectScene, pageUrl }) {
            if (collectScene === 'search') {
                return normalizeOzonRecord(record, pageUrl);
            }
            return record;
        },
    },
    capability: buildPlatformCapability({
        regions: ['ru'],
        status: 'partial',
        overview:
            'Ozon 是俄罗斯最大的电商平台之一，搜索页使用 .tile-root 作为商品卡片容器，已通过 CDP 验证可采集到 24 个商品。',
        notes: [
            'Ozon 搜索页使用 SSR + React hydration，商品卡片通过 .tile-root 选择器识别。',
            '搜索结果会自动重定向到分类页面，但商品数据仍然可采集。',
            '商品链接格式为 /product/{slug}-{id}/。',
        ],
        moduleDir: 'src/ecom-collect/platforms/ozon',
        selectorFile: 'src/ecom-collect/platforms/ozon/selectors.js',
        maintenanceNotes: [
            'Ozon 的类名使用 hash 后缀，但 .tile-root 是稳定的核心类名。',
            '商品链接中包含 /product/ 路径，可以通过正则提取产品 ID。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'verified',
                availability: 'available',
                reason: 'CDP 实测验证，搜索页返回 24 个商品卡片。',
                keywordPlaceholder: '例如：наушники bluetooth',
                keywordsPlaceholder: '支持俄文关键词搜索',
                overview: 'Ozon 搜索页使用 .tile-root 作为商品卡片容器，已验证可采集。',
                examples: [
                    {
                        title: 'Ozon 搜索采集',
                        payload: {
                            platform: 'ozon',
                            collectScene: 'search',
                            configData: {
                                keyword: 'наушники bluetooth',
                                maxPages: 3,
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
            buildProductDetailSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 Ozon 商品详情页链接',
                overview: 'Ozon 商品详情页结构相对稳定。',
                examples: [
                    {
                        title: 'Ozon 商品详情采集',
                        payload: {
                            platform: 'ozon',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.ozon.ru/product/naushniki-besprovodnye-1775672448/',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 Ozon 店铺页链接',
                overview: 'Ozon 店铺页商品列表采集。',
                examples: [
                    {
                        title: 'Ozon 店铺热门商品采集',
                        payload: {
                            platform: 'ozon',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://www.ozon.ru/seller/123456/',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default ozonPlatform;

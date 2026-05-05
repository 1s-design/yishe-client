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
    coupangProductDetailScene,
    coupangSearchScene,
    coupangShopHotProductsScene,
} from './selectors.js';

function extractCoupangProductId(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const patterns = [
        /\/vp\/products\/(\d+)/i,
        /\/products\/(\d+)/i,
        /[?&]productId=(\d+)/i,
        /[?&]itemId=(\d+)/i,
    ];
    for (const pattern of patterns) {
        const matched = raw.match(pattern);
        if (matched?.[1]) return matched[1];
    }
    return '';
}

function normalizeCoupangItemUrl(value = '', pageUrl = '') {
    const raw = sanitizeUrl(value, pageUrl);
    if (!raw) return '';
    const productId = extractCoupangProductId(raw);
    if (productId) {
        return `https://www.coupang.com/vp/products/${productId}`;
    }
    return raw;
}

function normalizeCoupangRecord(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(record.originalSourceUrl || record.sourceUrl, pageUrl);
    const sourceUrl = normalizeCoupangItemUrl(incomingUrl, pageUrl);
    const productId =
        extractCoupangProductId(record.recordKey) ||
        extractCoupangProductId(incomingUrl) ||
        extractCoupangProductId(sourceUrl);
    const nextRecordKey = productId
        ? `coupang:${productId}`
        : normalizeRecordKey(record.recordKey, sourceUrl || incomingUrl);

    return {
        ...record,
        title: sanitizeText(record.title),
        shopName: sanitizeText(record.shopName),
        sourceUrl: sourceUrl || record.sourceUrl || '',
        ...(incomingUrl && sourceUrl && incomingUrl !== sourceUrl
            ? { originalSourceUrl: incomingUrl }
            : {}),
        ...(productId ? { productId } : {}),
        recordKey: nextRecordKey,
    };
}

const coupangPlatform = {
    platform: 'coupang',
    label: 'Coupang',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: coupangSearchScene,
    productDetail: coupangProductDetailScene,
    shopHotProducts: coupangShopHotProductsScene,
    verification: {
        search: 'planned',
        product_detail: 'planned',
        shop_hot_products: 'planned',
    },
    hooks: {
        normalizeRecord({ record, collectScene, pageUrl }) {
            if (collectScene === 'search') {
                return normalizeCoupangRecord(record, pageUrl);
            }
            return record;
        },
    },
    capability: buildPlatformCapability({
        regions: ['kr'],
        status: 'blocked',
        reason: 'Coupang 搜索页有严格的反爬虫机制，当前环境返回空页面。需要韩国 IP 或稳定的代理环境。',
        overview:
            'Coupang 是韩国最大的电商平台，类似 Amazon 模式，以火箭配送闻名。',
        notes: [
            'Coupang 搜索页使用服务端渲染 + React hydration，但反爬虫较强。',
            '需要韩国 IP 环境才能正常访问搜索结果。',
            '商品链接使用 /vp/products/{id} 格式。',
        ],
        moduleDir: 'src/ecom-collect/platforms/coupang',
        selectorFile: 'src/ecom-collect/platforms/coupang/selectors.js',
        maintenanceNotes: [
            'Coupang 页面结构可能会因地区限制而返回空内容，建议先确认网络环境。',
            '选择器使用 li[class*="product"] 作为商品卡片容器。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '当前环境反爬虫拦截，返回空页面。需要韩国 IP。',
                keywordPlaceholder: '例如：무선 이어폰',
                keywordsPlaceholder: '支持韩文关键词搜索',
                overview: 'Coupang 搜索页商品卡片通过 li[class*="product"] 选择器识别。',
                examples: [
                    {
                        title: 'Coupang 搜索采集',
                        payload: {
                            platform: 'coupang',
                            collectScene: 'search',
                            configData: {
                                keyword: '무선 이어폰',
                                maxPages: 3,
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
            buildProductDetailSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '需要先验证搜索场景可用性。',
                targetUrlPlaceholder: '填写 Coupang 商品详情页链接',
                overview: 'Coupang 商品详情页使用 /vp/products/{id} 格式。',
                examples: [
                    {
                        title: 'Coupang 商品详情采集',
                        payload: {
                            platform: 'coupang',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.coupang.com/vp/products/12345678',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '需要先验证搜索场景可用性。',
                targetUrlPlaceholder: '填写 Coupang 店铺页链接',
                overview: 'Coupang 店铺页商品列表采集。',
                examples: [
                    {
                        title: 'Coupang 店铺热门商品采集',
                        payload: {
                            platform: 'coupang',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://www.coupang.com/vp/sellers/12345',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default coupangPlatform;

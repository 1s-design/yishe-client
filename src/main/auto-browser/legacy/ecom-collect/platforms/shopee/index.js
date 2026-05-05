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
    shopeeProductDetailScene,
    shopeeSearchScene,
    shopeeShopHotProductsScene,
} from './selectors.js';

const SHOPEE_MARKETPLACE_CONFIGS = {
    JP: { code: 'JP', label: '日本', domain: 'shopee.co.jp' },
    SG: { code: 'SG', label: '新加坡', domain: 'shopee.sg' },
    MY: { code: 'MY', label: '马来西亚', domain: 'shopee.com.my' },
    TH: { code: 'TH', label: '泰国', domain: 'shopee.co.th' },
    TW: { code: 'TW', label: '台湾', domain: 'shopee.tw' },
    VN: { code: 'VN', label: '越南', domain: 'shopee.vn' },
    PH: { code: 'PH', label: '菲律宾', domain: 'shopee.ph' },
    ID: { code: 'ID', label: '印尼', domain: 'shopee.co.id' },
    BR: { code: 'BR', label: '巴西', domain: 'shopee.com.br' },
};

function resolveShopeeDomain(marketplace = 'JP') {
    const key = String(marketplace || '').toUpperCase();
    return SHOPEE_MARKETPLACE_CONFIGS[key]?.domain || 'shopee.co.jp';
}

function extractShopeeItemId(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const patterns = [
        /-i\.(\d+)\.(\d+)/i,
        /\/product\/(\d+)\/(\d+)/i,
        /[?&]itemid=(\d+)/i,
        /itemId[=:]?\s*(\d+)/i,
    ];
    for (const pattern of patterns) {
        const matched = raw.match(pattern);
        if (matched) {
            if (matched[2]) return `${matched[1]}_${matched[2]}`;
            return matched[1];
        }
    }
    return '';
}

function normalizeShopeeItemUrl(value = '', pageUrl = '') {
    const raw = sanitizeUrl(value, pageUrl);
    if (!raw) return '';
    const itemId = extractShopeeItemId(raw);
    const shopIdMatch = raw.match(/-i\.(\d+)\./i);
    if (itemId && shopIdMatch) {
        return raw.split('?')[0];
    }
    return raw;
}

function normalizeShopeeRecord(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(record.originalSourceUrl || record.sourceUrl, pageUrl);
    const sourceUrl = normalizeShopeeItemUrl(incomingUrl, pageUrl);
    const itemId =
        extractShopeeItemId(record.recordKey) ||
        extractShopeeItemId(incomingUrl) ||
        extractShopeeItemId(sourceUrl);
    const nextRecordKey = itemId
        ? `shopee:${itemId}`
        : normalizeRecordKey(record.recordKey, sourceUrl || incomingUrl);

    return {
        ...record,
        title: sanitizeText(record.title),
        shopName: sanitizeText(record.shopName),
        sourceUrl: sourceUrl || record.sourceUrl || '',
        ...(incomingUrl && sourceUrl && incomingUrl !== sourceUrl
            ? { originalSourceUrl: incomingUrl }
            : {}),
        ...(itemId ? { itemId } : {}),
        recordKey: nextRecordKey,
    };
}

const shopeePlatform = {
    platform: 'shopee',
    label: 'Shopee',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: shopeeSearchScene,
    productDetail: shopeeProductDetailScene,
    shopHotProducts: shopeeShopHotProductsScene,
    verification: {
        search: 'planned',
        product_detail: 'planned',
        shop_hot_products: 'planned',
    },
    hooks: {
        normalizeRecord({ record, collectScene, pageUrl }) {
            if (collectScene === 'search') {
                return normalizeShopeeRecord(record, pageUrl);
            }
            return record;
        },
    },
    capability: buildPlatformCapability({
        regions: ['sea', 'jp'],
        status: 'blocked',
        reason: 'Shopee 搜索页有较严格的反爬虫机制，当前环境连接被重置。建议在已登录且稳定的网络环境下测试。',
        overview:
            'Shopee 是东南亚最大的电商平台，覆盖日本、新加坡、马来西亚、泰国、台湾、越南、菲律宾、印尼、巴西等市场。',
        notes: [
            'Shopee 搜索页使用 React SPA，商品数据可能通过 API 注入而非直接 HTML 渲染。',
            '需要在稳定的网络环境和已登录会话下才能正常采集。',
            '如果连接被重置，可能需要更换 IP 或使用代理。',
        ],
        moduleDir: 'src/ecom-collect/platforms/shopee',
        selectorFile: 'src/ecom-collect/platforms/shopee/selectors.js',
        maintenanceNotes: [
            'Shopee 使用 React + CSS Modules，类名可能包含 hash 后缀。',
            '建议优先验证日本站(shopee.co.jp)和新加坡站(shopee.sg)。',
            '搜索页商品卡片通过 data-sqe 属性标识。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '当前环境连接被重置，需要稳定网络环境。',
                keywordPlaceholder: '例如：wireless earbuds',
                keywordsPlaceholder: '支持英文和本地语言关键词',
                overview: 'Shopee 搜索页使用 React SPA 渲染，商品卡片通过 .shopee-search-item-result__item 选择器识别。',
                examples: [
                    {
                        title: 'Shopee 搜索采集',
                        payload: {
                            platform: 'shopee',
                            collectScene: 'search',
                            configData: {
                                keyword: 'wireless earbuds',
                                maxPages: 3,
                                maxItems: 60,
                                marketplace: 'JP',
                            },
                        },
                    },
                ],
            }),
            buildProductDetailSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '需要先验证搜索场景可用性。',
                targetUrlPlaceholder: '填写 Shopee 商品详情页链接',
                overview: 'Shopee 商品详情页使用 -i.shopid.itemid 格式链接。',
                examples: [
                    {
                        title: 'Shopee 商品详情采集',
                        payload: {
                            platform: 'shopee',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://shopee.co.jp/product-i.123456.789',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '需要先验证搜索场景可用性。',
                targetUrlPlaceholder: '填写 Shopee 店铺页链接',
                overview: 'Shopee 店铺页商品列表采集。',
                examples: [
                    {
                        title: 'Shopee 店铺热门商品采集',
                        payload: {
                            platform: 'shopee',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://shopee.co.jp/shop/123456',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default shopeePlatform;

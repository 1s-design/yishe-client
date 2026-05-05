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
    mercadolibreProductDetailScene,
    mercadolibreSearchScene,
    mercadolibreShopHotProductsScene,
} from './selectors.js';

const MERCADOLIBRE_MARKETPLACE_CONFIGS = {
    MX: { code: 'MX', label: '墨西哥', domain: 'mercadolibre.com.mx', listDomain: 'listado.mercadolibre.com.mx' },
    AR: { code: 'AR', label: '阿根廷', domain: 'mercadolibre.com.ar', listDomain: 'listado.mercadolibre.com.ar' },
    BR: { code: 'BR', label: '巴西', domain: 'mercadolivre.com.br', listDomain: 'lista.mercadolivre.com.br' },
    CO: { code: 'CO', label: '哥伦比亚', domain: 'mercadolibre.com.co', listDomain: 'listado.mercadolibre.com.co' },
    CL: { code: 'CL', label: '智利', domain: 'mercadolibre.cl', listDomain: 'listado.mercadolibre.cl' },
    PE: { code: 'PE', label: '秘鲁', domain: 'mercadolibre.com.pe', listDomain: 'listado.mercadolibre.com.pe' },
};

function resolveMercadoLibreDomain(marketplace = 'MX') {
    const key = String(marketplace || '').toUpperCase();
    return MERCADOLIBRE_MARKETPLACE_CONFIGS[key] || MERCADOLIBRE_MARKETPLACE_CONFIGS.MX;
}

function extractMercadoLibreItemId(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const patterns = [
        /\/ML[A-Z]-\d+/i,
        /ML[A-Z]\d+/i,
        /[A-Z]{2}\d{8,}/i,
    ];
    for (const pattern of patterns) {
        const matched = raw.match(pattern);
        if (matched?.[0]) return matched[0];
    }
    return '';
}

function normalizeMercadoLibreRecord(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(record.originalSourceUrl || record.sourceUrl, pageUrl);
    const itemId =
        extractMercadoLibreItemId(record.recordKey) ||
        extractMercadoLibreItemId(incomingUrl);
    const nextRecordKey = itemId
        ? `ml:${itemId}`
        : normalizeRecordKey(record.recordKey, incomingUrl);

    return {
        ...record,
        title: sanitizeText(record.title),
        shopName: sanitizeText(record.shopName),
        sourceUrl: incomingUrl || record.sourceUrl || '',
        ...(itemId ? { itemId } : {}),
        recordKey: nextRecordKey,
    };
}

const mercadolibrePlatform = {
    platform: 'mercadolibre',
    label: 'Mercado Libre',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: mercadolibreSearchScene,
    productDetail: mercadolibreProductDetailScene,
    shopHotProducts: mercadolibreShopHotProductsScene,
    verification: {
        search: 'planned',
        product_detail: 'planned',
        shop_hot_products: 'planned',
    },
    hooks: {
        normalizeRecord({ record, collectScene, pageUrl }) {
            if (collectScene === 'search') {
                return normalizeMercadoLibreRecord(record, pageUrl);
            }
            return record;
        },
    },
    capability: buildPlatformCapability({
        regions: ['latam'],
        status: 'blocked',
        reason: 'Mercado Libre 搜索页会触发账户验证重定向，当前环境无法直接访问搜索结果。',
        overview:
            'Mercado Libre 是拉丁美洲最大的电商平台，覆盖墨西哥、阿根廷、巴西、哥伦比亚、智利、秘鲁等市场。',
        notes: [
            '搜索页面会重定向到 account-verification 页面，需要通过验证后才能访问。',
            '建议在已登录且通过验证的会话环境下测试。',
            '商品链接使用 MLM-XXXXXXXXX 或类似格式的 ID。',
        ],
        moduleDir: 'src/ecom-collect/platforms/mercadolibre',
        selectorFile: 'src/ecom-collect/platforms/mercadolibre/selectors.js',
        maintenanceNotes: [
            'Mercado Libre 使用 Andes 设计系统，卡片类名为 andes-card。',
            '搜索结果页面使用 .ui-search-result 作为商品卡片容器。',
            '需要在已验证的会话环境下才能正常采集。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '当前环境触发账户验证重定向，需要已验证的会话。',
                keywordPlaceholder: '例如：auriculares bluetooth',
                keywordsPlaceholder: '支持西班牙语和葡萄牙语关键词',
                overview: 'Mercado Libre 搜索页使用 .ui-search-result 作为商品卡片容器。',
                examples: [
                    {
                        title: 'Mercado Libre 搜索采集',
                        payload: {
                            platform: 'mercadolibre',
                            collectScene: 'search',
                            configData: {
                                keyword: 'auriculares bluetooth',
                                maxPages: 3,
                                maxItems: 60,
                                marketplace: 'MX',
                            },
                        },
                    },
                ],
            }),
            buildProductDetailSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '需要先验证搜索场景可用性。',
                targetUrlPlaceholder: '填写 Mercado Libre 商品详情页链接',
                overview: 'Mercado Libre 商品详情页使用 articulo.mercadolibre.com.mx/MLM-XXXXXXXXX 格式。',
                examples: [
                    {
                        title: 'Mercado Libre 商品详情采集',
                        payload: {
                            platform: 'mercadolibre',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://articulo.mercadolibre.com.mx/MLM-123456789-demo',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '需要先验证搜索场景可用性。',
                targetUrlPlaceholder: '填写 Mercado Libre 店铺页链接',
                overview: 'Mercado Libre 店铺页使用 _CustId_ 格式标识。',
                examples: [
                    {
                        title: 'Mercado Libre 店铺热门商品采集',
                        payload: {
                            platform: 'mercadolibre',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://listado.mercadolibre.com.mx/_CustId_123456789',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default mercadolibrePlatform;

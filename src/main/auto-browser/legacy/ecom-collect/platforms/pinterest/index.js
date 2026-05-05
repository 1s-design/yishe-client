import {
    buildPlatformCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    buildProductDetailSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
    createOutputField,
} from '../shared.js';
import {
    normalizeRecordKey,
    sanitizeText,
    sanitizeUrl,
} from '../../common/runtime.js';
import {
    pinterestProductDetailScene,
    pinterestSearchScene,
    pinterestShopHotProductsScene,
} from './selectors.js';

const PINTEREST_RECORD_FIELDS_EXTRA = [
    createOutputField('pinId', 'Pin ID', {
        description: 'Pinterest Pin 唯一标识。',
        stability: 'platform',
    }),
    createOutputField('boardName', '画板名称', {
        description: 'Pin 所属画板名称。',
        stability: 'platform',
    }),
];

function extractPinterestPinId(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const patterns = [
        /\/pin\/(\d+)/i,
        /pin_id[=:]\s*(\d+)/i,
        /(\d{10,})/,
    ];
    for (const pattern of patterns) {
        const matched = raw.match(pattern);
        if (matched?.[1]) return matched[1];
    }
    return '';
}

function normalizePinterestRecord(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(record.originalSourceUrl || record.sourceUrl, pageUrl);
    const pinId =
        extractPinterestPinId(record.recordKey) ||
        extractPinterestPinId(incomingUrl);
    const nextRecordKey = pinId
        ? `pin:${pinId}`
        : normalizeRecordKey(record.recordKey, incomingUrl);

    return {
        ...record,
        title: sanitizeText(record.title),
        sourceUrl: incomingUrl || record.sourceUrl || '',
        ...(pinId ? { pinId } : {}),
        recordKey: nextRecordKey,
    };
}

const pinterestPlatform = {
    platform: 'pinterest',
    label: 'Pinterest',
    supportedScenes: ['search', 'product_detail', 'shop_hot_products'],
    search: pinterestSearchScene,
    productDetail: pinterestProductDetailScene,
    shopHotProducts: pinterestShopHotProductsScene,
    verification: {
        search: 'heuristic',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    hooks: {
        normalizeRecord({ record, collectScene, pageUrl }) {
            if (collectScene === 'search') {
                return normalizePinterestRecord(record, pageUrl);
            }
            return record;
        },
    },
    capability: buildPlatformCapability({
        regions: ['global'],
        status: 'heuristic',
        overview:
            'Pinterest 是全球最大的视觉搜索和灵感平台，可用于产品灵感和趋势发现。PinCard 是主要的内容卡片形式。',
        notes: [
            'Pinterest 搜索页使用无限滚动加载，需要滚动触发更多内容。',
            'Pin 卡片使用 PinCard__imageWrapper 类名标识。',
            '可用于发现产品灵感、趋势图片、设计素材等。',
        ],
        moduleDir: 'src/ecom-collect/platforms/pinterest',
        selectorFile: 'src/ecom-collect/platforms/pinterest/selectors.js',
        maintenanceNotes: [
            'Pinterest 使用 CSS modules，类名带 hash 后缀，但 PinCard__imageWrapper 是稳定的核心类名。',
            '搜索页内容通过无限滚动加载，需要模拟滚动操作。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                keywordPlaceholder: '例如：wireless earbuds design',
                keywordsPlaceholder: '支持英文关键词搜索',
                overview: 'Pinterest 搜索页使用 PinCard__imageWrapper 作为卡片容器，已验证可采集到 45 个 Pin。',
                examples: [
                    {
                        title: 'Pinterest 搜索采集',
                        payload: {
                            platform: 'pinterest',
                            collectScene: 'search',
                            configData: {
                                keyword: 'wireless earbuds design',
                                maxItems: 60,
                            },
                        },
                    },
                ],
                extraRecordFields: PINTEREST_RECORD_FIELDS_EXTRA,
            }),
            buildProductDetailSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 Pinterest Pin 页面链接',
                overview: 'Pinterest Pin 详情页采集。',
                examples: [
                    {
                        title: 'Pinterest Pin 详情采集',
                        payload: {
                            platform: 'pinterest',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.pinterest.com/pin/123456789/',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 Pinterest 画板链接',
                overview: 'Pinterest 画板内容采集。',
                examples: [
                    {
                        title: 'Pinterest 画板内容采集',
                        payload: {
                            platform: 'pinterest',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://www.pinterest.com/username/board-name/',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default pinterestPlatform;

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
import {
    buildKeywordList,
    extractDetailRecord,
} from '../../common/extractors.js';
import {
    captureScreenshot,
    prepareCollectionPage,
} from '../../common/navigation.js';
import {
    normalizeRecordKey,
    sanitizeText,
    sanitizeUrl,
} from '../../common/runtime.js';
import {
    rakutenProductDetailScene,
    rakutenSearchScene,
    rakutenShopHotProductsScene,
} from './selectors.js';

const RAKUTEN_MARKETPLACE_CONFIGS = {
    JP: {
        code: 'JP',
        label: '日本',
        homeUrl: 'https://www.rakuten.co.jp/',
        searchUrl: 'https://search.rakuten.co.jp/search/mall/',
    },
};

const RAKUTEN_MARKETPLACE_OPTIONS = Object.values(RAKUTEN_MARKETPLACE_CONFIGS).map((item) => ({
    label: item.label,
    value: item.code,
    description: `${item.label} 乐天市场`,
}));

const RAKUTEN_SEARCH_RECORD_FIELDS_EXTRA = [
    createOutputField('shopName', '店铺名称', {
        description: '乐天店铺名称。',
        stability: 'platform',
    }),
    createOutputField('ratingText', '评分', {
        description: '乐天商品评分文本。',
        stability: 'platform',
    }),
    createOutputField('reviewCountText', '评论数', {
        description: '乐天商品评论数量。',
        stability: 'platform',
    }),
    createOutputField('freeShipping', '免运费', {
        description: '是否免运费。',
        valueType: 'boolean',
        stability: 'platform',
    }),
];

const RAKUTEN_SUGGESTION_RECORD_FIELDS_EXTRA = [
    createOutputField('sourceType', '来源类型', {
        description: '联想词来源类型。',
        stability: 'platform',
        examples: ['keyword_suggestion'],
    }),
];

function extractRakutenItemId(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const patterns = [
        /item\/(\d+)\/(\d+)\//i,
        /review\.rakuten\.co\.jp\/item\/(\d+)\/(\d+)/i,
        /item\.rakuten\.co\.jp\/[^/]*\/([a-zA-Z0-9_-]+)/i,
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

function normalizeRakutenItemUrl(value = '', pageUrl = '') {
    const raw = sanitizeUrl(value, pageUrl);
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        if (/rakuten\.co\.jp/i.test(parsed.hostname)) {
            parsed.search = '';
            parsed.hash = '';
            return parsed.toString();
        }
    } catch {}
    return raw;
}

function normalizeRakutenRecord(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(record.originalSourceUrl || record.sourceUrl, pageUrl);
    const sourceUrl = normalizeRakutenItemUrl(incomingUrl, pageUrl);
    const itemId =
        extractRakutenItemId(record.recordKey) ||
        extractRakutenItemId(incomingUrl) ||
        extractRakutenItemId(sourceUrl);
    const nextRecordKey = itemId
        ? `rakuten:${itemId}`
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

function buildRakutenSuggestionApiUrl(keyword = '') {
    return `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/suggest?l-id=desktop_suggest`;
}

async function fetchRakutenSuggestions(keyword = '') {
    try {
        const response = await fetch(buildRakutenSuggestionApiUrl(keyword), {
            headers: {
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
                'accept-language': 'ja,en;q=0.9',
            },
        });
        if (!response.ok) return [];
        const data = await response.json().catch(() => null);
        if (!data) return [];
        const items = Array.isArray(data?.candidates) ? data.candidates : [];
        return items
            .map((item, index) => ({
                value: sanitizeText(typeof item === 'string' ? item : item?.keyword || item?.text || ''),
                rank: index + 1,
                source: 'api',
                suggestionType: 'KEYWORD',
            }))
            .filter((item) => item.value);
    } catch {
        return [];
    }
}

const rakutenPlatform = {
    platform: 'rakuten',
    label: 'Rakuten',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: rakutenSearchScene,
    productDetail: rakutenProductDetailScene,
    shopHotProducts: rakutenShopHotProductsScene,
    verification: {
        search: 'verified',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
        search_suggestions: 'heuristic',
    },
    hooks: {
        normalizeRecord({ record, collectScene, pageUrl }) {
            if (collectScene === 'search') {
                return normalizeRakutenRecord(record, pageUrl);
            }
            if (collectScene === 'product_detail') {
                return normalizeRakutenRecord(record, pageUrl);
            }
            return record;
        },
        async fetchSuggestions(keyword = '') {
            return fetchRakutenSuggestions(keyword);
        },
    },
    capability: buildPlatformCapability({
        regions: ['jp'],
        status: 'partial',
        overview:
            'Rakuten 是日本最大的电商平台，搜索页使用 dui-card + CSS modules，已验证关键词搜索和联想词采集。',
        notes: [
            'Rakuten 搜索结果使用 CSS modules，类名带 hash 后缀，选择器使用 class* 匹配。',
            '商品链接通常包含 rakuten.co.jp/item/ 或 review.rakuten.co.jp/item/ 路径。',
            '联想词可以通过 suggest API 获取，也可以通过页面 UI 下拉获取。',
        ],
        moduleDir: 'src/ecom-collect/platforms/rakuten',
        selectorFile: 'src/ecom-collect/platforms/rakuten/selectors.js',
        maintenanceNotes: [
            '如果 CSS modules hash 变了，需要更新 selectors.js 中的选择器。',
            'Rakuten 搜索页不需要登录，但某些商品可能需要。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'verified',
                availability: 'available',
                keywordPlaceholder: '例如：ワイヤレスイヤホン',
                keywordsPlaceholder: '支持日文关键词搜索',
                overview: 'Rakuten 搜索页使用 .searchresultitem 作为卡片容器，已验证 50 个商品卡片。',
                examples: [
                    {
                        title: 'Rakuten 搜索采集',
                        payload: {
                            platform: 'rakuten',
                            collectScene: 'search',
                            configData: {
                                keyword: 'ワイヤレスイヤホン',
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
                targetUrlPlaceholder: '填写 Rakuten 商品详情页链接',
                overview: 'Rakuten 商品详情页结构相对稳定。',
                examples: [
                    {
                        title: 'Rakuten 商品详情采集',
                        payload: {
                            platform: 'rakuten',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://item.rakuten.co.jp/example/product123/',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 Rakuten 店铺或排行榜页面链接',
                overview: 'Rakuten 排行榜和店铺页面可用于热门商品采集。',
                examples: [
                    {
                        title: 'Rakuten 排行榜采集',
                        payload: {
                            platform: 'rakuten',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://ranking.rakuten.co.jp/daily/558890/',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
            buildSearchSuggestionsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                keywordPlaceholder: '例如：ワイヤレスイヤホン',
                overview: 'Rakuten 搜索联想词可通过 suggest API 获取。',
                examples: [
                    {
                        title: 'Rakuten 联想词采集',
                        payload: {
                            platform: 'rakuten',
                            collectScene: 'search_suggestions',
                            configData: {
                                keyword: 'ワイヤレスイヤホン',
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default rakutenPlatform;

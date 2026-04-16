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
    alibaba1688HotProductsScene,
    alibaba1688ProductDetailScene,
    alibaba1688SearchScene,
} from './selectors.js';

function extract1688OfferId(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    const patterns = [
        /\/offer\/(\d+)\.html/i,
        /[?&]offerId=(\d+)/i,
        /[?&]id=(\d+)/i,
    ];

    for (const pattern of patterns) {
        const matched = text.match(pattern);
        if (matched?.[1]) {
            return matched[1];
        }
    }

    return '';
}

function normalize1688Url(value = '', pageUrl = '') {
    const incomingUrl = sanitizeUrl(value, pageUrl);
    if (!incomingUrl) {
        return '';
    }

    const offerId = extract1688OfferId(incomingUrl);
    if (offerId) {
        return `https://detail.1688.com/offer/${offerId}.html`;
    }

    try {
        const parsed = new URL(incomingUrl);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return incomingUrl;
    }
}

function normalize1688Record(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(
        record.originalSourceUrl || record.sourceUrl,
        pageUrl,
    );
    const sourceUrl = normalize1688Url(incomingUrl, pageUrl);
    const offerId =
        extract1688OfferId(record.recordKey) ||
        extract1688OfferId(incomingUrl) ||
        extract1688OfferId(sourceUrl);
    const nextRecordKey = offerId
        ? `offer:${offerId}`
        : normalizeRecordKey(record.recordKey, sourceUrl || incomingUrl);

    return {
        ...record,
        title: sanitizeText(record.title),
        subtitle: sanitizeText(record.subtitle),
        priceText: sanitizeText(record.priceText),
        shopName: sanitizeText(record.shopName),
        badgeText: sanitizeText(record.badgeText),
        sourceUrl: sourceUrl || record.sourceUrl || '',
        ...(incomingUrl && sourceUrl && incomingUrl !== sourceUrl
            ? { originalSourceUrl: incomingUrl }
            : {}),
        ...(offerId ? { offerId } : {}),
        recordKey: nextRecordKey,
    };
}

const alibaba1688Platform = {
    platform: '1688',
    label: '1688',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: alibaba1688SearchScene,
    productDetail: alibaba1688ProductDetailScene,
    shopHotProducts: alibaba1688HotProductsScene,
    verification: {
        search: 'heuristic',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    hooks: {
        async normalizeRecord(context) {
            return normalize1688Record(
                context.record,
                context.pageUrl || context.page?.url?.() || '',
            );
        },
    },
    capability: buildPlatformCapability({
        regions: ['cn'],
        status: 'heuristic',
        overview:
            '1688 已接入独立平台模块，当前优先覆盖同款搜索与详情采集，适合作为供应链侧数据源。',
        notes: [
            '1688 容易触发验证码或风控；命中时会尽快返回受限状态，不会长时间卡住任务。',
            '当前选择器以启发式兼容为主，后续可按真实页面持续补细节字段。',
        ],
        moduleDir: 'src/ecom-collect/platforms/alibaba_1688',
        selectorFile: 'src/ecom-collect/platforms/alibaba_1688/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/alibaba_1688/README.md',
        maintenanceNotes: [
            '优先依赖 `detail.1688.com/offer/` 链接、`data-offerid` 和价格/店铺语义节点，不要绑定完整 class hash。',
            '如果搜索页直接返回验证码，先看是否被重定向到 punish 页面，再决定是否补更多候选选择器。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                keywordPlaceholder: '例如：蓝牙耳机',
                keywordsPlaceholder: '建议拆成更短的供货关键词，减少风控概率',
                overview: '进入 1688 搜索结果页，提取供货商品卡片原始数据。',
                notes: [
                    '默认会规范化详情链接，方便后续继续进入详情页补充信息。',
                ],
                examples: [
                    {
                        title: '1688 搜索采集',
                        payload: {
                            platform: '1688',
                            collectScene: 'search',
                            configData: {
                                keyword: '蓝牙耳机',
                                maxPages: 1,
                                maxItems: 20,
                            },
                        },
                    },
                ],
            }),
            buildProductDetailSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 1688 商品详情页链接',
                overview: '打开 1688 商品详情页，提取标题、价格、图集和描述摘要等原始信息。',
                notes: [
                    '如果详情页触发验证码，当前会返回受限状态，便于上游决定是否重试。',
                ],
                examples: [
                    {
                        title: '1688 商品详情采集',
                        payload: {
                            platform: '1688',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://detail.1688.com/offer/123456789012.html',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 1688 店铺商品列表或类目页链接',
                overview: '打开 1688 店铺商品列表页，提取热门供货商品卡片原始数据。',
                examples: [
                    {
                        title: '1688 店铺热门商品采集',
                        payload: {
                            platform: '1688',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://shop.1688.com/',
                                maxItems: 20,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default alibaba1688Platform;

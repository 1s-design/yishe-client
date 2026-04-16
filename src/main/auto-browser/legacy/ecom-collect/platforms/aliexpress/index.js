import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';
import {
    aliexpressProductDetailScene,
    aliexpressSearchScene,
    aliexpressShopHotProductsScene,
} from './selectors.js';

function normalizeAliExpressPrice(value) {
    const compactText = String(value || '').replace(/\s+/g, '');
    const matched = compactText.match(/([A-Za-z$€£¥￥]{1,5})(\d+(?:\.\d+)?)/);
    if (!matched) {
        return String(value || '').trim();
    }
    return `${matched[1]} ${matched[2]}`;
}

const aliexpressPlatform = {
    platform: 'aliexpress',
    label: 'AliExpress',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: aliexpressSearchScene,
    productDetail: aliexpressProductDetailScene,
    shopHotProducts: aliexpressShopHotProductsScene,
    verification: {
        search: 'verified',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    hooks: {
        normalizeRecord({ record, collectScene }) {
            if (collectScene !== 'search') {
                return record;
            }

            return {
                ...record,
                priceText: normalizeAliExpressPrice(record.priceText),
            };
        },
    },
    capability: buildPlatformCapability({
        regions: ['global'],
        status: 'partial',
        overview:
            'AliExpress 搜索场景已有真实样本，详情页与店铺页仍以启发式选择器为主。',
        notes: [
            '适合作为跨境平台第二批稳定入口，优先对外开放搜索场景。',
        ],
        moduleDir: 'src/ecom-collect/platforms/aliexpress',
        selectorFile: 'src/ecom-collect/platforms/aliexpress/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/aliexpress/README.md',
        maintenanceNotes: [
            '价格字段带币种前缀，平台 hook 已做轻量归一化。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'verified',
                availability: 'available',
                keywordPlaceholder: '例如：phone case',
                keywordsPlaceholder: '一行一个关键词，可按细分类目拆分',
                overview: '进入 AliExpress 搜索结果页后抓取商品卡片。',
                notes: ['当前是 AliExpress 优先推荐场景。'],
                examples: [
                    {
                        title: 'AliExpress 搜索采集',
                        payload: {
                            platform: 'aliexpress',
                            collectScene: 'search',
                            configData: {
                                keyword: 'phone case',
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
                targetUrlPlaceholder: '填写 AliExpress 商品详情页链接',
                overview: '详情场景已接入，但仍需要结合真实页面持续回归。',
                notes: ['若页面频繁跳国家站点，可在平台目录内单独补地区逻辑。'],
                examples: [
                    {
                        title: 'AliExpress 商品详情采集',
                        payload: {
                            platform: 'aliexpress',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.aliexpress.com/item/1005001234567890.html',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 AliExpress 店铺页链接',
                overview: '店铺热门商品页支持度依赖目标页结构稳定性。',
                notes: ['如店铺页结构差异大，建议针对单店页面单独补选择器。'],
                examples: [
                    {
                        title: 'AliExpress 店铺热门商品采集',
                        payload: {
                            platform: 'aliexpress',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://www.aliexpress.com/store/1100000000',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default aliexpressPlatform;

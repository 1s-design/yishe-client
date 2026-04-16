import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';
import {
    tiktokShopHotProductsScene,
    tiktokShopProductDetailScene,
    tiktokShopSearchScene,
} from './selectors.js';

const tiktokShopPlatform = {
    platform: 'tiktok_shop',
    label: 'TikTok Shop',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: tiktokShopSearchScene,
    productDetail: tiktokShopProductDetailScene,
    shopHotProducts: tiktokShopHotProductsScene,
    verification: {
        search: 'heuristic',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    capability: buildPlatformCapability({
        regions: ['global'],
        status: 'heuristic',
        overview:
            'TikTok Shop 页面波动较大，当前采用独立平台目录持续维护搜索、详情和店铺场景。',
        notes: ['若命中登录、地区限制或验证码，需要快速返回风险结果。'],
        moduleDir: 'src/ecom-collect/platforms/tiktok_shop',
        selectorFile: 'src/ecom-collect/platforms/tiktok_shop/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/tiktok_shop/README.md',
        maintenanceNotes: [
            '平台结构改动后，优先在 selectors.js 内调整卡片根节点与 href 规则。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                keywordPlaceholder: '例如：pet supplies',
                keywordsPlaceholder: '可先少量关键词试跑，观察是否触发风控',
                overview: 'TikTok Shop 搜索场景以启发式选择器为主。',
                examples: [
                    {
                        title: 'TikTok Shop 搜索采集',
                        payload: {
                            platform: 'tiktok_shop',
                            collectScene: 'search',
                            configData: {
                                keyword: 'pet supplies',
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
                targetUrlPlaceholder: '填写 TikTok Shop 商品详情页链接',
                overview: '适合抓取详情页原始信息与截图回溯。',
                examples: [
                    {
                        title: 'TikTok Shop 商品详情采集',
                        payload: {
                            platform: 'tiktok_shop',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://shop.tiktok.com/view/product/1234567890',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写 TikTok Shop 店铺页链接',
                overview: '店铺热门商品场景适合小流量持续调试。',
                examples: [
                    {
                        title: 'TikTok Shop 店铺热门商品采集',
                        payload: {
                            platform: 'tiktok_shop',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://shop.tiktok.com/view/shop/1234567890',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default tiktokShopPlatform;

import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';

const ozonPlatform = {
    platform: 'ozon',
    label: 'Ozon',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    verification: {
        search: 'planned',
        product_detail: 'planned',
        shop_hot_products: 'planned',
    },
    capability: buildPlatformCapability({
        regions: ['ru'],
        status: 'unsupported',
        reason: '当前版本只保留平台占位与参数定义，尚未进入稳定调试。',
        overview:
            'Ozon 已预留独立平台目录，后续可在当前目录单独补 DOM 规则、页面交互与风险处理。',
        notes: [
            '当前主要是把平台能力声明、参数示例和维护入口先整理好。',
        ],
        moduleDir: 'src/ecom-collect/platforms/ozon',
        selectorFile: 'src/ecom-collect/platforms/ozon/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/ozon/README.md',
        maintenanceNotes: [
            '开始调试时建议优先做搜索场景，再补详情和店铺页。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'planned',
                availability: 'unsupported',
                reason: '尚未完成真实页面调试。',
                keywordPlaceholder: '例如：наушники bluetooth',
                overview: '预留 Ozon 搜索场景参数结构。',
                examples: [
                    {
                        title: 'Ozon 搜索采集',
                        payload: {
                            platform: 'ozon',
                            collectScene: 'search',
                            configData: {
                                keyword: 'наушники bluetooth',
                                maxPages: 2,
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
            buildProductDetailSceneCapability({
                verification: 'planned',
                availability: 'unsupported',
                reason: '尚未完成真实页面调试。',
                targetUrlPlaceholder: '填写 Ozon 商品详情页链接',
                overview: '预留 Ozon 商品详情参数结构。',
                examples: [
                    {
                        title: 'Ozon 商品详情采集',
                        payload: {
                            platform: 'ozon',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.ozon.ru/product/demo-123456789/',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'planned',
                availability: 'unsupported',
                reason: '尚未完成真实页面调试。',
                targetUrlPlaceholder: '填写 Ozon 店铺页链接',
                overview: '预留 Ozon 店铺热门商品参数结构。',
                examples: [
                    {
                        title: 'Ozon 店铺热门商品采集',
                        payload: {
                            platform: 'ozon',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://www.ozon.ru/seller/demo-123456/products/',
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

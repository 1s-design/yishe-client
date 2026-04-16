import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';
import {
    taobaoHotProductsScene,
    taobaoProductDetailScene,
    taobaoSearchScene,
} from './selectors.js';

const taobaoPlatform = {
    platform: 'taobao',
    label: '淘宝',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: taobaoSearchScene,
    productDetail: taobaoProductDetailScene,
    shopHotProducts: taobaoHotProductsScene,
    verification: {
        search: 'heuristic',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    capability: buildPlatformCapability({
        regions: ['cn'],
        status: 'heuristic',
        overview:
            '淘宝页面结构调整频率较高，平台模块需要保持独立维护，便于后续继续修正选择器。',
        notes: ['如果页面进入登录流，直接返回风险类型，不把任务长时间挂起。'],
        moduleDir: 'src/ecom-collect/platforms/taobao',
        selectorFile: 'src/ecom-collect/platforms/taobao/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/taobao/README.md',
        maintenanceNotes: [
            '优先依赖 href、data-* 与语义结构，不要依赖完整 hash class。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                keywordPlaceholder: '例如：耳机',
                keywordsPlaceholder: '建议按类目词拆分，避免单次任务过大',
                overview: '淘宝搜索页当前采用多候选选择器策略。',
                examples: [
                    {
                        title: '淘宝搜索采集',
                        payload: {
                            platform: 'taobao',
                            collectScene: 'search',
                            configData: {
                                keyword: '耳机',
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
                targetUrlPlaceholder: '填写淘宝商品详情页链接',
                overview: '详情页支持已接入，但需要结合真实页面持续验证。',
                examples: [
                    {
                        title: '淘宝商品详情采集',
                        payload: {
                            platform: 'taobao',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://item.taobao.com/item.htm?id=123456789012',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                targetUrlPlaceholder: '填写淘宝店铺页链接',
                overview: '店铺热门商品场景适合先做小批量试跑。',
                examples: [
                    {
                        title: '淘宝店铺热门商品采集',
                        payload: {
                            platform: 'taobao',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://shop.taobao.com/',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default taobaoPlatform;

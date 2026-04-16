import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';
import {
    douyinShopHotProductsScene,
    douyinShopProductDetailScene,
    douyinShopSearchScene,
} from './selectors.js';

const douyinShopPlatform = {
    platform: 'douyin_shop',
    label: '抖音店铺',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: douyinShopSearchScene,
    productDetail: douyinShopProductDetailScene,
    shopHotProducts: douyinShopHotProductsScene,
    verification: {
        search: 'heuristic',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    capability: buildPlatformCapability({
        regions: ['cn'],
        status: 'heuristic',
        access: {
            login: 'required',
            captcha: 'possible',
            antiBot: 'high',
            notes: ['抖音店铺整体依赖登录态，未登录或会话失效时应优先返回 login_required。'],
        },
        overview:
            '抖音店铺平台受登录态与风控影响较大，目前保留独立平台模块，方便持续调试与替换选择器。',
        notes: [
            '如果命中登录或验证码，要快速返回风险结果，不在页面长时间卡住。',
        ],
        moduleDir: 'src/ecom-collect/platforms/douyin_shop',
        selectorFile: 'src/ecom-collect/platforms/douyin_shop/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/douyin_shop/README.md',
        maintenanceNotes: [
            '搜索、店铺页、详情页的 DOM 结构差异较大，建议优先单场景回归。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                access: {
                    login: 'required',
                    captcha: 'possible',
                    antiBot: 'high',
                    notes: ['搜索场景最容易被登录流拦住，命中后不建议继续自动重试。'],
                },
                keywordPlaceholder: '例如：手机壳',
                keywordsPlaceholder: '一行一个关键词，便于回放失败样本',
                overview: '抖音店铺搜索页以启发式方式提取商品卡片。',
                notes: ['当前搜索场景受登录态影响明显。'],
                examples: [
                    {
                        title: '抖音店铺搜索采集',
                        payload: {
                            platform: 'douyin_shop',
                            collectScene: 'search',
                            configData: {
                                keyword: '手机壳',
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
                access: {
                    login: 'required',
                    captcha: 'possible',
                    antiBot: 'high',
                    notes: ['详情页适合在稳定登录环境下执行，否则容易被登录或验证页中断。'],
                },
                targetUrlPlaceholder: '填写抖音商品详情页链接',
                overview: '适合在已登录、稳定环境下抓取商品详情页原始数据。',
                notes: ['命中风险时直接返回 skipped / failed，不进行无限重试。'],
                examples: [
                    {
                        title: '抖音商品详情采集',
                        payload: {
                            platform: 'douyin_shop',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://haohuo.jinritemai.com/views/product/item?id=123456789',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                access: {
                    login: 'required',
                    captcha: 'possible',
                    antiBot: 'high',
                    notes: ['店铺页结构会随登录态变化，未登录环境下结果不稳定。'],
                },
                targetUrlPlaceholder: '填写抖音店铺页链接',
                overview: '适合从店铺页抓取热门商品卡片。',
                notes: ['店铺页结构可能随登录态变化，建议优先保留原始数据。'],
                examples: [
                    {
                        title: '抖音店铺热门商品采集',
                        payload: {
                            platform: 'douyin_shop',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://shop.jinritemai.com/store/123456789',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default douyinShopPlatform;

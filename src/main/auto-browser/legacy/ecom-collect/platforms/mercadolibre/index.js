import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';

const mercadolibrePlatform = {
    platform: 'mercadolibre',
    label: 'Mercado Libre',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    verification: {
        search: 'planned',
        product_detail: 'planned',
        shop_hot_products: 'planned',
    },
    capability: buildPlatformCapability({
        regions: ['latam'],
        status: 'unsupported',
        reason: '当前版本仅完成平台能力占位与文档整理，尚未进入真实 DOM 调试阶段。',
        overview:
            'Mercado Libre 已预留独立平台目录，后续可以在当前目录内继续补 selectors.js、平台 hook 和真实调试样本。',
        notes: [
            '当前先提供平台占位、参数结构与调用示例，便于后续逐步落地。',
        ],
        moduleDir: 'src/ecom-collect/platforms/mercadolibre',
        selectorFile: 'src/ecom-collect/platforms/mercadolibre/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/mercadolibre/README.md',
        maintenanceNotes: [
            '待开始调试时，优先补搜索页卡片根节点、详情页主信息区与店铺页商品列表。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'planned',
                availability: 'unsupported',
                reason: '尚未完成真实页面调试。',
                keywordPlaceholder: '例如：auriculares bluetooth',
                overview: '预留 Mercado Libre 搜索场景参数结构。',
                examples: [
                    {
                        title: 'Mercado Libre 搜索采集',
                        payload: {
                            platform: 'mercadolibre',
                            collectScene: 'search',
                            configData: {
                                keyword: 'auriculares bluetooth',
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
                targetUrlPlaceholder: '填写 Mercado Libre 商品详情页链接',
                overview: '预留 Mercado Libre 商品详情参数结构。',
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
                availability: 'unsupported',
                reason: '尚未完成真实页面调试。',
                targetUrlPlaceholder: '填写 Mercado Libre 店铺页链接',
                overview: '预留 Mercado Libre 店铺热门商品参数结构。',
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

import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';
import {
    jdHotProductsScene,
    jdProductDetailScene,
    jdSearchScene,
} from './selectors.js';

const jdPlatform = {
    platform: 'jd',
    label: '京东',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: jdSearchScene,
    productDetail: jdProductDetailScene,
    shopHotProducts: jdHotProductsScene,
    verification: {
        search: 'heuristic',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    hooks: {
        normalizeRecord({ record, collectScene, pageUrl }) {
            if (collectScene !== 'shop_hot_products' || record.sourceUrl) {
                return record;
            }

            return {
                ...record,
                sourceUrl: pageUrl,
                recordKey: record.recordKey || `${pageUrl}#${record.title || 'item'}`,
            };
        },
    },
    capability: buildPlatformCapability({
        regions: ['cn'],
        status: 'blocked',
        reason: '京东前台页面当前高频触发验证码，不建议进入默认可执行平台。',
        access: {
            login: 'required',
            captcha: 'blocking',
            antiBot: 'blocking',
            notes: ['当前环境下命中登录页和验证页的概率都很高，默认应视为阻断平台而不是重试平台。'],
        },
        overview:
            '京东平台保留独立目录和选择器实现，但默认标记为受限，避免把验证码平台加入常规调度。',
        notes: [
            '如后续要重新启用，可在本平台目录内继续调试选择器与风控绕过策略。',
        ],
        moduleDir: 'src/ecom-collect/platforms/jd',
        selectorFile: 'src/ecom-collect/platforms/jd/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/jd/README.md',
        maintenanceNotes: [
            '当前阶段主要保留代码与文档，不作为默认对外能力。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'blocked',
                availability: 'blocked',
                reason: '搜索页高频触发验证码。',
                access: {
                    login: 'required',
                    captcha: 'blocking',
                    antiBot: 'blocking',
                    notes: ['搜索入口当前稳定识别为 login_required 或风险校验，默认不建议进入自动调度。'],
                },
                keywordPlaceholder: '例如：蓝牙音箱',
                overview: '保留接口文档和参数定义，等待后续重新调试。',
                examples: [
                    {
                        title: '京东搜索采集',
                        payload: {
                            platform: 'jd',
                            collectScene: 'search',
                            configData: {
                                keyword: '蓝牙音箱',
                                maxPages: 2,
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
            buildProductDetailSceneCapability({
                verification: 'blocked',
                availability: 'blocked',
                reason: '详情页访问过程容易命中验证码与风控。',
                access: {
                    login: 'required',
                    captcha: 'blocking',
                    antiBot: 'blocking',
                    notes: ['详情页当前同样属于高风险入口，更适合保留文档而不是继续自动化重试。'],
                },
                targetUrlPlaceholder: '填写京东商品详情页链接',
                overview: '默认不执行，仅保留参数与调用示例。',
                examples: [
                    {
                        title: '京东商品详情采集',
                        payload: {
                            platform: 'jd',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://item.jd.com/100000000000.html',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'blocked',
                availability: 'blocked',
                reason: '店铺页同样容易触发风险验证。',
                access: {
                    login: 'required',
                    captcha: 'blocking',
                    antiBot: 'blocking',
                    notes: ['店铺页与列表页一样受风险策略影响，当前应视为不可自动执行。'],
                },
                targetUrlPlaceholder: '填写京东店铺页链接',
                overview: '默认不执行，仅保留参数与调用示例。',
                examples: [
                    {
                        title: '京东店铺热门商品采集',
                        payload: {
                            platform: 'jd',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://mall.jd.com/index-123456.html',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default jdPlatform;

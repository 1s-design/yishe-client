import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';
import {
    sheinHotProductsScene,
    sheinProductDetailScene,
    sheinSearchScene,
} from './selectors.js';

const sheinPlatform = {
    platform: 'shein',
    label: 'SHEIN',
    supportedScenes: DEFAULT_SUPPORTED_SCENES,
    search: sheinSearchScene,
    productDetail: sheinProductDetailScene,
    shopHotProducts: sheinHotProductsScene,
    verification: {
        search: 'heuristic',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
    },
    hooks: {
        async normalizeRecord({ record, collectScene, page }) {
            if (!['search', 'shop_hot_products'].includes(collectScene)) {
                return record;
            }

            const resolved = await page.evaluate(({ sourceUrl, currentTitle }) => {
                const anchors = Array.from(document.querySelectorAll('a[href*="-p-"]'));
                const target = anchors.find((node) => {
                    const href = node.getAttribute('href') || '';
                    const absoluteHref = node.href || '';
                    return href === sourceUrl || absoluteHref === sourceUrl || absoluteHref.startsWith(sourceUrl);
                }) || anchors.find((node) => {
                    const aria = (node.getAttribute('aria-label') || '').trim();
                    return aria && aria === currentTitle;
                });

                if (!target) {
                    return null;
                }

                const currentPrice = (target.getAttribute('data-price') || '').trim();
                const originalPrice = (target.getAttribute('data-us-origin-price') || '').trim();
                const title =
                    (target.getAttribute('data-title') || '').trim() ||
                    (target.getAttribute('aria-label') || '').trim();

                return {
                    title,
                    priceText: currentPrice ? `$${currentPrice}` : '',
                    badgeText: originalPrice ? `Original $${originalPrice}` : '',
                    recordKey:
                        (target.getAttribute('data-id') || '').trim() ||
                        (target.getAttribute('data-sku') || '').trim() ||
                        '',
                };
            }, {
                sourceUrl: record.sourceUrl,
                currentTitle: record.title,
            }).catch(() => null);

            if (!resolved) {
                return record;
            }

            return {
                ...record,
                title: resolved.title || record.title,
                priceText: resolved.priceText || record.priceText,
                badgeText: resolved.badgeText || record.badgeText,
                recordKey: resolved.recordKey || record.recordKey,
            };
        },
    },
    capability: buildPlatformCapability({
        regions: ['global'],
        status: 'partial',
        access: {
            login: 'optional',
            captcha: 'likely',
            antiBot: 'high',
            notes: ['SHEIN 当前最主要的问题是验证码和访问限制，适合把风险识别结果直接暴露给上层。'],
        },
        overview:
            'SHEIN 当前更推荐详情场景，搜索与店铺页虽然已有实现，但更容易受验证码或风控影响。',
        notes: [
            '平台模块里已经保留了额外的记录归一化逻辑，方便后续持续修正价格与链接。',
        ],
        moduleDir: 'src/ecom-collect/platforms/shein',
        selectorFile: 'src/ecom-collect/platforms/shein/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/shein/README.md',
        maintenanceNotes: [
            '如命中验证码，优先返回风险结果并截图，不要反复重试导致任务卡死。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                access: {
                    login: 'none',
                    captcha: 'blocking',
                    antiBot: 'high',
                    notes: ['搜索页当前实测会跳到 risk/challenge，应尽快返回 captcha 风险结果。'],
                },
                keywordPlaceholder: '例如：phone case',
                overview: '搜索场景可用，但要预期存在验证码风险。',
                notes: ['如果稳定性下降，可先只保留详情场景对外。'],
                examples: [
                    {
                        title: 'SHEIN 搜索采集',
                        payload: {
                            platform: 'shein',
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
                availability: 'available',
                access: {
                    login: 'optional',
                    captcha: 'possible',
                    antiBot: 'medium',
                    notes: ['详情页比搜索更稳定，但仍建议保留风控截图与失败原因。'],
                },
                targetUrlPlaceholder: '填写 SHEIN 商品详情页链接',
                overview: '详情页是当前优先推荐场景。',
                notes: ['详情页通常更容易拿到图片、规格与页面标题原始数据。'],
                examples: [
                    {
                        title: 'SHEIN 商品详情采集',
                        payload: {
                            platform: 'shein',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://us.shein.com/example-product-p-12345678-cat-1234.html',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                access: {
                    login: 'optional',
                    captcha: 'likely',
                    antiBot: 'high',
                    notes: ['列表和店铺流场景更容易被验证码覆盖，优先保证风险退出而不是强行补交互。'],
                },
                targetUrlPlaceholder: '填写 SHEIN 店铺页或分类页链接',
                overview: '店铺热门商品场景可用，但仍需要结合真实页面继续调试。',
                notes: ['如果页面结构变化，可优先修复卡片根节点与链接定位。'],
                examples: [
                    {
                        title: 'SHEIN 店铺热门商品采集',
                        payload: {
                            platform: 'shein',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://us.shein.com/campaigns/trendingnow',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default sheinPlatform;

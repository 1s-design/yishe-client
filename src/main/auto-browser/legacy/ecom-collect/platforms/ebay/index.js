import {
    buildPlatformCapability,
    buildProductDetailSceneCapability,
    buildSearchSceneCapability,
    buildSearchSuggestionsSceneCapability,
    buildShopHotProductsSceneCapability,
    createOutputField,
    DEFAULT_SUPPORTED_SCENES,
} from '../shared.js';
import { buildKeywordList } from '../../common/extractors.js';
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
    ebayProductDetailScene,
    ebaySearchScene,
    ebayShopHotProductsScene,
} from './selectors.js';

const EBAY_AUTOSUGGEST_ENDPOINT = 'https://autosug.ebay.com/autosug';
const EBAY_HTTP_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9',
};

const EBAY_PRODUCT_RECORD_FIELDS_EXTRA = [
    createOutputField('itemId', 'eBay Item ID', {
        description: 'eBay 商品唯一标识，适合做链接规范化和去重。',
        stability: 'platform',
        examples: ['143949885566'],
    }),
    createOutputField('originalSourceUrl', '原始链接', {
        description: '保留规范化前的原始商品链接。',
        valueType: 'url',
        stability: 'platform',
    }),
];

const EBAY_SUGGESTION_RECORD_FIELDS_EXTRA = [
    createOutputField('sourceType', '来源类型', {
        description: '当前记录属于搜索联想信号。',
        stability: 'platform',
        examples: ['keyword_suggestion'],
    }),
    createOutputField('signalType', '信号类型', {
        description: '信号子类型，当前为 search_suggestion。',
        stability: 'platform',
        examples: ['search_suggestion'],
    }),
    createOutputField('marketplace', '站点代码', {
        description: '当前联想词所属站点代码。',
        stability: 'platform',
        examples: ['US'],
    }),
    createOutputField('marketplaceLabel', '站点名称', {
        description: '站点的人类可读名称。',
        stability: 'platform',
        examples: ['美国'],
    }),
    createOutputField('suggestionSource', '建议来源', {
        description: '当前联想词来自 autosuggest API 还是 UI 下拉抓取。',
        stability: 'platform',
        examples: ['api'],
    }),
];

function extractEbayItemId(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    const patterns = [
        /\/itm(?:\/[^/?#]+)?\/(\d+)(?:[/?#]|$)/i,
        /[?&]itm=(\d+)(?:[&#]|$)/i,
    ];

    for (const pattern of patterns) {
        const matched = text.match(pattern);
        if (matched?.[1]) {
            return matched[1];
        }
    }

    return '';
}

function resolveEbayOrigin(...values) {
    for (const value of values) {
        const raw = String(value || '').trim();
        if (!raw) {
            continue;
        }

        try {
            const parsed = new URL(raw);
            if (/ebay\./i.test(parsed.hostname)) {
                return `${parsed.protocol}//${parsed.host}`;
            }
        } catch {
            // ignore non-url values
        }
    }

    return 'https://www.ebay.com';
}

function normalizeEbayItemUrl(value = '', pageUrl = '') {
    const raw = sanitizeUrl(value, pageUrl);
    if (!raw) {
        return '';
    }

    const itemId = extractEbayItemId(raw);
    if (itemId) {
        return `${resolveEbayOrigin(raw, pageUrl)}/itm/${itemId}`;
    }

    try {
        const parsed = new URL(raw);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return raw;
    }
}

function normalizeEbayRecord(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(
        record.originalSourceUrl || record.sourceUrl,
        pageUrl,
    );
    const sourceUrl = normalizeEbayItemUrl(incomingUrl, pageUrl);
    const itemId =
        extractEbayItemId(record.recordKey) ||
        extractEbayItemId(incomingUrl) ||
        extractEbayItemId(sourceUrl);
    const nextRecordKey = itemId
        ? `itm:${itemId}`
        : normalizeRecordKey(record.recordKey, sourceUrl || incomingUrl);

    return {
        ...record,
        title: sanitizeText(record.title),
        subtitle: sanitizeText(record.subtitle),
        shopName: sanitizeText(record.shopName),
        badgeText: sanitizeText(record.badgeText),
        sourceUrl: sourceUrl || record.sourceUrl || '',
        ...(incomingUrl && sourceUrl && incomingUrl !== sourceUrl
            ? { originalSourceUrl: incomingUrl }
            : {}),
        ...(itemId ? { itemId } : {}),
        recordKey: nextRecordKey,
    };
}

function slugifyEbayText(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function buildEbaySearchUrl(keyword = '') {
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}`;
}

function buildEbaySuggestionApiUrl(keyword = '') {
    const url = new URL(EBAY_AUTOSUGGEST_ENDPOINT);
    url.searchParams.set('kwd', keyword);
    url.searchParams.set('_jgr', '1');
    url.searchParams.set('sId', '0');
    url.searchParams.set('_ex_kw', keyword);
    return url.toString();
}

function parseEbayAutosuggestPayload(rawText = '') {
    const matched = String(rawText || '').match(/_do\(([\s\S]+)\)\s*$/);
    if (!matched?.[1]) {
        return [];
    }

    try {
        const parsed = JSON.parse(matched[1]);
        return Array.isArray(parsed?.res?.sug)
            ? parsed.res.sug
            : [];
    } catch {
        return [];
    }
}

async function fetchEbaySuggestions(keyword = '') {
    const response = await fetch(buildEbaySuggestionApiUrl(keyword), {
        headers: EBAY_HTTP_HEADERS,
    });
    if (!response.ok) {
        throw new Error(`eBay 联想词接口请求失败: ${response.status}`);
    }

    const suggestions = parseEbayAutosuggestPayload(await response.text());
    return suggestions.map((value, index) => ({
        value: sanitizeText(value),
        rank: index + 1,
        source: 'api',
        suggestionType: 'KEYWORD',
    })).filter((item) => item.value);
}

async function extractEbaySuggestionTextsFromPage(page) {
    return page.evaluate(() => {
        const selectors = [
            'li[role="option"]',
            'ul[role="listbox"] li',
            '.ghAC__suggestion',
            '.ui-autocomplete__row',
        ];
        const result = [];
        const seen = new Set();

        const push = (value) => {
            const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
            if (!text || text.length > 120 || seen.has(text)) {
                return;
            }
            seen.add(text);
            result.push(text);
        };

        selectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((node) => {
                push(node.getAttribute?.('aria-label') || node.textContent || '');
            });
        });

        return result.slice(0, 20);
    });
}

async function collectEbaySuggestionUi(context, keyword = '') {
    const { page, runtime, taskConfig } = context;
    const snapshotStage = `ebay-suggestions-${slugifyEbayText(keyword) || 'keyword'}`;

    try {
        const prepareResult = await prepareCollectionPage(page, runtime, {
            url: 'https://www.ebay.com/',
            timeoutMs: Number(taskConfig?.timeoutMs) || 45_000,
            blockedStage: `${snapshotStage}-blocked`,
            waitSelectors: ['#gh-ac', 'input[type="text"][name="_nkw"]'],
        });

        if (prepareResult.blocked) {
            return {
                status: 'blocked',
                suggestions: [],
                risk: prepareResult.risk || null,
            };
        }

        const inputLocator = page.locator('#gh-ac, input[type="text"][name="_nkw"]').first();
        await inputLocator.click({ timeout: 5_000 }).catch(() => {});
        await inputLocator.fill('').catch(() => {});
        await inputLocator.fill(keyword, { timeout: 10_000 });
        await page.waitForTimeout(1_200);

        const suggestions = await extractEbaySuggestionTextsFromPage(page);
        const snapshot = await captureScreenshot(
            page,
            runtime.snapshotDir,
            snapshotStage,
            runtime.snapshots,
            runtime.captureSnapshots === true,
        );

        return {
            status: suggestions.length > 0 ? 'success' : 'empty',
            suggestions,
            snapshotPath: snapshot?.path || '',
        };
    } catch (error) {
        return {
            status: 'failed',
            suggestions: [],
            error: error?.message || String(error),
        };
    }
}

function mergeEbaySuggestionCandidates(apiSuggestions = [], uiSuggestions = []) {
    const result = [];
    const seen = new Set();
    const push = (value, rank, source) => {
        const text = sanitizeText(value);
        const key = text.toLowerCase();
        if (!text || seen.has(key)) {
            return;
        }
        seen.add(key);
        result.push({
            value: text,
            rank,
            source,
            suggestionType: 'KEYWORD',
        });
    };

    apiSuggestions.forEach((item, index) => {
        push(item?.value || item, Number(item?.rank) || index + 1, 'api');
    });
    uiSuggestions.forEach((item, index) => {
        push(item, apiSuggestions.length + index + 1, 'ui');
    });

    return result;
}

function buildEbaySuggestionRecord(candidate = {}, seedKeyword = '') {
    const title = sanitizeText(candidate?.value);
    return {
        recordKey: `ebay-suggestion:${slugifyEbayText(seedKeyword) || 'seed'}:${slugifyEbayText(title) || 'candidate'}`,
        title,
        subtitle: `eBay | 种子词: ${seedKeyword}`,
        priceText: '',
        shopName: '',
        badgeText: sanitizeText(candidate?.suggestionType || 'KEYWORD'),
        sourceUrl: buildEbaySearchUrl(title),
        imageUrl: '',
        cardText: `${seedKeyword} -> ${title}`.slice(0, 500),
        capturedAt: new Date().toISOString(),
        sourceType: 'keyword_suggestion',
        signalType: 'search_suggestion',
        seedKeyword,
        marketplace: 'US',
        marketplaceLabel: '美国',
        rank: Number.isFinite(Number(candidate?.rank))
            ? Number(candidate.rank)
            : null,
        suggestionType: sanitizeText(candidate?.suggestionType || 'KEYWORD'),
        suggestionSource: sanitizeText(candidate?.source || 'api'),
    };
}

async function collectEbaySearchSuggestions(context) {
    const { taskConfig, runtime } = context;
    const keywords = buildKeywordList(taskConfig?.configData || {});
    if (!keywords.length) {
        throw new Error('search_suggestions 场景缺少 keyword/keywords');
    }

    const maxItems = Math.max(1, Math.min(100, Number(taskConfig?.configData?.maxItems) || 20));
    const records = [];
    const keywordSummaries = [];

    for (const keyword of keywords) {
        if (records.length >= maxItems) {
            break;
        }

        let apiSuggestions = [];
        let apiError = '';
        try {
            apiSuggestions = await fetchEbaySuggestions(keyword);
        } catch (error) {
            apiError = error?.message || String(error);
        }

        let uiResult = {
            status: runtime.captureSnapshots === true ? 'not_run' : 'disabled',
            suggestions: [],
            snapshotPath: '',
            risk: null,
            error: '',
        };

        if (runtime.captureSnapshots === true || apiSuggestions.length === 0) {
            uiResult = await collectEbaySuggestionUi(context, keyword);
        }

        const merged = mergeEbaySuggestionCandidates(apiSuggestions, uiResult.suggestions);
        merged
            .slice(0, Math.max(0, maxItems - records.length))
            .forEach((candidate) => {
                records.push(buildEbaySuggestionRecord(candidate, keyword));
            });

        keywordSummaries.push({
            keyword,
            apiSuggestionCount: apiSuggestions.length,
            uiSuggestionCount: uiResult.suggestions.length,
            mergedSuggestionCount: merged.length,
            uiStatus: uiResult.status,
            uiRisk: uiResult.risk || null,
            uiError: uiResult.error || null,
            snapshotPath: uiResult.snapshotPath || '',
            apiError: apiError || null,
        });
    }

    return {
        status: records.length > 0 ? 'success' : 'failed',
        message: records.length > 0 ? 'eBay 搜索联想词采集完成' : 'eBay 未返回有效联想词',
        records,
        summary: {
            keywords,
            marketplace: 'US',
            marketplaceLabel: '美国',
            recordsCount: records.length,
            keywordSummaries,
        },
    };
}

const ebayPlatform = {
    platform: 'ebay',
    label: 'eBay',
    supportedScenes: [...DEFAULT_SUPPORTED_SCENES, 'search_suggestions'],
    search: ebaySearchScene,
    productDetail: ebayProductDetailScene,
    shopHotProducts: ebayShopHotProductsScene,
    verification: {
        search: 'heuristic',
        product_detail: 'heuristic',
        shop_hot_products: 'heuristic',
        search_suggestions: 'verified',
    },
    customTaskTypeExecutors: {
        'ebay.search_suggestions': collectEbaySearchSuggestions,
    },
    hooks: {
        async normalizeRecord(context) {
            return normalizeEbayRecord(
                context.record,
                context.pageUrl || context.page?.url?.() || '',
            );
        },
    },
    capability: buildPlatformCapability({
        regions: ['global'],
        status: 'heuristic',
        access: {
            login: 'none',
            captcha: 'possible',
            antiBot: 'medium',
            notes: ['eBay 大部分公开页面可访问，但高频列表翻页和详情采样时仍可能触发风险限制。'],
        },
        overview:
            'eBay 已接入独立平台模块，优先覆盖搜索、商品详情、店铺/卖家商品列表三类核心页面。',
        notes: [
            '搜索页和店铺页沿用列表抽取公共流程，详情页补充了 eBay Evo 页面常见语义选择器。',
            '当前以启发式可用为主，后续可以继续补更多卖家、物流、规格等字段。',
        ],
        moduleDir: 'src/ecom-collect/platforms/ebay',
        selectorFile: 'src/ecom-collect/platforms/ebay/selectors.js',
        readmeFile: 'src/ecom-collect/platforms/ebay/README.md',
        maintenanceNotes: [
            '搜索结果优先依赖 `li.s-item` 与 `/itm/` 链接，不要把逻辑绑死在广告或推荐卡片容器上。',
            '详情页优先使用 `data-testid` 和 `x-*` 语义模块，类名变化时先查 Evo 主模块再补候选选择器。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                recordFieldsExtra: EBAY_PRODUCT_RECORD_FIELDS_EXTRA,
                access: {
                    login: 'none',
                    captcha: 'possible',
                    antiBot: 'medium',
                    notes: ['搜索页主要风险来自高频翻页和地区化结果差异。'],
                },
                keywordPlaceholder: '例如：wireless earbuds',
                keywordsPlaceholder: '一行一个关键词，适合按品类分批跑',
                overview: '进入 eBay 搜索结果页，提取商品卡片标题、价格、卖家等原始数据。',
                notes: [
                    '列表记录会尽量规范化为 eBay item canonical URL，减少追踪参数污染。',
                ],
                examples: [
                    {
                        title: 'eBay 搜索采集',
                        payload: {
                            platform: 'ebay',
                            collectScene: 'search',
                            configData: {
                                keyword: 'wireless earbuds',
                                maxPages: 2,
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
            buildSearchSuggestionsSceneCapability({
                verification: 'verified',
                availability: 'available',
                recordFieldsExtra: EBAY_SUGGESTION_RECORD_FIELDS_EXTRA,
                access: {
                    login: 'none',
                    captcha: 'none',
                    antiBot: 'low',
                    notes: ['联想词走公开 autosuggest 接口，适合低风险探词。'],
                },
                keywordPlaceholder: '例如：wireless earbuds',
                keywordsPlaceholder: '一行一个种子词，也支持逗号分隔',
                overview: '根据输入关键词抓取 eBay 公开搜索联想词，可作为热搜词和需求验证的轻量信号源。',
                notes: [
                    '优先走 eBay autosuggest 公共接口，减少页面波动影响。',
                    '开启截图时会补抓首页搜索下拉，方便人工核验真实联想结果。',
                ],
                examples: [
                    {
                        title: 'eBay 搜索联想词采集',
                        payload: {
                            platform: 'ebay',
                            collectScene: 'search_suggestions',
                            configData: {
                                keyword: 'wireless earbuds',
                                maxItems: 20,
                                captureSnapshots: false,
                            },
                        },
                    },
                ],
            }),
            buildProductDetailSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                recordFieldsExtra: EBAY_PRODUCT_RECORD_FIELDS_EXTRA,
                access: {
                    login: 'none',
                    captcha: 'possible',
                    antiBot: 'medium',
                    notes: ['详情页通常可抓，但部分商品会有地区、年龄或卖家限制。'],
                },
                targetUrlPlaceholder: '填写 eBay 商品详情页链接',
                overview: '打开 eBay 商品详情页，提取标题、价格、图集、卖家与描述相关原始信息。',
                notes: [
                    '当前详情抽取偏保真，后续适合继续扩充运输、退货、规格摘要等字段。',
                ],
                examples: [
                    {
                        title: 'eBay 商品详情采集',
                        payload: {
                            platform: 'ebay',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.ebay.com/itm/143949885566',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'heuristic',
                availability: 'heuristic',
                recordFieldsExtra: EBAY_PRODUCT_RECORD_FIELDS_EXTRA,
                access: {
                    login: 'none',
                    captcha: 'possible',
                    antiBot: 'medium',
                    notes: ['卖家商品页适合小批量验证，过快翻页时容易进入访问限制。'],
                },
                targetUrlPlaceholder: '填写 eBay 店铺商品页、卖家商品页或类目列表链接',
                overview: '打开 eBay 卖家或类目商品列表页，提取热门商品卡片原始数据。',
                notes: [
                    '适合先从固定卖家链接跑，后续再逐步补充不同列表形态的兼容性。',
                ],
                examples: [
                    {
                        title: 'eBay 店铺热门商品采集',
                        payload: {
                            platform: 'ebay',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://www.ebay.com/sch/i.html?_ssn=bestbuy&_oac=1',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default ebayPlatform;

import {
    buildPlatformCapability,
    buildSelectField,
    buildTrendKeywordsSceneCapability,
    createOutputField,
} from '../shared.js';

const GOOGLE_TRENDS_DEFAULT_GEO = 'US';
const GOOGLE_TRENDS_FEED_URL = 'https://trends.google.com/trending/rss';
const GOOGLE_TRENDS_PAGE_URL = 'https://trends.google.com/trending';
const GOOGLE_TRENDS_HTTP_HEADERS = {
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
};

const GOOGLE_TRENDS_GEO_OPTIONS = [
    { label: '美国', value: 'US', description: '适合跨境电商北美趋势观察。' },
    { label: '英国', value: 'GB', description: '适合英国站点趋势观察。' },
    { label: '德国', value: 'DE', description: '适合德语市场趋势观察。' },
    { label: '法国', value: 'FR', description: '适合法国市场趋势观察。' },
    { label: '日本', value: 'JP', description: '适合日本站点趋势观察。' },
    { label: '巴西', value: 'BR', description: '适合拉美市场趋势观察。' },
    { label: '印度', value: 'IN', description: '适合高流量英语市场趋势观察。' },
];

const GOOGLE_TRENDS_RECORD_FIELDS_EXTRA = [
    createOutputField('sourceType', '来源类型', {
        description: '当前记录属于趋势信号。',
        stability: 'platform',
        examples: ['trend_signal'],
    }),
    createOutputField('imageUrl', '趋势配图', {
        description: '趋势条目或相关新闻首图。',
        valueType: 'url',
        stability: 'platform',
    }),
    createOutputField('imageUrls[]', '趋势图片列表', {
        description: '趋势条目和相关新闻中提取到的图片列表。',
        valueType: 'array',
        stability: 'platform',
    }),
    createOutputField('pictureSource', '图片来源', {
        description: '趋势图片来源站点。',
        stability: 'platform',
    }),
    createOutputField('cardText', '卡片摘要文本', {
        description: '为轻量搜索和 AI 输入准备的短文本摘要。',
        valueType: 'text',
        stability: 'platform',
    }),
    createOutputField('descriptionText', '描述文本', {
        description: '趋势描述与相关新闻摘要拼接后的文本。',
        valueType: 'text',
        stability: 'platform',
    }),
    createOutputField('newsItems[]', '关联新闻对象', {
        description: '相关新闻对象列表，通常含标题、来源、链接、摘要、图片。',
        valueType: 'array',
        stability: 'platform',
    }),
];

function decodeXmlEntities(value = '') {
    const entityMap = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
    };

    return String(value || '')
        .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1')
        .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (matched, entity) => {
            const normalizedEntity = String(entity || '').toLowerCase();
            if (entityMap[normalizedEntity]) {
                return entityMap[normalizedEntity];
            }

            if (normalizedEntity.startsWith('#x')) {
                const codePoint = Number.parseInt(normalizedEntity.slice(2), 16);
                return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : matched;
            }

            if (normalizedEntity.startsWith('#')) {
                const codePoint = Number.parseInt(normalizedEntity.slice(1), 10);
                return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : matched;
            }

            return matched;
        })
        .replace(/\s+/g, ' ')
        .trim();
}

function stripHtmlTags(value = '') {
    return decodeXmlEntities(String(value || '').replace(/<[^>]+>/g, ' '));
}

function escapeTagName(tagName = '') {
    return String(tagName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:/g, '\\:');
}

function extractTagValue(block = '', tagName = '') {
    const escapedTagName = escapeTagName(tagName);
    const matched = String(block || '').match(
        new RegExp(`<${escapedTagName}[^>]*>([\\s\\S]*?)<\\/${escapedTagName}>`, 'i'),
    );

    return stripHtmlTags(matched?.[1] || '');
}

function extractTagBlocks(block = '', tagName = '') {
    const escapedTagName = escapeTagName(tagName);
    const matcher = new RegExp(`<${escapedTagName}[^>]*>([\\s\\S]*?)<\\/${escapedTagName}>`, 'gi');
    const blocks = [];

    let matched = matcher.exec(String(block || ''));
    while (matched) {
        blocks.push(matched[1] || '');
        matched = matcher.exec(String(block || ''));
    }

    return blocks;
}

function normalizeGeo(value = '') {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized || GOOGLE_TRENDS_DEFAULT_GEO;
}

function slugifyText(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function buildExploreUrl(geo = GOOGLE_TRENDS_DEFAULT_GEO, keyword = '') {
    return `https://trends.google.com/trends/explore?geo=${encodeURIComponent(geo)}&q=${encodeURIComponent(keyword)}`;
}

function buildFeedUrl(geo = GOOGLE_TRENDS_DEFAULT_GEO) {
    return `${GOOGLE_TRENDS_FEED_URL}?geo=${encodeURIComponent(geo)}`;
}

function buildOverviewUrl(geo = GOOGLE_TRENDS_DEFAULT_GEO) {
    return `${GOOGLE_TRENDS_PAGE_URL}?geo=${encodeURIComponent(geo)}`;
}

async function fetchGoogleTrendsFeed(geo = GOOGLE_TRENDS_DEFAULT_GEO) {
    const response = await fetch(buildFeedUrl(geo), {
        headers: GOOGLE_TRENDS_HTTP_HEADERS,
    });

    if (!response.ok) {
        throw new Error(`Google Trends RSS 请求失败: ${response.status}`);
    }

    return {
        geo,
        url: response.url || buildFeedUrl(geo),
        xml: await response.text(),
    };
}

function parseGoogleTrendsFeed(xml = '') {
    return extractTagBlocks(xml, 'item')
        .map((itemBlock, index) => {
            const newsItems = extractTagBlocks(itemBlock, 'ht:news_item')
                .map((newsBlock) => ({
                    title: extractTagValue(newsBlock, 'ht:news_item_title'),
                    snippet: extractTagValue(newsBlock, 'ht:news_item_snippet'),
                    url: extractTagValue(newsBlock, 'ht:news_item_url'),
                    picture: extractTagValue(newsBlock, 'ht:news_item_picture'),
                    source: extractTagValue(newsBlock, 'ht:news_item_source'),
                }))
                .filter((item) => item.title || item.url);

            const title = extractTagValue(itemBlock, 'title');
            const approxTraffic = extractTagValue(itemBlock, 'ht:approx_traffic');
            const pubDate = extractTagValue(itemBlock, 'pubDate');
            const picture = extractTagValue(itemBlock, 'ht:picture');
            const pictureSource = extractTagValue(itemBlock, 'ht:picture_source');
            const description = extractTagValue(itemBlock, 'description');

            return {
                rank: index + 1,
                title,
                approxTraffic,
                pubDate,
                picture,
                pictureSource,
                description,
                newsItems,
            };
        })
        .filter((item) => item.title);
}

function buildGoogleTrendsRecord(item = {}, geo = GOOGLE_TRENDS_DEFAULT_GEO) {
    const newsTitles = item.newsItems
        .map((newsItem) => String(newsItem?.title || '').trim())
        .filter(Boolean);
    const newsSources = Array.from(
        new Set(
            item.newsItems
                .map((newsItem) => String(newsItem?.source || '').trim())
                .filter(Boolean),
        ),
    );
    const imageUrls = Array.from(
        new Set(
            [item.picture, ...item.newsItems.map((newsItem) => newsItem?.picture)]
                .map((value) => String(value || '').trim())
                .filter(Boolean),
        ),
    );
    const descriptionParts = [
        item.description,
        newsTitles.length ? `相关新闻：${newsTitles.join('；')}` : '',
        newsSources.length ? `来源：${newsSources.join('、')}` : '',
    ].filter(Boolean);
    const dateText = String(item.pubDate || '').trim();
    const recordKey = [
        'google-trends',
        geo,
        dateText.slice(0, 16).replace(/[^0-9a-zA-Z]+/g, ''),
        slugifyText(item.title) || `rank-${item.rank || 0}`,
    ].filter(Boolean).join(':');

    return {
        recordKey,
        title: item.title,
        subtitle: item.approxTraffic ? `Approx. traffic ${item.approxTraffic}` : '',
        priceText: '',
        shopName: newsSources[0] || item.pictureSource || '',
        badgeText: item.approxTraffic || '',
        sourceUrl: buildExploreUrl(geo, item.title),
        imageUrl: imageUrls[0] || '',
        imageUrls,
        cardText: `${item.title} ${item.approxTraffic || ''} ${newsTitles.join(' ')}`.trim().slice(0, 500),
        descriptionText: descriptionParts.join('\n').slice(0, 4000),
        capturedAt: dateText || new Date().toISOString(),
        sourceType: 'trend_signal',
        signalType: 'daily_search_trend',
        geo,
        rank: item.rank || null,
        approxTraffic: item.approxTraffic || '',
        pictureSource: item.pictureSource || '',
        pubDate: dateText || '',
        newsItems: item.newsItems,
        newsTitles,
        newsSources,
    };
}

async function captureOverviewSnapshot(context, geo) {
    const { page, runtime, taskConfig, helpers } = context;
    const overviewUrl = buildOverviewUrl(geo);

    try {
        const prepareResult = await helpers.prepareCollectionPage(page, runtime, {
            url: overviewUrl,
            timeoutMs: Number(taskConfig?.timeoutMs) || 45_000,
            blockedStage: `google-trends-${geo}-blocked`,
            waitSelectors: ['main', 'table', 'tbody', 'tr'],
        });

        if (prepareResult.blocked) {
            return {
                pageUrl: page.url(),
                status: 'blocked',
                risk: prepareResult.risk || null,
            };
        }

        const snapshot = await helpers.captureScreenshot(
            page,
            runtime.snapshotDir,
            `google-trends-${geo}-overview`,
            runtime.snapshots,
            runtime.captureSnapshots === true,
        );

        return {
            pageUrl: page.url() || overviewUrl,
            status: snapshot ? 'captured' : 'capture_failed',
            detectedSelector: prepareResult.detectedSelector || '',
            snapshotPath: snapshot?.path || '',
        };
    } catch (error) {
        return {
            pageUrl: overviewUrl,
            status: 'failed',
            error: error?.message || String(error),
        };
    }
}

async function collectGoogleTrendsTrendKeywords(context) {
    const { taskConfig, runtime } = context;
    const configData = taskConfig?.configData || {};
    const geo = normalizeGeo(configData.geo);
    const maxItems = Math.max(1, Math.min(100, Number(configData.maxItems) || 20));
    const feedResult = await fetchGoogleTrendsFeed(geo);
    const feedItems = parseGoogleTrendsFeed(feedResult.xml);
    const records = feedItems
        .slice(0, maxItems)
        .map((item) => buildGoogleTrendsRecord(item, geo));

    const pageCapture =
        runtime.captureSnapshots === true
            ? await captureOverviewSnapshot(context, geo)
            : {
                pageUrl: buildOverviewUrl(geo),
                status: 'disabled',
            };

    return {
        status: records.length > 0 ? 'success' : 'failed',
        message: records.length > 0 ? 'Google Trends 趋势热词采集完成' : 'Google Trends 未返回有效趋势热词',
        records,
        summary: {
            geo,
            sourceType: 'trend_signal',
            signalType: 'daily_search_trend',
            feedUrl: feedResult.url,
            overviewUrl: buildOverviewUrl(geo),
            recordsCount: records.length,
            pageCapture,
        },
    };
}

const googleTrendsPlatform = {
    platform: 'google_trends',
    label: 'Google Trends',
    supportedScenes: ['trend_keywords'],
    verification: {
        trend_keywords: 'verified',
    },
    customTaskTypeExecutors: {
        'google_trends.trend_keywords': collectGoogleTrendsTrendKeywords,
    },
    capability: buildPlatformCapability({
        regions: ['global'],
        status: 'available',
        access: {
            login: 'none',
            captcha: 'none',
            antiBot: 'low',
            notes: ['当前优先走公开 RSS 源，适合作为低风险、可持续的趋势信号平台。'],
        },
        overview:
            'Google Trends 通过公开 RSS 趋势源采集热搜词，并保留新闻线索、趋势排名和预估热度，适合作为选品前置信号。',
        notes: [
            '当前优先走 RSS 数据源，减少页面脚本波动和接口 429 对稳定性的影响。',
            '更适合做需求趋势洞察，不直接替代商品详情采集。',
        ],
        moduleDir: 'src/ecom-collect/platforms/google_trends',
        readmeFile: 'src/ecom-collect/platforms/google_trends/README.md',
        maintenanceNotes: [
            '如果 RSS 字段变动，优先调整本模块内的 XML 解析器，不要改通用采集流程。',
            '趋势词属于市场信号，后续 AI 分析时建议与商品数据分层使用。',
        ],
        scenes: [
            buildTrendKeywordsSceneCapability({
                verification: 'verified',
                availability: 'available',
                recordFieldsExtra: GOOGLE_TRENDS_RECORD_FIELDS_EXTRA,
                access: {
                    login: 'none',
                    captcha: 'none',
                    antiBot: 'low',
                    notes: ['趋势词场景不依赖登录态，适合优先用于多平台对比前的需求信号采集。'],
                },
                extraFields: [
                    buildSelectField('geo', '地区', {
                        required: true,
                        defaultValue: GOOGLE_TRENDS_DEFAULT_GEO,
                        description: 'Google Trends 地区代码，不同地区会返回不同热词榜。',
                        options: GOOGLE_TRENDS_GEO_OPTIONS,
                    }),
                ],
                overview:
                    '采集 Google Trends 当前地区热搜词，并保留预估流量、相关新闻和趋势链接。',
                notes: [
                    '结果以趋势词为主，适合给 AI 提供热度线索。',
                    '如果需要更细的平台商品验证，可将趋势词再投喂到 Amazon、1688 等平台继续采集。',
                ],
                examples: [
                    {
                        title: 'Google Trends 热搜词采集',
                        payload: {
                            platform: 'google_trends',
                            collectScene: 'trend_keywords',
                            configData: {
                                geo: 'US',
                                maxItems: 20,
                                captureSnapshots: false,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default googleTrendsPlatform;

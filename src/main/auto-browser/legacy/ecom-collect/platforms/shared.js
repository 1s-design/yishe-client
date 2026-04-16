export const DEFAULT_SUPPORTED_SCENES = ['search', 'product_detail', 'shop_hot_products'];

export const ECOM_CAPABILITY_STATUS_META = {
    available: {
        label: '可用',
        runnable: true,
    },
    partial: {
        label: '部分可用',
        runnable: true,
    },
    heuristic: {
        label: '启发式可用',
        runnable: true,
    },
    blocked: {
        label: '受限',
        runnable: false,
    },
    unsupported: {
        label: '未实现',
        runnable: false,
    },
};

export const ECOM_VERIFICATION_STATUS_META = {
    verified: '已验证',
    heuristic: '启发式',
    blocked: '受限',
    planned: '待验证',
    unsupported: '未实现',
};

export const ECOM_ACCESS_LOGIN_META = {
    unknown: {
        label: '登录要求待确认',
        requiresLogin: false,
    },
    none: {
        label: '无需登录',
        requiresLogin: false,
    },
    optional: {
        label: '建议登录',
        requiresLogin: false,
    },
    required: {
        label: '需要登录',
        requiresLogin: true,
    },
};

export const ECOM_ACCESS_CAPTCHA_META = {
    unknown: {
        label: '验证码风险待确认',
    },
    none: {
        label: '无明显验证码风险',
    },
    possible: {
        label: '偶发验证码',
    },
    likely: {
        label: '高概率验证码',
    },
    blocking: {
        label: '当前会被验证码拦截',
    },
};

export const ECOM_ACCESS_ANTI_BOT_META = {
    unknown: {
        label: '风控强度待确认',
    },
    low: {
        label: '低风控',
    },
    medium: {
        label: '中风控',
    },
    high: {
        label: '高风控',
    },
    blocking: {
        label: '强风控阻断',
    },
};

const SCENE_MAP = {
    search: {
        value: 'search',
        label: '关键词搜索',
        description: '根据关键词进入平台前台搜索页，提取商品卡片原始数据。',
    },
    product_detail: {
        value: 'product_detail',
        label: '商品详情',
        description: '打开指定商品详情页，抓取详情原始信息与页面快照。',
    },
    shop_hot_products: {
        value: 'shop_hot_products',
        label: '店铺热门商品',
        description: '打开店铺或榜单类页面，提取热门商品卡片原始数据。',
    },
    search_suggestions: {
        value: 'search_suggestions',
        label: '搜索联想词',
        description: '根据输入关键词抓取平台公开联想词、热搜词或补全建议。',
    },
    trend_keywords: {
        value: 'trend_keywords',
        label: '趋势热词',
        description: '抓取平台公开趋势榜、热搜榜或趋势关键词原始数据。',
    },
};

function cloneValue(input) {
    if (input === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(input));
}

function mergeArray(input = [], fallback = []) {
    const source = Array.isArray(input) ? input : fallback;
    return source
        .map((item) => {
            if (item === undefined || item === null) {
                return '';
            }
            return typeof item === 'string' ? item.trim() : item;
        })
        .filter(Boolean);
}

export function createOutputField(key, label, overrides = {}) {
    return {
        key,
        label,
        description: '',
        valueType: 'string',
        stability: 'core',
        examples: undefined,
        ...cloneValue(overrides),
    };
}

export function buildRunPackageOutputFields(overrides = {}) {
    return [
        createOutputField('packageType', '结果包类型', {
            description: '固定为 run_result，用于标识这是一条按运行聚合的结果包。',
            examples: ['run_result'],
        }),
        createOutputField('taskId', '任务 ID', {
            description: '对应采集任务主键。',
            examples: ['task_xxx'],
        }),
        createOutputField('runId', '运行 ID', {
            description: '对应某次具体执行的运行主键。',
            examples: ['run_xxx'],
        }),
        createOutputField('platform', '平台标识', {
            description: '平台唯一标识，例如 amazon / temu / google_trends。',
            examples: ['amazon'],
        }),
        createOutputField('taskType', '任务类型', {
            description: '当前运行执行的 taskType。',
            examples: ['amazon.search'],
        }),
        createOutputField('status', '运行状态', {
            description: 'success / failed / skipped 等运行结果状态。',
            examples: ['success'],
        }),
        createOutputField('message', '结果消息', {
            description: '运行结果摘要信息。',
            examples: ['采集执行成功'],
        }),
        createOutputField('capturedAt', '采集时间', {
            description: '结果包最终采集时间。',
            valueType: 'datetime',
            examples: ['2026-04-12T12:00:00.000Z'],
        }),
        createOutputField('summary', '摘要对象', {
            description: '聚合后的摘要对象，通常包含 message / recordsCount / snapshots 等字段。',
            valueType: 'object',
            stability: 'optional',
        }),
        createOutputField('records[]', '记录数组', {
            description: '本次运行返回的明细记录列表，真正的业务数据在这一层展开。',
            valueType: 'array',
        }),
        createOutputField('snapshots[]', '快照数组', {
            description: '截图或快照引用列表。',
            valueType: 'array',
            stability: 'optional',
        }),
        createOutputField('debugMeta', '调试信息', {
            description: '调试辅助信息，不建议作为稳定业务字段依赖。',
            valueType: 'object',
            stability: 'platform',
        }),
        ...(Array.isArray(overrides.extraFields) ? overrides.extraFields : []),
    ];
}

export function buildProductListRecordFields(overrides = {}) {
    return [
        createOutputField('recordKey', '记录标识', {
            description: '单条记录的稳定主键，优先用于去重与追踪。',
            examples: ['amazon:B0XXXX'],
        }),
        createOutputField('title', '标题', {
            description: '商品标题或卡片主标题。',
            examples: ['Wireless Earbuds Bluetooth 5.4'],
        }),
        createOutputField('sourceUrl', '来源链接', {
            description: '商品详情页、列表页或原始来源链接。',
            valueType: 'url',
            examples: ['https://www.amazon.com/...'],
        }),
        createOutputField('imageUrl', '主图链接', {
            description: '主图链接。',
            valueType: 'url',
            stability: 'optional',
        }),
        createOutputField('priceText', '价格文本', {
            description: '原始价格文本，保留平台原样格式。',
            stability: 'optional',
            examples: ['$29.99'],
        }),
        createOutputField('shopName', '店铺/卖家', {
            description: '店铺名、卖家名或商家名。',
            stability: 'optional',
        }),
        createOutputField('badgeText', '标签文本', {
            description: '如销量、广告、热销、榜单等标签。',
            stability: 'optional',
        }),
        createOutputField('ratingText', '评分文本', {
            description: '评分或星级文本。',
            stability: 'optional',
        }),
        createOutputField('reviewCountText', '评论数文本', {
            description: '评论量、评价量等原始文本。',
            stability: 'optional',
        }),
        createOutputField('keyword', '触发关键词', {
            description: '本条记录所属的搜索关键词。',
            stability: 'optional',
        }),
        createOutputField('pageNo', '页码', {
            description: '该记录来自第几页。',
            valueType: 'number',
            stability: 'optional',
        }),
        createOutputField('capturedAt', '记录采集时间', {
            description: '该记录抓取时的时间。',
            valueType: 'datetime',
            stability: 'optional',
        }),
        createOutputField('listingData', '列表原始对象', {
            description: '保留平台列表页抽取时的原始结构，便于后续继续扩展。',
            valueType: 'object',
            stability: 'platform',
        }),
        ...(Array.isArray(overrides.extraFields) ? overrides.extraFields : []),
    ];
}

export function buildProductDetailRecordFields(overrides = {}) {
    return [
        createOutputField('recordKey', '记录标识', {
            description: '单条详情记录的稳定主键。',
        }),
        createOutputField('title', '标题', {
            description: '商品详情标题。',
        }),
        createOutputField('sourceUrl', '来源链接', {
            description: '详情页链接。',
            valueType: 'url',
        }),
        createOutputField('imageUrl', '主图链接', {
            description: '详情页主图链接。',
            valueType: 'url',
            stability: 'optional',
        }),
        createOutputField('imageUrls[]', '图片列表', {
            description: '详情页图片列表。',
            valueType: 'array',
            stability: 'optional',
        }),
        createOutputField('priceText', '价格文本', {
            description: '详情页价格文本。',
            stability: 'optional',
        }),
        createOutputField('originalPriceText', '原价文本', {
            description: '原价、划线价等文本。',
            stability: 'optional',
        }),
        createOutputField('shopName', '店铺/卖家', {
            description: '店铺名、卖家名或商家名。',
            stability: 'optional',
        }),
        createOutputField('brand', '品牌', {
            description: '品牌字段。',
            stability: 'optional',
        }),
        createOutputField('descriptionText', '描述文本', {
            description: '详情正文摘要或长描述。',
            valueType: 'text',
            stability: 'optional',
        }),
        createOutputField('bulletPoints[]', '卖点列表', {
            description: '卖点、要点、亮点等列表。',
            valueType: 'array',
            stability: 'optional',
        }),
        createOutputField('specPairs[]', '规格键值对', {
            description: '规格或参数列表。',
            valueType: 'array',
            stability: 'optional',
        }),
        createOutputField('breadcrumb', '面包屑', {
            description: '类目路径或面包屑。',
            stability: 'optional',
        }),
        createOutputField('availabilityText', '库存/可售文本', {
            description: '库存、是否可售等文本。',
            stability: 'optional',
        }),
        createOutputField('detailData', '详情原始对象', {
            description: '保留平台详情页抽取的原始结构，便于后续继续扩展。',
            valueType: 'object',
            stability: 'platform',
        }),
        ...(Array.isArray(overrides.extraFields) ? overrides.extraFields : []),
    ];
}

export function buildSuggestionRecordFields(overrides = {}) {
    return [
        createOutputField('recordKey', '记录标识', {
            description: '联想词或补全建议的唯一键。',
        }),
        createOutputField('title', '联想词', {
            description: '联想词、热搜词或补全建议文本。',
        }),
        createOutputField('keyword', '输入关键词', {
            description: '本次触发联想的输入关键词。',
            stability: 'optional',
        }),
        createOutputField('seedKeyword', '种子词', {
            description: '原始主关键词。',
            stability: 'optional',
        }),
        createOutputField('suggestionType', '建议类型', {
            description: '联想词类型、来源类型。',
            stability: 'optional',
        }),
        createOutputField('rank', '排序/序号', {
            description: '联想词排序。',
            valueType: 'number',
            stability: 'optional',
        }),
        createOutputField('sourceUrl', '来源链接', {
            description: '联想词来源页或搜索链接。',
            valueType: 'url',
            stability: 'optional',
        }),
        createOutputField('capturedAt', '记录采集时间', {
            description: '记录采集时间。',
            valueType: 'datetime',
            stability: 'optional',
        }),
        ...(Array.isArray(overrides.extraFields) ? overrides.extraFields : []),
    ];
}

export function buildTrendRecordFields(overrides = {}) {
    return [
        createOutputField('recordKey', '记录标识', {
            description: '趋势热词记录唯一键。',
        }),
        createOutputField('title', '趋势词', {
            description: '热词、趋势词、榜单词。',
        }),
        createOutputField('sourceUrl', '来源链接', {
            description: '趋势词详情页或来源页链接。',
            valueType: 'url',
        }),
        createOutputField('rank', '排序', {
            description: '趋势排序或榜单位置。',
            valueType: 'number',
            stability: 'optional',
        }),
        createOutputField('approxTraffic', '热度文本', {
            description: '近似流量、热度、趋势强度等文本。',
            stability: 'optional',
        }),
        createOutputField('signalType', '信号类型', {
            description: '趋势信号类型，例如 daily_search_trend。',
            stability: 'optional',
        }),
        createOutputField('geo', '地区', {
            description: '地区或市场标识。',
            stability: 'optional',
        }),
        createOutputField('pubDate', '发布时间', {
            description: '原始发布时间。',
            valueType: 'datetime',
            stability: 'optional',
        }),
        createOutputField('newsTitles[]', '关联新闻标题', {
            description: '趋势词关联的新闻标题列表。',
            valueType: 'array',
            stability: 'optional',
        }),
        createOutputField('newsSources[]', '关联新闻来源', {
            description: '趋势词关联的新闻来源列表。',
            valueType: 'array',
            stability: 'optional',
        }),
        createOutputField('capturedAt', '记录采集时间', {
            description: '记录采集时间。',
            valueType: 'datetime',
            stability: 'optional',
        }),
        ...(Array.isArray(overrides.extraFields) ? overrides.extraFields : []),
    ];
}

export function createField(key, label, overrides = {}) {
    return {
        key,
        label,
        component: 'input',
        valueType: 'string',
        required: false,
        placeholder: '',
        description: '',
        defaultValue: undefined,
        rows: undefined,
        min: undefined,
        max: undefined,
        step: undefined,
        options: undefined,
        examples: undefined,
        ...cloneValue(overrides),
    };
}

export function buildKeywordField(overrides = {}) {
    return createField('keyword', '关键词', {
        placeholder: '例如：wireless earbuds',
        description: '单个主关键词，便于快速试跑。',
        examples: ['wireless earbuds'],
        ...overrides,
    });
}

export function buildKeywordsField(overrides = {}) {
    return createField('keywords', '关键词列表', {
        component: 'array-text',
        valueType: 'string[]',
        placeholder: '一行一个关键词，也支持逗号分隔',
        description: '多关键词批量执行时使用；会自动去重并去空。',
        rows: 4,
        ...overrides,
    });
}

export function buildTargetUrlField(overrides = {}) {
    return createField('targetUrl', '目标链接', {
        component: 'url',
        valueType: 'url',
        placeholder: 'https://example.com/item/123',
        description: '填写商品详情页、店铺页或榜单页链接。',
        required: true,
        ...overrides,
    });
}

export function buildMaxPagesField(overrides = {}) {
    return createField('maxPages', '最大页数', {
        component: 'input-number',
        valueType: 'integer',
        description: '搜索场景最多翻页数，建议小批量逐步验证。',
        defaultValue: 2,
        min: 1,
        max: 20,
        step: 1,
        ...overrides,
    });
}

export function buildMaxItemsField(overrides = {}) {
    return createField('maxItems', '最大记录数', {
        component: 'input-number',
        valueType: 'integer',
        description: '单次任务最多保存的记录条数。',
        defaultValue: 60,
        min: 1,
        max: 500,
        step: 1,
        ...overrides,
    });
}

export function buildSelectField(key, label, overrides = {}) {
    return createField(key, label, {
        component: 'select',
        valueType: 'string',
        options: [],
        ...overrides,
    });
}

export function buildJsonField(key, label, overrides = {}) {
    return createField(key, label, {
        component: 'json',
        valueType: 'json',
        rows: 6,
        ...overrides,
    });
}

export function buildSwitchField(key, label, overrides = {}) {
    return createField(key, label, {
        component: 'switch',
        valueType: 'boolean',
        ...overrides,
    });
}

export function buildCaptureSnapshotsField(overrides = {}) {
    return buildSwitchField('captureSnapshots', '执行截图', {
        description: '是否在采集过程中保存执行截图；默认关闭，开启后会额外保存列表页、详情页或异常页截图。',
        defaultValue: false,
        ...overrides,
    });
}

function normalizeExamplePayloads(examples = [], sceneValue = '') {
    return mergeArray(examples).map((item, index) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            return {
                title: item.title || `${sceneValue || 'scene'} 示例 ${index + 1}`,
                description: item.description || '',
                payload: cloneValue(item.payload || item.task || item.request || {}),
            };
        }

        return {
            title: `${sceneValue || 'scene'} 示例 ${index + 1}`,
            description: '',
            payload: cloneValue(item),
        };
    });
}

function normalizeMetaValue(value, meta, fallback = 'unknown') {
    const normalized = String(value || '').trim();
    if (normalized && meta[normalized]) {
        return normalized;
    }
    return fallback;
}

export function buildCapabilityAccess(overrides = {}) {
    const source =
        overrides && typeof overrides === 'object' && !Array.isArray(overrides)
            ? overrides
            : {};
    const notes = mergeArray(source.notes || source.accessNotes);
    const hasExplicitAccess =
        notes.length > 0 ||
        ['login', 'captcha', 'antiBot'].some((key) =>
            String(source[key] || '').trim(),
        );

    if (!hasExplicitAccess) {
        return undefined;
    }

    const login = normalizeMetaValue(source.login, ECOM_ACCESS_LOGIN_META);
    const captcha = normalizeMetaValue(source.captcha, ECOM_ACCESS_CAPTCHA_META);
    const antiBot = normalizeMetaValue(source.antiBot, ECOM_ACCESS_ANTI_BOT_META);

    return {
        login,
        loginLabel: ECOM_ACCESS_LOGIN_META[login].label,
        requiresLogin: ECOM_ACCESS_LOGIN_META[login].requiresLogin,
        canRunWithoutLogin: !ECOM_ACCESS_LOGIN_META[login].requiresLogin,
        captcha,
        captchaLabel: ECOM_ACCESS_CAPTCHA_META[captcha].label,
        antiBot,
        antiBotLabel: ECOM_ACCESS_ANTI_BOT_META[antiBot].label,
        notes,
    };
}

export function buildSceneCapability(baseScene, overrides = {}) {
    const status = String(overrides.availability || 'heuristic').trim() || 'heuristic';
    const statusMeta = ECOM_CAPABILITY_STATUS_META[status] || ECOM_CAPABILITY_STATUS_META.heuristic;
    const fields = Array.isArray(overrides.fields) ? overrides.fields.map((item) => cloneValue(item)) : [];

    return {
        value: baseScene.value,
        label: baseScene.label,
        description: overrides.description || baseScene.description || '',
        availability: status,
        availabilityLabel: statusMeta.label,
        runnable:
            overrides.runnable !== undefined
                ? !!overrides.runnable
                : statusMeta.runnable,
        verification: String(overrides.verification || 'planned').trim() || 'planned',
        verificationLabel:
            ECOM_VERIFICATION_STATUS_META[String(overrides.verification || 'planned').trim()] ||
            ECOM_VERIFICATION_STATUS_META.planned,
        reason: String(overrides.reason || '').trim() || null,
        access: buildCapabilityAccess(overrides.access || {
            login: overrides.login,
            captcha: overrides.captcha,
            antiBot: overrides.antiBot,
            accessNotes: overrides.accessNotes,
        }),
        fields,
        docs: {
            overview: String(overrides.overview || '').trim() || '',
            notes: mergeArray(overrides.notes),
            examples: normalizeExamplePayloads(overrides.examples, baseScene.value),
            packageFields: Array.isArray(overrides.packageFields)
                ? cloneValue(overrides.packageFields)
                : buildRunPackageOutputFields(),
            recordFields: Array.isArray(overrides.recordFields)
                ? cloneValue(overrides.recordFields)
                : [],
        },
    };
}

export function buildPlatformCapability(overrides = {}) {
    const scenes = Array.isArray(overrides.scenes) ? overrides.scenes.map((item) => cloneValue(item)) : [];
    const status = String(overrides.status || 'heuristic').trim() || 'heuristic';
    const statusMeta = ECOM_CAPABILITY_STATUS_META[status] || ECOM_CAPABILITY_STATUS_META.heuristic;

    return {
        regions: mergeArray(overrides.regions, ['global']),
        status,
        statusLabel: statusMeta.label,
        runnable:
            overrides.runnable !== undefined
                ? !!overrides.runnable
                : scenes.some((item) => item?.runnable !== false),
        reason: String(overrides.reason || '').trim() || null,
        access: buildCapabilityAccess(overrides.access || {
            login: overrides.login,
            captcha: overrides.captcha,
            antiBot: overrides.antiBot,
            accessNotes: overrides.accessNotes,
        }),
        docs: {
            overview: String(overrides.overview || '').trim() || '',
            notes: mergeArray(overrides.notes),
        },
        maintenance: {
            moduleDir: String(overrides.moduleDir || '').trim() || '',
            selectorFile: String(overrides.selectorFile || '').trim() || '',
            readmeFile: String(overrides.readmeFile || '').trim() || '',
            notes: mergeArray(overrides.maintenanceNotes),
        },
        scenes,
    };
}

export function buildSearchSceneCapability(overrides = {}) {
    return buildSceneCapability(SCENE_MAP.search, {
        recordFields: buildProductListRecordFields({
            extraFields: Array.isArray(overrides.recordFieldsExtra)
                ? overrides.recordFieldsExtra
                : [],
        }),
        fields: [
            buildKeywordField({
                required: true,
                placeholder: overrides.keywordPlaceholder || '例如：wireless earbuds',
            }),
            buildKeywordsField({
                placeholder: overrides.keywordsPlaceholder || '一行一个关键词，也支持逗号分隔',
            }),
            buildMaxPagesField({
                defaultValue:
                    overrides.defaultMaxPages !== undefined
                        ? overrides.defaultMaxPages
                        : 2,
            }),
            buildMaxItemsField({
                defaultValue:
                    overrides.defaultMaxItems !== undefined
                        ? overrides.defaultMaxItems
                        : 60,
            }),
            buildCaptureSnapshotsField(),
            ...(Array.isArray(overrides.extraFields) ? overrides.extraFields : []),
        ],
        ...overrides,
    });
}

export function buildProductDetailSceneCapability(overrides = {}) {
    return buildSceneCapability(SCENE_MAP.product_detail, {
        recordFields: buildProductDetailRecordFields({
            extraFields: Array.isArray(overrides.recordFieldsExtra)
                ? overrides.recordFieldsExtra
                : [],
        }),
        fields: [
            buildTargetUrlField({
                placeholder: overrides.targetUrlPlaceholder || '填写商品详情页链接',
            }),
            buildCaptureSnapshotsField(),
            ...(Array.isArray(overrides.extraFields) ? overrides.extraFields : []),
        ],
        ...overrides,
    });
}

export function buildShopHotProductsSceneCapability(overrides = {}) {
    return buildSceneCapability(SCENE_MAP.shop_hot_products, {
        recordFields: buildProductListRecordFields({
            extraFields: Array.isArray(overrides.recordFieldsExtra)
                ? overrides.recordFieldsExtra
                : [],
        }),
        fields: [
            buildTargetUrlField({
                placeholder: overrides.targetUrlPlaceholder || '填写店铺页或榜单页链接',
            }),
            buildMaxItemsField({
                defaultValue:
                    overrides.defaultMaxItems !== undefined
                        ? overrides.defaultMaxItems
                        : 60,
            }),
            buildCaptureSnapshotsField(),
            ...(Array.isArray(overrides.extraFields) ? overrides.extraFields : []),
        ],
        ...overrides,
    });
}

export function buildSearchSuggestionsSceneCapability(overrides = {}) {
    return buildSceneCapability(SCENE_MAP.search_suggestions, {
        recordFields: buildSuggestionRecordFields({
            extraFields: Array.isArray(overrides.recordFieldsExtra)
                ? overrides.recordFieldsExtra
                : [],
        }),
        fields: [
            buildKeywordField({
                required: true,
                placeholder: overrides.keywordPlaceholder || '例如：wireless earbuds',
            }),
            buildKeywordsField({
                placeholder: overrides.keywordsPlaceholder || '一行一个关键词，也支持逗号分隔',
            }),
            buildMaxItemsField({
                defaultValue:
                    overrides.defaultMaxItems !== undefined
                        ? overrides.defaultMaxItems
                        : 20,
            }),
            buildCaptureSnapshotsField(),
            ...(Array.isArray(overrides.extraFields) ? overrides.extraFields : []),
        ],
        ...overrides,
    });
}

export function buildTrendKeywordsSceneCapability(overrides = {}) {
    return buildSceneCapability(SCENE_MAP.trend_keywords, {
        recordFields: buildTrendRecordFields({
            extraFields: Array.isArray(overrides.recordFieldsExtra)
                ? overrides.recordFieldsExtra
                : [],
        }),
        fields: [
            buildMaxItemsField({
                defaultValue:
                    overrides.defaultMaxItems !== undefined
                        ? overrides.defaultMaxItems
                        : 20,
            }),
            buildCaptureSnapshotsField(),
            ...(Array.isArray(overrides.extraFields) ? overrides.extraFields : []),
        ],
        ...overrides,
    });
}

export const SHARED_LIST_ITEM_ANCESTORS = [
    'article',
    'li',
    '[data-index]',
    '[data-testid*="product"]',
    '[class*="product"]',
    '[class*="item"]',
    '[class*="card"]',
    '[class*="tile"]',
    '[class*="grid"] > div',
    'div',
];

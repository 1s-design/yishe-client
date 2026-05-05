import {
    buildPlatformCapability,
    buildSearchSceneCapability,
    buildProductDetailSceneCapability,
    buildShopHotProductsSceneCapability,
    DEFAULT_SUPPORTED_SCENES,
    createOutputField,
} from '../shared.js';
import {
    normalizeRecordKey,
    sanitizeText,
    sanitizeUrl,
} from '../../common/runtime.js';
import {
    xiaohongshuProductDetailScene,
    xiaohongshuSearchScene,
    xiaohongshuShopHotProductsScene,
} from './selectors.js';

const XIAOHONGSHU_RECORD_FIELDS_EXTRA = [
    createOutputField('noteId', '笔记ID', {
        description: '小红书笔记唯一标识。',
        stability: 'platform',
    }),
    createOutputField('author', '作者', {
        description: '笔记作者昵称。',
        stability: 'platform',
    }),
    createOutputField('likeCount', '点赞数', {
        description: '笔记点赞数量。',
        stability: 'platform',
    }),
    createOutputField('noteType', '笔记类型', {
        description: '笔记类型（图文/视频）。',
        stability: 'platform',
    }),
];

function extractXiaohongshuNoteId(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const patterns = [
        /\/explore\/([a-f0-9]+)/i,
        /\/discovery\/item\/([a-f0-9]+)/i,
        /noteId[=:]\s*([a-f0-9]+)/i,
        /([a-f0-9]{24})/i,
    ];
    for (const pattern of patterns) {
        const matched = raw.match(pattern);
        if (matched?.[1]) return matched[1];
    }
    return '';
}

function normalizeXiaohongshuRecord(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(record.originalSourceUrl || record.sourceUrl, pageUrl);
    const noteId =
        extractXiaohongshuNoteId(record.recordKey) ||
        extractXiaohongshuNoteId(incomingUrl);
    const nextRecordKey = noteId
        ? `xhs:${noteId}`
        : normalizeRecordKey(record.recordKey, incomingUrl);

    return {
        ...record,
        title: sanitizeText(record.title),
        shopName: sanitizeText(record.shopName),
        sourceUrl: incomingUrl || record.sourceUrl || '',
        ...(noteId ? { noteId } : {}),
        recordKey: nextRecordKey,
    };
}

const xiaohongshuPlatform = {
    platform: 'xiaohongshu',
    label: '小红书',
    supportedScenes: ['search', 'product_detail', 'shop_hot_products'],
    search: xiaohongshuSearchScene,
    productDetail: xiaohongshuProductDetailScene,
    shopHotProducts: xiaohongshuShopHotProductsScene,
    verification: {
        search: 'planned',
        product_detail: 'planned',
        shop_hot_products: 'planned',
    },
    hooks: {
        normalizeRecord({ record, collectScene, pageUrl }) {
            if (collectScene === 'search') {
                return normalizeXiaohongshuRecord(record, pageUrl);
            }
            return record;
        },
    },
    capability: buildPlatformCapability({
        regions: ['cn'],
        status: 'blocked',
        reason: '小红书搜索页需要登录才能查看搜索结果，当前环境未登录。',
        overview:
            '小红书（RED）是中国最大的生活方式社区平台，可用于发现产品评测、种草笔记、时尚趋势等内容。',
        notes: [
            '小红书搜索页需要登录才能查看完整搜索结果。',
            '需要在已登录的小红书会话环境下才能采集。',
            '笔记使用 [class*="note-item"] 选择器标识。',
        ],
        moduleDir: 'src/ecom-collect/platforms/xiaohongshu',
        selectorFile: 'src/ecom-collect/platforms/xiaohongshu/selectors.js',
        maintenanceNotes: [
            '小红书前端使用 React + CSS Modules，类名可能包含 hash 后缀。',
            '笔记链接格式为 /explore/{noteId} 或 /discovery/item/{noteId}。',
            '搜索结果页面使用 type=51 参数标识图文笔记类型。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '当前环境未登录，搜索结果为空。需要已登录的小红书会话。',
                keywordPlaceholder: '例如：耳机推荐',
                keywordsPlaceholder: '支持中文关键词搜索',
                overview: '小红书搜索页使用 [class*="note-item"] 作为笔记卡片容器。',
                examples: [
                    {
                        title: '小红书搜索采集',
                        payload: {
                            platform: 'xiaohongshu',
                            collectScene: 'search',
                            configData: {
                                keyword: '耳机推荐',
                                maxItems: 60,
                            },
                        },
                    },
                ],
                extraRecordFields: XIAOHONGSHU_RECORD_FIELDS_EXTRA,
            }),
            buildProductDetailSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '需要先验证搜索场景可用性。',
                targetUrlPlaceholder: '填写小红书笔记链接',
                overview: '小红书笔记详情页采集。',
                examples: [
                    {
                        title: '小红书笔记详情采集',
                        payload: {
                            platform: 'xiaohongshu',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.xiaohongshu.com/explore/60a1234567890abcdef12345',
                            },
                        },
                    },
                ],
            }),
            buildShopHotProductsSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '需要先验证搜索场景可用性。',
                targetUrlPlaceholder: '填写小红书用户主页链接',
                overview: '小红书用户主页笔记列表采集。',
                examples: [
                    {
                        title: '小红书用户笔记采集',
                        payload: {
                            platform: 'xiaohongshu',
                            collectScene: 'shop_hot_products',
                            configData: {
                                targetUrl: 'https://www.xiaohongshu.com/user/profile/5abcdef1234567890abcdef1',
                                maxItems: 60,
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default xiaohongshuPlatform;

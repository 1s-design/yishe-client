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
    redditProductDetailScene,
    redditSearchScene,
    redditShopHotProductsScene,
} from './selectors.js';

const REDDIT_RECORD_FIELDS_EXTRA = [
    createOutputField('subreddit', '子版块', {
        description: '帖子所属的 subreddit 名称。',
        stability: 'platform',
    }),
    createOutputField('author', '作者', {
        description: '帖子作者用户名。',
        stability: 'platform',
    }),
    createOutputField('score', '得分', {
        description: '帖子得分（upvotes - downvotes）。',
        valueType: 'number',
        stability: 'platform',
    }),
    createOutputField('commentCount', '评论数', {
        description: '帖子评论数量。',
        valueType: 'number',
        stability: 'platform',
    }),
    createOutputField('postType', '帖子类型', {
        description: '帖子类型（text/link/image/video）。',
        stability: 'platform',
    }),
];

function extractRedditPostId(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const patterns = [
        /\/comments\/([a-z0-9]+)\//i,
        /\/comments\/([a-z0-9]+)$/i,
    ];
    for (const pattern of patterns) {
        const matched = raw.match(pattern);
        if (matched?.[1]) return matched[1];
    }
    return '';
}

function normalizeRedditRecord(record = {}, pageUrl = '') {
    const incomingUrl = sanitizeUrl(record.originalSourceUrl || record.sourceUrl, pageUrl);
    const postId =
        extractRedditPostId(record.recordKey) ||
        extractRedditPostId(incomingUrl);
    const nextRecordKey = postId
        ? `reddit:${postId}`
        : normalizeRecordKey(record.recordKey, incomingUrl);

    return {
        ...record,
        title: sanitizeText(record.title),
        sourceUrl: incomingUrl || record.sourceUrl || '',
        ...(postId ? { postId } : {}),
        recordKey: nextRecordKey,
    };
}

const redditPlatform = {
    platform: 'reddit',
    label: 'Reddit',
    supportedScenes: ['search', 'product_detail'],
    search: redditSearchScene,
    productDetail: redditProductDetailScene,
    shopHotProducts: redditShopHotProductsScene,
    verification: {
        search: 'planned',
        product_detail: 'planned',
        shop_hot_products: 'planned',
    },
    hooks: {
        normalizeRecord({ record, collectScene, pageUrl }) {
            if (collectScene === 'search') {
                return normalizeRedditRecord(record, pageUrl);
            }
            return record;
        },
    },
    capability: buildPlatformCapability({
        regions: ['global'],
        status: 'blocked',
        reason: 'Reddit 搜索页会触发 reCAPTCHA 验证，当前环境无法直接访问搜索结果。',
        overview:
            'Reddit 是全球最大的社区讨论平台，可用于发现用户评价、产品讨论、趋势话题等内容。',
        notes: [
            'Reddit 搜索页使用 reCAPTCHA 进行人机验证。',
            '需要在已登录且通过验证的环境下才能采集。',
            '帖子使用 [data-testid="post-container"] 选择器标识。',
        ],
        moduleDir: 'src/ecom-collect/platforms/reddit',
        selectorFile: 'src/ecom-collect/platforms/reddit/selectors.js',
        maintenanceNotes: [
            'Reddit 前端使用 React，data-testid 属性是稳定的选择器。',
            '帖子链接格式为 /r/{subreddit}/comments/{id}/{slug}/。',
            '旧版 Reddit (old.reddit.com) 结构不同，当前选择器针对新版。',
        ],
        scenes: [
            buildSearchSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '当前环境触发 reCAPTCHA 验证，需要已登录的 Reddit 会话。',
                keywordPlaceholder: '例如：wireless earbuds review',
                keywordsPlaceholder: '支持英文关键词搜索',
                overview: 'Reddit 搜索页使用 [data-testid="post-container"] 作为帖子容器。',
                examples: [
                    {
                        title: 'Reddit 搜索采集',
                        payload: {
                            platform: 'reddit',
                            collectScene: 'search',
                            configData: {
                                keyword: 'wireless earbuds review',
                                maxItems: 60,
                                subreddit: 'headphones',
                            },
                        },
                    },
                ],
                extraRecordFields: REDDIT_RECORD_FIELDS_EXTRA,
            }),
            buildProductDetailSceneCapability({
                verification: 'planned',
                availability: 'blocked',
                reason: '需要先验证搜索场景可用性。',
                targetUrlPlaceholder: '填写 Reddit 帖子链接',
                overview: 'Reddit 帖子详情页采集。',
                examples: [
                    {
                        title: 'Reddit 帖子详情采集',
                        payload: {
                            platform: 'reddit',
                            collectScene: 'product_detail',
                            configData: {
                                targetUrl: 'https://www.reddit.com/r/headphones/comments/abc123/post_title/',
                            },
                        },
                    },
                ],
            }),
        ],
    }),
};

export default redditPlatform;

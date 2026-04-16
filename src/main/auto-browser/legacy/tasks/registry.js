import executeDouyinPublishTask, { DOUYIN_PUBLISH_TASK_KEY } from './publish/douyin.publish.js';
import executeKuaishouPublishTask, { KUAISHOU_PUBLISH_TASK_KEY } from './publish/kuaishou.publish.js';
import executeXiaohongshuPublishTask, { XIAOHONGSHU_PUBLISH_TASK_KEY } from './publish/xiaohongshu.publish.js';
import executeWeiboPublishTask, { WEIBO_PUBLISH_TASK_KEY } from './publish/weibo.publish.js';
import executeYoutubePublishTask, { YOUTUBE_PUBLISH_TASK_KEY } from './publish/youtube.publish.js';
import executeXianyuPublishTask, { XIANYU_PUBLISH_TASK_KEY } from './publish/xianyu.publish.js';
import executeTiktokPublishTask, { TIKTOK_PUBLISH_TASK_KEY } from './publish/tiktok.publish.js';
import executeDoudianPublishTask, { DOUDIAN_PUBLISH_TASK_KEY } from './publish/doudian.publish.js';
import executeKuaishouShopPublishTask, { KUAISHOU_SHOP_PUBLISH_TASK_KEY } from './publish/kuaishou-shop.publish.js';
import executeTemuPublishTask, { TEMU_PUBLISH_TASK_KEY } from './publish/temu.publish.js';

export const TASK_REGISTRY = {
    [DOUYIN_PUBLISH_TASK_KEY]: {
        key: DOUYIN_PUBLISH_TASK_KEY,
        platform: 'douyin',
        action: 'publish',
        name: '抖音发布内容',
        description: '执行抖音发布任务',
        handler: executeDouyinPublishTask
    },
    [KUAISHOU_PUBLISH_TASK_KEY]: {
        key: KUAISHOU_PUBLISH_TASK_KEY,
        platform: 'kuaishou',
        action: 'publish',
        name: '快手发布内容',
        description: '执行快手发布任务',
        handler: executeKuaishouPublishTask
    },
    [XIAOHONGSHU_PUBLISH_TASK_KEY]: {
        key: XIAOHONGSHU_PUBLISH_TASK_KEY,
        platform: 'xiaohongshu',
        action: 'publish',
        name: '小红书发布内容',
        description: '执行小红书发布任务',
        handler: executeXiaohongshuPublishTask
    },
    [WEIBO_PUBLISH_TASK_KEY]: {
        key: WEIBO_PUBLISH_TASK_KEY,
        platform: 'weibo',
        action: 'publish',
        name: '微博发布内容',
        description: '执行微博发布任务',
        handler: executeWeiboPublishTask
    },
    [YOUTUBE_PUBLISH_TASK_KEY]: {
        key: YOUTUBE_PUBLISH_TASK_KEY,
        platform: 'youtube',
        action: 'publish',
        name: 'YouTube 发布内容',
        description: '执行 YouTube 发布任务',
        handler: executeYoutubePublishTask
    },
    [XIANYU_PUBLISH_TASK_KEY]: {
        key: XIANYU_PUBLISH_TASK_KEY,
        platform: 'xianyu',
        action: 'publish',
        name: '咸鱼发布商品',
        description: '执行咸鱼发布任务',
        handler: executeXianyuPublishTask
    },
    [TIKTOK_PUBLISH_TASK_KEY]: {
        key: TIKTOK_PUBLISH_TASK_KEY,
        platform: 'tiktok',
        action: 'publish',
        name: 'TikTok 发布内容',
        description: '执行 TikTok 发布任务',
        handler: executeTiktokPublishTask
    },
    [DOUDIAN_PUBLISH_TASK_KEY]: {
        key: DOUDIAN_PUBLISH_TASK_KEY,
        platform: 'doudian',
        action: 'publish',
        name: '抖店发布商品',
        description: '执行抖店商品发布任务',
        handler: executeDoudianPublishTask
    },
    [KUAISHOU_SHOP_PUBLISH_TASK_KEY]: {
        key: KUAISHOU_SHOP_PUBLISH_TASK_KEY,
        platform: 'kuaishou_shop',
        action: 'publish',
        name: '快手小店发布商品',
        description: '执行快手小店发布任务',
        handler: executeKuaishouShopPublishTask
    },
    [TEMU_PUBLISH_TASK_KEY]: {
        key: TEMU_PUBLISH_TASK_KEY,
        platform: 'temu',
        action: 'publish',
        name: 'Temu 发布商品',
        description: '执行 Temu 商品发布任务',
        handler: executeTemuPublishTask
    }
};

export function getTaskDefinition(taskKey) {
    return TASK_REGISTRY[String(taskKey || '').trim()] || null;
}

export function resolveTaskHandler(taskKey) {
    const definition = getTaskDefinition(taskKey);
    return definition?.handler || null;
}

export function getTaskCatalog() {
    return Object.values(TASK_REGISTRY).map((item) => ({
        key: item.key,
        platform: item.platform,
        action: item.action,
        name: item.name,
        description: item.description
    }));
}

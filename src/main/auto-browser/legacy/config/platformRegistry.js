import { resolveTaskHandler } from '../tasks/registry.js';

const createCapability = (key, name, description, handler) => ({
    key,
    name,
    description,
    handler
});

function resolveCapabilityHandler({ platform, action }) {
    const taskKey = `${action}:${platform}`;
    const taskHandler = resolveTaskHandler(taskKey);
    if (!taskHandler) {
        throw new Error(`未注册任务处理器: ${taskKey}`);
    }
    return taskHandler;
}

export const PLATFORM_REGISTRY = {
    douyin: {
        id: 'douyin',
        name: '抖音',
        category: 'content',
        defaultAction: 'publish',
        capabilities: [
            createCapability('publish', '发布内容', '发布视频或图文内容', resolveCapabilityHandler({ platform: 'douyin', action: 'publish' }))
        ]
    },
    kuaishou: {
        id: 'kuaishou',
        name: '快手',
        category: 'content',
        defaultAction: 'publish',
        capabilities: [
            createCapability('publish', '发布内容', '发布视频内容', resolveCapabilityHandler({ platform: 'kuaishou', action: 'publish' }))
        ]
    },
    xiaohongshu: {
        id: 'xiaohongshu',
        name: '小红书',
        category: 'content',
        defaultAction: 'publish',
        capabilities: [
            createCapability('publish', '发布内容', '发布图文或笔记内容', resolveCapabilityHandler({ platform: 'xiaohongshu', action: 'publish' }))
        ]
    },
    weibo: {
        id: 'weibo',
        name: '微博',
        category: 'content',
        defaultAction: 'publish',
        capabilities: [
            createCapability('publish', '发布内容', '发布微博内容', resolveCapabilityHandler({ platform: 'weibo', action: 'publish' }))
        ]
    },
    youtube: {
        id: 'youtube',
        name: 'YouTube',
        category: 'content',
        defaultAction: 'publish',
        capabilities: [
            createCapability('publish', '发布内容', '发布视频内容', resolveCapabilityHandler({ platform: 'youtube', action: 'publish' }))
        ]
    },
    xianyu: {
        id: 'xianyu',
        name: '咸鱼',
        category: 'commerce',
        defaultAction: 'publish',
        capabilities: [
            createCapability('publish', '发布商品', '发布闲置商品', resolveCapabilityHandler({ platform: 'xianyu', action: 'publish' }))
        ]
    },
    tiktok: {
        id: 'tiktok',
        name: 'TikTok',
        category: 'content',
        defaultAction: 'publish',
        capabilities: [
            createCapability('publish', '发布内容', '发布视频内容', resolveCapabilityHandler({ platform: 'tiktok', action: 'publish' }))
        ]
    },
    doudian: {
        id: 'doudian',
        name: '抖店',
        category: 'commerce',
        defaultAction: 'publish',
        capabilities: [
            createCapability('publish', '发布商品', '发布电商商品', resolveCapabilityHandler({ platform: 'doudian', action: 'publish' }))
        ]
    },
    kuaishou_shop: {
        id: 'kuaishou_shop',
        name: '快手小店',
        category: 'commerce',
        defaultAction: 'publish',
        capabilities: [
            createCapability('publish', '发布商品', '发布电商商品', resolveCapabilityHandler({ platform: 'kuaishou_shop', action: 'publish' }))
        ]
    },
    temu: {
        id: 'temu',
        name: 'Temu',
        category: 'commerce',
        defaultAction: 'publish',
        capabilities: [
            createCapability('publish', '发布商品', '发布 Temu 商品', resolveCapabilityHandler({ platform: 'temu', action: 'publish' }))
        ]
    }
};

export function getPlatformDefinition(platform) {
    return PLATFORM_REGISTRY[platform] || null;
}

export function getPlatformCatalog() {
    return Object.values(PLATFORM_REGISTRY).map((platform) => ({
        id: platform.id,
        name: platform.name,
        category: platform.category,
        defaultAction: platform.defaultAction,
        capabilities: platform.capabilities.map((capability) => ({
            key: capability.key,
            name: capability.name,
            description: capability.description
        }))
    }));
}

export function getSupportedPlatforms() {
    return Object.keys(PLATFORM_REGISTRY);
}

export function isPlatformSupported(platform) {
    return !!getPlatformDefinition(platform);
}

export function resolvePlatformCapability(platform, action = 'publish') {
    const definition = getPlatformDefinition(platform);
    if (!definition) return null;

    const targetAction = action || definition.defaultAction || 'publish';
    const capability = definition.capabilities.find((item) => item.key === targetAction);
    if (!capability) return null;

    return {
        platform: definition,
        capability
    };
}

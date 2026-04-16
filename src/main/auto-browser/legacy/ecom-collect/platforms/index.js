import aliexpressPlatform from './aliexpress/index.js';
import alibaba1688Platform from './alibaba_1688/index.js';
import amazonPlatform from './amazon/index.js';
import douyinShopPlatform from './douyin_shop/index.js';
import ebayPlatform from './ebay/index.js';
import googleTrendsPlatform from './google_trends/index.js';
import jdPlatform from './jd/index.js';
import mercadolibrePlatform from './mercadolibre/index.js';
import neweggPlatform from './newegg/index.js';
import ozonPlatform from './ozon/index.js';
import sheinPlatform from './shein/index.js';
import taobaoPlatform from './taobao/index.js';
import temuPlatform from './temu/index.js';
import tiktokShopPlatform from './tiktok_shop/index.js';
import walmartPlatform from './walmart/index.js';
import {
    buildPlatformCapability,
    ECOM_CAPABILITY_STATUS_META,
} from './shared.js';

const PLATFORM_LIST = [
    alibaba1688Platform,
    amazonPlatform,
    googleTrendsPlatform,
    ebayPlatform,
    neweggPlatform,
    walmartPlatform,
    aliexpressPlatform,
    temuPlatform,
    tiktokShopPlatform,
    douyinShopPlatform,
    taobaoPlatform,
    jdPlatform,
    sheinPlatform,
    ozonPlatform,
    mercadolibrePlatform,
];

export const PLATFORM_CONFIGS = Object.fromEntries(
    PLATFORM_LIST.map((item) => [item.platform, item]),
);

const TASK_ENTITY_TYPE_BY_SCENE = {
    search: 'product',
    product_detail: 'product',
    shop_hot_products: 'product',
    search_suggestions: 'keyword_signal',
    trend_keywords: 'keyword_signal',
};

export function buildDefaultTaskTypeValue(platform, collectScene) {
    const normalizedPlatform = String(platform || '').trim();
    const normalizedScene = String(collectScene || '').trim();
    if (!normalizedPlatform || !normalizedScene) {
        return '';
    }
    return `${normalizedPlatform}.${normalizedScene}`;
}

function normalizeTaskTypeExamples(examples, platform, taskType) {
    if (!Array.isArray(examples)) {
        return [];
    }

    return examples.map((item) => {
        const payload =
            item?.payload && typeof item.payload === 'object'
                ? cloneValue(item.payload)
                : {};
        const restPayload = {
            ...payload,
        };
        delete restPayload.collectScene;

        return {
            ...cloneValue(item),
            payload: {
                ...restPayload,
                platform,
                taskType,
                configData:
                    payload?.configData && typeof payload.configData === 'object'
                        ? payload.configData
                        : {},
            },
        };
    });
}

function buildTaskTypeCapability(platformValue, platformLabel, scene, override = {}) {
    const collectScene = String(
        override.collectScene || scene?.value || override.sceneValue || '',
    ).trim();
    const value = String(
        override.value ||
            override.taskType ||
            buildDefaultTaskTypeValue(platformValue, collectScene),
    ).trim();

    if (!value) {
        return null;
    }

    const docs =
        override?.docs && typeof override.docs === 'object'
            ? cloneValue(override.docs)
            : scene?.docs && typeof scene.docs === 'object'
                ? cloneValue(scene.docs)
                : {};
    const examples = normalizeTaskTypeExamples(
        Array.isArray(docs.examples) ? docs.examples : [],
        platformValue,
        value,
    );

    return {
        value,
        taskType: value,
        label:
            String(override.label || scene?.label || value).trim() ||
            `${platformLabel || platformValue} 任务`,
        description:
            String(override.description || scene?.description || '').trim() || '',
        platform: platformValue,
        collectScene,
        entityType:
            String(
                override.entityType ||
                    TASK_ENTITY_TYPE_BY_SCENE[collectScene] ||
                    'unknown',
            ).trim() || 'unknown',
        availability:
            String(override.availability || scene?.availability || '').trim() ||
            undefined,
        availabilityLabel:
            String(
                override.availabilityLabel || scene?.availabilityLabel || '',
            ).trim() || undefined,
        runnable:
            override.runnable !== undefined
                ? !!override.runnable
                : scene?.runnable !== false,
        verification:
            String(override.verification || scene?.verification || '').trim() ||
            undefined,
        verificationLabel:
            String(
                override.verificationLabel || scene?.verificationLabel || '',
            ).trim() || undefined,
        reason: String(override.reason || scene?.reason || '').trim() || null,
        access:
            override?.access && typeof override.access === 'object'
                ? cloneValue(override.access)
                : scene?.access && typeof scene.access === 'object'
                    ? cloneValue(scene.access)
                    : undefined,
        fields: Array.isArray(overridesToFields(override, scene))
            ? overridesToFields(override, scene)
            : [],
        docs: {
            ...docs,
            examples,
        },
    };
}

function overridesToFields(overrides, scene) {
    if (Array.isArray(overrides?.fields)) {
        return cloneValue(overrides.fields);
    }
    if (Array.isArray(scene?.fields)) {
        return cloneValue(scene.fields);
    }
    return [];
}

function buildPlatformTaskTypes(platformValue, platformLabel, scenes, taskTypes) {
    const sceneMap = new Map(
        (Array.isArray(scenes) ? scenes : [])
            .filter(Boolean)
            .map((item) => [String(item?.value || '').trim(), item]),
    );
    const rawTaskTypes = Array.isArray(taskTypes) && taskTypes.length
        ? taskTypes
        : (Array.isArray(scenes) ? scenes : []).map((scene) => ({
            taskType: buildDefaultTaskTypeValue(platformValue, scene?.value),
            collectScene: scene?.value,
            label: scene?.label,
            description: scene?.description,
            runnable: scene?.runnable,
            availability: scene?.availability,
            availabilityLabel: scene?.availabilityLabel,
            verification: scene?.verification,
            verificationLabel: scene?.verificationLabel,
            reason: scene?.reason,
            access: scene?.access,
            fields: scene?.fields,
            docs: scene?.docs,
        }));

    return rawTaskTypes
        .map((item) => {
            const collectScene = String(
                item?.collectScene || item?.scene || item?.sceneValue || '',
            ).trim();
            return buildTaskTypeCapability(
                platformValue,
                platformLabel,
                sceneMap.get(collectScene) || null,
                item,
            );
        })
        .filter(Boolean);
}

export function getPlatformCatalog() {
    return getPlatformCapabilities().map((item) => ({
        value: item.value,
        platform: item.value,
        label: item.label,
        regions: item.regions,
        supportedScenes: Array.isArray(item.supportedScenes) ? [...item.supportedScenes] : [],
        supportedTaskTypes: Array.isArray(item.supportedTaskTypes)
            ? [...item.supportedTaskTypes]
            : [],
        status: item.status,
        statusLabel: item.statusLabel,
        runnable: item.runnable,
        reason: item.reason,
        access: item.access || undefined,
        scenes: Array.isArray(item.scenes) ? item.scenes : [],
        taskTypes: Array.isArray(item.taskTypes) ? item.taskTypes : [],
        docs: item.docs || {},
        maintenance: item.maintenance || {},
    }));
}

export function getPlatformConfig(platform) {
    return PLATFORM_CONFIGS[String(platform || '').trim()] || null;
}

function cloneValue(input) {
    if (input === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(input));
}

function normalizePlatformCapability(item) {
    const capability =
        item?.capability && typeof item.capability === 'object'
            ? cloneValue(item.capability)
            : buildPlatformCapability({});
    const scenes = Array.isArray(capability.scenes) ? capability.scenes : [];
    const supportedScenes = Array.from(
        new Set(
            scenes
                .map((scene) => String(scene?.value || '').trim())
                .filter(Boolean),
        ),
    );
    const status = String(capability.status || 'heuristic').trim() || 'heuristic';
    const statusMeta = ECOM_CAPABILITY_STATUS_META[status] || ECOM_CAPABILITY_STATUS_META.heuristic;
    const taskTypes = buildPlatformTaskTypes(
        item.platform,
        item.label,
        scenes,
        capability.taskTypes,
    );
    const supportedTaskTypes = Array.from(
        new Set(
            taskTypes
                .map((taskType) => String(taskType?.value || taskType?.taskType || '').trim())
                .filter(Boolean),
        ),
    );

    return {
        value: item.platform,
        platform: item.platform,
        label: item.label,
        regions: Array.isArray(capability.regions) ? capability.regions : ['global'],
        status,
        statusLabel: capability.statusLabel || statusMeta.label,
        runnable:
            capability.runnable !== undefined
                ? !!capability.runnable
                : taskTypes.some((taskType) => taskType?.runnable !== false) ||
                  scenes.some((scene) => scene?.runnable !== false),
        reason: String(capability.reason || '').trim() || null,
        access:
            capability.access && typeof capability.access === 'object'
                ? cloneValue(capability.access)
                : undefined,
        supportedScenes,
        scenes,
        supportedTaskTypes,
        taskTypes,
        docs: capability.docs || {},
        maintenance: capability.maintenance || {},
        verification:
            item?.verification && typeof item.verification === 'object'
                ? cloneValue(item.verification)
                : {},
    };
}

export function getPlatformCapabilities() {
    return PLATFORM_LIST.map((item) => normalizePlatformCapability(item));
}

export function getPlatformCapability(platform) {
    return getPlatformCapabilities().find(
        (item) => item.value === String(platform || '').trim(),
    ) || null;
}

export function getPlatformTaskTypeCapability(platform, taskType) {
    const normalizedTaskType = String(taskType || '').trim();
    if (!normalizedTaskType) {
        return null;
    }

    const capability =
        platform && typeof platform === 'object' && !Array.isArray(platform)
            ? platform
            : getPlatformCapability(platform);
    if (!capability) {
        return null;
    }

    return (
        capability.taskTypes?.find((item) => item.value === normalizedTaskType) ||
        null
    );
}

export function getTaskTypeCapability(taskType) {
    const normalizedTaskType = String(taskType || '').trim();
    if (!normalizedTaskType) {
        return null;
    }

    return (
        getPlatformCapabilities()
            .flatMap((item) => item.taskTypes || [])
            .find((item) => item.value === normalizedTaskType) || null
    );
}

export function resolveCollectTaskConfig(input = {}) {
    let platform = String(input.platform || '').trim();
    let collectScene = String(input.collectScene || '').trim();
    let taskType = String(input.taskType || '').trim();

    if (!platform && taskType.includes('.')) {
        platform = taskType.split('.')[0] || '';
    }
    if (!taskType && platform && collectScene) {
        taskType = buildDefaultTaskTypeValue(platform, collectScene);
    }

    const platformConfig = getPlatformConfig(platform);
    const platformCapability = getPlatformCapability(platform);
    let taskTypeCapability = getPlatformTaskTypeCapability(platformCapability, taskType);

    if (!taskTypeCapability && collectScene && platformCapability) {
        taskTypeCapability = getPlatformTaskTypeCapability(
            platformCapability,
            buildDefaultTaskTypeValue(platform, collectScene),
        );
    }

    if (!collectScene && taskTypeCapability?.collectScene) {
        collectScene = String(taskTypeCapability.collectScene || '').trim();
    }
    if (!taskType && taskTypeCapability?.value) {
        taskType = String(taskTypeCapability.value || '').trim();
    }

    const sceneCapability = Array.isArray(platformCapability?.scenes)
        ? platformCapability.scenes.find((item) => item?.value === collectScene) || null
        : null;

    return {
        platform,
        collectScene,
        taskType,
        platformConfig,
        platformCapability,
        sceneCapability,
        taskTypeCapability,
    };
}

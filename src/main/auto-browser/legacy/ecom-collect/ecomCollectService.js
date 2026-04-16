import { getOrCreateBrowser } from '../services/BrowserService.js';
import {
    ensureDefaultBrowserProfile,
    getActiveBrowserProfile,
} from '../services/BrowserProfileService.js';
import {
    DEFAULT_MAX_ITEMS,
    DEFAULT_MAX_PAGES,
    DEFAULT_PAGE_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
} from './common/constants.js';
import {
    buildKeywordList,
    buildSerializableSceneConfig,
    extractDetailRecord,
    extractListRecords,
} from './common/extractors.js';
import {
    captureScreenshot,
    prepareCollectionPage,
} from './common/navigation.js';
import {
    ensureSnapshotDir,
    normalizePriceText,
    normalizeRecordKey,
    normalizeSourceUrlForStorage,
    nowIso,
    sanitizeText,
    sanitizeUrl,
} from './common/runtime.js';
import { detectRiskKind } from './common/risk.js';
import {
    buildDefaultTaskTypeValue,
    getPlatformCapabilities,
    getPlatformCapability,
    getPlatformCatalog,
    resolveCollectTaskConfig,
} from './platforms/index.js';

function mapBlockedRiskToStatus(riskKind) {
    return ['login_required', 'captcha', 'risk_control'].includes(String(riskKind || '').trim())
        ? 'skipped'
        : 'failed';
}

function buildBlockedResult(risk, summary = {}) {
    const status = mapBlockedRiskToStatus(risk?.riskKind);

    return {
        status,
        message:
            status === 'skipped'
                ? `页面受限，已跳过: ${risk?.riskKind || 'unknown'}`
                : `页面触发风控: ${risk?.riskKind || 'unknown'}`,
        records: [],
        summary: {
            ...summary,
            risk,
        },
    };
}

function shouldCaptureSnapshots(taskConfig = {}) {
    const value = taskConfig?.configData?.captureSnapshots;

    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function resolveCollectProfileId(taskConfig = {}) {
    const explicitProfileId = String(
        taskConfig.profileId ||
        taskConfig.configData?.profileId ||
        ''
    ).trim();
    if (explicitProfileId) {
        return explicitProfileId;
    }

    const explicitCdpEndpoint = String(
        taskConfig.cdpEndpoint ||
        taskConfig.configData?.cdpEndpoint ||
        ''
    ).trim();
    const explicitCdpUserDataDir = String(
        taskConfig.cdpUserDataDir ||
        taskConfig.userDataDir ||
        taskConfig.configData?.cdpUserDataDir ||
        taskConfig.configData?.userDataDir ||
        ''
    ).trim();
    const explicitDebugPort = Number(
        taskConfig.port ||
        taskConfig.debugPort ||
        taskConfig.configData?.port ||
        taskConfig.configData?.debugPort
    );
    if (
        explicitCdpEndpoint ||
        explicitCdpUserDataDir ||
        (Number.isFinite(explicitDebugPort) && explicitDebugPort > 0)
    ) {
        return null;
    }

    const activeProfile = getActiveBrowserProfile() || ensureDefaultBrowserProfile();
    return String(activeProfile?.id || '').trim() || null;
}

function resolveCollectBrowserConnectionOptions(taskConfig = {}) {
    const profileId = resolveCollectProfileId(taskConfig);
    const cdpEndpoint = String(
        taskConfig.cdpEndpoint ||
        taskConfig.configData?.cdpEndpoint ||
        process.env.CDP_ENDPOINT ||
        ''
    ).trim();
    const cdpUserDataDir = String(
        taskConfig.cdpUserDataDir ||
        taskConfig.userDataDir ||
        taskConfig.configData?.cdpUserDataDir ||
        taskConfig.configData?.userDataDir ||
        process.env.YISHE_AUTO_BROWSER_CDP_USER_DATA_DIR ||
        process.env.UPLOADER_CDP_USER_DATA_DIR ||
        ''
    ).trim();
    const port = Number(
        taskConfig.port ||
        taskConfig.debugPort ||
        taskConfig.configData?.port ||
        taskConfig.configData?.debugPort
    );

    const options = {
        mode: 'cdp',
    };

    if (profileId) {
        options.profileId = profileId;
        return options;
    }

    if (cdpEndpoint) {
        options.cdpEndpoint = cdpEndpoint;
    }
    if (cdpUserDataDir) {
        options.cdpUserDataDir = cdpUserDataDir;
    }
    if (Number.isFinite(port) && port > 0) {
        options.port = port;
    }

    return options;
}

async function runPlatformHook(platformConfig, hookName, context) {
    const hook = platformConfig?.hooks?.[hookName];
    if (typeof hook !== 'function') {
        return null;
    }
    return hook(context);
}

function buildCustomSceneExecutorContext({
    page,
    platform,
    collectScene,
    taskType,
    taskConfig,
    runtime,
    platformConfig,
    platformCapability,
    taskTypeCapability,
    sceneCapability,
}) {
    return {
        page,
        platform,
        collectScene,
        taskType,
        taskConfig,
        runtime,
        platformConfig,
        platformCapability,
        taskTypeCapability,
        sceneCapability,
        helpers: {
            captureScreenshot,
            prepareCollectionPage,
            runPlatformHook: (hookName, context) => runPlatformHook(platformConfig, hookName, context),
            buildBlockedResult,
            shouldCaptureSnapshots,
            normalizePriceText,
            normalizeRecordKey,
            normalizeSourceUrlForStorage,
            sanitizeText,
            sanitizeUrl,
            nowIso,
        },
    };
}

async function normalizeRecordsByPlatform(records, platformConfig, contextFactory) {
    const normalizedRecords = [];

    for (let index = 0; index < records.length; index += 1) {
        const context = contextFactory(records[index], index);
        const nextRecord = await runPlatformHook(platformConfig, 'normalizeRecord', context);
        normalizedRecords.push(
            nextRecord && typeof nextRecord === 'object'
                ? nextRecord
                : context.record,
        );
    }

    return normalizedRecords;
}

function buildBuiltinTaskTypeExecutors({
    page,
    platform,
    taskConfig,
    runtime,
    platformConfig,
    platformCapability,
}) {
    const sceneExecutorFactories = {
        search: () => collectSearchScene(page, platformConfig, taskConfig, runtime),
        product_detail: () =>
            collectDetailScene(
                page,
                platformConfig.productDetail || {},
                taskConfig,
                runtime,
                'product-detail',
                platformConfig,
                'product_detail',
            ),
        shop_hot_products: () =>
            collectListPageScene(
                page,
                platformConfig.shopHotProducts || {},
                taskConfig,
                runtime,
                'shop-hot-products',
                platformConfig,
                'shop_hot_products',
            ),
    };
    const executors = {};

    if (Array.isArray(platformCapability?.taskTypes)) {
        platformCapability.taskTypes.forEach((item) => {
            const taskTypeValue = String(item?.value || item?.taskType || '').trim();
            const collectScene = String(item?.collectScene || '').trim();
            const executorFactory = sceneExecutorFactories[collectScene];

            if (taskTypeValue && typeof executorFactory === 'function' && !executors[taskTypeValue]) {
                executors[taskTypeValue] = executorFactory;
            }
        });
    }

    Object.entries(sceneExecutorFactories).forEach(([collectScene, executorFactory]) => {
        const fallbackTaskType = buildDefaultTaskTypeValue(platform, collectScene);
        if (fallbackTaskType && !executors[fallbackTaskType]) {
            executors[fallbackTaskType] = executorFactory;
        }
    });

    return executors;
}

async function collectSearchScene(page, platformConfig, taskConfig, runtime) {
    const sceneConfig = platformConfig.search;
    const runtimeSceneConfig = buildSerializableSceneConfig(sceneConfig);
    const keywords = buildKeywordList(taskConfig.configData);

    if (!keywords.length) {
        throw new Error('search 场景缺少 keyword/keywords');
    }

    const maxPages = Math.max(1, Math.min(10, Number(taskConfig.configData?.maxPages) || DEFAULT_MAX_PAGES));
    const maxItems = Math.max(1, Math.min(500, Number(taskConfig.configData?.maxItems) || DEFAULT_MAX_ITEMS));
    const allRecords = [];
    const pageSummaries = [];

    for (const keyword of keywords) {
        for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
            const url = sceneConfig.buildUrl({
                keyword,
                page: pageNo,
                configData: taskConfig.configData || {},
            });

            const prepareResult = await prepareCollectionPage(page, runtime, {
                url,
                timeoutMs: taskConfig.timeoutMs,
                blockedStage: `blocked-${keyword}-${pageNo}`,
                waitSelectors: [...(sceneConfig.itemSelectors || []), ...(sceneConfig.linkSelectors || [])],
                onReady:
                    typeof sceneConfig.preparePage === 'function'
                        ? ({ page: nextPage, runtime: nextRuntime, url: currentUrl }) =>
                              sceneConfig.preparePage({
                                  page: nextPage,
                                  runtime: nextRuntime,
                                  url: currentUrl,
                                  keyword,
                                  pageNo,
                                  taskConfig,
                              })
                        : null,
            });

            if (prepareResult.blocked) {
                const blockedResult = buildBlockedResult(prepareResult.risk, {
                    pageSummaries,
                });

                return {
                    ...blockedResult,
                    records: allRecords,
                };
            }

            const pageResult = await extractListRecords(page, runtimeSceneConfig, {
                maxItems: Math.max(1, maxItems - allRecords.length),
            });

            pageSummaries.push({
                keyword,
                pageNo,
                url,
                detectedSelector: prepareResult.detectedSelector,
                recordsCount: pageResult.count,
            });

            const normalizedPageRecords = pageResult.records.map((item) => {
                const rawSourceUrl = sanitizeUrl(item.sourceUrl, page.url());
                const { sourceUrl, originalSourceUrl } = normalizeSourceUrlForStorage(rawSourceUrl);

                return {
                    ...item,
                    keyword,
                    pageNo,
                    priceText: normalizePriceText(item.priceText),
                    sourceUrl,
                    ...(originalSourceUrl ? { originalSourceUrl } : {}),
                    imageUrl: sanitizeUrl(item.imageUrl, page.url()),
                    recordKey: normalizeRecordKey(item.recordKey, originalSourceUrl || sourceUrl),
                };
            });

            const platformRecords = await normalizeRecordsByPlatform(
                normalizedPageRecords,
                platformConfig,
                (record, index) => ({
                    record,
                    originalRecord: pageResult.records[index],
                    collectScene: 'search',
                    keyword,
                    pageNo,
                    pageUrl: page.url(),
                    taskConfig,
                    runtime,
                    page,
                    index,
                }),
            );

            platformRecords.forEach((item) => {
                allRecords.push(item);
            });

            if (allRecords.length >= maxItems) {
                break;
            }
        }

        if (allRecords.length >= maxItems) {
            break;
        }
    }

    await captureScreenshot(
        page,
        runtime.snapshotDir,
        'search-finished',
        runtime.snapshots,
        runtime.captureSnapshots === true,
    );

    return {
        status: allRecords.length > 0 ? 'success' : 'failed',
        message: allRecords.length > 0 ? '搜索采集完成' : '未采集到有效结果',
        records: allRecords.slice(0, maxItems),
        summary: {
            pageSummaries,
            keywords,
        },
    };
}

async function collectListPageScene(page, sceneConfig, taskConfig, runtime, sceneLabel, platformConfig, collectScene) {
    const targetUrl = String(taskConfig.configData?.targetUrl || '').trim();
    if (!targetUrl) {
        throw new Error(`${sceneLabel} 场景缺少 targetUrl`);
    }

    const maxItems = Math.max(1, Math.min(500, Number(taskConfig.configData?.maxItems) || DEFAULT_MAX_ITEMS));
    const runtimeSceneConfig = buildSerializableSceneConfig(sceneConfig);
    const prepareResult = await prepareCollectionPage(page, runtime, {
        url: targetUrl,
        timeoutMs: taskConfig.timeoutMs,
        blockedStage: `blocked-${sceneLabel}`,
        waitSelectors: [...(sceneConfig.itemSelectors || []), ...(sceneConfig.linkSelectors || [])],
        onReady:
            typeof sceneConfig.preparePage === 'function'
                ? ({ page: nextPage, runtime: nextRuntime, url }) =>
                      sceneConfig.preparePage({
                          page: nextPage,
                          runtime: nextRuntime,
                          url,
                          taskConfig,
                      })
                : null,
    });

    if (prepareResult.blocked) {
        return buildBlockedResult(prepareResult.risk);
    }

    const pageResult = await extractListRecords(page, runtimeSceneConfig, {
        maxItems,
    });

    await captureScreenshot(
        page,
        runtime.snapshotDir,
        `${sceneLabel}-finished`,
        runtime.snapshots,
        runtime.captureSnapshots === true,
    );

    const normalizedRecords = pageResult.records.map((item) => {
        const rawSourceUrl = sanitizeUrl(item.sourceUrl, page.url());
        const { sourceUrl, originalSourceUrl } = normalizeSourceUrlForStorage(rawSourceUrl);

        return {
            ...item,
            pageNo: 1,
            priceText: normalizePriceText(item.priceText),
            sourceUrl,
            ...(originalSourceUrl ? { originalSourceUrl } : {}),
            imageUrl: sanitizeUrl(item.imageUrl, page.url()),
            recordKey: normalizeRecordKey(item.recordKey, originalSourceUrl || sourceUrl),
        };
    });

    const platformRecords = await normalizeRecordsByPlatform(
        normalizedRecords,
        platformConfig,
        (record, index) => ({
            record,
            originalRecord: pageResult.records[index],
            collectScene,
            pageUrl: page.url(),
            taskConfig,
            runtime,
            page,
            index,
        }),
    );

    return {
        status: pageResult.count > 0 ? 'success' : 'failed',
        message: pageResult.count > 0 ? '列表采集完成' : '列表页未提取到有效数据',
        records: platformRecords,
        summary: {
            targetUrl,
            detectedSelector: prepareResult.detectedSelector,
            recordsCount: pageResult.count,
        },
    };
}

async function collectDetailScene(page, sceneConfig, taskConfig, runtime, sceneLabel, platformConfig, collectScene) {
    const targetUrl = String(taskConfig.configData?.targetUrl || '').trim();
    if (!targetUrl) {
        throw new Error(`${sceneLabel} 场景缺少 targetUrl`);
    }

    const runtimeSceneConfig = buildSerializableSceneConfig(sceneConfig);
    const prepareResult = await prepareCollectionPage(page, runtime, {
        url: targetUrl,
        timeoutMs: taskConfig.timeoutMs,
        blockedStage: `blocked-${sceneLabel}`,
        waitSelectors: [
            ...(sceneConfig.titleSelectors || []),
            ...(sceneConfig.priceSelectors || []),
            ...(sceneConfig.imageSelectors || []),
        ],
        onReady:
            typeof sceneConfig.preparePage === 'function'
                ? ({ page: nextPage, runtime: nextRuntime, url }) =>
                      sceneConfig.preparePage({
                          page: nextPage,
                          runtime: nextRuntime,
                          url,
                          taskConfig,
                      })
                : null,
    });

    if (prepareResult.blocked) {
        return buildBlockedResult(prepareResult.risk);
    }

    const result = await extractDetailRecord(page, runtimeSceneConfig);
    await captureScreenshot(
        page,
        runtime.snapshotDir,
        `${sceneLabel}-finished`,
        runtime.snapshots,
        runtime.captureSnapshots === true,
    );

    const normalizedRecords = result.records.map((item) => {
        const rawSourceUrl = sanitizeUrl(item.sourceUrl, page.url());
        const { sourceUrl, originalSourceUrl } = normalizeSourceUrlForStorage(rawSourceUrl);

        return {
            ...item,
            priceText: normalizePriceText(item.priceText),
            sourceUrl,
            ...(originalSourceUrl ? { originalSourceUrl } : {}),
            imageUrls: Array.isArray(item.imageUrls)
                ? item.imageUrls.map((url) => sanitizeUrl(url, page.url()))
                : [],
            recordKey: normalizeRecordKey(item.recordKey, originalSourceUrl || sourceUrl),
        };
    });

    const platformRecords = await normalizeRecordsByPlatform(
        normalizedRecords,
        platformConfig,
        (record, index) => ({
            record,
            originalRecord: result.records[index],
            collectScene,
            pageUrl: page.url(),
            taskConfig,
            runtime,
            page,
            index,
        }),
    );

    return {
        status: result.count > 0 ? 'success' : 'failed',
        message: result.count > 0 ? '详情采集完成' : '详情页未提取到有效数据',
        records: platformRecords,
        summary: {
            targetUrl,
            detectedSelector: prepareResult.detectedSelector,
        },
    };
}

export async function getEcomPlatformCatalog() {
    return {
        platforms: getPlatformCatalog(),
        schemaVersion: 1,
    };
}

export async function getEcomCollectCapabilities() {
    return {
        schemaVersion: 1,
        generatedAt: nowIso(),
        platforms: getPlatformCapabilities(),
    };
}

export async function runEcomCollectTask(taskConfig = {}) {
    const resolvedTask = resolveCollectTaskConfig(taskConfig);
    const platform = String(resolvedTask.platform || '').trim();
    const collectScene = String(resolvedTask.collectScene || '').trim();
    const taskType =
        String(resolvedTask.taskType || taskConfig.taskType || '').trim() ||
        buildDefaultTaskTypeValue(platform, collectScene);
    const platformConfig = resolvedTask.platformConfig;
    const platformCapability = resolvedTask.platformCapability || getPlatformCapability(platform);
    const sceneCapability = resolvedTask.sceneCapability;
    const taskTypeCapability = resolvedTask.taskTypeCapability;

    if (!platformConfig) {
        throw new Error(`暂不支持的平台: ${platform}`);
    }
    if (!taskTypeCapability) {
        throw new Error(`暂不支持的任务类型: ${taskType}`);
    }
    if (!sceneCapability) {
        throw new Error(`任务类型未绑定执行场景: ${taskType}`);
    }
    if (taskTypeCapability?.runnable === false || sceneCapability.runnable === false) {
        throw new Error(
            taskTypeCapability?.reason ||
                sceneCapability.reason ||
                `${platformCapability?.label || platform} 当前场景暂不可执行`,
        );
    }

    const timeoutMs = Math.max(30_000, Number(taskConfig.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const captureSnapshots = shouldCaptureSnapshots(taskConfig);
    const snapshotDir = captureSnapshots
        ? ensureSnapshotDir({
            workspaceDir: taskConfig.workspaceDir,
            runId: taskConfig.runId || `${platform}-${Date.now()}`,
            platform,
            collectScene,
        })
        : '';
    const runtime = {
        snapshotDir,
        snapshots: [],
        visitedUrls: [],
        startedAt: nowIso(),
        cleanupPages: [],
        captureSnapshots,
    };

    const browserConnectionOptions = resolveCollectBrowserConnectionOptions(taskConfig);
    const collectProfileId = String(browserConnectionOptions.profileId || '').trim() || null;
    const browserOrContext = await getOrCreateBrowser(browserConnectionOptions);
    const page = await browserOrContext.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }).catch(() => {});
        await page.setViewportSize({ width: 1440, height: 960 }).catch(() => {});
        page.setDefaultTimeout(Math.min(timeoutMs, DEFAULT_PAGE_TIMEOUT_MS));
        page.setDefaultNavigationTimeout(Math.min(timeoutMs, DEFAULT_PAGE_TIMEOUT_MS));

        await runPlatformHook(platformConfig, 'beforeScene', {
            page,
            platform,
            collectScene,
            taskConfig,
            runtime,
            taskType,
        });

        const taskTypeExecutors = buildBuiltinTaskTypeExecutors({
            page,
            platform,
            taskConfig,
            runtime,
            platformConfig,
            platformCapability,
        });
        const customTaskTypeExecutor = platformConfig?.customTaskTypeExecutors?.[taskType];
        const taskTypeExecutor =
            typeof customTaskTypeExecutor === 'function'
                ? () =>
                    customTaskTypeExecutor(
                        buildCustomSceneExecutorContext({
                            page,
                            platform,
                            collectScene,
                            taskType,
                            taskConfig,
                            runtime,
                            platformConfig,
                            platformCapability,
                            taskTypeCapability,
                            sceneCapability,
                        }),
                    )
                : taskTypeExecutors[taskType];
        if (!taskTypeExecutor) {
            throw new Error(`暂不支持的任务类型: ${taskType}`);
        }

        const result = await taskTypeExecutor();

        await runPlatformHook(platformConfig, 'afterScene', {
            page,
            platform,
            collectScene,
            taskConfig,
            runtime,
            taskType,
            result,
        });

        return {
            success: result.status === 'success',
            status: result.status,
            message: result.message,
            data: {
                runId: taskConfig.runId || null,
                taskId: taskConfig.taskId || null,
                platform,
                taskType,
                collectScene,
                records: Array.isArray(result.records) ? result.records : [],
                snapshots: runtime.snapshots,
                summary: {
                    ...(result.summary || {}),
                    profileId: collectProfileId,
                    cdpEndpoint: String(browserConnectionOptions.cdpEndpoint || process.env.CDP_ENDPOINT || '').trim() || null,
                    taskType,
                    visitedUrls: runtime.visitedUrls,
                    startedAt: runtime.startedAt,
                    finishedAt: nowIso(),
                    selectorStrategy: 'platform-module + multi-candidate selectors + risk detection',
                },
                debugMeta: {
                    snapshotDir,
                    tempDir: snapshotDir,
                    profileId: collectProfileId,
                    cdpEndpoint: String(browserConnectionOptions.cdpEndpoint || process.env.CDP_ENDPOINT || '').trim() || null,
                    taskType,
                    workspaceDir: typeof taskConfig.workspaceDir === 'string' && taskConfig.workspaceDir.trim()
                        ? taskConfig.workspaceDir.trim()
                        : null,
                },
            },
        };
    } catch (error) {
        await captureScreenshot(
            page,
            runtime.snapshotDir,
            'failed',
            runtime.snapshots,
            runtime.captureSnapshots === true,
        );
        const errorMessage = error?.message || '采集执行失败';
        const riskKind = detectRiskKind(errorMessage);
        const normalizedRisk = riskKind
            ? {
                  blocked: true,
                  riskKind,
                  title: '',
                  bodyText: sanitizeText(errorMessage).slice(0, 1000),
                  url: page.url(),
              }
            : null;

        return {
            success: false,
            status: normalizedRisk ? mapBlockedRiskToStatus(normalizedRisk.riskKind) : 'failed',
            message: normalizedRisk
                ? mapBlockedRiskToStatus(normalizedRisk.riskKind) === 'skipped'
                    ? `页面受限，已跳过: ${normalizedRisk.riskKind}`
                    : `页面异常: ${normalizedRisk.riskKind}`
                : errorMessage,
            data: {
                runId: taskConfig.runId || null,
                taskId: taskConfig.taskId || null,
                platform,
                taskType,
                collectScene,
                records: [],
                snapshots: runtime.snapshots,
                summary: {
                    profileId: collectProfileId,
                    cdpEndpoint: String(browserConnectionOptions.cdpEndpoint || process.env.CDP_ENDPOINT || '').trim() || null,
                    taskType,
                    visitedUrls: runtime.visitedUrls,
                    startedAt: runtime.startedAt,
                    finishedAt: nowIso(),
                    ...(normalizedRisk ? { risk: normalizedRisk } : {}),
                },
                debugMeta: {
                    snapshotDir,
                    tempDir: snapshotDir,
                    profileId: collectProfileId,
                    cdpEndpoint: String(browserConnectionOptions.cdpEndpoint || process.env.CDP_ENDPOINT || '').trim() || null,
                    taskType,
                    workspaceDir: typeof taskConfig.workspaceDir === 'string' && taskConfig.workspaceDir.trim()
                        ? taskConfig.workspaceDir.trim()
                        : null,
                    error: errorMessage,
                },
            },
        };
    } finally {
        const cleanupPages = Array.isArray(runtime.cleanupPages) ? runtime.cleanupPages : [];
        for (const extraPage of cleanupPages) {
            if (!extraPage || extraPage === page) {
                continue;
            }
            await extraPage.close().catch(() => {});
        }
        await page.close().catch(() => {});
    }
}

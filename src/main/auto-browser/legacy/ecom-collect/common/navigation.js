import path from 'path';
import { logger } from '../../utils/logger.js';
import { DEFAULT_PAGE_TIMEOUT_MS } from './constants.js';
import { inspectRisk } from './risk.js';
import { nowIso, sleep } from './runtime.js';

export async function captureScreenshot(page, snapshotDir, stage, snapshots, enabled = true) {
    if (!enabled || !snapshotDir) {
        return null;
    }

    const filename = `${Date.now()}-${String(stage || 'snapshot').replace(/[^a-zA-Z0-9_-]/g, '-')}.png`;
    const filePath = path.join(snapshotDir, filename);

    try {
        await page.screenshot({
            path: filePath,
            fullPage: true,
        });
        const snapshot = {
            type: 'screenshot',
            stage,
            path: filePath,
            createdAt: nowIso(),
        };
        snapshots.push(snapshot);
        return snapshot;
    } catch (error) {
        logger.warn(`[ecomCollect] 截图失败 ${stage}: ${error?.message || error}`);
        return null;
    }
}

export async function gotoWithRetry(page, url, timeout = DEFAULT_PAGE_TIMEOUT_MS) {
    const waitStrategies = ['domcontentloaded', 'load', 'networkidle'];
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        for (const waitUntil of waitStrategies) {
            try {
                const response = await page.goto(url, {
                    waitUntil,
                    timeout,
                });
                return {
                    ok: true,
                    url,
                    waitUntil,
                    status: response?.status?.() ?? null,
                };
            } catch (error) {
                lastError = error;
                logger.warn(`[ecomCollect] 导航失败 attempt=${attempt} waitUntil=${waitUntil}: ${error?.message || error}`);
            }
        }
        await sleep(attempt * 1200);
    }

    throw lastError || new Error('页面导航失败');
}

export async function waitForAnySelector(page, selectors = [], timeout = 15_000) {
    const normalizedSelectors = selectors
        .map((item) => String(item || '').trim())
        .filter(Boolean);

    for (const selector of normalizedSelectors) {
        try {
            await page.waitForSelector(selector, { timeout });
            return selector;
        } catch {
            // try next selector
        }
    }

    return '';
}

export async function prepareCollectionPage(page, runtime, options = {}) {
    const url = String(options.url || '').trim();
    const blockedStage = String(options.blockedStage || 'blocked').trim() || 'blocked';
    const waitSelectors = Array.isArray(options.waitSelectors) ? options.waitSelectors : [];
    const onReady = typeof options.onReady === 'function' ? options.onReady : null;
    const timeoutMs = Number(options.timeoutMs) || DEFAULT_PAGE_TIMEOUT_MS;

    if (!url) {
        throw new Error('缺少目标页面地址');
    }

    const inspectBlockedRisk = async () => {
        const risk = await inspectRisk(page);
        if (!risk.blocked) {
            return null;
        }

        await captureScreenshot(
            page,
            runtime.snapshotDir,
            blockedStage,
            runtime.snapshots,
            runtime.captureSnapshots === true,
        );
        return risk;
    };

    runtime.visitedUrls.push(url);
    await gotoWithRetry(page, url, timeoutMs);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    await sleep(1500);

    const initialRisk = await inspectBlockedRisk();
    if (initialRisk) {
        return {
            blocked: true,
            risk: initialRisk,
            detectedSelector: '',
        };
    }

    if (onReady) {
        await onReady({ page, runtime, url });
        await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
        await sleep(1500);

        const currentUrl = page.url();
        if (currentUrl && !runtime.visitedUrls.includes(currentUrl)) {
            runtime.visitedUrls.push(currentUrl);
        }

        const postReadyRisk = await inspectBlockedRisk();
        if (postReadyRisk) {
            return {
                blocked: true,
                risk: postReadyRisk,
                detectedSelector: '',
            };
        }
    }

    const detectedSelector = await waitForAnySelector(page, waitSelectors, 15_000);
    if (detectedSelector) {
        const matchedSelectorRisk = await inspectBlockedRisk();
        if (matchedSelectorRisk) {
            return {
                blocked: true,
                risk: matchedSelectorRisk,
                detectedSelector,
            };
        }
    }

    if (!detectedSelector) {
        const emptyStateRisk = await inspectBlockedRisk();
        if (emptyStateRisk) {
            return {
                blocked: true,
                risk: emptyStateRisk,
                detectedSelector: '',
            };
        }
    }

    return {
        blocked: false,
        risk: null,
        detectedSelector,
    };
}

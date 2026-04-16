/**
 * HTTP API 服务器
 * 提供 RESTful API 接口 + 前端静态文件（同一端口）
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import util from 'util';
import { spawn } from 'child_process';
import { URL, fileURLToPath } from 'url';
import publishService from './publishService.js';
import crawlerService from './crawlerService.js';
import {
    getBrowserStatus,
    getOrCreateBrowser,
    closeBrowser,
    focusBrowser,
    launchWithDebugPort,
    checkAndReconnectBrowser,
    exportUserData,
    forceCloseBrowserByPort,
    listBrowserPages,
    getBrowserPage,
    createBrowserPage,
    listManagedBrowserProfiles,
    getManagedBrowserProfile,
    createManagedBrowserProfile,
    updateManagedBrowserProfile,
    deleteManagedBrowserProfile,
    switchManagedBrowserProfile
} from '../services/BrowserService.js';
import { PlatformLoginService } from '../services/PlatformLoginService.js';
import {
    listBrowserAutomationSmallFeatures,
    runBrowserAutomationSmallFeature
} from '../services/BrowserAutomationSmallFeatureService.js';
import taskManager from '../services/TaskManager.js';
import { logger } from '../utils/logger.js';
import { openExternalUrl, shouldAutoOpenBrowserOnStart } from '../utils/appLauncher.js';
import { PLATFORM_CONFIGS } from '../config/platforms.js';
import { getBrowserProfilesWorkspaceDir } from '../services/BrowserProfileService.js';
import {
    getEcomCollectCapabilities,
    getEcomPlatformCatalog,
    runEcomCollectTask,
} from '../ecom-collect/ecomCollectService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = process.env.FRONTEND_DIST
    ? path.resolve(process.env.FRONTEND_DIST)
    : path.resolve(__dirname, '../../web/dist');
const UPLOAD_DIR = path.resolve(__dirname, '../../temp');
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

function normalizeDebugValue(value, depth = 0) {
    if (depth > 4) return '[MaxDepth]';
    if (value === undefined) return '[undefined]';
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack
        };
    }
    if (Array.isArray(value)) {
        return value.map(item => normalizeDebugValue(item, depth + 1));
    }
    if (typeof value === 'object') {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            // ignore
        }

        const plain = {};
        for (const [key, val] of Object.entries(value)) {
            plain[key] = normalizeDebugValue(val, depth + 1);
        }
        if (Object.keys(plain).length) return plain;
        return util.inspect(value, { depth: 2, breakLength: 120 });
    }
    return String(value);
}

async function executePlaywrightScript(page, script) {
    const logs = [];
    const scriptConsole = {
        log: (...args) => logs.push({ level: 'log', args: args.map(item => normalizeDebugValue(item)) }),
        info: (...args) => logs.push({ level: 'info', args: args.map(item => normalizeDebugValue(item)) }),
        warn: (...args) => logs.push({ level: 'warn', args: args.map(item => normalizeDebugValue(item)) }),
        error: (...args) => logs.push({ level: 'error', args: args.map(item => normalizeDebugValue(item)) })
    };

    const wrapped = `
        "use strict";
        return await (async () => {
            ${script}
        })();
    `;

    const runner = new AsyncFunction('page', 'context', 'locator', 'console', wrapped);
    const value = await runner(
        page,
        page.context(),
        (selector) => page.locator(selector),
        scriptConsole
    );

    return {
        value: normalizeDebugValue(value),
        logs
    };
}

/** 与前端一致的默认 CDP 独立配置目录（避免占用系统 Chrome profile） */
function getDefaultCdpUserDataDir() {
    const envDir = process.env.YISHE_AUTO_BROWSER_CDP_USER_DATA_DIR || process.env.UPLOADER_CDP_USER_DATA_DIR;
    if (envDir) {
        return envDir;
    }

    return path.resolve(getBrowserProfilesWorkspaceDir(), 'cdp-user-data');
}

function normalizeSourceId(value) {
    const normalized = String(value || '').trim();
    return normalized || undefined;
}

function buildTaskSource(input = {}) {
    const sourceId = normalizeSourceId(input.sourceId || input.id);
    const source = input.source && typeof input.source === 'object'
        ? { ...input.source }
        : {};

    return {
        system: String(source.system || 'yishe-client').trim() || 'yishe-client',
        module: String(source.module || 'queue-executor').trim() || 'queue-executor',
        kind: String(source.kind || input.kind || 'generic').trim() || 'generic',
        id: normalizeSourceId(source.id || sourceId),
        traceId: normalizeSourceId(source.traceId),
        createdAt: source.createdAt,
    };
}

function buildSourcesFromQueryBody(body = {}) {
    const sourceIds = Array.isArray(body?.sourceIds)
        ? body.sourceIds.map((item) => normalizeSourceId(item)).filter(Boolean)
        : [];

    if (sourceIds.length > 0) {
        return sourceIds.map((sourceId) => buildTaskSource({ sourceId }));
    }

    const sources = Array.isArray(body?.sources) ? body.sources : [];
    if (sources.length > 0) {
        return sources.map((source) => buildTaskSource(source));
    }

    const singleSourceId = normalizeSourceId(body?.sourceId);
    if (singleSourceId) {
        return [buildTaskSource({ sourceId: singleSourceId })];
    }

    return [];
}

/**
 * API服务器类
 */
const BROWSER_CHECK_INTERVAL_MS = Number(process.env.BROWSER_CHECK_INTERVAL_MS) || 10000;
const SILENT_REQUEST_PATHS = new Set([
    '/api',
    '/api/browser/status',
    '/api/browser/pages'
]);

class ApiServer {
    constructor(port = 7010) {
        this.port = port;
        this.server = null;
        this.browserCheckTimer = null;
        this.isStopping = false;
    }

    /**
     * 启动服务器
     */
    start() {
        taskManager.start();
        this.server = http.createServer(async (req, res) => {
            await this.handleRequest(req, res);
        });

        this.server.listen(this.port, () => {
            const accessUrl = `http://localhost:${this.port}`;
            logger.info(`服务已启动，端口: ${this.port}`);
            logger.info(`访问地址: ${accessUrl}`);
            this.startBrowserCheckTimer();

            if (shouldAutoOpenBrowserOnStart()) {
                setTimeout(() => {
                    const opened = openExternalUrl(accessUrl);
                    if (opened) {
                        logger.info(`已自动打开管理界面: ${accessUrl}`);
                    } else {
                        logger.warn(`自动打开管理界面失败，请手动访问: ${accessUrl}`);
                    }
                }, 1200);
            }
        });

        return this.server;
    }

    /** 定时检测浏览器实例（断开则清除引用，便于下次发布时自动重连） */
    startBrowserCheckTimer() {
        if (this.browserCheckTimer) return;
        this.browserCheckTimer = setInterval(async () => {
            try {
                const result = await checkAndReconnectBrowser({ reconnect: true });
                if (result.available && (result.reconnected || result.adopted)) {
                    logger.info('定时检测: 已自动接管可用浏览器实例');
                } else if (!result.available && result.message && !result.message.includes('无浏览器实例')) {
                    logger.debug('定时检测: 未接管到可用浏览器实例:', result.message);
                }
            } catch (e) {
                logger.debug('定时检测浏览器异常:', e?.message);
            }
        }, BROWSER_CHECK_INTERVAL_MS);
        logger.info(`浏览器实例定时检测已启动，间隔 ${BROWSER_CHECK_INTERVAL_MS / 1000} 秒`);
    }

    stopBrowserCheckTimer() {
        if (this.browserCheckTimer) {
            clearInterval(this.browserCheckTimer);
            this.browserCheckTimer = null;
            logger.info('浏览器实例定时检测已停止');
        }
    }

    /**
     * 停止服务器
     */
    async stop() {
        if (this.isStopping) {
            return;
        }
        this.isStopping = true;
        this.stopBrowserCheckTimer();
        taskManager.stop();
        try {
            await closeBrowser();
        } catch (error) {
            logger.warn('停止 API 服务时关闭浏览器失败:', error?.message || error);
        }

        if (this.server) {
            await new Promise((resolve) => {
                this.server.close(() => resolve());
            });
            this.server = null;
            logger.info('API服务器已停止');
        }
    }

    createRuntimeTask(payload = {}) {
        const {
            kind = 'publish',
            action = 'publish',
            source = {},
            sourceId,
            metadata = {},
            concurrent = false,
            platforms = [],
            publishInfo = {},
        } = payload;
        const taskSource = buildTaskSource({ source, sourceId, kind });

        return taskManager.createTask({
            kind,
            action,
            platform: platforms[0],
            platforms,
            source: taskSource,
            metadata,
            request: {
                action,
                concurrent: !!concurrent,
                platforms,
                payload: publishInfo,
            },
        }, async (taskContext) => {
            taskContext.setStep('dispatch', {
                current: 0,
                total: platforms.length,
                message: `准备执行 ${platforms.length} 个平台任务`,
            });
                taskContext.log('info', '开始执行任务', {
                    action,
                    platforms,
                    source: taskSource,
                });

            const result = await publishService.batchPublish(
                platforms,
                { ...publishInfo, action },
                {
                    concurrent: !!concurrent,
                    taskLogHandler: (entry) => {
                        if (!entry?.message) return;
                        taskContext.log(entry.level || 'info', entry.message, entry.data);
                    }
                }
            );

            taskContext.setStep(result?.success ? 'completed' : 'failed', {
                current: platforms.length,
                total: platforms.length,
                message: result?.success
                    ? '任务执行完成'
                    : '任务执行结束，存在失败平台',
            });
            taskContext.log(result?.success ? 'info' : 'warn', '任务执行返回结果', result);
            return result;
        });
    }

    /**
     * 处理请求
     */
    async handleRequest(req, res) {
        // 设置CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // 处理OPTIONS请求
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const reqPath = url.pathname;
            const method = req.method;

            if (!SILENT_REQUEST_PATHS.has(reqPath)) {
                logger.info(`${method} ${reqPath}`);
            }

            // API 路由
            if (reqPath.startsWith('/api')) {
                if (reqPath === '/api' && method === 'GET') {
                    await this.handleApiIndex(req, res);
                } else if (reqPath === '/api/docs' && method === 'GET') {
                    await this.handleApiDocs(req, res);
                } else if (reqPath === '/api/swagger' && method === 'GET') {
                    await this.handleSwaggerUi(req, res);
                } else if (reqPath === '/api/publish' && method === 'POST') {
                    await this.handlePublishUnified(req, res);
                } else if (reqPath === '/api/tasks/execute' && method === 'POST') {
                    await this.handleCreateExecutionTask(req, res);
                } else if (reqPath === '/api/tasks' && method === 'GET') {
                    await this.handleListTasks(req, res, url);
                } else if (reqPath === '/api/tasks/query-by-source' && method === 'POST') {
                    await this.handleQueryTasksBySource(req, res);
                } else if (reqPath === '/api/tasks/cancel-by-source' && method === 'POST') {
                    await this.handleCancelTasksBySource(req, res);
                } else if (reqPath === '/api/tasks/logs/query-by-source' && method === 'POST') {
                    await this.handleQueryTaskLogsBySource(req, res);
                } else if (reqPath.startsWith('/api/tasks/') && reqPath.endsWith('/logs') && method === 'GET') {
                    await this.handleGetTaskLogs(req, res, reqPath);
                } else if (reqPath.startsWith('/api/tasks/') && method === 'GET') {
                    await this.handleGetTask(req, res, reqPath);
                } else if (reqPath === '/api/schedule' && method === 'POST') {
                    await this.handleCreateSchedule(req, res);
                } else if (reqPath === '/api/platforms' && method === 'GET') {
                    await this.handleGetPlatforms(req, res);
                } else if (reqPath === '/api/browser/status' && method === 'GET') {
                    await this.handleBrowserStatus(req, res);
                } else if (reqPath === '/api/browser/connect' && method === 'POST') {
                    await this.handleBrowserConnect(req, res);
                } else if (reqPath === '/api/browser/close' && method === 'POST') {
                    await this.handleBrowserClose(req, res);
                } else if (reqPath === '/api/browser/focus' && method === 'POST') {
                    await this.handleBrowserFocus(req, res);
                } else if (reqPath === '/api/browser/force-close' && method === 'POST') {
                    await this.handleBrowserForceClose(req, res);
                } else if (reqPath === '/api/browser/launch-with-debug' && method === 'POST') {
                    await this.handleBrowserLaunchDebug(req, res);
                } else if (reqPath === '/api/browser/check-port' && method === 'POST') {
                    await this.handleBrowserCheckPort(req, res);
                } else if (reqPath === '/api/browser/open-platform' && method === 'POST') {
                    await this.handleBrowserOpenPlatform(req, res);
                } else if (reqPath === '/api/browser/open-link' && method === 'POST') {
                    await this.handleBrowserOpenLink(req, res);
                } else if (reqPath === '/api/browser/small-features' && method === 'GET') {
                    await this.handleBrowserSmallFeatures(req, res);
                } else if (reqPath === '/api/browser/small-features/run' && method === 'POST') {
                    await this.handleBrowserRunSmallFeature(req, res);
                } else if (reqPath === '/api/browser/open-user-data-dir' && method === 'POST') {
                    await this.handleBrowserOpenUserDataDir(req, res);
                } else if (reqPath === '/api/browser/pages' && method === 'GET') {
                    await this.handleBrowserPages(req, res);
                } else if (reqPath === '/api/browser/debug' && method === 'POST') {
                    await this.handleBrowserDebug(req, res);
                } else if (reqPath === '/api/browser/profiles' && method === 'GET') {
                    await this.handleBrowserProfilesList(req, res);
                } else if (reqPath === '/api/browser/profiles' && method === 'POST') {
                    await this.handleBrowserProfilesCreate(req, res);
                } else if (reqPath.startsWith('/api/browser/profiles/') && reqPath.endsWith('/switch') && method === 'POST') {
                    await this.handleBrowserProfileSwitch(req, res, reqPath);
                } else if (reqPath.startsWith('/api/browser/profiles/') && method === 'GET') {
                    await this.handleBrowserProfileDetail(req, res, reqPath);
                } else if (reqPath.startsWith('/api/browser/profiles/') && method === 'PUT') {
                    await this.handleBrowserProfileUpdate(req, res, reqPath);
                } else if (reqPath.startsWith('/api/browser/profiles/') && method === 'DELETE') {
                    await this.handleBrowserProfileDelete(req, res, reqPath);
                } else if ((reqPath === '/api/browser/check-and-reconnect' || reqPath === '/api/browser/check') && (method === 'POST' || method === 'GET')) {
                    await this.handleBrowserCheckAndReconnect(req, res);
                } else if (reqPath === '/api/upload' && method === 'POST') {
                    await this.handleUpload(req, res);
                } else if (reqPath === '/api/login-status' && method === 'GET') {
                    await this.handleLoginStatus(req, res);
                } else if (reqPath === '/api/browser/export-user-data' && method === 'GET') {
                    await this.handleExportUserData(req, res);
                } else if (reqPath === '/api/crawler/health' && method === 'GET') {
                    await this.handleCrawlerHealth(req, res);
                } else if (reqPath === '/api/crawler/sites' && method === 'GET') {
                    await this.handleCrawlerSites(req, res);
                } else if (reqPath === '/api/crawler/url' && method === 'POST') {
                    await this.handleCrawlUrl(req, res);
                } else if (reqPath === '/api/crawler/run' && method === 'POST') {
                    await this.handleCrawlerRun(req, res);
                } else if (reqPath === '/api/ecom-collect/platforms' && method === 'GET') {
                    await this.handleEcomCollectPlatforms(req, res);
                } else if (reqPath === '/api/ecom-collect/capabilities' && method === 'GET') {
                    await this.handleEcomCollectCapabilities(req, res);
                } else if (reqPath === '/api/ecom-collect/run' && method === 'POST') {
                    await this.handleEcomCollectRun(req, res);
                } else {
                    this.sendResponse(res, 404, { success: false, error: 'Not Found' });
                }
            } else {
                // 静态文件（前端）
                await this.serveStatic(req, res, reqPath);
            }

        } catch (error) {
            logger.error('请求处理错误:', error);
            this.sendResponse(res, 500, { error: error.message });
        }
    }

    /**
     * API 概览（供前端/外部发现）
     */
    async handleApiIndex(req, res) {
        const base = `http://${req.headers.host}`;
        this.sendResponse(res, 200, {
            name: 'Yishe Auto Browser API',
            version: '2.0',
            docs: `${base}/api/docs`,
            swagger: `${base}/api/swagger`,
            endpoints: [
                { method: 'GET', path: '/api', description: 'API 概览（本接口）' },
                { method: 'GET', path: '/api/docs', description: 'API 文档（JSON）' },
                { method: 'GET', path: '/api/swagger', description: 'Swagger UI 在线调试页' },
                { method: 'POST', path: '/api/publish', description: '发布（传 platforms 数组，单平台如 ["douyin"]）' },
                { method: 'POST', path: '/api/tasks/execute', description: '创建通用执行任务（基于 source 进行弱绑定）' },
                { method: 'GET', path: '/api/tasks', description: '获取任务列表' },
                { method: 'GET', path: '/api/tasks/:taskId', description: '获取任务详情' },
                { method: 'GET', path: '/api/tasks/:taskId/logs', description: '获取任务日志' },
                { method: 'POST', path: '/api/tasks/query-by-source', description: '按 source 批量查询任务状态' },
                { method: 'POST', path: '/api/tasks/cancel-by-source', description: '按 source 批量取消任务' },
                { method: 'POST', path: '/api/tasks/logs/query-by-source', description: '按 source 批量查询任务日志' },
                { method: 'POST', path: '/api/schedule', description: '创建定时发布' },
                { method: 'GET', path: '/api/platforms', description: '支持的平台列表' },
                { method: 'POST', path: '/api/upload', description: '上传视频/图片文件' },
                { method: 'GET', path: '/api/login-status', description: '各平台登录状态' },
                { method: 'GET', path: '/api/browser/status', description: '浏览器连接状态' },
                { method: 'POST', path: '/api/browser/connect', description: '连接浏览器' },
                { method: 'POST', path: '/api/browser/close', description: '关闭浏览器' },
                { method: 'POST', path: '/api/browser/focus', description: '聚焦浏览器窗口并恢复最小化状态' },
                { method: 'POST', path: '/api/browser/force-close', description: '强制关闭指定端口浏览器（默认 9222）' },
                { method: 'POST', path: '/api/browser/launch-with-debug', description: '启动带调试端口的 Chrome' },
                { method: 'POST', path: '/api/browser/check-port', description: '检测 CDP 端口' },
                { method: 'POST', path: '/api/browser/open-platform', description: '在已连接浏览器中打开指定平台创作页' },
                { method: 'POST', path: '/api/browser/open-link', description: '在已连接浏览器中打开指定链接' },
                { method: 'GET', path: '/api/browser/small-features', description: '获取浏览器自动化端工具目录' },
                { method: 'POST', path: '/api/browser/small-features/run', description: '执行浏览器自动化端工具' },
                { method: 'POST', path: '/api/browser/open-user-data-dir', description: '在本机文件管理器中打开指定用户数据目录' },
                { method: 'GET', path: '/api/browser/pages', description: '获取当前浏览器标签页列表' },
                { method: 'POST', path: '/api/browser/debug', description: '对当前浏览器页面执行调试动作（goto/click/fill/text/eval 等）' },
                { method: 'POST', path: '/api/browser/check-and-reconnect', description: '检测浏览器实例并可选重连（body: { reconnect?: boolean }）' },
                { method: 'GET', path: '/api/browser/check', description: '仅检测浏览器实例（不重连）' },
                { method: 'GET', path: '/api/browser/export-user-data', description: '导出 User Data 压缩包' },
                { method: 'GET', path: '/api/crawler/health', description: '爬虫服务健康检查' },
                { method: 'GET', path: '/api/crawler/sites', description: '获取可用爬虫站点列表' },
                { method: 'POST', path: '/api/crawler/url', description: '按 URL 通用抓取（可传规则）' },
                { method: 'POST', path: '/api/crawler/run', description: '执行指定 site 的爬虫任务' },
                { method: 'GET', path: '/api/ecom-collect/platforms', description: '获取电商采集平台与场景目录' },
                { method: 'GET', path: '/api/ecom-collect/capabilities', description: '获取电商采集平台完整能力 schema（字段、示例、可用性、维护说明）' },
                { method: 'POST', path: '/api/ecom-collect/run', description: '执行一次电商平台数据采集' }
            ]
        });
    }

    /**
     * API 文档（机器可读的接口说明）
     */
    async handleApiDocs(req, res) {
        const base = `http://${req.headers.host}`;
        this.sendResponse(res, 200, {
            openapi: '3.0.0',
            info: {
                title: 'Yishe Auto Browser API',
                version: '2.0',
                description: '浏览器自动化 + 发布 + 爬虫接口，支持 Swagger 在线调试'
            },
            servers: [{ url: base }],
            tags: [
                { name: 'System', description: '系统发现与文档' },
                { name: 'Publish', description: '发布相关接口' },
                { name: 'Browser', description: '浏览器连接与状态' },
                { name: 'Upload', description: '文件上传' },
                { name: 'Auth', description: '平台登录状态' },
                { name: 'Crawler', description: '爬虫接口' },
                { name: 'EcomCollect', description: '电商平台数据采集' }
            ],
            paths: {
                '/api': {
                    get: {
                        tags: ['System'],
                        summary: 'API 概览',
                        responses: { 200: { description: 'API 基本信息与端点列表' } }
                    }
                },
                '/api/docs': {
                    get: {
                        tags: ['System'],
                        summary: 'OpenAPI 文档 JSON',
                        responses: { 200: { description: 'OpenAPI 3.0 文档' } }
                    }
                },
                '/api/swagger': {
                    get: {
                        tags: ['System'],
                        summary: 'Swagger UI 在线调试页面',
                        responses: { 200: { description: 'Swagger UI HTML 页面' } }
                    }
                },
                '/api/publish': {
                    post: {
                        tags: ['Publish'],
                        summary: '发布到平台（单平台或多平台统一接口）',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['platforms', 'title'],
                                        properties: {
                                            platforms: { type: 'array', items: { type: 'string' }, description: '平台 ID 数组，单平台如 ["douyin"]，多平台如 ["douyin", "xiaohongshu"]' },
                                            title: { type: 'string' },
                                            content: { type: 'string', description: '正文内容（可选）' },
                                            filePath: { type: 'string', description: '本机视频/图片绝对路径（服务端可访问），如 C:\\videos\\demo.mp4，无需上传' },
                                            images: { type: 'array', items: { type: 'string' }, description: '图文发布用图片 URL 列表（可选）' },
                                            imageUrls: { type: 'array', items: { type: 'string' }, description: '兼容字段：图片 URL 列表（会自动映射到 images）' },
                                            videoUrl: { type: 'string', description: '兼容字段：视频 URL/路径（会自动映射到 filePath 或 videos）' },
                                            tags: { type: 'array', items: { type: 'string' } },
                                            scheduled: { type: 'boolean' },
                                            scheduleTime: { type: 'string', format: 'date-time' },
                                            concurrent: { type: 'boolean', description: '多平台时是否并发' },
                                            platformSettings: { type: 'object' },
                                            publishOptions: { type: 'object', description: '兼容字段：平台发布参数（会自动合并到平台配置）' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '发布结果' } }
                    }
                },
                '/api/schedule': {
                    post: {
                        tags: ['Publish'],
                        summary: '创建定时发布任务',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['platforms', 'scheduleTime'],
                                        properties: {
                                            platforms: { type: 'array', items: { type: 'string' }, description: '平台 ID 数组' },
                                            scheduleTime: { type: 'string', format: 'date-time', description: '执行时间（ISO）' },
                                            title: { type: 'string' },
                                            content: { type: 'string' },
                                            filePath: { type: 'string' },
                                            images: { type: 'array', items: { type: 'string' } },
                                            tags: { type: 'array', items: { type: 'string' } },
                                            platformSettings: { type: 'object' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '任务创建结果' } }
                    }
                },
                '/api/platforms': {
                    get: {
                        tags: ['Publish'],
                        summary: '获取支持平台列表',
                        responses: { 200: { description: '平台列表' } }
                    }
                },
                '/api/upload': {
                    post: {
                        tags: ['Upload'],
                        summary: '上传文件（multipart/form-data）',
                        requestBody: {
                            required: true,
                            content: {
                                'multipart/form-data': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            file: { type: 'string', format: 'binary', description: '上传文件字段（file）' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '上传结果（返回保存路径）' } }
                    }
                },
                '/api/login-status': {
                    get: {
                        tags: ['Auth'],
                        summary: '获取平台登录状态',
                        parameters: [
                            {
                                name: 'refresh',
                                in: 'query',
                                required: false,
                                schema: { type: 'string', enum: ['0', '1'] },
                                description: '是否强制刷新检测，1=强制'
                            }
                        ],
                        responses: { 200: { description: '登录状态结果' } }
                    }
                },
                '/api/browser/status': {
                    get: {
                        tags: ['Browser'],
                        summary: '获取浏览器连接状态',
                        responses: { 200: { description: '状态结果' } }
                    }
                },
                '/api/browser/connect': {
                    post: {
                        tags: ['Browser'],
                        summary: '连接浏览器',
                        requestBody: {
                            required: false,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            mode: { type: 'string', enum: ['cdp'], description: '浏览器连接模式，当前仅支持 cdp' },
                                            profileId: { type: 'string', description: '可选：受管环境 ID；未传时默认绑定当前活动环境' },
                                            cdpEndpoint: { type: 'string', description: '如 http://127.0.0.1:9222' },
                                            port: { type: 'number', description: 'CDP 调试端口，默认 9222（仅未绑定 profileId 的直连场景需要）' },
                                            cdpUserDataDir: { type: 'string', description: '可选：CDP 直连时的浏览器 User Data 目录' },
                                            userDataDir: { type: 'string', description: '兼容字段：等同于 cdpUserDataDir' },
                                            headless: { type: 'boolean', description: '是否无头模式，默认false（可通过HEADLESS环境变量设置）' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '连接结果' } }
                    }
                },
                '/api/browser/close': {
                    post: {
                        tags: ['Browser'],
                        summary: '关闭浏览器连接',
                        responses: { 200: { description: '关闭结果' } }
                    }
                },
                '/api/browser/focus': {
                    post: {
                        tags: ['Browser'],
                        summary: '聚焦浏览器窗口并恢复最小化状态',
                        responses: { 200: { description: '聚焦结果' } }
                    }
                },
                '/api/browser/force-close': {
                    post: {
                        tags: ['Browser'],
                        summary: '强制关闭指定端口浏览器',
                        requestBody: {
                            required: false,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            port: { type: 'number', description: '远程调试端口，默认 9222' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '关闭结果' } }
                    }
                },
                '/api/browser/launch-with-debug': {
                    post: {
                        tags: ['Browser'],
                        summary: '启动带调试端口的 Chrome',
                        requestBody: {
                            required: false,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            port: { type: 'number', description: '远程调试端口，默认 9222' },
                                            userDataDir: { type: 'string', description: '可选 user-data-dir' },
                                            headless: { type: 'boolean', description: '是否无头模式，默认false（可通过HEADLESS环境变量设置）' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '启动结果' } }
                    }
                },
                '/api/browser/check-port': {
                    post: {
                        tags: ['Browser'],
                        summary: '检测 CDP 端口是否可用',
                        requestBody: {
                            required: false,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            port: { type: 'number', description: '默认 9222' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '检测结果' } }
                    }
                },
                '/api/browser/open-platform': {
                    post: {
                        tags: ['Browser'],
                        summary: '在已连接浏览器打开平台创作页',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['platform'],
                                        properties: {
                                            platform: { type: 'string', description: '平台 ID，如 douyin、xiaohongshu、weibo、kuaishou、doudian、kuaishou_shop、temu' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '打开结果' } }
                    }
                },
                '/api/browser/open-link': {
                    post: {
                        tags: ['Browser'],
                        summary: '在已连接浏览器打开指定链接',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['url'],
                                        properties: {
                                            url: { type: 'string', description: 'http/https 链接' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '打开结果' } }
                    }
                },
                '/api/browser/small-features': {
                    get: {
                        tags: ['Browser'],
                        summary: '获取浏览器自动化端工具目录',
                        responses: { 200: { description: '工具目录结果' } }
                    }
                },
                '/api/browser/small-features/run': {
                    post: {
                        tags: ['Browser'],
                        summary: '执行浏览器自动化端工具',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['featureKey'],
                                        properties: {
                                            featureKey: { type: 'string', description: '工具标识，如 temu-session-acquire / temu-login / temu-session-collect' },
                                            profileId: { type: 'string', description: '可选，指定执行环境' },
                                            acquireMode: { type: 'string', description: 'Temu 会话获取方式，可选 direct / login' },
                                            keepPageOpen: { type: 'boolean', description: '执行后是否保留页面，默认 true' },
                                            collectRegionCookies: { type: 'boolean', description: 'Temu 会话采集时是否补抓 global/us/eu 区域 cookies，默认 true' },
                                            account: { type: 'string', description: '账号类工具需要的账号' },
                                            password: { type: 'string', description: '账号类工具需要的密码' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '执行结果' } }
                    }
                },
                '/api/browser/open-user-data-dir': {
                    post: {
                        tags: ['Browser'],
                        summary: '在本机文件管理器中打开指定用户数据目录',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['dirPath'],
                                        properties: {
                                            dirPath: { type: 'string', description: '要打开的目录路径' },
                                            ensureExists: { type: 'boolean', description: '目录不存在时是否自动创建', default: true }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '打开结果' } }
                    }
                },
                '/api/browser/check-and-reconnect': {
                    get: {
                        tags: ['Browser'],
                        summary: '检测浏览器实例（GET，不重连）',
                        responses: { 200: { description: '检测结果' } }
                    },
                    post: {
                        tags: ['Browser'],
                        summary: '检测浏览器实例并可选重连（POST）',
                        requestBody: {
                            required: false,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            reconnect: { type: 'boolean', description: 'true 时断开后尝试重连' }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '检测结果' } }
                    }
                },
                '/api/browser/check': {
                    get: {
                        tags: ['Browser'],
                        summary: '仅检测浏览器实例（不重连）',
                        responses: { 200: { description: '检测结果' } }
                    }
                },
                '/api/browser/export-user-data': {
                    get: {
                        tags: ['Browser'],
                        summary: '导出 User Data 压缩包',
                        parameters: [
                            {
                                name: 'userDataDir',
                                in: 'query',
                                required: false,
                                schema: { type: 'string' },
                                description: '可选，指定导出的 user-data-dir 路径'
                            }
                        ],
                        responses: { 200: { description: 'ZIP 文件流（application/zip）' } }
                    }
                },
                '/api/crawler/health': {
                    get: {
                        tags: ['Crawler'],
                        summary: '爬虫服务健康检查',
                        responses: { 200: { description: '健康状态' } }
                    }
                },
                '/api/crawler/sites': {
                    get: {
                        tags: ['Crawler'],
                        summary: '获取可用爬虫站点列表',
                        responses: { 200: { description: '站点列表' } }
                    }
                },
                '/api/crawler/url': {
                    post: {
                        tags: ['Crawler'],
                        summary: '按 URL 执行通用抓取',
                        description: '通用 URL 爬取接口，可应用于任意网站。支持自定义选择器和等待策略。',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['url'],
                                        properties: {
                                            url: { type: 'string', description: '要抓取的页面 URL，如 https://example.com' },
                                            waitUntil: { type: 'string', enum: ['domcontentloaded', 'load', 'networkidle'], description: '页面加载等待策略，默认 domcontentloaded' },
                                            timeout: { type: 'number', description: '超时时间（毫秒），默认 30000' },
                                            rules: {
                                                type: 'object',
                                                description: '提取规则（可选）',
                                                properties: {
                                                    titleSelector: { type: 'string', description: 'CSS 选择器，用于提取页面标题，默认 "title"' },
                                                    contentSelector: { type: 'string', description: 'CSS 选择器，用于提取页面内容，默认 "body"' },
                                                    linksSelector: { type: 'string', description: 'CSS 选择器，用于提取链接，默认 "a[href]"' },
                                                    maxLinks: { type: 'number', description: '提取链接最大数量，默认 20' }
                                                }
                                            }
                                        }
                                    },
                                    examples: {
                                        'basic': {
                                            summary: '基础示例（仅传 URL）',
                                            value: {
                                                url: 'https://example.com'
                                            }
                                        },
                                        'with-wait-until': {
                                            summary: '自定义等待策略',
                                            value: {
                                                url: 'https://example.com',
                                                waitUntil: 'networkidle',
                                                timeout: 60000
                                            }
                                        },
                                        'with-rules': {
                                            summary: '自定义提取规则',
                                            value: {
                                                url: 'https://example.com',
                                                rules: {
                                                    titleSelector: 'h1.main-title',
                                                    contentSelector: 'div.article-content',
                                                    linksSelector: 'a.featured-link',
                                                    maxLinks: 50
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '抓取结果，包含标题、内容、链接等' } }
                    }
                },
                '/api/crawler/run': {
                    post: {
                        tags: ['Crawler'],
                        summary: '执行指定站点爬虫',
                        description: '针对特定网站（sora、pinterest等）的专门爬虫。每个网站有不同的参数和优化策略。',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['site'],
                                        properties: {
                                            site: { type: 'string', enum: ['sora', 'pinterest', 'demo'], description: '站点爬虫标识' },
                                            params: {
                                                type: 'object',
                                                description: '站点爬虫参数（见示例）',
                                                properties: {
                                                    maxImages: { type: 'number', description: '[Sora/Pinterest] 最大图片数量，默认 20' },
                                                    scrollTimes: { type: 'number', description: '[Sora/Pinterest] 滚动加载次数，默认 8' },
                                                    url: { type: 'string', description: '[Pinterest] 目标 URL，默认首页' },
                                                    titleSelector: { type: 'string', description: '[Demo] CSS 选择器' }
                                                }
                                            }
                                        }
                                    },
                                    examples: {
                                        'sora-default': {
                                            summary: 'Sora 爬虫 - 默认参数',
                                            description: '爬取 Sora 首页图片，返回 20 张',
                                            value: {
                                                site: 'sora',
                                                params: {}
                                            }
                                        },
                                        'sora-custom': {
                                            summary: 'Sora 爬虫 - 自定义参数',
                                            description: '设置最大图片数、增加滚动次数提升命中率',
                                            value: {
                                                site: 'sora',
                                                params: {
                                                    maxImages: 50,
                                                    scrollTimes: 12
                                                }
                                            }
                                        },
                                        'pinterest-default': {
                                            summary: 'Pinterest 爬虫 - 首页爬取',
                                            description: '爬取 Pinterest 首页图片',
                                            value: {
                                                site: 'pinterest',
                                                params: {}
                                            }
                                        },
                                        'pinterest-custom-url': {
                                            summary: 'Pinterest 爬虫 - 自定义页面',
                                            description: '爬取特定 Pinterest 页面（如用户主页、分类等）',
                                            value: {
                                                site: 'pinterest',
                                                params: {
                                                    url: 'https://www.pinterest.com/search/pins/?q=nature',
                                                    maxImages: 30,
                                                    scrollTimes: 10
                                                }
                                            }
                                        },
                                        'demo': {
                                            summary: 'Demo 爬虫 - 通用示例',
                                            description: '演示性爬虫，抓取任意 URL 并提取内容',
                                            value: {
                                                site: 'demo',
                                                params: {
                                                    url: 'https://example.com'
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '爬虫任务结果，包含提取的图片或内容' } }
                    }
                },
                '/api/ecom-collect/platforms': {
                    get: {
                        tags: ['EcomCollect'],
                        summary: '获取电商采集平台与场景目录',
                        responses: { 200: { description: '平台、场景与能力目录' } }
                    }
                },
                '/api/ecom-collect/capabilities': {
                    get: {
                        tags: ['EcomCollect'],
                        summary: '获取电商采集完整能力 schema',
                        description: '返回平台、场景、字段、参数示例、可用性、维护路径等信息，建议 admin 端直接以此渲染表单。',
                        responses: { 200: { description: '完整能力 schema' } }
                    }
                },
                '/api/ecom-collect/run': {
                    post: {
                        tags: ['EcomCollect'],
                        summary: '执行一次电商平台数据采集',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['taskType'],
                                        properties: {
                                            runId: { type: 'string', description: '运行 ID（由上游传入）' },
                                            taskId: { type: 'string', description: '任务 ID（由上游传入）' },
                                            platform: {
                                                type: 'string',
                                                description: '平台标识，可选；未传时会优先根据 taskType 自动推导',
                                            },
                                            taskType: {
                                                type: 'string',
                                                description: '任务类型标识，实际可选值以 /api/ecom-collect/capabilities 返回的 taskTypes schema 为准',
                                            },
                                            workspaceDir: { type: 'string', description: '客户端工作目录，截图会优先落在该目录下' },
                                            timeoutMs: { type: 'number', description: '单次运行超时时间，毫秒' },
                                            configData: {
                                                type: 'object',
                                                description: '采集配置',
                                                properties: {
                                                    keyword: { type: 'string' },
                                                    keywords: { type: 'array', items: { type: 'string' } },
                                                    targetUrl: { type: 'string' },
                                                    maxPages: { type: 'number' },
                                                    maxItems: { type: 'number' },
                                                    marketplace: { type: 'string', description: '部分平台的站点/市场标识，如 Amazon 的 US、JP' },
                                                    geo: { type: 'string', description: '趋势平台的地区代码，如 Google Trends 的 US、JP' },
                                                    captureSnapshots: {
                                                        type: 'boolean',
                                                        description: '是否执行截图；默认 false，开启后会额外保存列表页、详情页或异常页截图'
                                                    }
                                                }
                                            }
                                        }
                                    },
                                    examples: {
                                        amazonSearch: {
                                            summary: 'Amazon 搜索采集',
                                            value: {
                                                platform: 'amazon',
                                                taskType: 'amazon.search',
                                                configData: {
                                                    keyword: 'wireless earbuds',
                                                    keywords: ['wireless earbuds', 'bluetooth headphones'],
                                                    maxPages: 2,
                                                    maxItems: 60,
                                                    captureSnapshots: false
                                                }
                                            }
                                        },
                                        amazonDetail: {
                                            summary: 'Amazon 商品详情采集',
                                            value: {
                                                platform: 'amazon',
                                                taskType: 'amazon.product_detail',
                                                configData: {
                                                    targetUrl: 'https://www.amazon.com/dp/B0C1234567',
                                                    captureSnapshots: false
                                                }
                                            }
                                        },
                                        amazonSuggestions: {
                                            summary: 'Amazon 搜索联想词采集',
                                            value: {
                                                platform: 'amazon',
                                                taskType: 'amazon.search_suggestions',
                                                configData: {
                                                    marketplace: 'US',
                                                    keyword: 'wireless earbuds',
                                                    maxItems: 20,
                                                    captureSnapshots: false
                                                }
                                            }
                                        },
                                        googleTrends: {
                                            summary: 'Google Trends 趋势热词采集',
                                            value: {
                                                platform: 'google_trends',
                                                taskType: 'google_trends.trend_keywords',
                                                configData: {
                                                    geo: 'US',
                                                    maxItems: 20,
                                                    captureSnapshots: false
                                                }
                                            }
                                        },
                                        temuShop: {
                                            summary: 'Temu 店铺热门商品采集',
                                            value: {
                                                platform: 'temu',
                                                taskType: 'temu.shop_hot_products',
                                                configData: {
                                                    targetUrl: 'https://www.temu.com/store.html?store_id=1000000000',
                                                    maxItems: 60,
                                                    captureSnapshots: false
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        responses: { 200: { description: '采集执行结果' } }
                    }
                }
            }
        });
    }

        /**
         * Swagger UI 页面（在线调试）
         */
        async handleSwaggerUi(req, res) {
                const html = `<!doctype html>
<html lang="zh-CN">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Yishe Auto Browser API - Swagger UI</title>
        <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
        <style>
            html, body, #swagger-ui { margin: 0; padding: 0; height: 100%; }
            .topbar { display: none; }
        </style>
    </head>
    <body>
        <div id="swagger-ui"></div>
        <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
        <script>
            window.ui = SwaggerUIBundle({
                url: '/api/docs',
                dom_id: '#swagger-ui',
                deepLinking: true,
                displayRequestDuration: true,
                persistAuthorization: true,
                tryItOutEnabled: true,
                docExpansion: 'list'
            });
        </script>
    </body>
</html>`;

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
        }

    /**
     * 统一发布：单平台与多平台均传 platforms（数组），如 ["douyin"] 或 ["douyin", "xiaohongshu"]
     */
    async handlePublishUnified(req, res) {
        const body = await this.parseBody(req);
        const {
            platforms,
            concurrent = false,
            action = 'publish',
            asyncTask = false,
            taskMode,
            source,
            sourceId,
            metadata,
            ...publishInfo
        } = body;

        if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
            this.sendResponse(res, 400, { success: false, error: '请传 platforms（数组），单平台如 ["douyin"]，多平台如 ["douyin", "xiaohongshu"]' });
            return;
        }

        const normalizedPublishInfo = this.normalizePublishInfo(publishInfo, platforms);
        if (asyncTask === true || taskMode === 'task') {
            const task = this.createRuntimeTask({
                kind: 'publish',
                action,
                source,
                sourceId,
                metadata,
                concurrent,
                platforms,
                publishInfo: normalizedPublishInfo,
            });

            this.sendResponse(res, 200, {
                success: true,
                data: {
                    taskId: task.id,
                    status: task.status,
                    source: task.source,
                    createdAt: task.createdAt,
                },
                message: '发布任务已创建',
            });
            return;
        }

        const result = await publishService.batchPublish(platforms, { ...normalizedPublishInfo, action }, { concurrent });
        this.sendResponse(res, 200, result);
    }

    async handleCreateExecutionTask(req, res) {
        try {
            const body = await this.parseBody(req);
            const {
                kind = 'publish',
                action = 'publish',
                source = {},
                sourceId,
                metadata = {},
                concurrent = false,
                platforms,
                platform,
                ...publishInfo
            } = body || {};

            const resolvedPlatforms = Array.isArray(platforms) && platforms.length > 0
                ? platforms.map((item) => String(item || '').trim()).filter(Boolean)
                : (platform ? [String(platform).trim()] : []);

            if (resolvedPlatforms.length === 0) {
                this.sendResponse(res, 400, { success: false, message: '缺少平台信息，请传 platform 或 platforms' });
                return;
            }

            const normalizedPublishInfo = this.normalizePublishInfo(publishInfo, resolvedPlatforms);
            const task = this.createRuntimeTask({
                kind,
                action,
                source,
                sourceId,
                metadata,
                concurrent,
                platforms: resolvedPlatforms,
                publishInfo: normalizedPublishInfo,
            });

            this.sendResponse(res, 200, {
                success: true,
                data: {
                    taskId: task.id,
                    status: task.status,
                    source: task.source,
                    createdAt: task.createdAt,
                },
                message: '任务已创建',
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '创建任务失败' });
        }
    }

    async handleListTasks(req, res, url) {
        try {
            const tasks = taskManager.listTasks({
                status: url.searchParams.get('status') || undefined,
                kind: url.searchParams.get('kind') || undefined,
                platform: url.searchParams.get('platform') || undefined,
                sourceId: url.searchParams.get('sourceId') || undefined,
            });
            this.sendResponse(res, 200, {
                success: true,
                data: tasks,
                total: tasks.length,
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '获取任务列表失败' });
        }
    }

    async handleGetTask(req, res, reqPath) {
        try {
            const taskId = decodeURIComponent(reqPath.replace('/api/tasks/', '').trim());
            const task = taskManager.getTask(taskId);
            if (!task) {
                this.sendResponse(res, 404, { success: false, message: '任务不存在' });
                return;
            }
            this.sendResponse(res, 200, { success: true, data: task });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '获取任务详情失败' });
        }
    }

    async handleGetTaskLogs(req, res, reqPath) {
        try {
            const taskId = decodeURIComponent(reqPath.replace('/api/tasks/', '').replace('/logs', '').trim());
            const logs = taskManager.getTaskLogs(taskId);
            if (!logs) {
                this.sendResponse(res, 404, { success: false, message: '任务不存在' });
                return;
            }
            this.sendResponse(res, 200, {
                success: true,
                data: logs,
                total: logs.length,
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '获取任务日志失败' });
        }
    }

    async handleQueryTasksBySource(req, res) {
        try {
            const body = await this.parseBody(req);
            const sources = buildSourcesFromQueryBody(body);
            const detail = body?.detail === true;
            const data = taskManager.queryTasksBySourceList(sources, { detail });
            this.sendResponse(res, 200, {
                success: true,
                data,
                total: data.length,
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '按 source 查询任务失败' });
        }
    }

    async handleCancelTasksBySource(req, res) {
        try {
            const body = await this.parseBody(req);
            const sources = buildSourcesFromQueryBody(body);
            const reason = String(body?.reason || '').trim() || '任务已取消';

            if (sources.length === 0) {
                this.sendResponse(res, 400, { success: false, message: '请传 sourceId/sourceIds 或 sources' });
                return;
            }

            const data = sources.map((source) => {
                const task = taskManager.cancelTaskBySource(source, reason);
                return {
                    source,
                    exists: !!task,
                    cancelled: !!task,
                    task: task || null,
                };
            });

            this.sendResponse(res, 200, {
                success: true,
                data,
                total: data.length,
                message: '取消指令已处理',
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '按 source 取消任务失败' });
        }
    }

    async handleQueryTaskLogsBySource(req, res) {
        try {
            const body = await this.parseBody(req);
            const sources = buildSourcesFromQueryBody(body);
            const afterIds = body?.afterIds && typeof body.afterIds === 'object'
                ? body.afterIds
                : {};
            const data = sources.map((source) => {
                const sourceId = String(source?.id || '').trim();
                const afterId = sourceId
                    ? String(afterIds[sourceId] || '').trim() || undefined
                    : undefined;
                const task = taskManager.findTaskSummaryBySource(source);
                const logs = taskManager.findTaskLogsBySource(source, { afterId });
                return {
                    source,
                    exists: !!task,
                    logs: logs || [],
                    total: Number(task?.logInfo?.count) || 0,
                    lastLogId: task?.logInfo?.last?.id || null,
                };
            });
            this.sendResponse(res, 200, {
                success: true,
                data,
                total: data.length,
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '按 source 查询任务日志失败' });
        }
    }

    /**
     * 处理创建定时任务请求
     */
    async handleCreateSchedule(req, res) {
        const body = await this.parseBody(req);
        const { platforms, scheduleTime, action = 'publish', ...publishInfo } = body;

        if (!platforms || !scheduleTime) {
            this.sendResponse(res, 400, { error: '缺少必要参数' });
            return;
        }

        const normalizedPublishInfo = this.normalizePublishInfo(publishInfo, platforms);
        const result = await publishService.createScheduleTask(platforms, { ...normalizedPublishInfo, action }, scheduleTime);
        this.sendResponse(res, 200, result);
    }

    /**
     * 兼容新旧发布数据结构，并把服务端 canonical payload 归一化为发布端统一消费格式
     * - canonical: contractType/text/media/platformOptions
     * - transitional: imageUrls/videoUrl/publishOptions
     * - legacy: images/filePath/platformSettings
     */
    normalizePublishInfo(publishInfo, platforms = []) {
        const normalized = { ...(publishInfo || {}) };
        const primaryPlatform = platforms.find(Boolean) || normalized.platform || '';

        const normalizeTags = (input) => {
            if (Array.isArray(input)) {
                return input.map((item) => String(item).trim()).filter(Boolean);
            }
            return String(input || '')
                .split(/[,，\s]+/)
                .map((item) => item.trim())
                .filter(Boolean);
        };

        const normalizeMediaList = (list, fallbackKind) => {
            if (!Array.isArray(list)) return [];
            return list
                .map((item) => {
                    if (typeof item === 'string' && item.trim()) {
                        return { source: item.trim(), kind: fallbackKind };
                    }
                    if (item && typeof item.source === 'string' && item.source.trim()) {
                        return {
                            source: item.source.trim(),
                            kind: item.kind || fallbackKind,
                        };
                    }
                    return null;
                })
                .filter(Boolean);
        };

        if (!normalized.post && !normalized.assets && !normalized.options) {
            const flatImageSources = Array.isArray(normalized.imageSources)
                ? normalized.imageSources.map((item) => String(item).trim()).filter(Boolean)
                : [];
            const flatVideoSource = typeof normalized.videoSource === 'string' && normalized.videoSource.trim()
                ? normalized.videoSource.trim()
                : '';

            if ((!normalized.images || normalized.images.length === 0) && flatImageSources.length > 0) {
                normalized.images = [...flatImageSources];
            }
            if ((!normalized.imageUrls || normalized.imageUrls.length === 0) && flatImageSources.length > 0) {
                normalized.imageUrls = [...flatImageSources];
            }
            if (!normalized.videoUrl && flatVideoSource) {
                normalized.videoUrl = flatVideoSource;
            }
            if ((!normalized.videos || normalized.videos.length === 0) && flatVideoSource) {
                normalized.videos = [flatVideoSource];
            }
            if (!normalized.filePathSource) {
                normalized.filePathSource = flatVideoSource || flatImageSources[0] || '';
            }
            if (!normalized.filePath) {
                normalized.filePath = normalized.filePathSource || flatVideoSource || flatImageSources[0] || '';
            }
            if (!normalized.mediaType) {
                normalized.mediaType = flatVideoSource ? 'video' : (flatImageSources.length > 0 ? 'image' : undefined);
            }
            if (normalized.isVideo === undefined && normalized.mediaType) {
                normalized.isVideo = normalized.mediaType === 'video';
            }
        }

        if (normalized.contractType === 'yishe.publish.payload' || normalized.text || normalized.media) {
            const text = normalized.text && typeof normalized.text === 'object' ? normalized.text : {};
            const media = normalized.media && typeof normalized.media === 'object' ? normalized.media : {};
            const primary = media.primary && typeof media.primary === 'object' ? media.primary : null;
            const images = normalizeMediaList(media.images, 'image');
            const videos = normalizeMediaList(media.videos, 'video');

            if (!normalized.title && text.title) {
                normalized.title = String(text.title).trim();
            }
            if (!normalized.description && text.description) {
                normalized.description = String(text.description).trim();
            }
            if (!normalized.content && text.content) {
                normalized.content = String(text.content).trim();
            }
            normalized.tags = normalizeTags(normalized.tags || text.tags);

            if (!normalized.imageUrls || normalized.imageUrls.length === 0) {
                normalized.imageUrls = images.map((item) => item.source);
            }
            if (!normalized.images || normalized.images.length === 0) {
                normalized.images = [...normalized.imageUrls];
            }

            if (!normalized.videoUrl && videos.length > 0) {
                normalized.videoUrl = videos[0].source;
            }
            if (!Array.isArray(normalized.videos) || normalized.videos.length === 0) {
                normalized.videos = videos.map((item) => item.source);
            }

            if (!normalized.filePathSource && primary?.source) {
                normalized.filePathSource = primary.source;
            }
            if (!normalized.mediaType && primary?.kind) {
                normalized.mediaType = primary.kind;
            }
            if (normalized.isVideo === undefined && normalized.mediaType) {
                normalized.isVideo = normalized.mediaType === 'video';
            }

            if (!normalized.platformOptions || typeof normalized.platformOptions !== 'object') {
                normalized.platformOptions = {};
            }
            if ((!normalized.platformOptions || Object.keys(normalized.platformOptions).length === 0) && normalized.publishOptions && typeof normalized.publishOptions === 'object') {
                normalized.platformOptions = { ...normalized.publishOptions };
            }
        }

        if (normalized.post || normalized.assets || normalized.options) {
            const post = normalized.post && typeof normalized.post === 'object' ? normalized.post : {};
            const assets = normalized.assets && typeof normalized.assets === 'object' ? normalized.assets : {};
            const primary = assets.primary && typeof assets.primary === 'object' ? assets.primary : null;
            const assetImages = Array.isArray(assets.images) ? assets.images.map((item) => String(item).trim()).filter(Boolean) : [];
            const assetVideos = Array.isArray(assets.videos) ? assets.videos.map((item) => String(item).trim()).filter(Boolean) : [];
            const optionBag = normalized.options && typeof normalized.options === 'object' ? normalized.options : {};

            if (!normalized.title && post.title) {
                normalized.title = String(post.title).trim();
            }
            if (!normalized.description && post.description) {
                normalized.description = String(post.description).trim();
            }
            if (!normalized.content && post.content) {
                normalized.content = String(post.content).trim();
            }
            if ((!normalized.tags || normalized.tags.length === 0) && post.tags) {
                normalized.tags = normalizeTags(post.tags);
            }

            if ((!normalized.imageUrls || normalized.imageUrls.length === 0) && assetImages.length > 0) {
                normalized.imageUrls = assetImages;
            }
            if ((!normalized.images || normalized.images.length === 0) && assetImages.length > 0) {
                normalized.images = [...assetImages];
            }
            if (!normalized.videoUrl && assetVideos.length > 0) {
                normalized.videoUrl = assetVideos[0];
            }
            if ((!normalized.videos || normalized.videos.length === 0) && assetVideos.length > 0) {
                normalized.videos = [...assetVideos];
            }
            if (!normalized.filePathSource && primary?.source) {
                normalized.filePathSource = String(primary.source).trim();
            }
            if (!normalized.mediaType && primary?.kind) {
                normalized.mediaType = primary.kind;
            }
            if (normalized.isVideo === undefined && normalized.mediaType) {
                normalized.isVideo = normalized.mediaType === 'video';
            }
            if (!normalized.platformOptions || typeof normalized.platformOptions !== 'object' || Object.keys(normalized.platformOptions).length === 0) {
                normalized.platformOptions = { ...optionBag };
            }
            if (!normalized.publishOptions || typeof normalized.publishOptions !== 'object' || Object.keys(normalized.publishOptions).length === 0) {
                normalized.publishOptions = { ...optionBag };
            }
        }

        if (!normalized.content && normalized.description) {
            normalized.content = normalized.description;
        }
        if (!normalized.description && normalized.content) {
            normalized.description = normalized.content;
        }

        if ((!normalized.description || !String(normalized.description).trim()) && typeof normalized.title === 'string') {
            normalized.description = normalized.description || normalized.title;
        }

        normalized.tags = normalizeTags(normalized.tags);

        if (!Array.isArray(normalized.images) || normalized.images.length === 0) {
            if (Array.isArray(normalized.imageUrls) && normalized.imageUrls.length > 0) {
                normalized.images = [...normalized.imageUrls];
            }
        }

        if (!Array.isArray(normalized.videos)) {
            normalized.videos = [];
        }
        if (normalized.videoUrl && normalized.videos.length === 0) {
            normalized.videos = [normalized.videoUrl];
        }

        if (!normalized.filePath) {
            normalized.filePath = normalized.filePathSource || normalized.videoUrl || normalized.videos[0] || normalized.images?.[0] || '';
        }

        const optionsFromPlatformSettings = primaryPlatform && normalized.platformSettings?.[primaryPlatform] && typeof normalized.platformSettings[primaryPlatform] === 'object'
            ? normalized.platformSettings[primaryPlatform]
            : {};
        const platformOptions = normalized.platformOptions && typeof normalized.platformOptions === 'object'
            ? normalized.platformOptions
            : {};
        const publishOptions = normalized.publishOptions && typeof normalized.publishOptions === 'object'
            ? normalized.publishOptions
            : {};
        const reservedKeys = new Set([
            'platforms', 'platform',
            'title', 'description', 'content', 'tags', 'keywords',
            'images', 'imageUrls', 'imageSources',
            'videos', 'videoUrl', 'videoSource',
            'filePath', 'filePathSource',
            'mediaType', 'isVideo',
            'publishOptions', 'platformOptions', 'platformSettings',
            'post', 'assets', 'options', 'processing',
            'contractType', 'contractVersion', 'taskKind',
            'text', 'media', 'executionHints',
        ]);
        const flatOptions = Object.keys(normalized).reduce((acc, key) => {
            if (reservedKeys.has(key)) {
                return acc;
            }
            acc[key] = normalized[key];
            return acc;
        }, {});
        const mergedOptions = {
            ...optionsFromPlatformSettings,
            ...publishOptions,
            ...platformOptions,
            ...flatOptions,
        };

        normalized.platformOptions = mergedOptions;
        normalized.publishOptions = mergedOptions;

        if (!normalized.platformSettings || typeof normalized.platformSettings !== 'object') {
            normalized.platformSettings = {};
        }

        for (const platform of platforms) {
            if (!platform) continue;
            const current = normalized.platformSettings[platform] && typeof normalized.platformSettings[platform] === 'object'
                ? normalized.platformSettings[platform]
                : {};
            normalized.platformSettings[platform] = {
                ...current,
                ...mergedOptions,
            };
        }

        Object.keys(mergedOptions).forEach((key) => {
            if (normalized[key] === undefined) {
                normalized[key] = mergedOptions[key];
            }
        });

        return normalized;
    }
    /**
     * 获取支持的平台列表
     */
    async handleGetPlatforms(req, res) {
        const platforms = publishService.getSupportedPlatforms();
        const catalog = typeof publishService.getPlatformCatalog === 'function'
            ? publishService.getPlatformCatalog()
            : [];
        this.sendResponse(res, 200, { platforms, items: catalog });
    }

    /**
     * 获取浏览器状态（返回前先做存活检测，若窗口已关闭则清除引用，保证客户端/网页端看到的是实时状态）
     */
    async handleBrowserStatus(req, res) {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const profileId = (url.searchParams.get('profileId') || '').trim() || undefined;
            const status = await getBrowserStatus({
                profileId,
                lightweight: true,
                includePages: false
            });
            this.sendResponse(res, 200, { success: true, data: status });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message });
        }
    }

    /**
     * 连接浏览器
     * 当前统一使用 CDP 模式；未传 profileId 时默认绑定当前活动环境
     */
    async handleBrowserConnect(req, res) {
        try {
            const body = await this.parseBody(req).catch(() => ({})) || {};
            const requestedMode = String(body?.mode || '').trim().toLowerCase();
            const headless = body.headless === true ? true : (body.headless === false ? false : undefined);
            const profileId = String(body?.profileId || '').trim() || undefined;
            if (requestedMode && requestedMode !== 'cdp') {
                logger.warn(`API connect 收到已废弃浏览器模式 "${requestedMode}"，已统一改为 cdp`);
            }
            await checkAndReconnectBrowser({ reconnect: false, profileId });
            const statusBefore = await getBrowserStatus({ profileId });
            if (statusBefore.hasInstance && statusBefore.isConnected && Object.keys(body).length === 0) {
                this.sendResponse(res, 200, { success: true, data: statusBefore });
                return;
            }
            await getOrCreateBrowser({
                ...body,
                mode: 'cdp',
                profileId,
                headless,
            });
            const status = await getBrowserStatus({ profileId });
            this.sendResponse(res, 200, { success: true, data: status });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message });
        }
    }

    extractProfileIdFromPath(reqPath, suffix = '') {
        const prefix = '/api/browser/profiles/';
        if (!reqPath.startsWith(prefix)) {
            return '';
        }

        const remainder = reqPath.slice(prefix.length);
        const normalized = suffix && remainder.endsWith(suffix)
            ? remainder.slice(0, -suffix.length)
            : remainder;
        return decodeURIComponent(String(normalized || '').replace(/\/+$/g, '').trim());
    }

    async handleBrowserProfilesList(req, res) {
        try {
            this.sendResponse(res, 200, {
                success: true,
                data: listManagedBrowserProfiles(),
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '获取环境列表失败' });
        }
    }

    async handleBrowserProfilesCreate(req, res) {
        try {
            const body = await this.parseBody(req).catch(() => ({})) || {};
            const created = createManagedBrowserProfile(body);
            this.sendResponse(res, 200, {
                success: true,
                data: created,
                message: '环境已创建',
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '创建环境失败' });
        }
    }

    async handleBrowserProfileDetail(req, res, reqPath) {
        try {
            const profileId = this.extractProfileIdFromPath(reqPath);
            const profile = getManagedBrowserProfile(profileId);
            if (!profile) {
                this.sendResponse(res, 404, { success: false, message: '环境不存在' });
                return;
            }

            this.sendResponse(res, 200, {
                success: true,
                data: profile,
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '获取环境详情失败' });
        }
    }

    async handleBrowserProfileUpdate(req, res, reqPath) {
        try {
            const profileId = this.extractProfileIdFromPath(reqPath);
            const body = await this.parseBody(req).catch(() => ({})) || {};
            const profile = updateManagedBrowserProfile(profileId, body);
            this.sendResponse(res, 200, {
                success: true,
                data: profile,
                message: '环境已更新',
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '更新环境失败' });
        }
    }

    async handleBrowserProfileDelete(req, res, reqPath) {
        try {
            const profileId = this.extractProfileIdFromPath(reqPath);
            const result = await deleteManagedBrowserProfile(profileId);
            this.sendResponse(res, 200, {
                success: true,
                data: result,
                message: '环境已删除',
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '删除环境失败' });
        }
    }

    async handleBrowserProfileSwitch(req, res, reqPath) {
        try {
            const profileId = this.extractProfileIdFromPath(reqPath, '/switch');
            const profile = switchManagedBrowserProfile(profileId);
            this.sendResponse(res, 200, {
                success: true,
                data: profile,
                message: '环境已切换',
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '切换环境失败' });
        }
    }

    async handleBrowserOpenUserDataDir(req, res) {
        try {
            const body = await this.parseBody(req).catch(() => ({})) || {};
            const rawDirPath = String(body?.dirPath || '').trim();
            const ensureExists = body?.ensureExists !== false;

            if (!rawDirPath) {
                this.sendResponse(res, 400, { success: false, message: '缺少 dirPath' });
                return;
            }

            const dirPath = path.resolve(rawDirPath);

            if (ensureExists && !fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            if (!fs.existsSync(dirPath)) {
                this.sendResponse(res, 404, { success: false, message: '目录不存在' });
                return;
            }

            const openResult = await this.openDirectoryInFileManager(dirPath);
            if (!openResult.success) {
                this.sendResponse(res, 500, { success: false, message: openResult.message || '打开目录失败' });
                return;
            }

            this.sendResponse(res, 200, {
                success: true,
                message: '目录已打开',
                data: {
                    dirPath,
                },
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '打开目录失败' });
        }
    }

    async openDirectoryInFileManager(dirPath) {
        const commandInfo = (() => {
            if (process.platform === 'win32') {
                return { command: 'explorer.exe', args: [dirPath] };
            }
            if (process.platform === 'darwin') {
                return { command: 'open', args: [dirPath] };
            }
            return { command: 'xdg-open', args: [dirPath] };
        })();

        return await new Promise((resolve) => {
            try {
                const child = spawn(commandInfo.command, commandInfo.args, {
                    detached: true,
                    stdio: 'ignore',
                });

                child.on('error', (error) => {
                    resolve({
                        success: false,
                        message: error?.message || '系统文件管理器打开失败',
                    });
                });

                child.unref();
                resolve({ success: true });
            } catch (error) {
                resolve({
                    success: false,
                    message: error?.message || '系统文件管理器打开失败',
                });
            }
        });
    }

    /**
     * 关闭浏览器
     */
    async handleBrowserClose(req, res) {
        try {
            const body = await this.parseBody(req).catch(() => ({})) || {};
            const profileId = String(body?.profileId || '').trim() || undefined;
            await closeBrowser({ profileId });
            const status = await getBrowserStatus({ profileId });
            this.sendResponse(res, 200, { success: true, data: status });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message });
        }
    }

    /**
     * 聚焦浏览器窗口
     */
    async handleBrowserFocus(req, res) {
        try {
            const body = await this.parseBody(req).catch(() => ({})) || {};
            const profileId = String(body?.profileId || '').trim() || undefined;
            const result = await focusBrowser({ profileId });
            const status = await getBrowserStatus({ profileId });
            this.sendResponse(res, 200, {
                success: true,
                message: '浏览器窗口已聚焦',
                data: {
                    ...(result || {}),
                    status,
                },
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '聚焦浏览器失败' });
        }
    }

    /**
     * 强制关闭浏览器（按端口）
     */
    async handleBrowserForceClose(req, res) {
        try {
            const body = await this.parseBody(req).catch(() => ({})) || {};
            const { port = 9222 } = body;
            const result = await forceCloseBrowserByPort({ port });
            this.sendResponse(res, 200, { success: true, data: result });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message });
        }
    }

    /**
     * 启动带调试端口的浏览器
     */
    async handleBrowserLaunchDebug(req, res) {
        try {
            const body = await this.parseBody(req);
            const result = launchWithDebugPort(body);
            this.sendResponse(res, 200, { success: true, data: result });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message });
        }
    }

    /**
     * 检测 CDP 端口
     */
    async handleBrowserCheckPort(req, res) {
        try {
            const body = await this.parseBody(req);
            const { port = 9222 } = body;
            const http = await import('http');
            const url = `http://127.0.0.1:${port}/json/version`;
            const result = await new Promise((resolve) => {
                const req = http.default.get(url, { timeout: 3000 }, (resp) => {
                    let data = '';
                    resp.on('data', chunk => { data += chunk; });
                    resp.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            resolve({ ok: true, port, browser: json.Browser || json.browser });
                        } catch {
                            resolve({ ok: true, port, raw: data?.slice(0, 200) });
                        }
                    });
                });
                req.on('error', (e) => resolve({ ok: false, port, error: e.message }));
                req.on('timeout', () => { req.destroy(); resolve({ ok: false, port, error: '连接超时' }); });
            });
            this.sendResponse(res, 200, { success: true, data: result });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message });
        }
    }

    /**
     * 在已连接浏览器中打开指定平台创作页
     */
    async handleBrowserOpenPlatform(req, res) {
        try {
            const body = await this.parseBody(req);
            const { platform } = body;
            const profileId = String(body?.profileId || '').trim() || undefined;
            if (!platform || typeof platform !== 'string') {
                this.sendResponse(res, 400, { success: false, message: '请传 platform（如 douyin、xiaohongshu、weibo、kuaishou、doudian、kuaishou_shop、temu）' });
                return;
            }
            const config = PLATFORM_CONFIGS[platform];
            if (!config || !config.uploadUrl) {
                this.sendResponse(res, 400, { success: false, message: `不支持的平台: ${platform}` });
                return;
            }

            const browserStatus = await getBrowserStatus({ profileId });
            if (!browserStatus?.hasInstance || !browserStatus?.isConnected) {
                this.sendResponse(res, 400, {
                    success: false,
                    message: '浏览器实例未启动或未连接，请先连接浏览器'
                });
                return;
            }

            const browser = await getOrCreateBrowser({ profileId });
            const page = await browser.newPage({ foreground: true });
            await page.goto(config.uploadUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            this.sendResponse(res, 200, { success: true, data: { platform, name: config.name, url: config.uploadUrl } });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '打开平台链接失败' });
        }
    }

    /**
     * 在已连接浏览器中打开指定链接
     */
    async handleBrowserOpenLink(req, res) {
        try {
            const body = await this.parseBody(req);
            const { url } = body;
            const profileId = String(body?.profileId || '').trim() || undefined;

            if (!url || typeof url !== 'string') {
                this.sendResponse(res, 400, { success: false, message: '请传 url' });
                return;
            }

            const targetUrl = String(url).trim();
            let parsed;
            try {
                parsed = new URL(targetUrl);
            } catch {
                this.sendResponse(res, 400, { success: false, message: 'url 格式不正确' });
                return;
            }

            if (!['http:', 'https:'].includes(parsed.protocol)) {
                this.sendResponse(res, 400, { success: false, message: '仅支持 http/https 链接' });
                return;
            }

            const browserStatus = await getBrowserStatus({ profileId });
            if (!browserStatus?.hasInstance || !browserStatus?.isConnected) {
                this.sendResponse(res, 400, {
                    success: false,
                    message: '浏览器实例未启动或未连接，请先连接浏览器'
                });
                return;
            }

            const browser = await getOrCreateBrowser({ profileId });
            const page = await browser.newPage({ foreground: true });
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            this.sendResponse(res, 200, {
                success: true,
                data: {
                    url: targetUrl,
                    title: await page.title().catch(() => '')
                }
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '打开链接失败' });
        }
    }

    async handleBrowserSmallFeatures(req, res) {
        try {
            this.sendResponse(res, 200, {
                success: true,
                data: listBrowserAutomationSmallFeatures()
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '获取工具目录失败' });
        }
    }

    async handleBrowserRunSmallFeature(req, res) {
        try {
            const body = await this.parseBody(req).catch(() => ({})) || {};
            const featureKey = String(body?.featureKey || '').trim();
            if (!featureKey) {
                this.sendResponse(res, 400, { success: false, message: '缺少 featureKey' });
                return;
            }

            const { featureKey: _featureKey, ...payload } = body;
            const result = await runBrowserAutomationSmallFeature(featureKey, payload);
            this.sendResponse(res, 200, result);
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '执行工具失败' });
        }
    }

    async handleBrowserPages(req, res) {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const profileId = (url.searchParams.get('profileId') || '').trim() || undefined;
            const browserStatus = await getBrowserStatus({ profileId });
            if (!browserStatus?.hasInstance || !browserStatus?.isConnected) {
                this.sendResponse(res, 400, {
                    success: false,
                    message: '浏览器实例未启动或未连接，请先连接浏览器'
                });
                return;
            }

            const pages = await listBrowserPages({ profileId });
            this.sendResponse(res, 200, { success: true, data: pages });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '获取页面列表失败' });
        }
    }

    async handleBrowserDebug(req, res) {
        try {
            const body = await this.parseBody(req);
            const action = String(body?.action || '').trim();
            const profileId = String(body?.profileId || '').trim() || undefined;
            const browserStatus = await getBrowserStatus({ profileId });
            if (!browserStatus?.hasInstance || !browserStatus?.isConnected) {
                this.sendResponse(res, 400, {
                    success: false,
                    message: '浏览器实例未启动或未连接，请先连接浏览器'
                });
                return;
            }
            const pageIndexValue = body?.pageIndex;
            const pageIndex = pageIndexValue === '' || pageIndexValue === undefined || pageIndexValue === null
                ? undefined
                : Number(pageIndexValue);

            if (!action) {
                this.sendResponse(res, 400, { success: false, message: '缺少 action' });
                return;
            }

            const resolvePage = async () => {
                if (action === 'newPage') {
                    return await createBrowserPage({ profileId });
                }
                if (pageIndex !== undefined && !Number.isNaN(pageIndex)) {
                    return await getBrowserPage(pageIndex, { profileId });
                }
                return await getBrowserPage(0, { profileId });
            };

            const page = await resolvePage();
            const timeout = Number(body?.timeout) > 0 ? Number(body.timeout) : 30000;
            let result = null;

            switch (action) {
                case 'newPage':
                    result = { url: page.url(), title: await page.title().catch(() => '') };
                    break;
                case 'goto': {
                    const targetUrl = String(body?.url || '').trim();
                    if (!targetUrl) throw new Error('缺少 url');
                    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });
                    result = { url: page.url(), title: await page.title().catch(() => '') };
                    break;
                }
                case 'reload':
                    await page.reload({ waitUntil: 'domcontentloaded', timeout });
                    result = { url: page.url(), title: await page.title().catch(() => '') };
                    break;
                case 'bringToFront':
                    await page.bringToFront();
                    result = { focused: true };
                    break;
                case 'closePage': {
                    await page.close({ runBeforeUnload: true });
                    const pagesAfterClose = await listBrowserPages({ profileId });
                    this.sendResponse(res, 200, {
                        success: true,
                        data: {
                            action,
                            page: null,
                            result: { closed: true },
                            pages: pagesAfterClose
                        }
                    });
                    return;
                }
                case 'click': {
                    const selector = String(body?.selector || '').trim();
                    if (!selector) throw new Error('缺少 selector');
                    await page.locator(selector).first().click({ timeout });
                    result = { clicked: true };
                    break;
                }
                case 'fill': {
                    const selector = String(body?.selector || '').trim();
                    if (!selector) throw new Error('缺少 selector');
                    await page.locator(selector).first().fill(String(body?.text || ''), { timeout });
                    result = { filled: true };
                    break;
                }
                case 'type': {
                    const selector = String(body?.selector || '').trim();
                    if (!selector) throw new Error('缺少 selector');
                    await page.locator(selector).first().pressSequentially(String(body?.text || ''), { timeout });
                    result = { typed: true };
                    break;
                }
                case 'press': {
                    const selector = String(body?.selector || '').trim();
                    const key = String(body?.key || '').trim();
                    if (!selector) throw new Error('缺少 selector');
                    if (!key) throw new Error('缺少 key');
                    await page.locator(selector).first().press(key, { timeout });
                    result = { pressed: key };
                    break;
                }
                case 'text': {
                    const selector = String(body?.selector || '').trim();
                    if (!selector) throw new Error('缺少 selector');
                    result = { text: await page.locator(selector).first().textContent({ timeout }) };
                    break;
                }
                case 'html': {
                    const selector = String(body?.selector || '').trim();
                    if (!selector) throw new Error('缺少 selector');
                    result = { html: await page.locator(selector).first().innerHTML({ timeout }) };
                    break;
                }
                case 'count': {
                    const selector = String(body?.selector || '').trim();
                    if (!selector) throw new Error('缺少 selector');
                    result = { count: await page.locator(selector).count() };
                    break;
                }
                case 'eval': {
                    const expression = String(body?.expression || '').trim();
                    if (!expression) throw new Error('缺少 expression');
                    const value = await page.evaluate((expr) => globalThis.eval(expr), expression);
                    result = { value };
                    break;
                }
                case 'playwright': {
                    const script = String(body?.expression || '').trim();
                    if (!script) throw new Error('缺少 expression');
                    result = await executePlaywrightScript(page, script);
                    break;
                }
                case 'wait': {
                    const ms = Number(body?.ms) || 1000;
                    await page.waitForTimeout(ms);
                    result = { waited: ms };
                    break;
                }
                case 'screenshot': {
                    const filename = `browser-debug-${Date.now()}.png`;
                    const savePath = path.resolve(UPLOAD_DIR, filename);
                    if (!fs.existsSync(UPLOAD_DIR)) {
                        await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
                    }
                    await page.screenshot({ path: savePath, fullPage: true });
                    result = { path: savePath, filename };
                    break;
                }
                default:
                    throw new Error(`不支持的 action: ${action}`);
            }

            const currentUrl = page.url();
            const currentTitle = await page.title().catch(() => '');
            const pages = await listBrowserPages({ profileId });
            this.sendResponse(res, 200, {
                success: true,
                data: {
                    action,
                    page: {
                        url: currentUrl,
                        title: currentTitle,
                        index: pages.findIndex(item => item.url === currentUrl && item.title === currentTitle)
                    },
                    result,
                    pages
                }
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '页面调试执行失败' });
        }
    }

    /**
     * 检测浏览器实例并可选重连（接口调用）
     * POST/GET /api/browser/check-and-reconnect 或 GET /api/browser/check
     * Body (POST): { reconnect?: boolean }，reconnect 为 true 时断开后尝试自动重连
     */
    async handleBrowserCheckAndReconnect(req, res) {
        try {
            let reconnect = false;
            let profileId = undefined;
            if (req.method === 'POST') {
                const body = await this.parseBody(req).catch(() => ({}));
                reconnect = !!body.reconnect;
                profileId = String(body?.profileId || '').trim() || undefined;
            } else {
                const url = new URL(req.url, `http://${req.headers.host}`);
                profileId = (url.searchParams.get('profileId') || '').trim() || undefined;
            }
            const result = await checkAndReconnectBrowser({ reconnect, profileId });
            this.sendResponse(res, 200, {
                success: true,
                available: result.available,
                reconnected: result.reconnected || false,
                message: result.message,
                status: result.status
            });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '检测失败' });
        }
    }

    /**
     * 导出 User Data
     */
    async handleExportUserData(req, res) {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const userDataDir = (url.searchParams.get('userDataDir') || getDefaultCdpUserDataDir()).trim();

            logger.info(`开始导出 User Data: ${userDataDir}`);
            const buffer = await exportUserData(userDataDir);

            const filename = `yishe-auto-browser-userdata-${new Date().toISOString().split('T')[0]}.zip`;
            res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': buffer.length,
                'Access-Control-Expose-Headers': 'Content-Disposition'
            });
            res.end(buffer);
        } catch (error) {
            logger.error('导出失败:', error);
            this.sendResponse(res, 500, { success: false, message: error.message });
        }
    }

    /**
     * 处理文件上传（发布用视频/图片）- 使用内置流解析 multipart，无第三方依赖
     */
    async handleUpload(req, res) {
        try {
            const contentType = req.headers['content-type'] || '';
            if (!contentType.includes('multipart/form-data')) {
                this.sendResponse(res, 400, { success: false, message: '需要 multipart/form-data' });
                return;
            }
            const m = contentType.match(/boundary=([^;\s]+)/);
            const boundary = m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
            if (!boundary) {
                this.sendResponse(res, 400, { success: false, message: '缺少 boundary' });
                return;
            }
            if (!fs.existsSync(UPLOAD_DIR)) {
                await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
            }
            const result = await this.parseMultipart(req, Buffer.from(`--${boundary}`));
            if (!result.savedPath) {
                this.sendResponse(res, 400, { success: false, message: '未选择文件' });
                return;
            }
            const filename = path.basename(result.savedPath);
            logger.info('文件上传成功:', { path: result.savedPath, filename });
            this.sendResponse(res, 200, {
                success: true,
                path: result.savedPath,
                filename
            });
        } catch (error) {
            logger.error('上传失败:', error);
            this.sendResponse(res, 500, { success: false, message: error.message || '上传失败' });
        }
    }

    /**
     * 简易 multipart 解析：只提取第一个带 filename 的文件并写入 temp
     * 改进：
     * 1. 确保文件完整写入
     * 2. 正确处理 writeStream 的异步关闭
     * 3. 改进缓冲区管理，防止 OOM
     * 4. 添加磁盘空间检查
     */
    parseMultipart(req, boundaryPrefix) {
        return new Promise((resolve, reject) => {
            const B = boundaryPrefix;
            const BCRLF = Buffer.from('\r\n');
            let state = 'preamble';
            let headers = '';
            let filename = null;
            let writeStream = null;
            let savedPath = null;
            let buffer = Buffer.alloc(0);
            let resolved = false;
            let fileBodyEnded = false;
            let bytesWritten = 0;
            const maxBuffer = 1024 * 1024; // 1MB 用于边界检测
            const MAX_MEMORY_BUFFER = 100 * 1024 * 1024; // 100MB 最大内存缓冲
            let writeQueue = Promise.resolve();

            function flushToFile(chunk) {
                if (!writeStream || !chunk || !chunk.length) {
                    return Promise.resolve();
                }

                // 排队写入，避免并发
                writeQueue = writeQueue.then(() => {
                    return new Promise((resolve, reject) => {
                        if (!writeStream) {
                            reject(new Error('writeStream 已关闭'));
                            return;
                        }
                        
                        writeStream.write(chunk, (err) => {
                            if (err) {
                                // 捕获磁盘相关错误
                                if (err.code === 'ENOSPC') {
                                    reject(new Error('磁盘空间不足，无法完成上传'));
                                } else if (err.code === 'EAGAIN' || err.code === 'EWOULDBLOCK') {
                                    reject(new Error('文件系统繁忙，请稍后重试'));
                                } else {
                                    reject(new Error(`文件写入失败: ${err.message}`));
                                }
                            } else {
                                bytesWritten += chunk.length;
                                resolve();
                            }
                        });
                    });
                });
                return writeQueue;
            }

            function finishFile() {
                if (!writeStream) return false;
                
                return new Promise((resolve) => {
                    // 确保流正确关闭
                    writeStream.once('finish', () => {
                        writeStream = null;
                        if (savedPath && !resolved) {
                            resolved = true;
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    });
                    writeStream.once('error', (err) => {
                        logger.error('写入文件流错误:', err);
                        writeStream = null;
                        resolve(false);
                    });
                    writeStream.end();
                });
            }

            const processChunk = async () => {
                while (buffer.length > 0 && !resolved) {
                    if (state === 'preamble' || state === 'between') {
                        const i = buffer.indexOf(B);
                        if (i === -1) {
                            const keep = Math.min(buffer.length, B.length + 4);
                            buffer = buffer.subarray(buffer.length - keep);
                            break;
                        }
                        buffer = buffer.subarray(i + B.length);
                        if (buffer.length >= 2 && buffer[0] === 0x2d && buffer[1] === 0x2d) {
                            buffer = buffer.subarray(2);
                            if (await finishFile()) return;
                            state = 'between';
                            continue;
                        }
                        const crlf = buffer.indexOf(BCRLF);
                        if (crlf !== 0) {
                            buffer = buffer.subarray(crlf >= 0 ? crlf : buffer.length);
                            break;
                        }
                        buffer = buffer.subarray(2);
                        state = 'headers';
                        headers = '';
                        filename = null;
                        continue;
                    }
                    if (state === 'headers') {
                        const idx = buffer.indexOf(Buffer.from('\r\n\r\n'));
                        if (idx === -1) {
                            headers += buffer.toString('utf8');
                            if (buffer.length > 8192) buffer = buffer.subarray(buffer.length - 128);
                            break;
                        }
                        headers += buffer.subarray(0, idx).toString('utf8');
                        buffer = buffer.subarray(idx + 4);
                        const fn = headers.match(/filename="([^"]*)"/);
                        const fnStar = headers.match(/filename\*=(?:utf-8'')?([^;\r\n]+)/);
                        filename = (fn && fn[1]) || (fnStar && decodeURIComponent(fnStar[1].trim())) || null;
                        if (filename) {
                            const ext = path.extname(filename) || '';
                            const base = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;
                            savedPath = path.join(UPLOAD_DIR, base);
                            writeStream = fs.createWriteStream(savedPath);
                            logger.info(`开始接收上传文件: ${base}`);
                        }
                        state = 'body';
                        continue;
                    }
                    if (state === 'body') {
                        const i = buffer.indexOf(B);
                        if (i === -1) {
                            const safe = Math.max(0, buffer.length - B.length - 4);
                            if (safe > 0) {
                                await flushToFile(buffer.subarray(0, safe));
                                buffer = buffer.subarray(safe);
                            }
                            break;
                        }
                        const trim = i >= 2 && buffer[i - 2] === 0x0d && buffer[i - 1] === 0x0a ? 2 : 0;
                        await flushToFile(buffer.subarray(0, i - trim));
                        buffer = buffer.subarray(i);
                        fileBodyEnded = true;
                        state = 'between';
                    }
                }
            };

            req.on('data', async (chunk) => {
                if (resolved) return;
                try {
                    // 安全的缓冲区连接 - 捕获内存分配错误
                    try {
                        buffer = Buffer.concat([buffer, chunk]);
                    } catch (bufErr) {
                        if (bufErr instanceof RangeError) {
                            throw new Error(`内存分配失败: 缓冲区过大 (${(buffer.length + chunk.length) / 1024 / 1024}MB)。请减小文件大小或增加系统内存。`);
                        }
                        throw bufErr;
                    }
                    
                    // 防止缓冲区无限增长
                    if (buffer.length > MAX_MEMORY_BUFFER) {
                        logger.warn(`缓冲区超过 ${MAX_MEMORY_BUFFER / 1024 / 1024}MB，仅保留最后 ${maxBuffer / 1024}KB`);
                        buffer = buffer.subarray(buffer.length - maxBuffer);
                    }
                    
                    await processChunk();
                } catch (err) {
                    if (!resolved) {
                        resolved = true;
                        reject(err);
                    }
                }
            });

            req.on('end', async () => {
                if (resolved) return;
                try {
                    // 等待所有待处理的写入完成
                    await writeQueue;
                    
                    if (buffer.length) {
                        try {
                            await flushToFile(buffer);
                        } catch (flushErr) {
                            throw flushErr;
                        }
                    }
                    
                    // 确保文件流正确关闭
                    if (writeStream) {
                        if (!fileBodyEnded) {
                            await finishFile();
                        } else if (writeStream && !writeStream.closed) {
                            writeStream.destroy();
                        }
                    }
                    
                    if (!resolved) {
                        resolved = true;
                        resolve({ savedPath: savedPath || null });
                    }
                } catch (err) {
                    if (!resolved) {
                        resolved = true;
                        reject(err);
                    }
                }
            });

            req.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    // 清理资源
                    if (writeStream) {
                        writeStream.destroy();
                    }
                    // 删除部分上传的文件
                    if (savedPath && fs.existsSync(savedPath)) {
                        try {
                            fs.unlinkSync(savedPath);
                        } catch (e) {
                            logger.warn(`清理临时文件失败: ${e.message}`);
                        }
                    }
                    reject(err);
                }
            });
        });
    }

    /**
     * 检查磁盘剩余空间
     */
    async checkDiskSpace(dirPath) {
        try {
            // 使用 fs.statfs 检查磁盘空间（仅 Unix）
            // Windows 用户需要其他方式
            if (process.platform !== 'win32') {
                const util = require('util');
                const statfs = util.promisify(require('fs').statfs);
                const stats = await statfs(dirPath);
                const freeSpace = stats.bavail * stats.bsize; // 可用空间（字节）
                const requiredSpace = 500 * 1024 * 1024; // 需要 500MB
                if (freeSpace < requiredSpace) {
                    return {
                        ok: false,
                        available: Math.floor(freeSpace / 1024 / 1024),
                        required: Math.floor(requiredSpace / 1024 / 1024)
                    };
                }
            }
            return { ok: true };
        } catch (err) {
            logger.warn(`磁盘空间检查失败: ${err.message}`);
            return { ok: true }; // 如果检查失败，允许继续
        }
    }

    /**
     * 获取各平台登录状态（用于发布前校验）
     */
    async handleLoginStatus(req, res) {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const forceRefresh = url.searchParams.get('refresh') === '1';
            const profileId = String(url.searchParams.get('profileId') || '').trim() || undefined;
            const loginStatus = await PlatformLoginService.checkSocialMediaLoginStatus(forceRefresh, { profileId });
            if (profileId) {
                try {
                    updateManagedBrowserProfile(profileId, {
                        loginSummary: loginStatus,
                    });
                } catch {
                    // ignore profile cache update errors
                }
            }
            this.sendResponse(res, 200, { success: true, data: loginStatus });
        } catch (error) {
            logger.error('获取登录状态失败:', error);
            this.sendResponse(res, 500, { success: false, message: error.message || '获取登录状态失败' });
        }
    }

    /**
     * 爬虫服务健康检查
     */
    async handleCrawlerHealth(req, res) {
        try {
            const result = await crawlerService.checkCrawlerHealth();
            this.sendResponse(res, 200, result);
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '爬虫服务异常' });
        }
    }

    /**
     * 获取可用爬虫站点
     */
    async handleCrawlerSites(req, res) {
        try {
            const sites = crawlerService.getSupportedSites();
            this.sendResponse(res, 200, { success: true, sites });
        } catch (error) {
            this.sendResponse(res, 500, { success: false, message: error.message || '获取站点列表失败' });
        }
    }

    /**
     * 通用 URL 抓取
     */
    async handleCrawlUrl(req, res) {
        try {
            const body = await this.parseBody(req);
            const result = await crawlerService.crawlUrl(body);
            this.sendResponse(res, 200, result);
        } catch (error) {
            const statusCode = error.message && error.message.includes('缺少 url 参数') ? 400 : 500;
            this.sendResponse(res, statusCode, { success: false, message: error.message || '抓取失败' });
        }
    }

    /**
     * 执行站点爬虫
     */
    async handleCrawlerRun(req, res) {
        try {
            const body = await this.parseBody(req);
            const { site, params = {} } = body;
            const result = await crawlerService.runSiteCrawler(site, params);
            this.sendResponse(res, 200, result);
        } catch (error) {
            const isBadRequest =
                (error.message && error.message.includes('缺少 site 参数')) ||
                (error.message && error.message.includes('不支持的 site'));
            this.sendResponse(res, isBadRequest ? 400 : 500, {
                success: false,
                message: error.message || '执行爬虫任务失败'
            });
        }
    }

    /**
     * 获取电商采集平台目录
     */
    async handleEcomCollectPlatforms(req, res) {
        try {
            const result = await getEcomPlatformCatalog();
            this.sendResponse(res, 200, {
                success: true,
                data: result,
            });
        } catch (error) {
            this.sendResponse(res, 500, {
                success: false,
                message: error.message || '获取电商采集目录失败'
            });
        }
    }

    /**
     * 获取电商采集完整能力 schema
     */
    async handleEcomCollectCapabilities(req, res) {
        try {
            const result = await getEcomCollectCapabilities();
            this.sendResponse(res, 200, {
                success: true,
                data: result,
            });
        } catch (error) {
            this.sendResponse(res, 500, {
                success: false,
                message: error.message || '获取电商采集能力失败'
            });
        }
    }

    /**
     * 执行一次电商采集
     */
    async handleEcomCollectRun(req, res) {
        try {
            const body = await this.parseBody(req);
            const result = await runEcomCollectTask(body || {});
            this.sendResponse(res, 200, result);
        } catch (error) {
            this.sendResponse(res, 500, {
                success: false,
                message: error.message || '执行电商采集失败'
            });
        }
    }

    /**
     * 解析请求体
     */
    async parseBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    resolve(body ? JSON.parse(body) : {});
                } catch (error) {
                    reject(new Error('Invalid JSON'));
                }
            });
            req.on('error', reject);
        });
    }

    /**
     * 发送响应
     */
    sendResponse(res, statusCode, data) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }

    /**
     * 提供前端静态文件
     */
    async serveStatic(req, res, reqPath) {
        try {
            const webExists = fs.existsSync(WEB_DIR);
            if (!webExists) {
                res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>前端未构建</h1><p>请先执行: npm run web:build 或 cd web && npm run build</p>');
                return;
            }
        } catch {
            // ignore
        }

        const safePath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\//, '');
        const filePath = path.join(WEB_DIR, safePath);
        const resolvedPath = path.resolve(filePath);
        if (!resolvedPath.startsWith(path.resolve(WEB_DIR))) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        try {
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
                const ext = path.extname(filePath);
                const mimeTypes = {
                    '.html': 'text/html; charset=utf-8',
                    '.js': 'text/javascript; charset=utf-8',
                    '.css': 'text/css; charset=utf-8',
                    '.json': 'application/json',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml',
                    '.ico': 'image/x-icon',
                    '.woff': 'font/woff',
                    '.woff2': 'font/woff2'
                };
                const contentType = mimeTypes[ext] || 'application/octet-stream';
                res.writeHead(200, { 'Content-Type': contentType });
                fs.createReadStream(filePath).pipe(res);
            } else {
                const indexPath = path.join(WEB_DIR, 'index.html');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                fs.createReadStream(indexPath).pipe(res);
            }
        } catch (err) {
            if (err.code === 'ENOENT') {
                const indexPath = path.join(WEB_DIR, 'index.html');
                try {
                    fs.accessSync(indexPath, fs.constants.F_OK);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    fs.createReadStream(indexPath).pipe(res);
                } catch {
                    res.writeHead(404);
                    res.end('Not Found');
                }
            } else {
                res.writeHead(500);
                res.end('Internal Server Error');
            }
        }
    }
}

// 创建并导出服务器实例
const apiServer = new ApiServer();

export default apiServer;

// 作为入口运行时启动服务器（npm start 即 node src/api/server.js）
apiServer.start();

let shutdownTriggered = false;

async function shutdownServer(reason, options = {}) {
    if (shutdownTriggered) {
        return;
    }
    shutdownTriggered = true;

    const { exitCode = 0, error = null } = options;
    logger.warn(`收到退出信号，开始清理发布端资源: ${reason}`);

    if (error) {
        logger.error(`发布端异常退出原因 (${reason}):`, error);
    }

    try {
        await apiServer.stop();
    } catch (stopError) {
        logger.error('发布端停止过程中发生错误:', stopError);
    } finally {
        process.exit(exitCode);
    }
}

process.on('SIGINT', () => {
    shutdownServer('SIGINT', { exitCode: 0 });
});

process.on('SIGTERM', () => {
    shutdownServer('SIGTERM', { exitCode: 0 });
});

process.on('SIGBREAK', () => {
    shutdownServer('SIGBREAK', { exitCode: 0 });
});

process.on('uncaughtException', (error) => {
    shutdownServer('uncaughtException', { exitCode: 1, error });
});

process.on('unhandledRejection', (reason) => {
    shutdownServer('unhandledRejection', {
        exitCode: 1,
        error: reason instanceof Error ? reason : new Error(String(reason))
    });
});

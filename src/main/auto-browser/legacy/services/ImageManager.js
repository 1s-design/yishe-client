/**
 * 图片管理器 - 统一管理图片下载、上传、删除等操作
 * 远程媒体文件带磁盘缓存：同一 URL 2 小时内重复下载直接命中缓存，
 * 并支持 prefetchMedia 后台预热下一条任务的媒体文件。
 */

import { join as pathJoin, extname } from 'path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, copyFileSync, statSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';
import { getAutoBrowserTempDir } from '../utils/workspacePaths.js';

const MEDIA_CACHE_DIR_NAME = 'yishe-publish-media-cache';
const MEDIA_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const MEDIA_CACHE_MAX_FILES = 500;
const DOWNLOAD_CONCURRENCY = 4;

// 同一 URL 的并发下载共享同一个 Promise
const inflightDownloads = new Map();

/**
 * 获取媒体缓存目录（与临时目录同级的子目录）
 */
function getMediaCacheDir() {
    const dir = pathJoin(getAutoBrowserTempDir(), MEDIA_CACHE_DIR_NAME);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * 清理缓存目录：删除过期文件，超量时按 mtime 最旧先删（LRU）
 */
function cleanupMediaCache() {
    const dir = getMediaCacheDir();
    const now = Date.now();
    const files = readdirSync(dir)
        .map(name => {
            const filePath = pathJoin(dir, name);
            try {
                const stat = statSync(filePath);
                return stat.isFile() ? { path: filePath, mtimeMs: stat.mtimeMs } : null;
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    const fresh = [];
    for (const item of files) {
        if (now - item.mtimeMs >= MEDIA_CACHE_TTL_MS) {
            try { unlinkSync(item.path); } catch {}
        } else {
            fresh.push(item);
        }
    }

    if (fresh.length > MEDIA_CACHE_MAX_FILES) {
        fresh.sort((a, b) => a.mtimeMs - b.mtimeMs);
        const overflow = fresh.length - MEDIA_CACHE_MAX_FILES;
        for (let i = 0; i < overflow; i++) {
            try { unlinkSync(fresh[i].path); } catch {}
        }
    }
}

// 模块加载时异步清理过期 + 超量缓存文件
const cacheCleanupTimer = setTimeout(() => {
    try {
        cleanupMediaCache();
    } catch (error) {
        logger.warn('媒体缓存清理失败:', error);
    }
}, 0);
cacheCleanupTimer.unref?.();

/**
 * 图片管理器类
 */
export class ImageManager {
    constructor() {
        this.tempDir = this.getTempDir();
        this.cacheDir = getMediaCacheDir();
    }

    /**
     * 确保目录存在
     */
    ensureDir(dirPath) {
        if (!existsSync(dirPath)) {
            mkdirSync(dirPath, { recursive: true });
            logger.debug('创建目录:', dirPath);
        }
        return dirPath;
    }

    /**
     * 获取临时目录路径
     */
    getTempDir() {
        return this.ensureDir(getAutoBrowserTempDir());
    }

    /**
     * 解析本地资源路径，支持普通路径与 file:// URL。
     * 远程 URL 或文件不存在时返回空字符串。
     */
    resolveLocalImagePath(source) {
        const raw = String(source || '').trim();
        if (!raw || /^https?:\/\//i.test(raw)) {
            return '';
        }
        let candidate = raw;
        if (raw.startsWith('file://')) {
            try {
                candidate = fileURLToPath(raw);
            } catch {
                return '';
            }
        }
        try {
            return existsSync(candidate) && statSync(candidate).isFile() ? candidate : '';
        } catch {
            return '';
        }
    }

    /**
     * 下载图片到本地（远程 URL 走磁盘缓存，本地资源复制一份）。
     * 本地资源必须复制而不是直接复用：调用方上传后会删除临时文件，
     * 直接复用会导致发布缓存素材被误删。
     */
    async downloadImage(imageUrl, filename) {
        try {
            const rawSource = String(imageUrl || '').trim();
            const safeName = this.sanitizeFilename(filename || Date.now());

            const localImagePath = this.resolveLocalImagePath(rawSource);
            if (localImagePath) {
                const extension = extname(localImagePath).replace('.', '').toLowerCase() || 'jpg';
                const tempPath = pathJoin(this.tempDir, `${safeName}.${extension}`);
                copyFileSync(localImagePath, tempPath);
                logger.debug('本地图片已复制到临时目录:', tempPath);
                return tempPath;
            }

            if (
                rawSource.startsWith('file://') ||
                rawSource.startsWith('/') ||
                /^[a-zA-Z]:[\\/]/.test(rawSource)
            ) {
                throw new Error(`图片文件不存在: ${rawSource}`);
            }

            // 远程 URL：先查磁盘缓存（平台脚本上传后可能删除返回的文件，命中前必须校验存在性）
            const cachedPath = this.getFreshCachePath(rawSource);
            if (cachedPath) {
                logger.debug('命中媒体缓存:', cachedPath);
                return cachedPath;
            }

            let inflight = inflightDownloads.get(rawSource);
            if (!inflight) {
                inflight = this.downloadToCache(rawSource).finally(() => {
                    inflightDownloads.delete(rawSource);
                });
                inflightDownloads.set(rawSource, inflight);
            }
            return await inflight;

        } catch (error) {
            logger.error('下载图片失败:', error);
            throw error;
        }
    }

    /**
     * 下载远程媒体到缓存目录，返回缓存文件路径
     */
    async downloadToCache(imageUrl) {
        const response = await fetch(imageUrl);

        if (!response.ok) {
            throw new Error(`下载图片失败: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const extension = this.getCacheExtension(imageUrl, response);
        const cachePath = pathJoin(this.cacheDir, `${this.getCacheKey(imageUrl)}.${extension}`);

        writeFileSync(cachePath, Buffer.from(buffer));
        logger.debug('媒体已下载到缓存:', cachePath);
        return cachePath;
    }

    /**
     * 缓存 key：sha1(url)
     */
    getCacheKey(imageUrl) {
        return createHash('sha1').update(String(imageUrl)).digest('hex');
    }

    /**
     * 从 URL path 推断扩展名
     */
    getUrlExtension(imageUrl) {
        try {
            const urlObj = new URL(imageUrl);
            const pathExt = extname(urlObj.pathname).replace('.', '').toLowerCase();
            if (pathExt && pathExt.length <= 5) {
                return pathExt;
            }
        } catch {}
        return '';
    }

    /**
     * 缓存文件扩展名：优先 URL path，其次 Content-Type，兜底 bin
     */
    getCacheExtension(imageUrl, response) {
        const urlExt = this.getUrlExtension(imageUrl);
        if (urlExt) {
            return urlExt;
        }
        const contentType = response.headers?.get?.('content-type') || '';
        if (contentType.includes('png')) return 'png';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
        if (contentType.includes('webp')) return 'webp';
        if (contentType.includes('gif')) return 'gif';
        if (contentType.includes('mp4')) return 'mp4';
        return 'bin';
    }

    /**
     * 查找缓存目录中指定 hash 的文件
     */
    findCachedFile(hash) {
        try {
            const matched = readdirSync(this.cacheDir).find(name => name.startsWith(`${hash}.`));
            return matched ? pathJoin(this.cacheDir, matched) : '';
        } catch {
            return '';
        }
    }

    /**
     * 获取未过期的缓存文件路径；文件被平台脚本删除或已过期时返回空字符串
     */
    getFreshCachePath(imageUrl) {
        const cachedPath = this.findCachedFile(this.getCacheKey(imageUrl));
        if (!cachedPath || !existsSync(cachedPath)) {
            return '';
        }
        try {
            const stat = statSync(cachedPath);
            if (!stat.isFile() || Date.now() - stat.mtimeMs >= MEDIA_CACHE_TTL_MS) {
                return '';
            }
        } catch {
            return '';
        }
        return cachedPath;
    }

    /**
     * 规范化文件名
     */
    sanitizeFilename(filename) {
        return String(filename)
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .slice(0, 80);
    }

    /**
     * 删除临时文件
     */
    deleteTempFile(filePath) {
        try {
            if (existsSync(filePath)) {
                unlinkSync(filePath);
                logger.debug('临时文件已删除:', filePath);
            }
        } catch (error) {
            logger.warn('删除临时文件失败:', error);
        }
    }

    /**
     * 批量下载图片（并发数 4，返回顺序与输入一致，任一失败即抛错）
     */
    async downloadImages(imageUrls, baseFilename) {
        const tempPaths = new Array(imageUrls.length);
        let nextIndex = 0;

        const worker = async () => {
            while (nextIndex < imageUrls.length) {
                const i = nextIndex++;
                try {
                    tempPaths[i] = await this.downloadImage(imageUrls[i], `${baseFilename}_${i}`);
                } catch (error) {
                    logger.error(`下载第 ${i + 1} 张图片失败:`, error);
                    throw error;
                }
            }
        };

        const workerCount = Math.min(DOWNLOAD_CONCURRENCY, imageUrls.length);
        const workers = [];
        for (let i = 0; i < workerCount; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        return tempPaths;
    }

    /**
     * 后台预热媒体文件：并发下载到缓存，单个失败静默忽略
     */
    async prefetchMedia(urls) {
        const seen = new Set();
        const targets = (Array.isArray(urls) ? urls : [])
            .map(item => String(item || '').trim())
            .filter(item => {
                if (!/^https?:\/\//i.test(item) || seen.has(item)) {
                    return false;
                }
                seen.add(item);
                return true;
            });

        let queued = 0;
        let skipped = 0;
        let failed = 0;
        let nextIndex = 0;

        const worker = async () => {
            while (nextIndex < targets.length) {
                const url = targets[nextIndex++];
                if (this.getFreshCachePath(url)) {
                    skipped++;
                    continue;
                }
                queued++;
                try {
                    let inflight = inflightDownloads.get(url);
                    if (!inflight) {
                        inflight = this.downloadToCache(url).finally(() => {
                            inflightDownloads.delete(url);
                        });
                        inflightDownloads.set(url, inflight);
                    }
                    await inflight;
                } catch {
                    failed++;
                }
            }
        };

        const workerCount = Math.min(DOWNLOAD_CONCURRENCY, targets.length);
        const workers = [];
        for (let i = 0; i < workerCount; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        return { queued, skipped, failed };
    }

    /**
     * 批量删除临时文件
     */
    deleteTempFiles(filePaths) {
        filePaths.forEach(filePath => this.deleteTempFile(filePath));
    }

    /**
     * 清理临时目录
     */
    cleanupTempDir() {
        try {
            logger.debug('临时目录清理完成');
        } catch (error) {
            logger.warn('清理临时目录失败:', error);
        }
    }

    /**
     * 获取图片信息
     */
    async getImageInfo(imageUrl) {
        try {
            const response = await fetch(imageUrl, { method: 'HEAD' });
            return {
                size: response.headers.get('content-length'),
                type: response.headers.get('content-type'),
                lastModified: response.headers.get('last-modified')
            };
        } catch (error) {
            logger.warn('获取图片信息失败:', error);
            return null;
        }
    }
}

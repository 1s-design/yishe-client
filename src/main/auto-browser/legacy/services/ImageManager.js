/**
 * 图片管理器 - 统一管理图片下载、上传、删除等操作
 * 远程媒体文件带磁盘缓存：同一 URL 2 小时内重复下载直接命中缓存，
 * 并支持 prefetchMedia 后台预热下一条任务的媒体文件。
 *
 * 下载时会根据目标尺寸（maxDimension）对 COS 域名 URL 拼接 imageMogr2
 * 让 CDN 实时返回缩图；非 COS 域名则用 sharp 在本地 resize。缓存 key 以
 * 原始 URL 计算哈希并携带尺寸后缀，保证预热与正常下载产出同一缓存路径。
 */

import { join as pathJoin, extname } from 'path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, copyFileSync, statSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { logger } from '../utils/logger.js';
import { getAutoBrowserTempDir } from '../utils/workspacePaths.js';

const MEDIA_CACHE_DIR_NAME = 'yishe-publish-media-cache';
const MEDIA_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const MEDIA_CACHE_MAX_FILES = 500;
const DOWNLOAD_CONCURRENCY = 4;

// 默认图片尺寸上限（最长边像素），覆盖绝大多数发布场景
const DEFAULT_MAX_DIMENSION = 2000;

// 支持 CDN 实时图片处理（query 参数让 CDN 返回缩图）的域名正则。
// 切换图床（阿里 OSS imagex-oss-process、AWS CloudFront 等）时，
// 在下方数组新增对应正则即可；没命中的域名自动走 sharp 本地 resize 兜底，
// 不会报错，只是先下载原图再缩。
const CDN_IMAGE_PROCESS_DOMAINS = [
    /\bmyqcloud\.com$/i,
    /\btencentcloudcdn\.com$/i,
    /\btencentcloud\.com$/i,
    /\bcos\.[a-z0-9-]+\.myqcloud\.com$/i,
    /\bvod\.[a-z0-9-]+\.myqcloud\.com$/i,
    /\bcos-pic\.[a-z0-9-]+\.myqcloud\.com$/i,
];

// 同一 (URL + 尺寸) 的并发下载共享同一个 Promise
const inflightDownloads = new Map();

function buildInflightKey(url, maxDimension) {
    return `${url}||d${maxDimension || 'raw'}`;
}

function isCdnImageUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return CDN_IMAGE_PROCESS_DOMAINS.some(re => re.test(host));
    } catch {
        return false;
    }
}

/**
 * URL 是否已带 CDN 图片处理参数（避免重复拼接）。
 * 已知参数名：imageMogr2（腾讯 COS）、x-oss-process（阿里 OSS）、x-amz-process（AWS）
 */
function hasCdnProcessParam(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes('imagemogr2') || lower.includes('x-oss-process') || lower.includes('x-amz-process');
}

/**
 * 构建下载时的优化 URL：
 * - 命中 CDN 实时处理域名 → 拼接 imageMogr2/thumbnail/x{max} 让 CDN 返回缩图
 *   （已带 imageMogr2 参数时跳过，避免格式破坏）
 * - 非 CDN / 视频 / 已带处理参数 → 原样返回（后续 sharp 在本地 resize 兜底）
 */
function buildOptimizedUrl(url, maxDimension) {
    if (!url || !maxDimension) return url;

    // 视频不走 CDN 图片处理
    const pathPart = url.toLowerCase().split('?')[0];
    if (pathPart.endsWith('.mp4') || pathPart.endsWith('.mov') || pathPart.endsWith('.webm') || pathPart.endsWith('.m4v')) {
        return url;
    }

    // 非 CDN 域名 → 原样返回（sharp 兜底）
    if (!isCdnImageUrl(url)) {
        return url;
    }

    // URL 已带 CDN 图片处理参数（比如来自上一层调用方或服务端 COS 生成的缩略图 URL）
    if (hasCdnProcessParam(url)) {
        logger.debug('URL 已带 CDN 图片处理参数，跳过 imageMogr2 拼接:', url.slice(0, 80));
        return url;
    }

    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}imageMogr2/thumbnail/x${maxDimension}/quality/80/format/webp/ignore-error/1`;
}

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
     *
     * @param {string} imageUrl 远程或本地图片 URL
     * @param {string} filename 临时文件名（不含扩展名）
     * @param {object} [options]
     * @param {number} [options.maxDimension] 目标最长边像素；COS URL 会让 CDN 返回缩图，
     *                                        非 COS URL 用 sharp 本地 resize。默认 2000
     */
    async downloadImage(imageUrl, filename, options = {}) {
        const maxDimension = options.maxDimension || DEFAULT_MAX_DIMENSION;
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
            const cachedPath = this.getFreshCachePath(rawSource, maxDimension);
            if (cachedPath) {
                logger.debug('命中媒体缓存:', cachedPath);
                return cachedPath;
            }

            const inflightKey = buildInflightKey(rawSource, maxDimension);
            let inflight = inflightDownloads.get(inflightKey);
            if (!inflight) {
                inflight = this.downloadToCache(rawSource, maxDimension).finally(() => {
                    inflightDownloads.delete(inflightKey);
                });
                inflightDownloads.set(inflightKey, inflight);
            }
            return await inflight;

        } catch (error) {
            logger.error('下载图片失败:', error);
            throw error;
        }
    }

    /**
     * 下载远程媒体到缓存目录，返回缓存文件路径。
     * CDN 域名 URL 会拼接 imageMogr2 让 CDN 返回缩图（content-type 非 image 时放弃优化）；
     * 非 CDN URL + maxDimension 则下载原图后用 sharp 本地 resize。
     */
    async downloadToCache(imageUrl, maxDimension) {
        const isCdn = isCdnImageUrl(imageUrl);
        let usedOptimization = false;
        let currentUrl = imageUrl;

        // CDN 路径：尝试拼接 imageMogr2，但如果 CDN 返回非 image 内容（参数不被识别、
        // URL 已带其他 CDN 参数导致 imageMogr2 格式破坏等），回退到原始 URL 重下。
        if (isCdn && maxDimension) {
            const optimized = buildOptimizedUrl(imageUrl, maxDimension);
            if (optimized !== imageUrl) {
                currentUrl = optimized;
                usedOptimization = true;
            }
        }

        let response = await fetch(currentUrl);
        if (!response.ok) {
            if (usedOptimization) {
                logger.warn('CDN 优化 URL 请求失败，回退原始 URL:', response.status, imageUrl);
                response = await fetch(imageUrl);
                if (!response.ok) {
                    throw new Error(`下载图片失败: ${response.statusText}`);
                }
            } else {
                throw new Error(`下载图片失败: ${response.statusText}`);
            }
        }

        // 校验 content-type：CDN 优化 URL 如果返回非 image/*（比如 CDN 忽略参数返回了
        // HTML 错误页），回退原始 URL。原始 URL 也做同样校验。
        const contentType = response.headers?.get?.('content-type') || '';
        const looksLikeImage = /^image\//i.test(contentType) || contentType.includes('octet-stream');
        if (!looksLikeImage) {
            if (usedOptimization) {
                logger.warn('CDN 优化 URL 返回非图片内容，回退原始 URL:', contentType.slice(0, 40), imageUrl);
                response = await fetch(imageUrl);
                if (!response.ok) {
                    throw new Error(`下载图片失败: ${response.statusText}`);
                }
            } else {
                throw new Error(`下载图片失败: 响应非图片 (content-type: ${contentType}, url: ${imageUrl.slice(0, 80)})`);
            }
        }

        let buffer = Buffer.from(await response.arrayBuffer());
        const extension = this.getCacheExtension(currentUrl, response);

        // 非 CDN 域名 + maxDimension：下载原图后 sharp resize 到目标尺寸
        // 或 CDN 回退到原始 URL 但仍需要缩图
        if (maxDimension && (!isCdn || currentUrl === imageUrl)) {
            try {
                const resized = await sharp(buffer)
                    .rotate() // 自动修正 EXIF 方向
                    .resize({
                        width: maxDimension,
                        height: maxDimension,
                        fit: 'inside',
                        withoutEnlargement: true,
                    })
                    .webp({ quality: 80 })
                    .toBuffer();
                buffer = resized;
                logger.debug('图片已本地 resize:', imageUrl);
            } catch (err) {
                logger.warn('sharp resize 失败，使用原图:', err?.message, imageUrl.slice(0, 60));
            }
        }

        const cachePath = pathJoin(this.cacheDir, `${this.getCacheKey(imageUrl, maxDimension)}.${extension}`);
        writeFileSync(cachePath, buffer);
        logger.debug('媒体已下载到缓存:', cachePath);
        return cachePath;
    }

    /**
     * 缓存 key：sha1(原始 URL) + 尺寸后缀，保证预热与正常下载产出同一缓存路径
     */
    getCacheKey(imageUrl, maxDimension) {
        const suffix = maxDimension ? `_d${maxDimension}` : '_raw';
        return createHash('sha1').update(String(imageUrl)).digest('hex') + suffix;
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
    getFreshCachePath(imageUrl, maxDimension) {
        const cachedPath = this.findCachedFile(this.getCacheKey(imageUrl, maxDimension));
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
    async downloadImages(imageUrls, baseFilename, options = {}) {
        const { maxDimension } = options;
        const tempPaths = new Array(imageUrls.length);
        let nextIndex = 0;

        const worker = async () => {
            while (nextIndex < imageUrls.length) {
                const i = nextIndex++;
                try {
                    tempPaths[i] = await this.downloadImage(imageUrls[i], `${baseFilename}_${i}`, { maxDimension });
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
     * 后台预热媒体文件：并发下载到缓存，单个失败静默忽略。
     * 与 downloadImage 使用相同的 maxDimension → 产出同一缓存 key，
     * 保证预热文件能被正式下载命中。
     */
    async prefetchMedia(urls, options = {}) {
        const maxDimension = options.maxDimension || DEFAULT_MAX_DIMENSION;
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
                if (this.getFreshCachePath(url, maxDimension)) {
                    skipped++;
                    continue;
                }
                queued++;
                try {
                    const inflightKey = buildInflightKey(url, maxDimension);
                    let inflight = inflightDownloads.get(inflightKey);
                    if (!inflight) {
                        inflight = this.downloadToCache(url, maxDimension).finally(() => {
                            inflightDownloads.delete(inflightKey);
                        });
                        inflightDownloads.set(inflightKey, inflight);
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

/**
 * 图片管理器 - 统一管理图片下载、上传、删除等操作
 */

import { join as pathJoin, extname } from 'path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { logger } from '../utils/logger.js';

/**
 * 图片管理器类
 */
export class ImageManager {
    constructor() {
        this.tempDir = this.getTempDir();
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
        const tempDir = pathJoin(process.cwd(), 'temp');
        return this.ensureDir(tempDir);
    }

    /**
     * 下载图片到临时目录
     */
    async downloadImage(imageUrl, filename) {
        try {
            const response = await fetch(imageUrl);
            
            if (!response.ok) {
                throw new Error(`下载图片失败: ${response.statusText}`);
            }
            
            const buffer = await response.arrayBuffer();

            // 提取扩展名：优先从 pathname 获取，其次从 content-type 推断，最后默认 jpg
            let extension = this.getImageExtension(imageUrl, response);
            
            // 规范化文件名，避免包含非法字符或路径片段
            const safeName = this.sanitizeFilename(filename || Date.now());
            const tempPath = pathJoin(this.tempDir, `${safeName}.${extension}`);
            
            writeFileSync(tempPath, Buffer.from(buffer));
            logger.debug('图片已下载到:', tempPath);
            return tempPath;
            
        } catch (error) {
            logger.error('下载图片失败:', error);
            throw error;
        }
    }

    /**
     * 获取图片扩展名
     */
    getImageExtension(imageUrl, response) {
        let extension = 'jpg';
        
        try {
            const urlObj = new URL(imageUrl);
            const pathExt = extname(urlObj.pathname).replace('.', '').toLowerCase();
            if (pathExt && pathExt.length <= 5) {
                extension = pathExt;
            }
        } catch {}
        
        if (extension === 'jpg' || extension === '') {
            const contentType = response.headers?.get?.('content-type') || '';
            if (contentType.includes('png')) extension = 'png';
            else if (contentType.includes('jpeg') || contentType.includes('jpg')) extension = 'jpg';
            else if (contentType.includes('webp')) extension = 'webp';
            else if (contentType.includes('gif')) extension = 'gif';
        }

        return extension;
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
     * 批量下载图片
     */
    async downloadImages(imageUrls, baseFilename) {
        const tempPaths = [];
        
        for (let i = 0; i < imageUrls.length; i++) {
            try {
                const filename = `${baseFilename}_${i}`;
                const tempPath = await this.downloadImage(imageUrls[i], filename);
                tempPaths.push(tempPath);
            } catch (error) {
                logger.error(`下载第 ${i + 1} 张图片失败:`, error);
                throw error;
            }
        }
        
        return tempPaths;
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

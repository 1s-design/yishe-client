/**
 * 爬虫服务 - 提供可扩展的抓取能力
 *
 * 说明：
 * 1) crawlUrl: 通用 URL 抓取（适合先期快速接入）
 * 2) runSiteCrawler: 按 site 标识执行站点爬虫（后续可逐站扩展）
 */

import { getOrCreateBrowser } from '../services/BrowserService.js';
import { logger } from '../utils/logger.js';

const siteCrawlers = {
    demo: demoCrawler,
    sora: soraCrawler,
    pinterest: pinterestCrawler
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableNavigationError(error) {
    const message = error?.message || '';
    return [
        'ERR_CONNECTION_CLOSED',
        'ERR_CONNECTION_RESET',
        'ERR_HTTP2_PROTOCOL_ERROR',
        'ERR_NETWORK_CHANGED',
        'ERR_TIMED_OUT',
        'Timeout'
    ].some((keyword) => message.includes(keyword));
}

async function gotoWithFallback(page, url, timeout = 60000) {
    const waitUntilStrategies = ['domcontentloaded', 'load', 'networkidle'];
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
        for (const waitUntil of waitUntilStrategies) {
            try {
                logger.info(`导航尝试 #${attempt} (${waitUntil}): ${url}`);
                const response = await page.goto(url, { waitUntil, timeout });
                return {
                    ok: true,
                    waitUntil,
                    status: response?.status?.() ?? null
                };
            } catch (error) {
                lastError = error;
                logger.warn(`导航失败 #${attempt} (${waitUntil}): ${error.message}`);
                if (!isRetriableNavigationError(error)) {
                    throw error;
                }
            }
        }

        await sleep(1000 * attempt);
    }

    throw lastError || new Error('页面导航失败');
}

function normalizeSelector(selector, fallback) {
    return typeof selector === 'string' && selector.trim() ? selector.trim() : fallback;
}

function sanitizeText(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim();
}

async function extractByRules(page, rules = {}) {
    const titleSelector = normalizeSelector(rules.titleSelector, 'title');
    const contentSelector = normalizeSelector(rules.contentSelector, 'body');
    const linksSelector = normalizeSelector(rules.linksSelector, 'a[href]');
    const maxLinks = Number(rules.maxLinks) > 0 ? Number(rules.maxLinks) : 20;

    return page.evaluate(({ titleSelector, contentSelector, linksSelector, maxLinks }) => {
        const byText = (selector) => {
            const el = document.querySelector(selector);
            return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
        };

        const title = byText(titleSelector) || document.title || '';
        const content = byText(contentSelector);

        const links = Array.from(document.querySelectorAll(linksSelector))
            .slice(0, maxLinks)
            .map((item) => ({
                text: (item.textContent || '').replace(/\s+/g, ' ').trim(),
                href: item.getAttribute('href') || ''
            }))
            .filter((item) => item.href);

        return {
            title,
            content,
            links,
            crawledAt: new Date().toISOString()
        };
    }, { titleSelector, contentSelector, linksSelector, maxLinks });
}

async function crawlUrl({
    url,
    waitUntil = 'domcontentloaded',
    timeout = 30000,
    rules = {}
}) {
    if (!url || typeof url !== 'string') {
        throw new Error('缺少 url 参数');
    }

    const browser = await getOrCreateBrowser();
    const page = await browser.newPage();

    try {
        logger.info(`开始抓取 URL: ${url}`);
        await page.goto(url, { waitUntil, timeout: Number(timeout) || 30000 });

        const extracted = await extractByRules(page, rules);
        const finalResult = {
            success: true,
            mode: 'url',
            url,
            data: {
                title: sanitizeText(extracted.title),
                content: sanitizeText(extracted.content),
                links: Array.isArray(extracted.links) ? extracted.links : [],
                crawledAt: extracted.crawledAt
            }
        };

        logger.info(`URL 抓取完成: ${url}`);
        return finalResult;
    } finally {
        await page.close().catch(() => { });
    }
}

/**
 * Sora 探索页面爬虫 - 抓取图片预览数据
 * 页面：https://sora.chatgpt.com/explore?type=images
 */
async function soraCrawler(params = {}) {
    const targetUrl = 'https://sora.chatgpt.com/explore?type=images';
    const maxImages = Number(params.maxImages) > 0 ? Number(params.maxImages) : 20;

    const browser = await getOrCreateBrowser();
    const page = await browser.newPage();

    try {
        logger.info(`开始爬取 Sora 图片: ${targetUrl}`);

        await page.setExtraHTTPHeaders({
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
        });

        await page.goto('https://sora.chatgpt.com', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        }).catch((error) => {
            logger.warn(`Sora 主域预热失败，继续尝试目标页: ${error.message}`);
        });

        const navResult = await gotoWithFallback(page, targetUrl, 60000);
        logger.info(`Sora 页面已打开，waitUntil=${navResult.waitUntil}, status=${navResult.status ?? 'unknown'}`);

        logger.info('等待图片容器加载...');
        await page.waitForSelector('img[src], img[data-src], img[srcset]', { timeout: 20000 }).catch(() => {
            logger.warn('未能等待到 img 选择器，继续尝试提取现有内容');
        });

        for (let i = 0; i < 8; i++) {
            await page.mouse.wheel(0, 1200).catch(() => { });
            await page.waitForTimeout(500);
        }

        const images = await page.evaluate((maxImages) => {
            const extracted = [];
            const seenUrls = new Set();

            const toAbsoluteUrl = (value) => {
                if (!value) return '';
                try {
                    return new URL(value, window.location.origin).toString();
                } catch {
                    return '';
                }
            };

            const looksLikeAvatarOrIcon = (url = '', alt = '', cls = '') => {
                const s = `${url} ${alt} ${cls}`.toLowerCase();
                return [
                    'avatar',
                    'profile',
                    'user',
                    'icon',
                    'logo',
                    'favicon',
                    'emoji',
                    'badge'
                ].some((k) => s.includes(k));
            };

            const validVisualSize = (width, height) => {
                const w = Number(width) || 0;
                const h = Number(height) || 0;
                return (w >= 180 && h >= 180) || (w * h >= 45000);
            };

            const pickSrcFromSrcSet = (srcset = '') => {
                if (!srcset) return '';
                const parts = srcset.split(',').map((item) => item.trim().split(' ')[0]).filter(Boolean);
                return parts[parts.length - 1] || parts[0] || '';
            };

            const pickBackgroundImage = (el) => {
                if (!el) return '';
                const styleBg = el.style?.backgroundImage || '';
                const cssBg = window.getComputedStyle(el).backgroundImage || '';
                const bg = styleBg && styleBg !== 'none' ? styleBg : cssBg;
                const m = bg.match(/url\(["']?(.*?)["']?\)/i);
                return m && m[1] ? m[1] : '';
            };

            const pushImage = ({ url, alt = '', title = '', description = '', width = 0, height = 0 }) => {
                const finalUrl = toAbsoluteUrl(url);
                const cleanAlt = (alt || '').trim();
                const cleanTitle = (title || '').trim();
                const cleanDesc = (description || '').trim();

                if (!finalUrl || seenUrls.has(finalUrl)) return;
                if (finalUrl.startsWith('data:') || finalUrl.startsWith('blob:')) return;
                if (looksLikeAvatarOrIcon(finalUrl, cleanAlt, cleanTitle)) return;
                if (!validVisualSize(width, height)) return;

                seenUrls.add(finalUrl);
                extracted.push({
                    url: finalUrl,
                    alt: cleanAlt || cleanTitle || cleanDesc || '图片',
                    title: cleanTitle || cleanAlt || '',
                    description: cleanDesc,
                    index: extracted.length + 1
                });
            };

            const cardSelectors = [
                'main a',
                'article',
                '[data-testid*="card"]',
                '[class*="card"]',
                '[class*="tile"]'
            ];

            const cardNodes = Array.from(new Set(cardSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))));

            for (const node of cardNodes) {
                if (extracted.length >= maxImages) break;

                const img = node.querySelector('img');
                const source = node.querySelector('source[srcset]');
                const bgNode = node.querySelector('[style*="background-image"], [class*="image"], [class*="cover"]') || node;

                const src =
                    (img && (img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || pickSrcFromSrcSet(img.getAttribute('srcset') || ''))) ||
                    (source && pickSrcFromSrcSet(source.getAttribute('srcset') || '')) ||
                    pickBackgroundImage(bgNode);

                const width = img ? (img.naturalWidth || img.width || img.clientWidth || node.clientWidth) : (node.clientWidth || 0);
                const height = img ? (img.naturalHeight || img.height || img.clientHeight || node.clientHeight) : (node.clientHeight || 0);
                const title = img?.getAttribute('title') || node.getAttribute('title') || '';
                const alt = img?.getAttribute('alt') || '';

                const textEl = node.querySelector('p, span, div[class*="description"], div[class*="text"], h1, h2, h3, h4');
                const description = textEl ? (textEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220) : '';

                pushImage({ url: src, alt, title, description, width, height });
            }

            if (extracted.length < maxImages) {
                const fallbackImgs = Array.from(document.querySelectorAll('img'));
                for (const img of fallbackImgs) {
                    if (extracted.length >= maxImages) break;

                    const src = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || pickSrcFromSrcSet(img.getAttribute('srcset') || '');
                    const alt = img.getAttribute('alt') || '';
                    const title = img.getAttribute('title') || '';

                    let context = img.closest('article, div[role="article"], a, div[data-test], section');
                    if (!context) context = img.parentElement;

                    const textEl = context?.querySelector?.('p, span, div[class*="description"], div[class*="text"], h1, h2, h3, h4');
                    const description = textEl ? (textEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220) : '';

                    pushImage({
                        url: src,
                        alt,
                        title,
                        description,
                        width: img.naturalWidth || img.width || img.clientWidth,
                        height: img.naturalHeight || img.height || img.clientHeight
                    });
                }
            }

            return extracted;
        }, maxImages);

        if (!images.length) {
            throw new Error('页面已打开但未提取到图片，可能需要先在浏览器中登录 Sora，或当前网络对该域名连接不稳定');
        }

        logger.info(`成功提取 ${images.length} 张图片`);

        return {
            success: true,
            mode: 'site',
            site: 'sora',
            data: {
                title: 'OpenAI Sora - Explore Images',
                url: targetUrl,
                images,
                totalImages: images.length,
                crawledAt: new Date().toISOString()
            }
        };
    } catch (error) {
        logger.error(`Sora 爬虫执行失败: ${error.message}`);
        throw new Error(`Sora 爬虫失败: ${error.message}`);
    } finally {
        await page.close().catch(() => { });
    }
}

/**
 * Pinterest 图片爬虫 - 抓取首页/任意 Pinterest 页面图片
 * 默认页面：https://www.pinterest.com/
 */
async function pinterestCrawler(params = {}) {
    const targetUrl = params.url || 'https://www.pinterest.com/';
    const maxImages = Number(params.maxImages) > 0 ? Number(params.maxImages) : 20;
    const scrollTimes = Number(params.scrollTimes) > 0 ? Number(params.scrollTimes) : 8;

    const browser = await getOrCreateBrowser();
    const page = await browser.newPage();

    try {
        logger.info(`开始爬取 Pinterest 图片: ${targetUrl}`);

        await page.setExtraHTTPHeaders({
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
        });

        const navResult = await gotoWithFallback(page, targetUrl, 60000);
        logger.info(`Pinterest 页面已打开，waitUntil=${navResult.waitUntil}, status=${navResult.status ?? 'unknown'}`);

        logger.info('等待图片容器加载...');
        await page.waitForSelector('img[src], img[data-src], img[srcset]', { timeout: 20000 }).catch(() => {
            logger.warn('未能等待到 img 选择器，继续尝试提取现有内容');
        });

        for (let i = 0; i < scrollTimes; i++) {
            await page.mouse.wheel(0, 1200).catch(() => { });
            await page.waitForTimeout(600);
        }

        const images = await page.evaluate((maxImages) => {
            const extracted = [];
            const seenUrls = new Set();

            const toAbsoluteUrl = (value) => {
                if (!value) return '';
                try {
                    return new URL(value, window.location.origin).toString();
                } catch {
                    return '';
                }
            };

            const looksLikeAvatarOrIcon = (url = '', alt = '', cls = '') => {
                const s = `${url} ${alt} ${cls}`.toLowerCase();
                return [
                    'avatar',
                    'profile',
                    'user',
                    'icon',
                    'logo',
                    'favicon',
                    'emoji',
                    'badge'
                ].some((k) => s.includes(k));
            };

            const validVisualSize = (width, height) => {
                const w = Number(width) || 0;
                const h = Number(height) || 0;
                return (w >= 180 && h >= 180) || (w * h >= 45000);
            };

            const pickSrcFromSrcSet = (srcset = '') => {
                if (!srcset) return '';
                const parts = srcset.split(',').map((item) => item.trim().split(' ')[0]).filter(Boolean);
                return parts[parts.length - 1] || parts[0] || '';
            };

            const pushImage = ({ url, alt = '', title = '', description = '', width = 0, height = 0 }) => {
                const finalUrl = toAbsoluteUrl(url);
                const cleanAlt = (alt || '').trim();
                const cleanTitle = (title || '').trim();
                const cleanDesc = (description || '').trim();

                if (!finalUrl || seenUrls.has(finalUrl)) return;
                if (finalUrl.startsWith('data:') || finalUrl.startsWith('blob:')) return;
                if (looksLikeAvatarOrIcon(finalUrl, cleanAlt, cleanTitle)) return;
                if (!validVisualSize(width, height)) return;

                seenUrls.add(finalUrl);
                extracted.push({
                    url: finalUrl,
                    alt: cleanAlt || cleanTitle || cleanDesc || '图片',
                    title: cleanTitle || cleanAlt || '',
                    description: cleanDesc,
                    index: extracted.length + 1
                });
            };

            const cardSelectors = [
                'a[href*="/pin/"]',
                '[data-test-id*="pin"]',
                '[data-test-id*="pinWrapper"]',
                'article',
                '[role="listitem"]'
            ];

            const cardNodes = Array.from(new Set(cardSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))));

            for (const node of cardNodes) {
                if (extracted.length >= maxImages) break;

                const img = node.querySelector('img');
                const source = node.querySelector('source[srcset]');

                const src =
                    (img && (img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || pickSrcFromSrcSet(img.getAttribute('srcset') || ''))) ||
                    (source && pickSrcFromSrcSet(source.getAttribute('srcset') || ''));

                const width = img ? (img.naturalWidth || img.width || img.clientWidth || node.clientWidth) : (node.clientWidth || 0);
                const height = img ? (img.naturalHeight || img.height || img.clientHeight || node.clientHeight) : (node.clientHeight || 0);
                const title = img?.getAttribute('title') || node.getAttribute('title') || '';
                const alt = img?.getAttribute('alt') || '';

                const textEl = node.querySelector('span, p, div[class*="description"], div[class*="text"], h1, h2, h3, h4');
                const description = textEl ? (textEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220) : '';

                pushImage({ url: src, alt, title, description, width, height });
            }

            if (extracted.length < maxImages) {
                const fallbackImgs = Array.from(document.querySelectorAll('img'));
                for (const img of fallbackImgs) {
                    if (extracted.length >= maxImages) break;

                    const src = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || pickSrcFromSrcSet(img.getAttribute('srcset') || '');
                    const alt = img.getAttribute('alt') || '';
                    const title = img.getAttribute('title') || '';

                    let context = img.closest('a[href*="/pin/"], article, div[role="listitem"], section');
                    if (!context) context = img.parentElement;

                    const textEl = context?.querySelector?.('span, p, div[class*="description"], div[class*="text"], h1, h2, h3, h4');
                    const description = textEl ? (textEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220) : '';

                    pushImage({
                        url: src,
                        alt,
                        title,
                        description,
                        width: img.naturalWidth || img.width || img.clientWidth,
                        height: img.naturalHeight || img.height || img.clientHeight
                    });
                }
            }

            return extracted;
        }, maxImages);

        if (!images.length) {
            throw new Error('页面已打开但未提取到图片，可能需要先在浏览器中登录 Pinterest，或当前网络对该域名连接不稳定');
        }

        logger.info(`成功提取 ${images.length} 张图片`);

        return {
            success: true,
            mode: 'site',
            site: 'pinterest',
            data: {
                title: 'Pinterest',
                url: targetUrl,
                images,
                totalImages: images.length,
                crawledAt: new Date().toISOString()
            }
        };
    } catch (error) {
        logger.error(`Pinterest 爬虫执行失败: ${error.message}`);
        throw new Error(`Pinterest 爬虫失败: ${error.message}`);
    } finally {
        await page.close().catch(() => { });
    }
}

async function demoCrawler(params = {}) {
    const targetUrl = params.url || 'https://example.com';
    const result = await crawlUrl({
        url: targetUrl,
        rules: {
            titleSelector: params.titleSelector || 'h1, title',
            contentSelector: params.contentSelector || 'p, body',
            linksSelector: params.linksSelector || 'a[href]',
            maxLinks: params.maxLinks || 10
        },
        waitUntil: params.waitUntil || 'domcontentloaded',
        timeout: params.timeout || 30000
    });

    return {
        ...result,
        mode: 'site',
        site: 'demo'
    };
}

function getSupportedSites() {
    return Object.keys(siteCrawlers);
}

async function runSiteCrawler(site, params = {}) {
    if (!site || typeof site !== 'string') {
        throw new Error('缺少 site 参数');
    }

    const crawler = siteCrawlers[site];
    if (!crawler) {
        throw new Error(`不支持的 site: ${site}`);
    }

    logger.info(`执行站点爬虫: ${site}`);
    const result = await crawler(params);
    return {
        success: true,
        site,
        data: result.data,
        crawledAt: new Date().toISOString()
    };
}

async function checkCrawlerHealth() {
    return {
        success: true,
        service: 'crawler',
        status: 'ok',
        supportedSites: getSupportedSites(),
        timestamp: new Date().toISOString()
    };
}

export default {
    crawlUrl,
    runSiteCrawler,
    getSupportedSites,
    checkCrawlerHealth
};

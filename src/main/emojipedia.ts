import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
/**
 * Emojipedia Emoji/Sticker 搜索能力
 * 官方网站: https://emojipedia.org/
 * 特点: Emoji 百科全书，支持多平台风格(Apple/Google/Samsung等)，SVG/PNG 图片
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';

const EMOJIPEDIA_SITE_URL = 'https://emojipedia.org/';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface EmojipediaItem {
  id: string; // slug
  name: string; // short name
  title: string; // display title
  description: string;
  image: string; // 默认图片链接
  svgUrl?: string; // SVG 链接
  pngUrl?: string; // PNG 链接
  thumbnail: string;
  downloadUrl: string;
  link: string; // 原详情页
  url: string;
  emoji?: string; // 实际 emoji 字符
  platform?: string; // Apple, Google, Samsung, etc.
  tags?: string[];
  author?: string;
  license?: string;
  isFree?: boolean;
  width?: number | null;
  height?: number | null;
}

export interface EmojipediaSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: EmojipediaItem[];
  links: string[];
  page: number;
  totalPages?: number;
  nextPage: number | null;
  error?: string;
}

interface EmojipediaSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  category?: string; // stickers, emojis, etc.
  platform?: string; // apple, google, samsung, etc.
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

/** 获取 Node/Electron fetch 实现 */
async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') {
    return net.fetch.bind(net);
  }
  return fetch;
}

/**
 * 检查 Emojipedia 服务状态
 */
export async function getEmojipediaStatus() {
  const site = await checkSiteAvailability(EMOJIPEDIA_SITE_URL, { timeoutMs: 8000 });
  return {
    key: 'emojipedia',
    pluginKey: 'emojipedia',
    label: 'Emojipedia Emoji/Sticker',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Emojipedia 可用' : `Emojipedia 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

/**
 * 搜索 Emojipedia
 */
export async function searchEmojipedia(
  query: string,
  options: EmojipediaSearchOptions = {},
): Promise<EmojipediaSearchResult> {
  const keyword = (query || '').trim();
  if (!keyword) {
    return {
      success: false, query: '', count: 0, items: [], links: [],
      page: 1, nextPage: null, error: '缺少搜索关键词',
    };
  }

  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(Math.max(Number(options.limit || options.pageSize) || 20, 1), 100);
  const _category = options.category || 'stickers';
  const platform = options.platform || '';

  try {
    const fetchFn = await getFetchImpl();
    // Emojipedia 统一搜索 URL: https://emojipedia.org/search?q=cat
    const targetUrl = `https://emojipedia.org/search?q=${encodeURIComponent(keyword)}`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://emojipedia.org/',
    };

    const res = await fetchFn(targetUrl, { headers });
    if (!res.ok) {
      throw new Error(`Emojipedia HTTP 错误: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const items = parseEmojipediaHtml(html, platform);

    const total = items.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const pagedItems = items.slice(startIndex, startIndex + limit);

    return {
      success: true,
      query: keyword,
      count: pagedItems.length,
      total,
      totalPages,
      items: pagedItems,
      links: pagedItems.map((item) => item.image),
      page,
      nextPage: page < totalPages ? page + 1 : null,
    };
  } catch (error: any) {
    return {
      success: false, query: keyword, count: 0, total: 0,
      items: [], links: [], page, nextPage: null,
      error: error?.message || '搜索 Emojipedia 发生异常',
    };
  }
}

/**
 * 解析 Emojipedia 搜索结果 HTML
 */
function parseEmojipediaHtml(html: string, platformFilter: string): EmojipediaItem[] {
  const items: EmojipediaItem[] = [];
  const usedIds = new Set<string>();

  try {
    // Strategy 1: __NEXT_DATA__ (Next.js)
    const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const pageProps = nextData?.props?.pageProps || {};
        const rawItems: any[] = pageProps?.results || pageProps?.items || pageProps?.data || pageProps?.searchResults || [];
        for (const raw of rawItems) {
          const slug = raw.slug || raw.id || raw.name || '';
          if (!slug || usedIds.has(slug)) continue;
          usedIds.add(slug);
          items.push(buildEmojipediaItem(slug, raw, platformFilter));
        }
      } catch (e) {
        console.warn('[Emojipedia Parser] __NEXT_DATA__ parse failed:', e);
      }
    }

    // Strategy 1.5: Next.js App Router RSC 流式数据提取 (self.__next_f)
    if (items.length === 0) {
      const rscRegex = /\{\\"id\\":\\"(\d+)\\",\\"code\\":\\"([^"\\]+)\\",\\"slug\\":\\"([^"\\]+)\\",\\"title\\":\\"([^"\\]+)\\"/g;
      let rscMatch;
      while ((rscMatch = rscRegex.exec(html)) !== null) {
        const id = rscMatch[1];
        const code = rscMatch[2];
        const slug = rscMatch[3];
        const title = rscMatch[4];
        if (!slug || usedIds.has(slug)) continue;
        usedIds.add(slug);

        const imageSrc = code
          ? `https://em-content.zobj.net/source/apple/391/${slug}_${code.toLowerCase()}.png`
          : `https://em-content.zobj.net/source/apple/391/${slug}.png`;

        items.push(buildEmojipediaItem(slug, {
          id,
          code,
          title,
          slug,
          image: imageSrc,
        }, platformFilter));
      }
    }

    // Strategy 2: 从 img 标签提取
    if (items.length === 0) {
      const imgTagRegex = /<img[^>]*>/gi;
      let imgMatch;
      
      while ((imgMatch = imgTagRegex.exec(html)) !== null) {
        const imgTag = imgMatch[0];
        const srcMatch = imgTag.match(/(?:data-src|src)="([^"]*(?:emojipedia|cdn\.emojipedia)[^"]*)"/i);
        if (!srcMatch) continue;
        const src = srcMatch[1];
        
        const altMatch = imgTag.match(/alt="([^"]*)"/i);
        const alt = altMatch ? altMatch[1] : '';
        
        // 从 URL 提取 slug
        const slugMatch = src.match(/\/([^\/]+?)(?:-\w+)?\.(?:png|svg|jpg)/i) ||
          src.match(/\/([^\/]+)\//);
        if (!slugMatch) continue;
        
        const slug = slugMatch[1];
        if (usedIds.has(slug) || slug.length < 2) continue;
        usedIds.add(slug);
        
        items.push(buildEmojipediaItem(slug, { image: src, title: alt }, platformFilter));
      }
    }

    // Strategy 3: 从 <a> 链接提取
    if (items.length === 0) {
      const linkRegex = /<a[^>]+href="\/([^\/]+)\/"[^>]*>([\s\S]*?)<\/a>/gi;
      let linkMatch;
      
      while ((linkMatch = linkRegex.exec(html)) !== null) {
        const slug = linkMatch[1];
        if (usedIds.has(slug) || slug.length < 2) continue;
        if (['stickers', 'emojis', 'search', 'about', 'apple', 'google'].includes(slug)) continue;
        usedIds.add(slug);
        
        const innerHtml = linkMatch[2];
        const innerImg = innerHtml.match(/<img[^>]*?(?:data-src|src)="([^"]+)"/i);
        
        items.push(buildEmojipediaItem(slug, {
          image: innerImg ? innerImg[1] : '',
          title: slug.replace(/-/g, ' '),
        }, platformFilter));
      }
    }
  } catch (err) {
    console.error('[Emojipedia Parser Error]', err);
  }

  return items;
}

/**
 * 构建 EmojipediaItem
 */
function buildEmojipediaItem(slug: string, raw: any, platform: string): EmojipediaItem {
  const detailUrl = `https://emojipedia.org/${slug}/`;
  const title = raw.title || raw.name || slug.replace(/-/g, ' ');
  const imageUrl = raw.image || raw.url || raw.src || '';
  
  // 构建各平台图片 URL (如果有)
  const svgUrl = imageUrl.endsWith('.svg') ? imageUrl : '';
  const pngUrl = imageUrl.endsWith('.png') ? imageUrl : imageUrl.replace(/\.svg$/, '.png');

  return {
    id: slug,
    name: sanitizeName(slug) || slug,
    title,
    description: `Emojipedia — ${title}`,
    image: imageUrl,
    svgUrl,
    pngUrl,
    thumbnail: imageUrl,
    downloadUrl: imageUrl,
    link: detailUrl,
    url: detailUrl,
    emoji: raw.emoji || raw.character || '',
    platform: raw.platform || platform || '',
    tags: raw.tags ? (Array.isArray(raw.tags) ? raw.tags : raw.tags.split(',')) : [],
    author: raw.vendor || raw.platform || 'Emojipedia',
    license: 'CC BY-SA 4.0 / Vendor Specific',
    isFree: true,
    width: raw.width || null,
    height: raw.height || null,
  };
}

/**
 * 获取工作空间保存路径
 */
function getEmojipediaWorkspaceDir(): string {
  try {
    const globalState = (global as any).__YISHE_WORKSPACE_DIR__;
    if (globalState && typeof globalState === 'string' && fs.existsSync(globalState)) {
      return globalState;
    }
  } catch {}

  const homeDir = app ? app.getPath('home') : process.env.HOME || '/tmp';
  const defaultDir = join(homeDir, 'yisheworkspace');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return defaultDir;
}

/**
 * 下载 Emojipedia 图片到本地
 */
export async function downloadEmojipediaItem(
  imageUrl: string,
  options: { filename?: string; platform?: string } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '缺少图片下载链接' };
  }

  try {
    const fetchFn = await getFetchImpl();
    const headers = {
      'User-Agent': USER_AGENT,
      'Referer': 'https://emojipedia.org/',
    };

    const res = await fetchFn(imageUrl, { headers });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workspaceDir = getEmojipediaWorkspaceDir();
    const saveDir = join(workspaceDir, 'emojipedia-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    const ext = imageUrl.endsWith('.svg') ? '.svg' : imageUrl.endsWith('.png') ? '.png' : '.jpg';
    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith(ext) ? '' : ext}`
      : `emojipedia_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);

    return { success: true, filePath, filename };
  } catch (error: any) {
    return { success: false, error: error?.message || '下载过程中发生错误' };
  }
}

/**
 * 下载并上传至用户个人 COS 存储
 */
export async function syncEmojipediaToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  if (!imageUrl) {
    return { success: false, error: '缺少图片 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadEmojipediaItem(imageUrl, {
    filename: metadata?.title || metadata?.name,
    platform: metadata?.platform,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;


  // 2. 上传到素材库 (COS + sticker 表)
  try {
    const fileName = localFilePath.split('/').pop() || `emojipedia_${Date.now()}.png`;
    const title = metadata?.title || metadata?.name || fileName.replace(/\.(png|jpg|webp)$/i, '');
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'emojipedia',
      group: 'emojipedia',
      source: 'Emojipedia',
      originUrl: imageUrl,
      suffix: 'png',
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'emojipedia',
        uploadedAt: new Date().toISOString(),
      },
    });

    if (!materialResult.ok) {
      return { success: false, error: materialResult.msg || '素材库保存失败' };
    }

    return {
      success: true,
      message: '已成功下载 Emojipedia 素材并上传入库至素材库',
      localFilePath,
      cosUrl: materialResult.materialUrl,
      materialId: materialResult.materialId,
      data: {
        materialId: materialResult.materialId,
        cosUrl: materialResult.materialUrl,
        localFilePath,
        fileName,
        metadata: {
          ...metadata,
          source: 'emojipedia',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || '上传素材至素材库失败' };
  }
}

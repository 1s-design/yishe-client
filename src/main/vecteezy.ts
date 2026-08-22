/**
 * Vecteezy 免版税素材采集能力
 * 官方网站: https://www.vecteezy.com/
 * 特点: 三大素材分类 — 摄影图片(Photos)、透明PNG(Png)、矢量插画(Vector)
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';

const VECTEEZY_SITE_URL = 'https://www.vecteezy.com/';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface VecteezyAsset {
  id: string;
  name: string;
  title: string;
  description: string;
  image: string; // 默认预览图/下载链接
  svgUrl?: string; // 矢量 SVG 链接
  pngUrl?: string; // PNG 链接
  jpgUrl?: string; // JPG 链接
  thumbnail: string; // 缩略图
  downloadUrl: string;
  link: string; // 原详情页链接
  url: string;
  width?: number | null;
  height?: number | null;
  author?: string;
  license?: string;
  isFree?: boolean;
  format?: 'svg' | 'png' | 'jpg';
  mediaType?: 'photos' | 'png' | 'vector';
  tags?: string;
}

export interface VecteezySearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: VecteezyAsset[];
  links: string[];
  page: number;
  totalPages?: number;
  nextPage: number | null;
  error?: string;
}

interface VecteezySearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  mediaType?: 'photos' | 'png' | 'vector';
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
 * 检查 Vecteezy 服务状态
 */
export async function getVecteezyStatus() {
  const site = await checkSiteAvailability(VECTEEZY_SITE_URL, { timeoutMs: 8000 });
  return {
    key: 'vecteezy',
    pluginKey: 'vecteezy',
    label: 'Vecteezy 免版税素材',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Vecteezy 可用' : `Vecteezy 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

/**
 * 解析 Vecteezy 搜索页 HTML
 */
function parseVecteezyHtml(html: string, mediaType: string): { items: VecteezyAsset[]; total: number; totalPages: number } {
  const items: VecteezyAsset[] = [];
  let total = 0;
  let totalPages = 1;
  const usedIds = new Set<string>();

  try {
    // 方式 1: 从 __NEXT_DATA__ 中提取
    const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const pageProps = nextData?.props?.pageProps || {};
        const rawItems: any[] = pageProps?.items || pageProps?.assets || pageProps?.data || pageProps?.results || [];
        const rawTotal = pageProps?.total || pageProps?.count || rawItems.length;

        if (rawItems.length > 0) {
          total = rawTotal || rawItems.length;
          for (const raw of rawItems) {
            const id = String(raw.id || raw.slug || raw.uuid || '');
            if (!id || usedIds.has(id)) continue;
            usedIds.add(id);

            const title = raw.title || raw.name || 'Vecteezy Asset';
            const item = buildVecteezyAsset(id, title, raw?.preview_url || raw?.thumbnail_url || raw?.src || '', mediaType, raw);
            items.push(item);
          }
        }
      } catch (e) {
        console.warn('[Vecteezy Parser] __NEXT_DATA__ 解析失败:', e);
      }
    }

    // 方式 2: 从 <img> 标签提取 (逐个 img 标签解析)
    if (items.length === 0) {
      const imgTagRegex = /<img[^>]*>/gi;
      let imgMatch: RegExpExecArray | null;

      while ((imgMatch = imgTagRegex.exec(html)) !== null) {
        const imgTag = imgMatch[0];
        const srcMatch = imgTag.match(/(?:data-src|src)="([^"]*static\.vecteezy\.com\/system\/resources\/thumbnails\/[^"]+)"/i);
        if (!srcMatch) continue;
        const src = srcMatch[1];

        const altMatch = imgTag.match(/alt="([^"]*)"/i);
        const alt = altMatch ? altMatch[1] : '';

        // 提取 ID 和 slug: /thumbnails/047/493/988/small_2x/hairy-fluffy-cat-playing-png.png
        const idMatch = src.match(/thumbnails\/(\d+\/\d+\/\d+)/i) || src.match(/thumbnails\/(\d+)/i);
        const slugMatch = src.match(/\/([^/]+)\.(?:png|jpg|jpeg|svg)$/i);
        const id = idMatch ? idMatch[1].replace(/\//g, '') : slugMatch ? slugMatch[1] : '';
        if (!id || usedIds.has(id)) continue;
        usedIds.add(id);

        const rawTitle = alt || (slugMatch ? slugMatch[1].replace(/-(?:png|jpg|jpeg|svg|vector|photo)$/i, '').replace(/-/g, ' ') : 'Vecteezy Asset');
        const title = rawTitle.replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\b\w/g, (c: string) => c.toUpperCase());
        const highResSrc = src.includes('/small/') ? src.replace('/small/', '/small_2x/') : src;
        const item = buildVecteezyAsset(id, title, highResSrc, mediaType);
        items.push(item);
      }
    }

    // 方式 3: 从 <a> 链接提取
    if (items.length === 0) {
      const linkRegex = /<a[^]+(?:vecteezy\.com\/)(?:free-[a-z]+\/\d+[-\w]+|art-renderer\/\d+)[^"]*[^>]*>([\s\S]*?)<\/a>/gi;
      let linkMatch: RegExpExecArray | null;

      while ((linkMatch = linkRegex.exec(html)) !== null) {
        const href = linkMatch[0]?.match(/href="([^"]+)"/)?.[1] || '';
        const innerHtml = linkMatch[1];
        const idMatch = href.match(/\/(\d+)[-\/]/) || href.match(/(\d{5,})/);
        if (!idMatch) continue;

        const id = idMatch[1];
        if (usedIds.has(id)) continue;
        usedIds.add(id);

        const innerImg = innerHtml.match(/<img[^>]+src="([^"]+)"/i);
        const thumbSrc = innerImg ? innerImg[1] : '';

        const title = id;
        const item = buildVecteezyAsset(id, title, thumbSrc, mediaType);
        items.push(item);
      }
    }

    // 提取总数
    const totalMatch = html.match(/([\d,]+)\s*(?:results|items|assets)/i);
    if (totalMatch) {
      total = parseInt(totalMatch[1].replace(/,/g, ''), 10) || 0;
    }

    const pagesMatch = html.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if (pagesMatch) {
      totalPages = parseInt(pagesMatch[2], 10) || 1;
    } else if (total > items.length) {
      totalPages = Math.ceil(total / 20);
    }
  } catch (err) {
    console.error('[Vecteezy Parser Error]', err);
  }

  return {
    items,
    total: total || items.length,
    totalPages,
  };
}

/**
 * 根据 ID 构建 VecteezyAsset
 */
function buildVecteezyAsset(id: string, title: string, thumbSrc: string, mediaType: string, raw?: any): VecteezyAsset {
  const detailUrl = `https://www.vecteezy.com/free-${mediaType}/${id}`;
  const _ext = mediaType === 'vector' ? '.svg' : mediaType === 'png' ? '.png' : '.jpg';

  return {
    id,
    name: sanitizeName(title) || `vecteezy_${id}`,
    title: title.length > 0 ? title : `Vecteezy ${mediaType}`,
    description: `Vecteezy Stock Media — ${title} (Free License with attribution)`,
    image: thumbSrc,
    svgUrl: mediaType === 'vector' ? thumbSrc : undefined,
    pngUrl: mediaType === 'png' ? thumbSrc : undefined,
    jpgUrl: mediaType === 'photos' ? thumbSrc : undefined,
    thumbnail: thumbSrc,
    downloadUrl: thumbSrc,
    link: detailUrl,
    url: detailUrl,
    width: raw?.width || null,
    height: raw?.height || null,
    author: raw?.author || raw?.user || 'Vecteezy Contributor',
    license: 'Vecteezy Free License (attribution required)',
    isFree: true,
    format: mediaType === 'vector' ? 'svg' : mediaType === 'png' ? 'png' : 'jpg',
    mediaType: mediaType as any,
    tags: title,
  };
}

/**
 * 搜索 Vecteezy 素材
 */
export async function searchVecteezy(
  query: string,
  options: VecteezySearchOptions = {},
): Promise<VecteezySearchResult> {
  const keyword = (query || '').trim();
  if (!keyword) {
    return {
      success: false,
      query: '',
      count: 0,
      items: [],
      links: [],
      page: 1,
      nextPage: null,
      error: '缺少搜索关键词',
    };
  }

  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(Math.max(Number(options.limit || options.pageSize) || 20, 1), 100);
  const mediaType = options.mediaType || 'photos';

  try {
    const fetchFn = await getFetchImpl();
    // Vecteezy 搜索 URL: https://www.vecteezy.com/free-photos/cat
    const targetUrl = `https://www.vecteezy.com/free-${mediaType}/${encodeURIComponent(keyword)}`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.vecteezy.com/',
    };

    const res = await fetchFn(targetUrl, { headers });
    if (!res.ok) {
      throw new Error(`Vecteezy HTTP 错误: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const { items, total, totalPages } = parseVecteezyHtml(html, mediaType);

    // 分页处理
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
      success: false,
      query: keyword,
      count: 0,
      total: 0,
      items: [],
      links: [],
      page,
      nextPage: null,
      error: error?.message || '搜索 Vecteezy 素材发生异常',
    };
  }
}

/**
 * 获取工作空间保存路径
 */
function getVecteezyWorkspaceDir(): string {
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
 * 下载 Vecteezy 素材到本地
 */
export async function downloadVecteezyAsset(
  imageUrl: string,
  options: { filename?: string; format?: 'svg' | 'png' | 'jpg' } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '缺少图片下载链接' };
  }

  try {
    const fetchFn = await getFetchImpl();
    const headers = {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.vecteezy.com/',
    };

    const res = await fetchFn(imageUrl, { headers });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workspaceDir = getVecteezyWorkspaceDir();
    const saveDir = join(workspaceDir, 'vecteezy-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    const ext = options.format === 'svg' ? '.svg' : options.format === 'png' ? '.png' : '.jpg';
    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith(ext) ? '' : ext}`
      : `vecteezy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);

    return { success: true, filePath, filename };
  } catch (error: any) {
    return { success: false, error: error?.message || '下载图片过程中发生错误' };
  }
}

/**
 * 下载并上传至用户个人 COS 存储
 */
export async function syncVecteezyToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  if (!imageUrl) {
    return { success: false, error: '缺少图片 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadVecteezyAsset(imageUrl, {
    filename: metadata?.title || metadata?.name,
    format: metadata?.format,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;

import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';

  // 2. 上传到素材库 (COS + sticker 表)
  try {
    const fileName = localFilePath.split('/').pop() || `vecteezy_${Date.now()}.jpg`;
    const ext = fileName.split('.').pop() || 'jpg';
    const title = metadata?.title || metadata?.name || fileName.replace(/\.(svg|png|jpg|jpeg)$/i, '');
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'vecteezy',
      group: 'vecteezy',
      source: 'Vecteezy',
      originUrl: imageUrl,
      suffix: ext,
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'vecteezy',
        uploadedAt: new Date().toISOString(),
      },
    });

    if (!materialResult.ok) {
      return { success: false, error: materialResult.msg || '素材库保存失败' };
    }

    return {
      success: true,
      message: '已成功下载 Vecteezy 素材并上传入库至素材库',
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
          source: 'vecteezy',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || '上传素材至素材库失败' };
  }
}

import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
/**
 * undraw 开源插画图库采集能力
 * 官方网站: https://undraw.co/
 * 特点: 100% 免费开源插画 (MIT-like license)，可自定义主题色，原生 SVG 矢量格式
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';

const UNDRAW_SITE_URL = 'https://undraw.co/';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface UndrawPhoto {
  id: string; // slug 标识
  name: string; // 文件用名
  title: string; // 插画标题
  description: string;
  image: string; // SVG 原图直链（含自定义颜色）
  svgUrl: string; // SVG 矢量原图直链
  thumbnail: string; // 缩略图（同 SVG，可缩放）
  downloadUrl: string; // 下载直链
  link: string; // 原详情页链接
  url: string;
  color?: string; // 当前主题色 hex
  defaultColor?: string; // 默认主题色
  width?: number | null;
  height?: number | null;
  author?: string;
  license?: string;
  isFree?: boolean;
  tags?: string;
}

export interface UndrawSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: UndrawPhoto[];
  links: string[];
  page: number;
  totalPages?: number;
  nextPage: number | null;
  error?: string;
}

interface UndrawSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  color?: string; // 自定义主题色 (hex, 如 #6C63FF)
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

/** 校验并返回安全的 hex 颜色值 */
function safeHexColor(color: string | undefined, fallback = '#6C63FF'): string {
  if (!color) return fallback;
  const hex = color.trim();
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex)) {
    return hex;
  }
  return fallback;
}

/** 获取 Node/Electron fetch 实现 */
async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') {
    return net.fetch.bind(net);
  }
  return fetch;
}

/**
 * 检查 undraw 服务状态
 */
export async function getUndrawStatus() {
  const site = await checkSiteAvailability(UNDRAW_SITE_URL, { timeoutMs: 8000 });
  return {
    key: 'undraw',
    pluginKey: 'undraw',
    label: 'undraw 开源插画',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'undraw 可用' : `undraw 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

/**
 * 解析 undraw 搜索页 HTML（Next.js 数据通常在 __NEXT_DATA__ 或 <img> 标签中）
 */
function parseUndrawHtml(html: string, color?: string): { items: UndrawPhoto[]; total: number; totalPages: number } {
  const items: UndrawPhoto[] = [];
  let total = 0;
  let totalPages = 1;
  const usedSlugs = new Set<string>();

  const themeColor = safeHexColor(color);

  try {
    // 方式 1: 从 __NEXT_DATA__ 中提取 (Next.js 页面数据)
    const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // 搜索数据通常在 props.pageProps 中
        const pageProps = nextData?.props?.pageProps || {};
        const rawItems: any[] =
          pageProps?.initialResults ||
          pageProps?.illustrations ||
          pageProps?.items ||
          pageProps?.data ||
          [];
        const rawTotal = pageProps?.total || pageProps?.count || rawItems.length;

        if (rawItems.length > 0) {
          total = rawTotal || rawItems.length;
          for (const raw of rawItems) {
            const slug = raw.newSlug || raw.slug || raw.id || raw.name || '';
            if (!slug || usedSlugs.has(slug)) continue;
            usedSlugs.add(slug);

            const title =
              raw.title ||
              raw.name ||
              slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
            const mediaUrl = raw.media || raw.image || raw.svg || '';
            const item = buildUndrawPhoto(slug, title, mediaUrl, themeColor);
            items.push(item);
          }
        }
      } catch (e) {
        console.warn('[undraw Parser] __NEXT_DATA__ 解析失败，回退到 img 标签解析:', e);
      }
    }

    // 方式 2: 如果方式 1 没有结果，从 <img> 标签中提取
    if (items.length === 0) {
      // 匹配 undraw 插画图片: src 中包含 /svg/illustrations/ 或类似路径
      const imgRegex = /<img[^>]+src="([^"]*(?:illustrations|undraw|svg)[^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi;
      let match: RegExpExecArray | null;

      while ((match = imgRegex.exec(html)) !== null) {
        const src = match[1];
        const alt = match[2] || 'undraw Illustration';

        // 提取 slug: /svg/illustrations/hello_abc-123.svg → hello_abc-123
        const slugMatch = src.match(/\/svg\/illustrations\/([^./]+)/i) || src.match(/([a-z0-9_-]+)\.svg/i);
        if (!slugMatch) continue;

        const slug = slugMatch[1];
        if (usedSlugs.has(slug)) continue;
        usedSlugs.add(slug);

        const title = alt.replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
        const item = buildUndrawPhoto(slug, title, src, themeColor);
        items.push(item);
      }
    }

    // 方式 3: 如果仍无结果，尝试匹配 SVG <a> 链接包裹的详情页
    if (items.length === 0) {
      const linkRegex = /<a[^>]+href="\/illustrations\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let linkMatch: RegExpExecArray | null;

      while ((linkMatch = linkRegex.exec(html)) !== null) {
        const slugPath = linkMatch[1];
        const innerHtml = linkMatch[2];
        const slug = slugPath.split('/').pop() || slugPath;
        if (!slug || usedSlugs.has(slug)) continue;
        usedSlugs.add(slug);

        // 从内部 img 提取缩略图
        const innerImg = innerHtml.match(/<img[^>]+src="([^"]+)"/i);
        const thumbSrc = innerImg ? innerImg[1] : '';

        const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        const item = buildUndrawPhoto(slug, title, thumbSrc, themeColor);
        items.push(item);
      }
    }

    // 尝试提取总数
    const totalMatch = html.match(/([\d,]+)\s*(?:illustrations|results|items)/i);
    if (totalMatch) {
      total = parseInt(totalMatch[1].replace(/,/g, ''), 10) || items.length;
    }

    // 检查是否有分页指示器
    const pagesMatch = html.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if (pagesMatch) {
      totalPages = parseInt(pagesMatch[2], 10) || 1;
    } else if (total > items.length) {
      totalPages = Math.ceil(total / 20);
    }
  } catch (err) {
    console.error('[undraw Parser Error]', err);
  }

  return {
    items,
    total: total || items.length,
    totalPages,
  };
}

/**
 * 根据 slug 构建 UndrawPhoto 对象
 */
function buildUndrawPhoto(slug: string, title: string, thumbSrc: string, color: string): UndrawPhoto {
  // undraw SVG 官方 CDN 直链: https://cdn.undraw.co/illustration/{slug}.svg
  const svgUrl = `https://cdn.undraw.co/illustration/${slug}.svg`;
  // 带颜色参数的 SVG
  const coloredSvgUrl = color ? `${svgUrl}?color=${encodeURIComponent(color)}` : svgUrl;
  const detailUrl = `https://undraw.co/illustrations/${slug}`;

  return {
    id: slug,
    name: sanitizeName(slug) || `undraw_${slug}`,
    title: title.length > 0 ? title : slug.replace(/-/g, ' '),
    description: `undraw Open Illustration — ${title} (Free for commercial use)`,
    image: coloredSvgUrl, // 默认提供带主题色的 SVG
    svgUrl: coloredSvgUrl,
    thumbnail: thumbSrc.startsWith('http') ? thumbSrc : `https://undraw.co${thumbSrc}`,
    downloadUrl: svgUrl,
    link: detailUrl,
    url: detailUrl,
    color,
    defaultColor: '#6C63FF',
    width: 1000,
    height: 1000,
    author: 'undraw / Katerina Limpitsouni',
    license: 'Free for commercial and personal use (no attribution required)',
    isFree: true,
    tags: title,
  };
}

/**
 * 搜索 undraw 开源插画素材
 */
export async function searchUndraw(
  query: string,
  options: UndrawSearchOptions = {},
): Promise<UndrawSearchResult> {
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
  const themeColor = safeHexColor(options.color);

  try {
    const fetchFn = await getFetchImpl();
    // undraw 搜索 URL: https://undraw.co/search/cat
    const targetUrl = `https://undraw.co/search/${encodeURIComponent(keyword)}`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://undraw.co/',
    };

    const res = await fetchFn(targetUrl, { headers });
    if (!res.ok) {
      throw new Error(`undraw HTTP 错误: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const { items, total, totalPages } = parseUndrawHtml(html, themeColor);

    // 分页处理：undraw 返回所有结果，前端分页
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
      error: error?.message || '搜索 undraw 素材发生异常',
    };
  }
}

/**
 * 获取工作空间保存路径
 */
function getUndrawWorkspaceDir(): string {
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
 * 下载 undraw SVG 插画到本地
 */
export async function downloadUndrawImage(
  imageUrl: string,
  options: { filename?: string; color?: string } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '缺少图片下载链接' };
  }

  try {
    const fetchFn = await getFetchImpl();
    const headers = {
      'User-Agent': USER_AGENT,
      'Referer': 'https://undraw.co/',
    };

    const res = await fetchFn(imageUrl, { headers });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workspaceDir = getUndrawWorkspaceDir();
    const saveDir = join(workspaceDir, 'undraw-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    // 判断文件名
    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith('.svg') ? '' : '.svg'}`
      : `undraw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.svg`;

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
export async function syncUndrawToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  if (!imageUrl) {
    return { success: false, error: '缺少图片 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadUndrawImage(imageUrl, {
    filename: metadata?.title || metadata?.name,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;


  // 2. 上传到素材库 (COS + sticker 表)
  try {
    const fileName = localFilePath.split('/').pop() || `undraw_${Date.now()}.svg`;
    const title = metadata?.title || metadata?.name || fileName.replace(/\.svg$/i, '');
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'undraw',
      group: 'undraw',
      source: 'undraw',
      originUrl: imageUrl,
      suffix: 'svg',
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'undraw',
        uploadedAt: new Date().toISOString(),
      },
    });

    if (!materialResult.ok) {
      return { success: false, error: materialResult.msg || '素材库保存失败' };
    }

    return {
      success: true,
      message: '已成功下载 undraw 插画并上传入库至素材库',
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
          source: 'undraw',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || '上传素材至素材库失败' };
  }
}

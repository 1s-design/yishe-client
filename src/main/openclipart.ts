import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
/**
 * Openclipart 免费矢量插画图库采集能力
 * 官方网站: https://openclipart.org/
 * 特点: 100% Public Domain (CC0) 免费商用，支持原生矢量 SVG 原图与 2000px 超清 PNG 下载
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';

const OPENCLIPART_SITE_URL = 'https://openclipart.org/';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface OpenclipartPhoto {
  id: string;
  name: string;
  title: string;
  description: string;
  image: string; // 默认原图下载链接（优先 2000px PNG 或 SVG）
  svgUrl: string; // 矢量 SVG 原图直链
  pngUrl: string; // 2000px 超清 PNG 直链
  thumbnail: string; // 800px 预览缩略图
  downloadUrl: string;
  link: string; // 原详情页链接
  url: string;
  width?: number | null;
  height?: number | null;
  author?: string;
  license?: string;
  isFree?: boolean;
  format?: 'svg' | 'png';
  tags?: string;
}

export interface OpenclipartSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: OpenclipartPhoto[];
  links: string[];
  page: number;
  totalPages?: number;
  nextPage: number | null;
  error?: string;
}

interface OpenclipartSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  formatPreference?: 'svg' | 'png';
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
 * 检查 Openclipart 服务状态
 */
export async function getOpenclipartStatus() {
  const site = await checkSiteAvailability(OPENCLIPART_SITE_URL, { timeoutMs: 8000 });
  return {
    key: 'openclipart',
    pluginKey: 'openclipart',
    label: 'Openclipart 免费矢量插画',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Openclipart 可用' : `Openclipart 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

/**
 * 解析 Openclipart 搜索结果 HTML
 */
function parseOpenclipartHtml(html: string): { items: OpenclipartPhoto[]; total: number; totalPages: number } {
  const items: OpenclipartPhoto[] = [];
  let total = 0;
  let totalPages = 1;

  try {
    // 匹配总数与页码: <h2 class="text-center"> 98 clipart for "hi" <small> (Page 1 of 4) </small></h2>
    const totalMatch = html.match(/([\d,]+)\s+clipart\s+for/i);
    if (totalMatch) {
      total = parseInt(totalMatch[1].replace(/,/g, ''), 10) || 0;
    }

    const pagesMatch = html.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if (pagesMatch) {
      totalPages = parseInt(pagesMatch[2], 10) || 1;
    }

    // 匹配 artwork: <div class="artwork"> <a href="/detail/332280/hi"> <img src="/image/800px/332280" alt="Hi" /> </a> </div>
    const artworkRegex = /<div class="artwork">\s*<a href="([^"]+)">\s*<img src="([^"]+)" alt="([^"]*)"[^>]*>\s*<\/a>\s*<\/div>/gi;
    let match: RegExpExecArray | null;

    while ((match = artworkRegex.exec(html)) !== null) {
      const detailHref = match[1];
      const imgSrc = match[2];
      const rawTitle = match[3] || 'Openclipart Clipart';

      // 提取 ID (从 /detail/332280/hi 或 /image/800px/332280)
      const idMatch = detailHref.match(/\/detail\/(\d+)/i) || imgSrc.match(/\/(\d+)$/);
      if (!idMatch) continue;

      const id = idMatch[1];
      const title = rawTitle.replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      const detailUrl = detailHref.startsWith('http') ? detailHref : `https://openclipart.org${detailHref}`;
      const svgUrl = `https://openclipart.org/download/${id}`;
      const png2000Url = `https://openclipart.org/image/2000px/${id}`;
      const thumbnail = imgSrc.startsWith('http') ? imgSrc : `https://openclipart.org${imgSrc}`;

      items.push({
        id,
        name: sanitizeName(title) || `openclipart_${id}`,
        title,
        description: `Openclipart Vector Art (CC0 Public Domain) - ID: ${id}`,
        image: png2000Url, // 默认提供 2000px 超清位图或矢量 SVG
        svgUrl,
        pngUrl: png2000Url,
        thumbnail,
        downloadUrl: svgUrl,
        link: detailUrl,
        url: detailUrl,
        width: 2000,
        height: 2000,
        author: 'Openclipart Community',
        license: 'CC0 1.0 Universal (Public Domain Dedication)',
        isFree: true,
      });
    }
  } catch (err) {
    console.error('[Openclipart Parser Error]', err);
  }

  // 去重 (根据 ID)
  const uniqueMap = new Map<string, OpenclipartPhoto>();
  for (const item of items) {
    if (!uniqueMap.has(item.id)) {
      uniqueMap.set(item.id, item);
    }
  }

  return {
    items: Array.from(uniqueMap.values()),
    total: total || uniqueMap.size,
    totalPages,
  };
}

/**
 * 搜索 Openclipart 矢量插画素材
 */
export async function searchOpenclipart(
  query: string,
  options: OpenclipartSearchOptions = {},
): Promise<OpenclipartSearchResult> {
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

  try {
    const fetchFn = await getFetchImpl();
    // Openclipart 搜索 URL 格式：https://openclipart.org/search/?p=1&query=keyword
    const targetUrl = `https://openclipart.org/search/?p=${page}&query=${encodeURIComponent(keyword)}`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://openclipart.org/',
    };

    const res = await fetchFn(targetUrl, { headers });
    if (!res.ok) {
      throw new Error(`Openclipart HTTP 错误: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const { items, total, totalPages } = parseOpenclipartHtml(html);

    // 截取 limit
    const pagedItems = items.slice(0, limit);

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
      error: error?.message || '搜索 Openclipart 素材发生异常',
    };
  }
}

/**
 * 获取工作空间保存路径
 */
function getOpenclipartWorkspaceDir(): string {
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
 * 下载 Openclipart 矢量 SVG 或高清 PNG 到本地
 */
export async function downloadOpenclipartImage(
  imageUrl: string,
  options: { filename?: string; format?: 'svg' | 'png' } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '缺少图片下载链接' };
  }

  try {
    const fetchFn = await getFetchImpl();
    const headers = {
      'User-Agent': USER_AGENT,
      'Referer': 'https://openclipart.org/',
    };

    const res = await fetchFn(imageUrl, { headers });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workspaceDir = getOpenclipartWorkspaceDir();
    const saveDir = join(workspaceDir, 'openclipart-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    // 判断后缀：svg 还是 png
    const isSvg = imageUrl.endsWith('.svg') || imageUrl.includes('/download/') || res.headers.get('content-type')?.includes('svg');
    const ext = isSvg ? '.svg' : '.png';

    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith(ext) ? '' : ext}`
      : `openclipart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

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
export async function syncOpenclipartToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; materialId?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  if (!imageUrl) {
    return { success: false, error: '缺少图片 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadOpenclipartImage(imageUrl, {
    filename: metadata?.title || metadata?.name,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;

  // 2. 强制上传原图到用户个人的 COS 存储

  try {
    const isSvg = localFilePath.endsWith('.svg');
    const ext = isSvg ? 'svg' : 'png';
    const fileName = localFilePath.split('/').pop() || `openclipart_${Date.now()}.${ext}`;
    const title = metadata?.title || metadata?.name || fileName.replace(/\.(svg|png)$/i, '');
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'openclipart',
      group: 'openclipart',
      source: 'Openclipart',
      originUrl: imageUrl,
      suffix: ext,
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'openclipart',
        uploadedAt: new Date().toISOString(),
      },
    });

    if (!materialResult.ok) {
      return { success: false, error: materialResult.msg || '素材库保存失败' };
    }

    return {
      success: true,
      message: '已成功下载素材并上传入库至素材库',
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
          source: 'openclipart',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || '上传素材至素材库失败' };
  }
}

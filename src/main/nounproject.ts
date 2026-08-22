/**
 * The Noun Project 图标与摄影图库采集能力
 * 官方网站: https://thenounproject.com/
 * 特点: 支持 Photos（摄影图）与 Icons（矢量图标）双模式搜索，
 *       Creative Commons 与 Royalty-free 多种授权，SVG/PNG/JPG 多格式
 */
import * as fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';

const NOUNPROJECT_SITE_URL = 'https://thenounproject.com/';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface NounProjectAsset {
  id: string;
  name: string;
  title: string;
  image: string; // 默认预览图/下载链接
  svgUrl?: string; // SVG 矢量原图直链（Icons 模式）
  pngUrl?: string; // PNG 直链
  thumbnail: string; // 缩略图
  downloadUrl: string; // 默认下载链接
  link: string; // 原详情页链接
  url: string;
  author?: string;
  license?: string;
  isFree?: boolean;
  format?: 'svg' | 'png' | 'jpg';
  tags?: string;
}

export interface NounProjectSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: NounProjectAsset[];
  links: string[];
  page: number;
  totalPages?: number;
  nextPage: number | null;
  error?: string;
}

interface NounProjectSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  mediaType?: 'photos' | 'icons';
  color?: string;
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
 * 检查 Noun Project 服务状态
 */
export async function getNounProjectStatus() {
  const site = await checkSiteAvailability(NOUNPROJECT_SITE_URL, { timeoutMs: 8000 });
  return {
    key: 'nounproject',
    pluginKey: 'nounproject',
    label: 'The Noun Project 图标与摄影图库',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'The Noun Project 可用' : `The Noun Project 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

/**
 * 解析 Noun Project 搜索结果 HTML（多策略解析）
 */
function parseNounProjectHtml(
  html: string,
  mediaType: 'photos' | 'icons',
): { items: NounProjectAsset[]; total: number; totalPages: number } {
  const items: NounProjectAsset[] = [];
  let total = 0;
  let totalPages = 1;
  const usedIds = new Set<string>();

  try {
    // ─── 策略 1: 从 JSON-LD 结构化数据提取 ───
    const jsonLdRegex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let jsonLdMatch: RegExpExecArray | null;
    while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(jsonLdMatch[1]);
        const graph = data?.graph || data?.mainEntity || data;
        const itemList = graph?.itemListElement || graph?.about || [];
        const rawList = Array.isArray(itemList) ? itemList : [];

        for (const raw of rawList) {
          const item = raw?.item || raw;
          const url = item?.url || item?.['@id'] || '';
          const name = item?.name || item?.headline || '';
          const image = item?.image || item?.thumbnailUrl || '';

          const idMatch = url.match(/\/(?:term|icon|photo)\/(\d+)/i) || url.match(/(\d+)/);
          if (!idMatch || !name) continue;

          const id = idMatch[1];
          if (usedIds.has(id)) continue;
          usedIds.add(id);

          const asset = buildNounProjectAsset(id, name, image, mediaType);
          items.push(asset);
        }
      } catch {
        // JSON-LD 解析失败，继续下一个
      }
    }

    // ─── 策略 2: 从 <img> 标签提取（Next.js 渲染的预览图） ───
    if (items.length === 0) {
      const imgRegex = /<img[^>]+src="([^"]*(?:static\.thenounproject\.com|cdn\.thenounproject\.com|tnp\.dnjs)[^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi;
      let imgMatch: RegExpExecArray | null;

      while ((imgMatch = imgRegex.exec(html)) !== null) {
        const src = imgMatch[1];
        const alt = imgMatch[2] || 'Noun Project Asset';

        // 提取 ID: /png/8422832-200.png 或 /photo/123456/... 或 /icon/123456/...
        const idMatch = src.match(/png\/(\d+)-(?:200|512)\.png/i) || src.match(/\/(?:photo|icon|tnp)\/(\d+)/i) || src.match(/(\d{5,})/);
        if (!idMatch) continue;

        const id = idMatch[1];
        if (usedIds.has(id)) continue;
        usedIds.add(id);

        const title = alt.replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
        const asset = buildNounProjectAsset(id, title, src, mediaType);
        items.push(asset);
      }
    }

    // ─── 策略 3: 从 <a> 详情页链接提取（/icon/cat-8422832/） ───
    if (items.length === 0) {
      const linkRegex = /href="(\/(?:icon|term|photo)\/([a-z0-9_-]+)-(\d+)\/?)"/gi;
      let linkMatch: RegExpExecArray | null;

      while ((linkMatch = linkRegex.exec(html)) !== null) {
        const slug = linkMatch[2];
        const id = linkMatch[3];

        if (usedIds.has(id)) continue;
        usedIds.add(id);

        const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        const thumbSrc = `https://static.thenounproject.com/png/${id}-200.png`;
        const asset = buildNounProjectAsset(id, title, thumbSrc, mediaType);
        items.push(asset);
      }
    }

    // ─── 策略 4: 从 Next.js __NEXT_DATA__ 提取 ───
    if (items.length === 0) {
      const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          const pageProps = nextData?.props?.pageProps || {};
          const rawItems: any[] =
            pageProps?.items ||
            pageProps?.assets ||
            pageProps?.searchResults ||
            pageProps?.data ||
            [];
          const rawTotal = pageProps?.total || pageProps?.count || rawItems.length;

          if (rawItems.length > 0) {
            total = rawTotal || rawItems.length;
            for (const raw of rawItems) {
              const id = String(raw?.id || raw?.assetId || raw?.slug || '');
              const rawTitle = raw?.title || raw?.name || raw?.term || raw?.description || '';
              if (!id || usedIds.has(id)) continue;
              usedIds.add(id);

              const title = rawTitle.replace(/&#039;/g, "'").replace(/&amp;/g, '&');
              const thumbSrc =
                raw?.previewUrl ||
                raw?.thumbnailUrl ||
                raw?.image ||
                raw?.svgUrl ||
                raw?.iconUrl ||
                '';

              const asset = buildNounProjectAsset(id, title, thumbSrc, mediaType);
              if (raw?.author || raw?.creator) {
                asset.author = raw.author || raw.creator;
              }
              if (raw?.license) {
                asset.license = raw.license;
              }
              items.push(asset);
            }
          }
        } catch {
          console.warn('[NounProject Parser] __NEXT_DATA__ 解析失败，尝试其他解析方式');
        }
      }
    }

    // 提取总数
    const totalMatch = html.match(/([\d,]+)\s*(?:results|items|icons|photos)/i);
    if (totalMatch) {
      total = parseInt(totalMatch[1].replace(/,/g, ''), 10) || items.length;
    }

    // 检查分页
    const pagesMatch = html.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if (pagesMatch) {
      totalPages = parseInt(pagesMatch[2], 10) || 1;
    } else if (total > items.length) {
      totalPages = Math.ceil(total / 20);
    }
  } catch (err) {
    console.error('[NounProject Parser Error]', err);
  }

  return {
    items,
    total: total || items.length,
    totalPages,
  };
}

/**
 * 根据 ID 构建 NounProjectAsset 对象
 */
function buildNounProjectAsset(
  id: string,
  title: string,
  thumbSrc: string,
  mediaType: 'photos' | 'icons',
): NounProjectAsset {
  const cleanTitle =
    title
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/^\s*-\s*Noun Project\s*$/i, '') || `Noun Project ${id}`;

  const isPhoto = mediaType === 'photos';
  const png200Url = `https://static.thenounproject.com/png/${id}-200.png`;
  const pngUrl = `https://static.thenounproject.com/png/${id}-200.png`;
  const svgUrl = `https://static.thenounproject.com/svg/${id}.svg`;
  const photoUrl = `https://static.thenounproject.com/photo/${id}.jpg`;

  const thumbnail = thumbSrc.startsWith('http')
    ? thumbSrc
    : thumbSrc.startsWith('/')
      ? `https://thenounproject.com${thumbSrc}`
      : isPhoto
        ? photoUrl
        : png200Url;

  const image = isPhoto ? (thumbnail || photoUrl) : png200Url;
  const link = `https://thenounproject.com/${isPhoto ? 'photo' : 'icon'}/${id}/`;
  const downloadUrl = isPhoto ? image : png200Url;

  return {
    id,
    name: sanitizeName(cleanTitle) || `nounproject_${id}`,
    title: cleanTitle,
    image,
    svgUrl: svgUrl,
    pngUrl: pngUrl,
    thumbnail,
    downloadUrl,
    link,
    url: link,
    format: isPhoto ? 'jpg' : 'png',
    author: 'Noun Project Community',
    license: 'Creative Commons / Royalty-free (varies by asset)',
    isFree: true,
    tags: cleanTitle,
  };
}

/**
 * 搜索 The Noun Project 素材（支持 Photos 与 Icons 双模式）
 */
export async function searchNounProject(
  query: string,
  options: NounProjectSearchOptions = {},
): Promise<NounProjectSearchResult> {
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
  const mediaType = options.mediaType || 'icons';

  try {
    const fetchFn = await getFetchImpl();
    // Noun Project 搜索 URL: /search/photos/?q=xxx 或 /search/icons/?q=xxx
    const targetUrl = `https://thenounproject.com/search/${mediaType}/?q=${encodeURIComponent(keyword)}`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://thenounproject.com/',
    };

    const res = await fetchFn(targetUrl, { headers });
    if (!res.ok) {
      throw new Error(`Noun Project HTTP 错误: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const { items, total, totalPages } = parseNounProjectHtml(html, mediaType);

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
      error: error?.message || '搜索 The Noun Project 素材发生异常',
    };
  }
}

/**
 * 获取工作空间保存路径
 */
function getNounProjectWorkspaceDir(): string {
  try {
    const globalState = (global as any).__YISHE_WORKSPACE_DIR__;
    if (globalState && typeof globalState === 'string' && fs.existsSync(globalState)) {
      return globalState;
    }
  } catch {}

  const homeDir = (typeof app !== 'undefined' && app?.getPath) ? app.getPath('home') : (process.env.HOME || '/tmp');
  const defaultDir = join(homeDir, 'yisheworkspace');
  try {
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    return defaultDir;
  } catch {
    const tmpDir = join('/tmp', 'yisheworkspace');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    return tmpDir;
  }
}

/**
 * 下载 The Noun Project 素材（SVG/PNG/JPG）到本地
 */
export async function downloadNounProjectAsset(
  imageUrl: string,
  options: { filename?: string; format?: 'svg' | 'png' | 'jpg' } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '缺少素材下载链接' };
  }

  try {
    const fetchFn = await getFetchImpl();
    const headers = {
      'User-Agent': USER_AGENT,
      'Referer': 'https://thenounproject.com/',
    };

    const res = await fetchFn(imageUrl, { headers });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workspaceDir = getNounProjectWorkspaceDir();
    let saveDir = join(workspaceDir, 'nounproject-downloads');
    try {
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
    } catch {
      saveDir = join('/tmp', 'nounproject-downloads');
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
    }

    // 精确判断文件格式（优先魔数嗅探）
    const contentType = res.headers.get('content-type') || '';
    let ext = '.svg';
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isSvg = buffer.toString('utf-8', 0, 100).toLowerCase().includes('<svg');

    if (isPng || contentType.includes('png') || imageUrl.includes('.png')) {
      ext = '.png';
    } else if (isJpg || contentType.includes('jpeg') || contentType.includes('jpg') || imageUrl.includes('.jpg')) {
      ext = '.jpg';
    } else if (isSvg || contentType.includes('svg') || imageUrl.includes('.svg')) {
      ext = '.svg';
    } else if (options.format === 'png') {
      ext = '.png';
    } else if (options.format === 'jpg') {
      ext = '.jpg';
    }

    const cleanBaseName = sanitizeName(options.filename || '').replace(/\.(svg|png|jpe?g)$/i, '');
    const filename = cleanBaseName
      ? `${cleanBaseName}${ext}`
      : `nounproject_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);

    return { success: true, filePath, filename };
  } catch (error: any) {
    return { success: false, error: error?.message || '下载素材过程中发生错误' };
  }
}

/**
 * 下载并上传至用户个人 COS 存储
 */
export async function syncNounProjectToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  if (!imageUrl) {
    return { success: false, error: '缺少素材 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadNounProjectAsset(imageUrl, {
    filename: metadata?.title || metadata?.name,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;

import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';

  // 2. 上传到素材库 (COS + sticker 表)
  try {
    const fileName = localFilePath.split('/').pop() || `nounproject_${Date.now()}.svg`;
    const ext = fileName.split('.').pop() || 'svg';
    const title = metadata?.title || metadata?.name || fileName.replace(/\.(svg|png|jpg)$/i, '');
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'nounproject',
      group: 'nounproject',
      source: 'Noun Project',
      originUrl: imageUrl,
      suffix: ext,
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'nounproject',
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
          source: 'nounproject',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || '上传素材至素材库失败' };
  }
}

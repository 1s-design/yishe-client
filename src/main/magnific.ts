import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
/**
 * Magnific 视频素材采集能力 (Freepik 家族 Stock 视频站)
 * 官方网站: https://www.magnific.com/
 * 特点: 内部搜索接口 /api/videos 返回 JSON；免费视频预览为无水印 clear mp4
 * 注意: 源站有 WAF，必须携带完整浏览器指纹头 (sec-fetch-* / sec-ch-ua / Referer)
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const MAGNIFIC_SITE_URL = 'https://www.magnific.com/';
const MAGNIFIC_API_URL = 'https://www.magnific.com/api/videos';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 过 WAF 必需的完整浏览器指纹头（实测缺 sec-fetch-* 会被 403） */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://www.magnific.com/search',
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

export interface MagnificVideo {
  id: string;
  name: string;
  title: string;
  description: string;
  mediaType: 'video';
  /** 无水印预览 mp4（免费为 clear，premium 为 watermarked） */
  videoUrl: string;
  /** 小尺寸预览 mp4（悬停预览用） */
  previewUrl: string;
  image: string; // 封面缩略图（大图）
  thumbnail: string; // 封面缩略图（小图）
  link: string; // 站内详情页
  url: string;
  duration?: number | null;
  quality?: string | null; // 原片规格标记，如 "4K"
  premium?: boolean;
  isAIGenerated?: boolean;
  itemSubtype?: string; // footage | motion_graphics
  width?: number | null;
  height?: number | null;
  aspectRatio?: string | null;
  orientation?: string | null;
  author?: string;
  license?: string;
  tags?: string;
  isFree?: boolean;
}

export interface MagnificSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  pages?: number;
  items: MagnificVideo[];
  links: string[];
  page: number;
  nextPage: number | null;
  error?: string;
}

interface MagnificSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  /** free=仅免费(无水印) / premium=仅付费(带水印) / all=全部 */
  license?: 'free' | 'premium' | 'all';
  /** relevance=相关度(默认) / recent=最新 */
  order?: 'relevance' | 'recent';
}

interface MagnificApiItem {
  id: number;
  name: string;
  created?: string;
  url?: string;
  quality?: string;
  premium?: boolean;
  duration?: number;
  author?: { name?: string; slug?: string };
  thumbnails?: Array<{ url?: string; width?: number; height?: number; aspectRatio?: string }>;
  previews?: Array<{ url?: string; width?: number; height?: number; aspectRatio?: string }>;
  poster?: string;
  posterLarge?: string;
  videoSrc?: string;
  videoSrcFallback?: string | null;
  isAIGenerated?: boolean;
  itemSubtype?: string;
  nativeAspectRatio?: string;
  nativeOrientation?: string;
  tags?: Array<{ slug?: string; name?: string }>;
}

interface MagnificApiResponse {
  items?: MagnificApiItem[];
  metas?: { total?: number; pages?: number };
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

/** 获取 Node/Electron fetch 实现（net.fetch 走 Chromium 网络栈，TLS 指纹即浏览器，利于过 WAF） */
async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') {
    return net.fetch.bind(net);
  }
  return fetch;
}

/** 从 previews 中挑选指定规格的 mp4 URL */
function pickPreviewUrl(item: MagnificApiItem, size: 'large' | 'small'): string {
  const previews = item.previews || [];
  const match = previews.find((p) => p.url && p.url.includes(`/${size}.mp4`));
  if (match?.url) return match.url;
  // 兜底：取最后一个（通常为 large）
  return previews[previews.length - 1]?.url || item.videoSrc || '';
}

/** 将站内 API 条目转换为通用采集条目 */
function normalizeApiItem(item: MagnificApiItem): MagnificVideo {
  const thumbLarge =
    (item.thumbnails || []).find((t) => t.url && t.url.includes('large.jpg'))?.url ||
    item.posterLarge ||
    item.poster ||
    '';
  const thumbSmall =
    (item.thumbnails || []).find((t) => t.url && t.url.includes('small.jpg'))?.url || thumbLarge;
  const detailUrl = item.url
    ? item.url.startsWith('http')
      ? item.url
      : `https://www.magnific.com${item.url}`
    : '';
  const tags = (item.tags || [])
    .map((t) => t.name || t.slug)
    .filter(Boolean)
    .join(', ');

  return {
    id: String(item.id),
    name: sanitizeName(item.name || `magnific_${item.id}`),
    title: item.name || `Magnific Video ${item.id}`,
    description: item.name || '',
    mediaType: 'video',
    videoUrl: pickPreviewUrl(item, 'large'),
    previewUrl: pickPreviewUrl(item, 'small'),
    image: thumbLarge,
    thumbnail: thumbSmall,
    link: detailUrl,
    url: detailUrl,
    duration: item.duration ?? null,
    quality: item.quality || null,
    premium: !!item.premium,
    isAIGenerated: !!item.isAIGenerated,
    itemSubtype: item.itemSubtype,
    width: (item.previews || [])[0]?.width ?? null,
    height: (item.previews || [])[0]?.height ?? null,
    aspectRatio: item.nativeAspectRatio || null,
    orientation: item.nativeOrientation || null,
    author: item.author?.name || 'Magnific Contributor',
    license: item.premium ? 'Magnific Premium (watermarked preview)' : 'Magnific Free (clear preview)',
    tags,
    isFree: !item.premium,
  };
}

/**
 * 检查 Magnific 服务状态
 */
export async function getMagnificStatus() {
  const site = await checkSiteAvailability(MAGNIFIC_SITE_URL, { timeoutMs: 5000 });
  return {
    key: 'magnific',
    pluginKey: 'magnific',
    label: 'Magnific 视频素材',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Magnific 可用' : `Magnific 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

/**
 * 搜索 Magnific 视频素材
 */
export async function searchMagnific(
  query: string,
  options: MagnificSearchOptions = {},
): Promise<MagnificSearchResult> {
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
  const limit = Math.min(Math.max(Number(options.limit || options.pageSize) || 20, 1), 50); // 源站每页上限 50
  const license = options.license || 'free';
  const order = options.order || 'relevance';

  try {
    const fetchFn = await getFetchImpl();

    // 源站为 PHP 风格参数：format[search]=1&license[free]=1&locale=en&term=cat&type[video]=1
    const params = new URLSearchParams();
    params.set('format[search]', '1');
    if (license === 'free') params.set('license[free]', '1');
    else if (license === 'premium') params.set('license[premium]', '1');
    params.set('locale', 'en');
    params.set('term', keyword);
    params.set('type[video]', '1');
    params.set('page', String(page));
    if (order === 'recent') params.set('order', 'recent');

    const res = await fetchFn(`${MAGNIFIC_API_URL}?${params.toString()}`, {
      method: 'GET',
      headers: BROWSER_HEADERS,
    });

    if (!res.ok) {
      // 403 通常是 WAF 拦截；400 为参数错误（如空 term）
      const reason = res.status === 403 ? '被源站安全过滤拦截 (403)' : `HTTP ${res.status}`;
      return {
        success: false,
        query: keyword,
        count: 0,
        items: [],
        links: [],
        page,
        nextPage: null,
        error: `搜索失败: ${reason}`,
      };
    }

    const data = (await res.json()) as MagnificApiResponse;
    const items = (data.items || []).map(normalizeApiItem);
    const total = data.metas?.total ?? items.length;
    const pages = data.metas?.pages ?? 1;
    const links = items.map((i) => i.videoUrl);

    return {
      success: true,
      query: keyword,
      count: items.length,
      total,
      pages,
      items,
      links,
      page,
      nextPage: page < pages ? page + 1 : null,
    };
  } catch (error: any) {
    return {
      success: false,
      query: keyword,
      count: 0,
      items: [],
      links: [],
      page,
      nextPage: null,
      error: error?.message || '搜索请求发生错误',
    };
  }
}

/**
 * 下载 Magnific 视频到本地
 */
export async function downloadMagnificVideo(
  videoUrl: string,
  options: { filename?: string; saveDir?: string } = {},
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!videoUrl) {
    return { success: false, error: '未提供视频链接' };
  }

  try {
    const fetchFn = await getFetchImpl();
    // CDN 使用 URL 内签名 token 鉴权，Referer 仅作保险
    const res = await fetchFn(videoUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.magnific.com/',
      },
    });

    if (!res.ok) {
      return { success: false, error: `下载失败: HTTP ${res.status}` };
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let workspaceDir = options.saveDir;
    if (!workspaceDir) {
      workspaceDir = app ? app.getPath('downloads') : process.cwd();
    }

    const saveDir = join(workspaceDir, 'magnific-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    const filename = options.filename
      ? `${sanitizeName(options.filename)}.mp4`
      : `magnific_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);

    return { success: true, filePath };
  } catch (error: any) {
    return { success: false, error: error?.message || '下载视频过程中发生错误' };
  }
}

/**
 * 下载无水印预览视频并上传至 COS 素材库
 */
export async function syncMagnificToMaterialLibrary(
  _clientId: string,
  data: { videoUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; materialId?: string; data?: any; error?: string }> {
  const { videoUrl, metadata } = data;
  if (!videoUrl) {
    return { success: false, error: '缺少视频链接' };
  }

  // 1. 下载预览视频到本地
  const dlResult = await downloadMagnificVideo(videoUrl, {
    filename: metadata?.title || metadata?.name,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载视频失败' };
  }

  const localFilePath = dlResult.filePath;

  // 2. 上传到素材库 (COS + crawler_material)
  try {
    const fileName = localFilePath.split('/').pop() || `magnific_${Date.now()}.mp4`;
    const title = metadata?.title || metadata?.name || fileName.replace(/\.mp4$/i, '');
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'magnific',
      group: 'magnific',
      source: 'Magnific',
      originUrl: metadata?.link || metadata?.url || '',
      suffix: 'mp4',
      name: title,
      nameEn: title,
      keywords: metadata?.tags || metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'magnific',
        mediaType: 'video',
        uploadedAt: new Date().toISOString(),
      },
    });

    if (!materialResult.ok) {
      return { success: false, error: materialResult.msg || '素材库保存失败' };
    }

    return {
      success: true,
      message: '已成功下载视频并上传入库至素材库',
      localFilePath,
      cosUrl: materialResult.materialUrl,
      materialId: materialResult.materialId,
      data: {
        materialId: materialResult.materialId,
        cosUrl: materialResult.materialUrl,
        localFilePath,
      },
    };
  } catch (cosError: any) {
    return {
      success: false,
      error: cosError?.message || '上传素材库时发生错误',
    };
  }
}

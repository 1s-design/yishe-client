import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
/**
 * Magnific 素材采集能力 (Freepik 家族 Stock 素材站)
 * 官方网站: https://www.magnific.com/
 * 覆盖三类资源（均为源站内部接口，无官方开放 API）:
 *   - 视频   /api/videos          免费视频预览为无水印 clear mp4（签名 token URL）
 *   - 图标   /api/icons           PNG 三档尺寸直链完全开放（SVG 需付费，freeSvg 标记）
 *   - 图/矢量 /api/regular/search content_type=photo|vector，预览 jpg 直链开放，?w= 可放大
 * 注意: 源站有 WAF，需携带浏览器 UA/Referer 指纹头（sec-fetch-* 为禁止头，不可设置）
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const MAGNIFIC_SITE_URL = 'https://www.magnific.com/';
const MAGNIFIC_VIDEOS_API = 'https://www.magnific.com/api/videos';
const MAGNIFIC_ICONS_API = 'https://www.magnific.com/api/icons';
const MAGNIFIC_REGULAR_API = 'https://www.magnific.com/api/regular/search';

/** 图片预览放大参数（img CDN 按最长边缩放，实测 418x626 → 920x1380） */
const IMAGE_PREVIEW_W = '1380';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * 过 WAF 的浏览器指纹头。
 * 注意：不可手动设置 sec-fetch-* 头 —— 它是 Fetch 规范的禁止头，
 * Electron net.fetch (Chromium 网络栈) 会直接拒绝请求并抛 net::ERR_INVALID_ARGUMENT。
 * 实测 (electron 35.7.5)：去掉 sec-fetch-* 后 WAF 依旧放行，甚至仅 UA 也能过。
 */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://www.magnific.com/search',
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
};

/** 资源类型：视频走 /api/videos，图标走 /api/icons，图片/矢量走 /api/regular/search */
export type MagnificResourceType = 'video' | 'icon' | 'photo' | 'vector';

export interface MagnificItem {
  id: string;
  name: string;
  title: string;
  description: string;
  mediaType: 'video' | 'image';
  /** 资源类型标识 */
  resourceType: MagnificResourceType;
  /** 采集目标直链（视频=clear mp4；图标=512 PNG；图片/矢量=放大预览 jpg） */
  fileUrl: string;
  /** 视频专用：无水印预览 mp4（与 fileUrl 一致） */
  videoUrl: string;
  /** 小尺寸预览（视频悬停播放 / 图标中图） */
  previewUrl: string;
  image: string; // 封面缩略图（大图）
  thumbnail: string; // 封面缩略图（小图）
  link: string; // 站内详情页
  url: string;
  duration?: number | null;
  quality?: string | null; // 原片规格标记，如 "4K"
  premium?: boolean;
  isAIGenerated?: boolean;
  /** 源站子类型：footage | motion_graphics | standard | animated | photo | vector */
  itemSubtype?: string | null;
  width?: number | null;
  height?: number | null;
  aspectRatio?: string | null;
  orientation?: string | null;
  author?: string;
  license?: string;
  tags?: string;
  isFree?: boolean;
  /** 入库文件后缀：mp4 | png | jpg */
  suffix: string;
}

/** 兼容别名：视频场景沿用旧命名 */
export type MagnificVideo = MagnificItem;

export interface MagnificSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  pages?: number;
  items: MagnificItem[];
  links: string[];
  page: number;
  nextPage: number | null;
  /** 本页实际页大小（icons 固定 96、regular 固定 50、视频可自定义） */
  perPage?: number;
  error?: string;
}

interface MagnificSearchOptions {
  /** 资源类型，默认 video */
  resourceType?: MagnificResourceType;
  page?: number;
  limit?: number;
  pageSize?: number;
  /** video: free=仅免费(无水印) / premium=仅付费(带水印) / all=全部 */
  license?: 'free' | 'premium' | 'all';
  /** video + photo/vector: relevance(默认) / recent */
  order?: 'relevance' | 'recent';
  /** icon: standard(静态) / animated(动图) / all(混合) */
  iconType?: 'standard' | 'animated' | 'all';
}

// ─── 源站 API 原始结构 ──────────────────────────────────────

interface MagnificApiAuthor {
  name?: string;
  slug?: string;
}

interface MagnificVideoApiItem {
  id: number;
  name: string;
  created?: string;
  url?: string;
  quality?: string;
  premium?: boolean;
  duration?: number;
  author?: MagnificApiAuthor;
  thumbnails?: Array<{ url?: string; width?: number; height?: number; aspectRatio?: string }>;
  previews?: Array<{ url?: string; width?: number; height?: number; aspectRatio?: string }>;
  poster?: string;
  posterLarge?: string;
  videoSrc?: string;
  isAIGenerated?: boolean;
  itemSubtype?: string;
  nativeAspectRatio?: string;
  nativeOrientation?: string;
  tags?: Array<{ slug?: string; name?: string }>;
}

interface MagnificIconApiItem {
  id: number;
  type?: string;
  name: string;
  created?: string;
  slug?: string;
  author?: MagnificApiAuthor & { avatar?: string; assets?: number };
  family?: { id?: number; name?: string; slug?: string; total?: number };
  freeSvg?: boolean;
  iconType?: string;
  thumbnails?: {
    small?: { url?: string; width?: number; height?: number };
    medium?: { url?: string; width?: number; height?: number };
    large?: { url?: string; width?: number; height?: number };
  };
  creditCost?: { free?: number; premium?: number };
  style?: { id?: number; name?: string };
}

interface MagnificRegularApiItem {
  id: number;
  name: string;
  slug?: string;
  url?: string;
  premium?: boolean;
  new?: boolean;
  type?: string; // photo | vector | psd
  author?: MagnificApiAuthor;
  preview?: { width?: number; height?: number; url?: string };
  isAIGenerated?: boolean;
  hasPrompt?: boolean;
  creditCost?: number;
  pixel?: string;
}

/** Laravel 风格分页（icons / regular 端点） */
interface MagnificPagination {
  total?: number;
  lastPage?: number;
  currentPage?: number;
  perPage?: number;
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

/** 从 URL 推断入库后缀 */
function detectSuffix(url: string): string {
  const clean = (url || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.mp4')) return 'mp4';
  if (clean.endsWith('.png')) return 'png';
  if (clean.endsWith('.svg')) return 'svg';
  if (clean.endsWith('.webp')) return 'webp';
  return 'jpg';
}

// ─── 条目归一化 ──────────────────────────────────────────────

/** 从视频 previews 中挑选指定规格的 mp4 URL */
function pickVideoPreviewUrl(item: MagnificVideoApiItem, size: 'large' | 'small'): string {
  const previews = item.previews || [];
  const match = previews.find((p) => p.url && p.url.includes(`/${size}.mp4`));
  if (match?.url) return match.url;
  return previews[previews.length - 1]?.url || item.videoSrc || '';
}

function normalizeVideoItem(item: MagnificVideoApiItem): MagnificItem {
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
  const videoUrl = pickVideoPreviewUrl(item, 'large');

  return {
    id: String(item.id),
    name: sanitizeName(item.name || `magnific_${item.id}`),
    title: item.name || `Magnific Video ${item.id}`,
    description: item.name || '',
    mediaType: 'video',
    resourceType: 'video',
    fileUrl: videoUrl,
    videoUrl,
    previewUrl: pickVideoPreviewUrl(item, 'small'),
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
    suffix: 'mp4',
  };
}

function normalizeIconItem(item: MagnificIconApiItem): MagnificItem {
  const large = item.thumbnails?.large?.url || item.thumbnails?.medium?.url || '';
  const medium = item.thumbnails?.medium?.url || large;
  const small = item.thumbnails?.small?.url || medium;
  const familyName = item.family?.name || item.style?.name || '';
  const detailUrl = item.slug ? `https://www.magnific.com/icon/${item.slug}` : '';

  return {
    id: String(item.id),
    name: sanitizeName(item.name || `magnific_icon_${item.id}`),
    title: item.name || `Magnific Icon ${item.id}`,
    description: familyName ? `Family: ${familyName}` : '',
    mediaType: 'image',
    resourceType: 'icon',
    fileUrl: large,
    videoUrl: '',
    previewUrl: medium,
    image: large,
    thumbnail: small,
    link: detailUrl,
    url: detailUrl,
    duration: null,
    quality: null,
    premium: !item.freeSvg,
    isAIGenerated: false,
    itemSubtype: item.iconType || 'standard',
    width: item.thumbnails?.large?.width ?? 512,
    height: item.thumbnails?.large?.height ?? 512,
    aspectRatio: '1:1',
    orientation: 'square',
    author: item.author?.name || 'Magnific Contributor',
    license: item.freeSvg
      ? 'Magnific Free (SVG & PNG free)'
      : 'Magnific Free PNG (SVG requires premium)',
    tags: familyName,
    isFree: true, // PNG 始终免费可下载
    suffix: 'png',
  };
}

function normalizeRegularItem(item: MagnificRegularApiItem): MagnificItem | null {
  // 防御：混合结果中过滤掉 psd（按需求不采集）
  const type = item.type;
  if (type !== 'photo' && type !== 'vector') return null;

  const previewUrl = item.preview?.url || '';
  // img CDN 支持按最长边缩放，放大预览图用于入库
  const fileUrl = previewUrl ? `${previewUrl}?w=${IMAGE_PREVIEW_W}` : '';
  const detailUrl = item.url || '';

  return {
    id: String(item.id),
    name: sanitizeName(item.name || `magnific_${type}_${item.id}`),
    title: item.name || `Magnific ${type} ${item.id}`,
    description: item.name || '',
    mediaType: 'image',
    resourceType: type,
    fileUrl,
    videoUrl: '',
    previewUrl,
    image: previewUrl,
    thumbnail: previewUrl,
    link: detailUrl,
    url: detailUrl,
    duration: null,
    quality: item.pixel === 'free' ? null : item.pixel || null,
    premium: !!item.premium,
    isAIGenerated: !!item.isAIGenerated,
    itemSubtype: type,
    width: item.preview?.width ?? null,
    height: item.preview?.height ?? null,
    aspectRatio: null,
    orientation: null,
    author: item.author?.name || 'Magnific Contributor',
    license: item.premium ? 'Magnific Premium (preview)' : 'Magnific Free (preview)',
    tags: '',
    isFree: !item.premium,
    suffix: 'jpg',
  };
}

// ─── 通用搜索结果组装 ────────────────────────────────────────

function buildResult(
  keyword: string,
  page: number,
  items: MagnificItem[],
  total: number,
  pages: number,
  perPage: number,
): MagnificSearchResult {
  return {
    success: true,
    query: keyword,
    count: items.length,
    total,
    pages,
    items,
    links: items.map((i) => i.fileUrl),
    page,
    nextPage: page < pages ? page + 1 : null,
    perPage,
  };
}

function buildError(keyword: string, page: number, error: string): MagnificSearchResult {
  return {
    success: false,
    query: keyword,
    count: 0,
    items: [],
    links: [],
    page,
    nextPage: null,
    error,
  };
}

// ─── 状态 ────────────────────────────────────────────────────

/**
 * 检查 Magnific 服务状态
 */
export async function getMagnificStatus() {
  const site = await checkSiteAvailability(MAGNIFIC_SITE_URL, { timeoutMs: 5000 });
  return {
    key: 'magnific',
    pluginKey: 'magnific',
    label: 'Magnific 素材采集',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Magnific 可用' : `Magnific 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

// ─── 视频搜索 (/api/videos) ──────────────────────────────────

async function searchMagnificVideos(
  keyword: string,
  page: number,
  limit: number,
  license: 'free' | 'premium' | 'all',
  order: 'relevance' | 'recent',
): Promise<MagnificSearchResult> {
  const fetchFn = await getFetchImpl();

  const params = new URLSearchParams();
  params.set('format[search]', '1');
  if (license === 'free') params.set('license[free]', '1');
  else if (license === 'premium') params.set('license[premium]', '1');
  params.set('locale', 'en');
  params.set('term', keyword);
  params.set('type[video]', '1');
  params.set('page', String(page));
  if (order === 'recent') params.set('order', 'recent');
  if (limit && limit !== 50) params.set('limit', String(limit));

  const res = await fetchFn(`${MAGNIFIC_VIDEOS_API}?${params.toString()}`, {
    method: 'GET',
    headers: BROWSER_HEADERS,
  });

  if (!res.ok) {
    const reason = res.status === 403 ? '被源站安全过滤拦截 (403)' : `HTTP ${res.status}`;
    return buildError(keyword, page, `搜索失败: ${reason}`);
  }

  const data = (await res.json()) as { items?: MagnificVideoApiItem[]; metas?: { total?: number; pages?: number } };
  const items = (data.items || []).map(normalizeVideoItem);
  const total = data.metas?.total ?? items.length;
  const pages = data.metas?.pages ?? 1;

  return buildResult(keyword, page, items, total, pages, limit);
}

// ─── 图标搜索 (/api/icons) ───────────────────────────────────

async function searchMagnificIcons(
  keyword: string,
  page: number,
  iconType: 'standard' | 'animated' | 'all',
): Promise<MagnificSearchResult> {
  const fetchFn = await getFetchImpl();

  const params = new URLSearchParams();
  if (iconType !== 'all') params.set('filters[icon_type][]', iconType);
  params.set('format[search]', '1');
  params.set('locale', 'en');
  params.set('term', keyword);
  params.set('type[icon]', '1');
  params.set('page', String(page));

  const res = await fetchFn(`${MAGNIFIC_ICONS_API}?${params.toString()}`, {
    method: 'GET',
    headers: BROWSER_HEADERS,
  });

  if (!res.ok) {
    const reason = res.status === 403 ? '被源站安全过滤拦截 (403)' : `HTTP ${res.status}`;
    return buildError(keyword, page, `搜索失败: ${reason}`);
  }

  const data = (await res.json()) as { items?: MagnificIconApiItem[]; pagination?: MagnificPagination };
  const items = (data.items || []).map(normalizeIconItem);
  const total = data.pagination?.total ?? items.length;
  const pages = data.pagination?.lastPage ?? 1;
  const perPage = data.pagination?.perPage ?? (items.length || 96);

  return buildResult(keyword, page, items, total, pages, perPage);
}

// ─── 图片/矢量搜索 (/api/regular/search) ─────────────────────

async function searchMagnificRegular(
  keyword: string,
  page: number,
  contentType: 'photo' | 'vector',
  order: 'relevance' | 'recent',
): Promise<MagnificSearchResult> {
  const fetchFn = await getFetchImpl();

  const params = new URLSearchParams();
  params.set('locale', 'en');
  params.set('term', keyword);
  params.set('content_type', contentType);
  params.set('page', String(page));
  if (order === 'recent') params.set('order', 'recent');

  const res = await fetchFn(`${MAGNIFIC_REGULAR_API}?${params.toString()}`, {
    method: 'GET',
    headers: BROWSER_HEADERS,
  });

  if (!res.ok) {
    const reason = res.status === 403 ? '被源站安全过滤拦截 (403)' : `HTTP ${res.status}`;
    return buildError(keyword, page, `搜索失败: ${reason}`);
  }

  const data = (await res.json()) as { items?: MagnificRegularApiItem[]; pagination?: MagnificPagination };
  const items = (data.items || [])
    .map(normalizeRegularItem)
    .filter((i): i is MagnificItem => !!i);
  const total = data.pagination?.total ?? items.length;
  const pages = data.pagination?.lastPage ?? 1;
  const perPage = data.pagination?.perPage ?? (items.length || 50);

  return buildResult(keyword, page, items, total, pages, perPage);
}

// ─── 统一搜索入口（按 resourceType 分发） ─────────────────────

/**
 * 搜索 Magnific 素材（视频 / 图标 / 图片 / 矢量）
 */
export async function searchMagnific(
  query: string,
  options: MagnificSearchOptions = {},
): Promise<MagnificSearchResult> {
  const keyword = (query || '').trim();
  if (!keyword) {
    return buildError('', 1, '缺少搜索关键词');
  }

  const page = Math.max(Number(options.page) || 1, 1);
  const resourceType = options.resourceType || 'video';

  try {
    switch (resourceType) {
      case 'icon':
        return await searchMagnificIcons(keyword, page, options.iconType || 'standard');
      case 'photo':
      case 'vector':
        return await searchMagnificRegular(keyword, page, resourceType, options.order || 'relevance');
      case 'video':
      default: {
        const limit = Math.min(Math.max(Number(options.limit || options.pageSize) || 20, 1), 50);
        return await searchMagnificVideos(
          keyword,
          page,
          limit,
          options.license || 'free',
          options.order || 'relevance',
        );
      }
    }
  } catch (error: any) {
    return buildError(keyword, page, error?.message || '搜索请求发生错误');
  }
}

// ─── 下载 ────────────────────────────────────────────────────

/**
 * 下载 Magnific 素材文件到本地（视频 mp4 / 图标 png / 图片 jpg 通用）
 */
export async function downloadMagnificFile(
  fileUrl: string,
  options: { filename?: string; saveDir?: string; suffix?: string } = {},
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!fileUrl) {
    return { success: false, error: '未提供文件链接' };
  }

  try {
    const fetchFn = await getFetchImpl();
    // CDN 使用 URL 内签名 token 鉴权（仅视频），Referer 仅作保险
    const res = await fetchFn(fileUrl, {
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

    const suffix = options.suffix || detectSuffix(fileUrl);
    const filename = options.filename
      ? `${sanitizeName(options.filename)}.${suffix}`
      : `magnific_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${suffix}`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);

    return { success: true, filePath };
  } catch (error: any) {
    return { success: false, error: error?.message || '下载文件过程中发生错误' };
  }
}

/**
 * 下载 Magnific 视频到本地（兼容旧接口，等价于 downloadMagnificFile）
 */
export function downloadMagnificVideo(
  videoUrl: string,
  options: { filename?: string; saveDir?: string } = {},
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  return downloadMagnificFile(videoUrl, { ...options, suffix: 'mp4' });
}

// ─── 同步入库 ────────────────────────────────────────────────

/**
 * 下载素材文件并上传至 COS 素材库（视频/图标/图片通用）
 */
export async function syncMagnificToMaterialLibrary(
  _clientId: string,
  data: {
    fileUrl?: string;
    videoUrl?: string;
    imageUrl?: string;
    metadata?: Record<string, any>;
  },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; materialId?: string; data?: any; error?: string }> {
  // 兼容三种字段名：fileUrl（推荐）/ videoUrl（视频旧字段）/ imageUrl（图片）
  const targetUrl = data.fileUrl || data.videoUrl || data.imageUrl;
  const { metadata } = data;
  if (!targetUrl) {
    return { success: false, error: '缺少文件链接' };
  }

  const suffix = metadata?.suffix || detectSuffix(targetUrl);

  // 1. 下载素材文件到本地
  const dlResult = await downloadMagnificFile(targetUrl, {
    filename: metadata?.title || metadata?.name,
    suffix,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载文件失败' };
  }

  const localFilePath = dlResult.filePath;

  // 2. 上传到素材库 (COS + crawler_material)
  try {
    const fileName = localFilePath.split('/').pop() || `magnific_${Date.now()}.${suffix}`;
    const title = metadata?.title || metadata?.name || fileName.replace(/\.[a-z0-9]+$/i, '');
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'magnific',
      group: 'magnific',
      source: 'Magnific',
      originUrl: metadata?.link || metadata?.url || '',
      suffix,
      name: title,
      nameEn: title,
      keywords: metadata?.tags || metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'magnific',
        mediaType: suffix === 'mp4' ? 'video' : 'image',
        resourceType: metadata?.resourceType || (suffix === 'mp4' ? 'video' : 'image'),
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
      },
    };
  } catch (cosError: any) {
    return {
      success: false,
      error: cosError?.message || '上传素材库时发生错误',
    };
  }
}

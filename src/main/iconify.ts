/**
 * Iconify 图标聚合平台采集能力
 * 官方网站: https://icon-sets.iconify.design/
 * 特点: 200,000+ 图标，100+ 图标集（Material Icons, Font Awesome, Heroicons 等），
 *       大多数图标集使用 Apache 2.0 / MIT / CC BY 4.0 许可
 *
 * API 文档: https://iconify.design/docs/api/
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';

const ICONIFY_SITE_URL = 'https://icon-sets.iconify.design/';
const ICONIFY_API_BASE = 'https://api.iconify.design';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface IconifyIcon {
  id: string;
  name: string;
  title: string;
  image: string; // SVG URL (默认带颜色)
  svgUrl: string; // SVG 矢量原图直链
  pngUrl: string; // PNG 缩略图直链
  thumbnail: string; // 缩略图 (同 PNG)
  downloadUrl: string; // 下载直链 (SVG)
  link: string; // 原详情页链接
  url: string;
  prefix: string; // 图标集前缀，如 "mdi", "fa", "heroicons"
  tags?: string;
  width?: number;
  height?: number;
  author?: string; // 图标集名称
  license?: string;
  isFree?: boolean;
  description?: string;
}

export interface IconifySearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: IconifyIcon[];
  links: string[];
  page: number;
  totalPages?: number;
  nextPage: number | null;
  error?: string;
}

interface IconifySearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  prefix?: string; // 过滤指定图标集，如 "mdi"
  color?: string; // 自定义颜色 (hex, 如 #6C63FF)
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

/** 校验并返回安全的 hex 颜色值 */
function safeHexColor(color: string | undefined): string | null {
  if (!color) return null;
  const hex = color.trim();
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex)) {
    return hex;
  }
  return null;
}

/** 获取 Node/Electron fetch 实现 */
async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') {
    return net.fetch.bind(net);
  }
  return fetch;
}

/**
 * 检查 Iconify 服务状态
 */
export async function getIconifyStatus() {
  const site = await checkSiteAvailability(ICONIFY_SITE_URL, { timeoutMs: 8000 });
  return {
    key: 'iconify',
    pluginKey: 'iconify',
    label: 'Iconify 图标聚合平台',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Iconify 可用' : `Iconify 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

/**
 * 构建 Iconify SVG URL
 */
function buildSvgUrl(prefix: string, name: string, color?: string | null): string {
  let url = `${ICONIFY_API_BASE}/${prefix}/${name}.svg`;
  const params: string[] = [];
  if (color) {
    params.push(`color=${encodeURIComponent(color)}`);
  }
  if (params.length > 0) {
    url += `?${params.join('&')}`;
  }
  return url;
}

/**
 * 构建 Iconify PNG URL
 */
function buildPngUrl(prefix: string, name: string, width = 100, height = 100): string {
  return `${ICONIFY_API_BASE}/${prefix}/${name}.png?width=${width}&height=${height}`;
}

/**
 * 从 API 响应中解析图标列表
 */
function parseIconifySearchResponse(
  data: any,
  color?: string | null,
): { items: IconifyIcon[]; total: number } {
  const items: IconifyIcon[] = [];
  const usedIds = new Set<string>();

  try {
    const rawIcons = data.icons || [];
    const collections = data.collections || {};
    const total = data.total || (Array.isArray(rawIcons) ? rawIcons.length : Object.keys(rawIcons).length);

    if (Array.isArray(rawIcons)) {
      for (const item of rawIcons) {
        const fullName = typeof item === 'string' ? item : item.name || '';
        if (!fullName || usedIds.has(fullName)) continue;
        usedIds.add(fullName);

        const parts = fullName.includes(':') ? fullName.split(':') : fullName.includes('-') ? [fullName.split('-')[0], fullName.slice(fullName.indexOf('-') + 1)] : ['custom', fullName];
        const prefix = parts[0];
        const iconName = parts[1] || prefix;

        const svgUrl = buildSvgUrl(prefix, iconName, color);
        const pngUrl = buildPngUrl(prefix, iconName);
        const collectionInfo = collections[prefix] || {};
        const setName = collectionInfo.name || prefix;
        const setLicense = collectionInfo.license?.title || collectionInfo.license || 'Open Source';
        const setAuthor = collectionInfo.author?.name || collectionInfo.author || 'Iconify Community';

        const title = `${iconName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} (${prefix})`;

        items.push({
          id: fullName,
          name: fullName,
          title,
          description: `Iconify Icon: ${fullName} [${setName}]`,
          image: pngUrl,
          svgUrl,
          pngUrl,
          thumbnail: svgUrl,
          downloadUrl: svgUrl,
          link: `https://icon-sets.iconify.design/${prefix}/${iconName}/`,
          url: `https://icon-sets.iconify.design/${prefix}/${iconName}/`,
          prefix,
          iconName,
          category: setName,
          width: 24,
          height: 24,
          author: setAuthor,
          license: setLicense,
          isFree: true,
          format: 'svg',
          color: color || '#000000',
        });
      }
    } else {
      for (const [iconName, iconData] of Object.entries(rawIcons)) {
        const prefix = data.prefix || '';
        const id = `${prefix}:${iconName}`;
        if (usedIds.has(id)) continue;
        usedIds.add(id);

        const svgUrl = buildSvgUrl(prefix, iconName, color);
        const pngUrl = buildPngUrl(prefix, iconName);
        const collectionInfo = collections[prefix] || {};
        const setName = collectionInfo.name || prefix;

        items.push({
          id,
          name: id,
          title: iconName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          description: `Iconify Icon: ${id}`,
          image: pngUrl,
          svgUrl,
          pngUrl,
          thumbnail: svgUrl,
          downloadUrl: svgUrl,
          link: `https://icon-sets.iconify.design/${prefix}/${iconName}/`,
          url: `https://icon-sets.iconify.design/${prefix}/${iconName}/`,
          prefix,
          iconName,
          category: setName,
          width: (iconData as any)?.width || 24,
          height: (iconData as any)?.height || 24,
          author: collectionInfo.author?.name || collectionInfo.author || 'Iconify Community',
          license: collectionInfo.license?.title || collectionInfo.license || 'Open Source',
          isFree: true,
          format: 'svg',
          color: color || '#000000',
        });
      }
    }
  } catch (err) {
    console.error('[Iconify Parser Error]', err);
  }

  return {
    items,
    total: items.length,
  };
}

/**
 * 搜索 Iconify 图标素材
 */
export async function searchIconify(
  query: string,
  options: IconifySearchOptions = {},
): Promise<IconifySearchResult> {
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
  const prefix = options.prefix || undefined;
  const themeColor = safeHexColor(options.color);

  try {
    const fetchFn = await getFetchImpl();

    // 构建搜索 API URL
    // GET https://api.iconify.design/search?query={keyword}&limit={n}&offset={n}
    const offset = (page - 1) * limit;
    const searchParams = new URLSearchParams({
      query: keyword,
      limit: String(limit),
      offset: String(offset),
    });
    if (prefix) {
      searchParams.set('prefix', prefix);
    }

    const targetUrl = `${ICONIFY_API_BASE}/search?${searchParams.toString()}`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      'Referer': ICONIFY_SITE_URL,
    };

    const res = await fetchFn(targetUrl, { headers });
    if (!res.ok) {
      throw new Error(`Iconify HTTP 错误: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const { items, total } = parseIconifySearchResponse(data, themeColor);

    // 计算分页信息
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      success: true,
      query: keyword,
      count: items.length,
      total,
      totalPages,
      items,
      links: items.map((item) => item.image),
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
      error: error?.message || '搜索 Iconify 图标发生异常',
    };
  }
}

/**
 * 获取工作空间保存路径
 */
function getIconifyWorkspaceDir(): string {
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
 * 下载 Iconify SVG 图标到本地
 */
export async function downloadIconifyIcon(
  imageUrl: string,
  options: { filename?: string; color?: string } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '缺少图标下载链接'};
  }

  try {
    const fetchFn = await getFetchImpl();
    const headers = {
      'User-Agent': USER_AGENT,
      'Referer': ICONIFY_SITE_URL,
    };

    const res = await fetchFn(imageUrl, { headers });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workspaceDir = getIconifyWorkspaceDir();
    const saveDir = join(workspaceDir, 'iconify-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    // Iconify 默认返回 SVG
    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith('.svg') ? '' : '.svg'}`
      : `iconify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.svg`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);

    return { success: true, filePath, filename };
  } catch (error: any) {
    return { success: false, error: error?.message || '下载图标过程中发生错误' };
  }
}

/**
 * 下载并上传至用户个人 COS 存储
 */
export async function syncIconifyToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  if (!imageUrl) {
    return { success: false, error: '缺少图标 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadIconifyIcon(imageUrl, {
    filename: metadata?.title || metadata?.name,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载图标失败' };
  }

  const localFilePath = dlResult.filePath;

  // 2. 上传原图到用户个人的 COS 存储
  try {
    const fileName = localFilePath.split('/').pop() || `iconify_${Date.now()}.svg`;
    const cosKey = await generateCosKey({ category: 'iconify', filename: fileName });
    const cosResult = await uploadFileToCos(localFilePath, cosKey);

    if (!cosResult.ok || !cosResult.url) {
      return { success: false, error: 'msg' in cosResult ? (cosResult as any).msg : 'COS 上传失败' };
    }

    return {
      success: true,
      message: '已成功下载图标并上传至个人 COS 存储',
      localFilePath,
      cosUrl: cosResult.url,
      data: {
        cosUrl: cosResult.url,
        localFilePath,
        fileName,
        metadata: {
          ...metadata,
          source: 'iconify',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || '上传图标至个人 COS 存储失败' };
  }
}

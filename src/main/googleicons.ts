/**
 * Google Material Icons 图标库采集能力
 * 官方网站: https://fonts.google.com/icons
 * 特点: Google 官方 Material Icons + Material Symbols，SVG/PNG 下载，多种粗细/填充风格
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';

const GOOGLE_ICONS_SITE_URL = 'https://fonts.google.com/icons';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface GoogleIcon {
  id: string; // icon name
  name: string; // icon name
  title: string; // display name
  description: string;
  image: string; // SVG 链接
  svgUrl: string;
  pngUrl: string;
  thumbnail: string;
  downloadUrl: string;
  link: string; // 原详情页
  url: string;
  group?: string; // category
  style?: string; // outlined, rounded, sharp, two-tone
  tags?: string[];
  author?: string;
  license?: string;
  isFree?: boolean;
  width?: number | null;
  height?: number | null;
}

export interface GoogleIconsSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: GoogleIcon[];
  links: string[];
  page: number;
  totalPages?: number;
  nextPage: number | null;
  error?: string;
}

interface GoogleIconsSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  style?: 'outlined' | 'rounded' | 'sharp' | 'two-tone'; // Icon category
  size?: number; // 20, 24, 40, 48
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
 * 检查 Google Icons 服务状态
 */
export async function getGoogleIconsStatus() {
  const site = await checkSiteAvailability(GOOGLE_ICONS_SITE_URL, { timeoutMs: 8000 });
  return {
    key: 'google-icons',
    pluginKey: 'google-icons',
    label: 'Google Material Icons',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Google Icons 可用' : `Google Icons 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

let cachedGoogleIconsData: any[] | null = null;
let lastGoogleIconsFetchedAt = 0;

/**
 * 搜索 Google Material Icons
 * 使用 Google 官方元数据接口 https://fonts.google.com/metadata/icons
 */
export async function searchGoogleIcons(
  query: string,
  options: GoogleIconsSearchOptions = {},
): Promise<GoogleIconsSearchResult> {
  const keyword = (query || '').trim().toLowerCase();
  if (!keyword) {
    return {
      success: false, query: '', count: 0, items: [], links: [],
      page: 1, nextPage: null, error: '缺少搜索关键词',
    };
  }

  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(Math.max(Number(options.limit || options.pageSize) || 20, 1), 100);
  const style = options.style || 'outlined';
  const size = options.size || 24;

  try {
    const fetchFn = await getFetchImpl();

    // 缓存 1 小时
    const now = Date.now();
    if (!cachedGoogleIconsData || now - lastGoogleIconsFetchedAt > 3600000) {
      const metadataUrl = 'https://fonts.google.com/metadata/icons';
      const res = await fetchFn(metadataUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json, text/plain, */*',
        },
      });

      if (res.ok) {
        const text = await res.text();
        const cleanJson = text.replace(/^\)]}'\s*/, '');
        const json = JSON.parse(cleanJson);
        cachedGoogleIconsData = json?.icons || [];
        lastGoogleIconsFetchedAt = now;
      }
    }

    let allIcons: any[] = cachedGoogleIconsData || [];
    const matchedRaw = allIcons.filter((ic: any) => {
      const name = String(ic.name || '').toLowerCase();
      const tags = Array.isArray(ic.tags) ? ic.tags.map((t: string) => String(t).toLowerCase()) : [];
      const categories = Array.isArray(ic.categories) ? ic.categories.map((c: string) => String(c).toLowerCase()) : [];
      return name.includes(keyword) || tags.some((t: string) => t.includes(keyword)) || categories.some((c: string) => c.includes(keyword));
    });

    const items: GoogleIcon[] = matchedRaw.map((ic: any) => {
      const name = ic.name;
      const version = ic.version || 1;
      return buildGoogleIcon(name, ic, style, size);
    });

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
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
      error: error?.message || '搜索 Google Icons 发生异常',
    };
  }
}

/**
 * 解析 Google Icons 搜索结果 HTML
 */
function parseGoogleIconsHtml(html: string, style: string, size: number): GoogleIcon[] {
  const items: GoogleIcon[] = [];
  const usedNames = new Set<string>();

  try {
    // Strategy 1: 从 __NEXT_DATA__ 或 script 标签中提取数据
    const nextDataMatch = html.match(/<script[^>]*>(\s*window\.__Tags\s*=\s*(\[.*?\]);?\s*)<\/script>/is) ||
      html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const icons: any[] = Array.isArray(data) ? data : data?.props?.pageProps?.icons || [];
        for (const icon of icons) {
          const name = icon.name || icon.id || '';
          if (!name || usedNames.has(name)) continue;
          usedNames.add(name);
          items.push(buildGoogleIcon(name, icon, style, size));
        }
      } catch (e) {
        console.warn('[Google Icons Parser] JSON parse failed:', e);
      }
    }

    // Strategy 2: 从 HTML 结构中解析图标卡片
    if (items.length === 0) {
      // Google Icons 页面结构: div[class*="icon"] 包含图标名称
      const iconCardRegex = /<div[^>]*class="[^"]*(?:icon|Icon)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
      let cardMatch;
      
      while ((cardMatch = iconCardRegex.exec(html)) !== null) {
        const cardHtml = cardMatch[0];
        
        // 尝试提取图标名称
        const nameMatch = cardHtml.match(/(?:data-icon-name|aria-label|data-name)="([^"]+)"/i) ||
          cardHtml.match(/<span[^>]*>([a-z][a-z0-9_]+)<\/span>/i);
        
        if (!nameMatch) continue;
        const name = nameMatch[1].trim();
        if (!name || usedNames.has(name) || name.length < 2) continue;
        if (!/^[a-z][a-z0-9_]*$/.test(name)) continue;
        
        usedNames.add(name);
        items.push(buildGoogleIcon(name, null, style, size));
      }
    }

    // Strategy 3: 如果还是没结果，尝试从 img/src 提取
    if (items.length === 0) {
      const imgRegex = /<img[^>]+src="([^"]*(?:gstatic|googleapis)[^"]*material[^"]*)"[^>]*>/gi;
      let imgMatch;
      
      while ((imgMatch = imgRegex.exec(html)) !== null) {
        const src = imgMatch[1];
        const nameMatch = src.match(/\/([a-z][a-z0-9_]+)\//);
        if (!nameMatch) continue;
        const name = nameMatch[1];
        if (usedNames.has(name)) continue;
        usedNames.add(name);
        items.push(buildGoogleIcon(name, null, style, size));
      }
    }
  } catch (err) {
    console.error('[Google Icons Parser Error]', err);
  }

  return items;
}

/**
 * 构建 GoogleIcon 对象
 */
function buildGoogleIcon(name: string, raw: any | null, style: string, size: number): GoogleIcon {
  // Google Material Icons SVG URL 模式
  // 彩色 SVG: https://fonts.gstatic.com/s/i/materialicons/{name}/v1/24px.svg
  // 或通过 Material Symbols
  const svgUrl = `https://fonts.gstatic.com/s/i/materialicons/${name}/v1/${size}px.svg`;
  const pngUrl = `https://fonts.gstatic.com/s/i/materialicons/${name}/v1/${size}px.png`;
  const detailUrl = `https://fonts.google.com/icons?icon.query=${name}&icon.set=Material+Icons`;

  const displayName = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    id: name,
    name,
    title: displayName,
    description: `Google Material Icon — ${displayName} (${style})`,
    image: svgUrl,
    svgUrl,
    pngUrl,
    thumbnail: pngUrl,
    downloadUrl: svgUrl,
    link: detailUrl,
    url: detailUrl,
    group: raw?.group || raw?.category || '',
    style,
    tags: Array.isArray(raw?.tags)
      ? raw.tags
      : typeof raw?.tags === 'string'
        ? raw.tags.split(',').map((t: string) => t.trim())
        : [],
    author: 'Google',
    license: 'Apache License 2.0',
    isFree: true,
    width: size,
    height: size,
  };
}

/**
 * 获取工作空间保存路径
 */
function getGoogleIconsWorkspaceDir(): string {
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
 * 下载 Google Icon SVG/PNG 到本地
 */
export async function downloadGoogleIcon(
  imageUrl: string,
  options: { filename?: string; style?: string } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '缺少图片下载链接' };
  }

  try {
    const fetchFn = await getFetchImpl();
    const headers = {
      'User-Agent': USER_AGENT,
      'Referer': 'https://fonts.google.com/',
    };

    const res = await fetchFn(imageUrl, { headers });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workspaceDir = getGoogleIconsWorkspaceDir();
    const saveDir = join(workspaceDir, 'googleicons-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    const ext = imageUrl.endsWith('.svg') || imageUrl.includes('/materialicons/') ? '.svg' : '.png';
    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith(ext) ? '' : ext}`
      : `googleicon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

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
export async function syncGoogleIconsToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  if (!imageUrl) {
    return { success: false, error: '缺少图片 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadGoogleIcon(imageUrl, {
    filename: metadata?.title || metadata?.name,
    style: metadata?.style,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;

  // 2. 强制上传原图到用户个人的 COS 存储
  try {
    const fileName = localFilePath.split('/').pop() || `googleicon_${Date.now()}.svg`;
    const cosKey = await generateCosKey({ category: 'googleicons', filename: fileName });
    const cosResult = await uploadFileToCos(localFilePath, cosKey);

    if (!cosResult.ok || !cosResult.url) {
      return { success: false, error: 'msg' in cosResult ? (cosResult as any).msg : 'COS 上传失败' };
    }

    return {
      success: true,
      message: '已成功下载 Google Icon 并上传至个人 COS 存储',
      localFilePath,
      cosUrl: cosResult.url,
      data: {
        cosUrl: cosResult.url,
        localFilePath,
        fileName,
        metadata: {
          ...metadata,
          source: 'google-icons',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || '上传素材至个人 COS 存储失败' };
  }
}

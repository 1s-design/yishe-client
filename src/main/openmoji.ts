/**
 * OpenMoji 开源 Emoji 图标库采集能力
 * 官方网站: https://openmoji.org/
 * 特点: 100% 开源 Emoji (CC BY-SA 4.0)，支持彩色/黑白两种风格，SVG + PNG 下载
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';

const OPENMOJI_SITE_URL = 'https://openmoji.org/';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface OpenMojiEmoji {
  id: string; // hexcode
  name: string; // annotation
  title: string; // annotation (human readable)
  description: string;
  image: string; // 默认 SVG 链接
  svgUrl: string; // 彩色 SVG
  svgBlackUrl: string; // 黑白 SVG
  pngUrl: string; // 彩色 PNG
  pngBlackUrl: string; // 黑白 PNG
  thumbnail: string;
  downloadUrl: string;
  link: string; // 原详情页
  url: string;
  emoji?: string; // 实际 emoji 字符
  hexcode?: string;
  group?: string;
  subGroup?: string;
  tags?: string[];
  author?: string;
  license?: string;
  isFree?: boolean;
  width?: number | null;
  height?: number | null;
}

export interface OpenMojiSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: OpenMojiEmoji[];
  links: string[];
  page: number;
  totalPages?: number;
  nextPage: number | null;
  error?: string;
}

interface OpenMojiSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  style?: 'color' | 'black'; // 彩色 or 黑白
  group?: string; // 按分组过滤
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
 * 检查 OpenMoji 服务状态
 */
export async function getOpenMojiStatus() {
  const site = await checkSiteAvailability(OPENMOJI_SITE_URL, { timeoutMs: 8000 });
  return {
    key: 'openmoji',
    pluginKey: 'openmoji',
    label: 'OpenMoji 开源 Emoji',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'OpenMoji 可用' : `OpenMoji 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

/**
 * 搜索 OpenMoji emoji (通过 openmoji.json 全量数据本地搜索)
 */
export async function searchOpenMoji(
  query: string,
  options: OpenMojiSearchOptions = {},
): Promise<OpenMojiSearchResult> {
  const keyword = (query || '').trim().toLowerCase();
  if (!keyword) {
    return {
      success: false, query: '', count: 0, items: [], links: [],
      page: 1, nextPage: null, error: '缺少搜索关键词',
    };
  }

  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(Math.max(Number(options.limit || options.pageSize) || 20, 1), 100);
  const style = options.style || 'color';
  const filterGroup = options.group || '';

  try {
    const fetchFn = await getFetchImpl();
    // OpenMoji 全量数据 JSON
    const targetUrl = 'https://openmoji.org/data/openmoji.json';

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      'Referer': 'https://openmoji.org/',
    };

    const res = await fetchFn(targetUrl, { headers });
    if (!res.ok) {
      throw new Error(`OpenMoji HTTP 错误: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as any[];
    
    // 搜索过滤
    const filtered = data.filter((item: any) => {
      const annotation = (item.annotation || '').toLowerCase();
      const tags = (item.tags || '').toLowerCase();
      const subGroup = (item.subGroup || '').toLowerCase();
      const group = (item.group || '').toLowerCase();
      const hexcode = (item.hexcode || '').toLowerCase();
      
      const matches = annotation.includes(keyword) ||
        tags.includes(keyword) ||
        subGroup.includes(keyword) ||
        group.includes(keyword) ||
        hexcode.includes(keyword) ||
        (item.emoji && keyword.length <= 2 && item.emoji.includes(keyword));
      
      // 分组过滤
      if (filterGroup && group !== filterGroup.toLowerCase()) {
        return false;
      }
      
      return matches;
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const pagedItems = filtered.slice(startIndex, startIndex + limit);

    const items: OpenMojiEmoji[] = pagedItems.map((item: any) => {
      const hexcode = item.hexcode || '';
      const annotation = item.annotation || hexcode || 'OpenMoji Emoji';
      const emojiChar = item.emoji || '';
      
      // URL 模式
      const svgColorUrl = `https://openmoji.org/data/color/${hexcode}.svg`;
      const svgBlackUrl = `https://openmoji.org/data/black/${hexcode}.svg`;
      const pngColorUrl = `https://openmoji.org/data/color/${hexcode}.png?size=64`;
      const pngBlackUrl = `https://openmoji.org/data/black/${hexcode}.png?size=64`;
      const defaultSvg = style === 'black' ? svgBlackUrl : svgColorUrl;
      const defaultPng = style === 'black' ? pngBlackUrl : pngColorUrl;
      const detailUrl = `https://openmoji.org/library/#emoji=${hexcode}&search=${encodeURIComponent(keyword)}`;

      return {
        id: hexcode || annotation,
        name: sanitizeName(annotation) || hexcode || 'openmoji',
        title: emojiChar ? `${emojiChar} ${annotation}` : annotation,
        description: `OpenMoji Emoji — ${annotation} (${item.group || ''} / ${item.subGroup || ''})`,
        image: defaultSvg,
        svgUrl: svgColorUrl,
        svgBlackUrl: svgBlackUrl,
        pngUrl: defaultPng,
        pngBlackUrl: style === 'black' ? pngBlackUrl : pngColorUrl,
        thumbnail: defaultPng,
        downloadUrl: defaultSvg,
        link: detailUrl,
        url: detailUrl,
        emoji: emojiChar,
        hexcode,
        group: item.group,
        subGroup: item.subGroup,
        tags: item.tags ? item.tags.split(',').map((t: string) => t.trim()) : [],
        author: 'OpenMoji Community',
        license: 'CC BY-SA 4.0',
        isFree: true,
        width: 64,
        height: 64,
      };
    });

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
      success: false, query: keyword, count: 0, total: 0,
      items: [], links: [], page, nextPage: null,
      error: error?.message || '搜索 OpenMoji 素材发生异常',
    };
  }
}

/**
 * 获取工作空间保存路径
 */
function getOpenMojiWorkspaceDir(): string {
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
 * 下载 OpenMoji SVG/PNG 到本地
 */
export async function downloadOpenMojiEmoji(
  imageUrl: string,
  options: { filename?: string; style?: 'color' | 'black' } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '缺少图片下载链接' };
  }

  try {
    const fetchFn = await getFetchImpl();
    const headers = {
      'User-Agent': USER_AGENT,
      'Referer': 'https://openmoji.org/',
    };

    const res = await fetchFn(imageUrl, { headers });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workspaceDir = getOpenMojiWorkspaceDir();
    const saveDir = join(workspaceDir, 'openmoji-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    const isSvg = imageUrl.includes('/data/color/') || imageUrl.includes('/data/black/');
    const ext = imageUrl.endsWith('.svg') || isSvg ? '.svg' : '.png';

    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith(ext) ? '' : ext}`
      : `openmoji_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

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
export async function syncOpenMojiToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  if (!imageUrl) {
    return { success: false, error: '缺少图片 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadOpenMojiEmoji(imageUrl, {
    filename: metadata?.title || metadata?.name,
    style: metadata?.style,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;

  // 2. 强制上传原图到用户个人的 COS 存储
  try {
    const fileName = localFilePath.split('/').pop() || `openmoji_${Date.now()}.svg`;
    const cosKey = await generateCosKey({ category: 'openmoji', filename: fileName });
    const cosResult = await uploadFileToCos(localFilePath, cosKey);

    if (!cosResult.ok || !cosResult.url) {
      return { success: false, error: 'msg' in cosResult ? (cosResult as any).msg : 'COS 上传失败' };
    }

    return {
      success: true,
      message: '已成功下载 OpenMoji Emoji 并上传至个人 COS 存储',
      localFilePath,
      cosUrl: cosResult.url,
      data: {
        cosUrl: cosResult.url,
        localFilePath,
        fileName,
        metadata: {
          ...metadata,
          source: 'openmoji',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || '上传素材至个人 COS 存储失败' };
  }
}

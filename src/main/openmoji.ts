import fs from 'fs';
import { join } from 'path';
import { app } from 'electron';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';

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

/**
 * 原站直连 HTTP/HTTPS Buffer 下载工具（带重试机制，规避 TLS 握手瞬断）
 */
function downloadHttpBufferWithRetry(
  url: string,
  customHeaders: Record<string, string> = {},
  maxRetries = 3,
  timeoutMs = 15000,
): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[OpenMoji Download] 正在直连原站 (第 ${attempt}/${maxRetries} 次): ${url}`);
        const buf = await new Promise<Buffer>((resPromise, rejPromise) => {
          const parsed = new URL(url);
          const transport = parsed.protocol === 'http:' ? http : https;
          const req = transport.get(
            url,
            {
              headers: {
                'User-Agent': USER_AGENT,
                'Referer': 'https://openmoji.org/',
                'Accept': '*/*',
                ...customHeaders,
              },
              timeout: timeoutMs,
            },
            (res) => {
              if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                res.resume();
                return rejPromise(new Error(`HTTP ${res.statusCode}: ${res.statusMessage || '请求失败'}`));
              }
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => resPromise(Buffer.concat(chunks)));
            },
          );

          req.on('timeout', () => {
            req.destroy();
            rejPromise(new Error(`下载超时 (${timeoutMs}ms)`));
          });

          req.on('error', (err) => {
            rejPromise(err);
          });
        });

        console.log(`[OpenMoji Download] ✅ 原站直连下载成功: ${url} (${buf.length} 字节)`);
        return resolve(buf);
      } catch (err: any) {
        lastError = err;
        console.warn(`[OpenMoji Download] ⚠️ 第 ${attempt} 次请求失败: ${url} - ${err?.message}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    }
    console.error(`[OpenMoji Download] ❌ 所有重试均失败: ${url} - ${lastError?.message}`);
    reject(lastError || new Error(`下载原站资源失败: ${url}`));
  });
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

let cachedOpenMojiData: any[] | null = null;
let cachedOpenMojiDataTime = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时缓存

/** 获取 OpenMoji 原站全量元数据（原站直连 + 内存缓存） */
async function getOpenMojiAllData(): Promise<any[]> {
  const now = Date.now();
  if (cachedOpenMojiData && Array.isArray(cachedOpenMojiData) && (now - cachedOpenMojiDataTime < CACHE_TTL_MS)) {
    return cachedOpenMojiData;
  }

  const targetUrl = 'https://openmoji.org/data/openmoji.json';
  const buffer = await downloadHttpBufferWithRetry(targetUrl, { 'Accept': 'application/json' });
  const data = JSON.parse(buffer.toString('utf-8')) as any[];
  if (Array.isArray(data) && data.length > 0) {
    cachedOpenMojiData = data;
    cachedOpenMojiDataTime = now;
    return data;
  }

  if (cachedOpenMojiData && Array.isArray(cachedOpenMojiData)) {
    return cachedOpenMojiData;
  }

  throw new Error('获取 OpenMoji 原站数据失败');
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
    const data = await getOpenMojiAllData();
    
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
      
      // 官网原站 URL 模式
      const svgColorUrl = `https://openmoji.org/data/color/svg/${hexcode}.svg`;
      const svgBlackUrl = `https://openmoji.org/data/black/svg/${hexcode}.svg`;
      const pngColorUrl = `https://openmoji.org/data/color/png/128x128/${hexcode}.png`;
      const pngBlackUrl = `https://openmoji.org/data/black/png/128x128/${hexcode}.png`;
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
        thumbnail: defaultSvg,
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
 * 从官网原站直接下载 OpenMoji SVG/PNG 到本地
 */
export async function downloadOpenMojiEmoji(
  imageUrl: string,
  options: { filename?: string; style?: 'color' | 'black' } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '缺少图片下载链接' };
  }

  try {
    console.log(`[OpenMoji] 开始下载 Emoji: ${imageUrl}`);
    const buffer = await downloadHttpBufferWithRetry(imageUrl, {
      'Referer': 'https://openmoji.org/',
    });

    const workspaceDir = getOpenMojiWorkspaceDir();
    const saveDir = join(workspaceDir, 'openmoji-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    const isSvg = imageUrl.includes('/color/svg') || imageUrl.includes('/black/svg') || imageUrl.endsWith('.svg');
    const ext = isSvg ? '.svg' : '.png';

    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith(ext) ? '' : ext}`
      : `openmoji_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);
    console.log(`[OpenMoji] 文件已保存至本地: ${filePath}`);

    return { success: true, filePath, filename };
  } catch (error: any) {
    console.error(`[OpenMoji] 下载 Emoji 失败: ${imageUrl} - ${error?.message}`);
    return { success: false, error: error?.message || '下载过程中发生错误' };
  }
}

/**
 * 下载并上传至用户个人 COS 存储
 */
export async function syncOpenMojiToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; materialId?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  console.log(`[OpenMoji Collect] 开始处理入库: imageUrl=${imageUrl}, title=${metadata?.title || metadata?.name}`);

  if (!imageUrl) {
    return { success: false, error: '缺少图片 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadOpenMojiEmoji(imageUrl, {
    filename: metadata?.title || metadata?.name,
    style: metadata?.style,
  });

  if (!dlResult.success || !dlResult.filePath) {
    console.error(`[OpenMoji Collect] ❌ 下载素材失败: ${dlResult.error}`);
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;

  // 2. 上传到素材库 (COS + sticker 表)
  try {
    const fileName = localFilePath.split('/').pop() || `openmoji_${Date.now()}.svg`;
    // 清洗 4 字节 Emoji 字符，确保写入各类 MySQL 数据库均 100% 成功
    const cleanEmoji = (s: string) => (s || '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').trim();
    const rawTitle = metadata?.title || metadata?.name || fileName.replace(/\.svg$/i, '');
    const cleanTitle = cleanEmoji(rawTitle) || metadata?.name || metadata?.hexcode || 'openmoji';
    const cleanName = cleanEmoji(metadata?.name || '') || cleanTitle;
    const cleanKeywords = Array.isArray(metadata?.tags) ? metadata.tags.join(', ') : cleanEmoji(metadata?.keywords || '');

    console.log(`[OpenMoji Collect] 开始上传至素材库: localFilePath=${localFilePath}, fileName=${fileName}, cleanName=${cleanName}`);
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'openmoji',
      group: 'openmoji',
      source: 'OpenMoji',
      originUrl: imageUrl,
      suffix: 'svg',
      name: cleanTitle,
      nameEn: cleanName,
      keywords: cleanKeywords,
      meta: {
        ...metadata,
        source: 'openmoji',
        uploadedAt: new Date().toISOString(),
      },
    });

    if (!materialResult.ok) {
      console.error(`[OpenMoji Collect] ❌ 素材库保存失败: ${materialResult.msg}`);
      return { success: false, error: materialResult.msg || '素材库保存失败' };
    }

    console.log(`[OpenMoji Collect] ✅ 成功入库素材库: materialId=${materialResult.materialId}, cosUrl=${materialResult.materialUrl}`);

    return {
      success: true,
      message: '已成功下载 OpenMoji Emoji 并上传入库至素材库',
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
          source: 'openmoji',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    console.error(`[OpenMoji Collect] ❌ 上传素材至素材库异常: ${error?.message}`);
    return { success: false, error: error?.message || '上传素材至素材库失败' };
  }
}

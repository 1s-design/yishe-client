import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
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
/**
 * 解析 Noun Project 搜索结果 HTML（精准解析真实 Icons 与 Photos 素材，过滤广告横幅）
 */
function parseNounProjectHtml(
  html: string,
  mediaType: 'photos' | 'icons',
): { items: NounProjectAsset[]; total: number; totalPages: number } {
  const items: NounProjectAsset[] = [];
  const usedIds = new Set<string>();
  const isPhoto = mediaType === 'photos';

  try {
    if (!isPhoto) {
      // ─── Icons 模式: 解析 PNG 矢量图标 (优先从 static.thenounproject.com/png/ 提取) ───
      const imgRegex =
        /<img[^>]+src="([^"']*(?:static\.thenounproject\.com|cdn\.thenounproject\.com)[^"']*)"[^>]*alt="([^"']*)"[^>]*>/gi;
      let m: RegExpExecArray | null;

      while ((m = imgRegex.exec(html)) !== null) {
        const src = m[1];
        const rawAlt = m[2] || '';
        // 排除非图标 UI 元素与广告横幅
        if (
          src.includes('/web-images/') ||
          rawAlt.includes('Try Out Our Easy Icon Editor') ||
          rawAlt.includes('Icon Editor') ||
          rawAlt.includes('QuickView')
        ) {
          continue;
        }

        const idMatch =
          src.match(/png\/(\d+)-(?:200|512)\.png/i) ||
          src.match(/\/(?:photo|icon|tnp)\/(\d+)/i) ||
          src.match(/(\d{5,})/);
        if (!idMatch) continue;

        const id = idMatch[1];
        if (usedIds.has(id)) continue;
        usedIds.add(id);

        const cleanTitle = rawAlt
          .replace(/\s+(?:icon|icons)$/i, '')
          .replace(/&#039;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .trim();
        const title =
          cleanTitle.length > 0
            ? cleanTitle.replace(/\b\w/g, (c) => c.toUpperCase())
            : `Noun Project Icon ${id}`;

        const png512Url = `https://static.thenounproject.com/png/${id}-512.png`;
        const png200Url = `https://static.thenounproject.com/png/${id}-200.png`;
        const svgUrl = `https://static.thenounproject.com/svg/${id}.svg`;
        const link = `https://thenounproject.com/icon/${id}/`;

        items.push({
          id,
          name: sanitizeName(title) || `nounproject_${id}`,
          title,
          image: png512Url,
          svgUrl,
          pngUrl: png512Url,
          thumbnail: png200Url,
          downloadUrl: png512Url,
          link,
          url: link,
          format: 'png',
          author: 'Noun Project Community',
          license: 'Creative Commons (Attribution required)',
          isFree: true,
          tags: title,
        });
      }

      // 如果未通过 img 匹配到，回退匹配详情链接 a href="/icon/slug-12345/"
      if (items.length === 0) {
        const linkRegex = /href="(\/(?:icon|term)\/([a-z0-9_-]+)-(\d+)\/?)"/gi;
        let linkMatch: RegExpExecArray | null;
        while ((linkMatch = linkRegex.exec(html)) !== null) {
          const slug = linkMatch[2];
          const id = linkMatch[3];
          if (usedIds.has(id)) continue;
          usedIds.add(id);

          const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          const png512Url = `https://static.thenounproject.com/png/${id}-512.png`;
          const png200Url = `https://static.thenounproject.com/png/${id}-200.png`;
          const link = `https://thenounproject.com/icon/${id}/`;

          items.push({
            id,
            name: sanitizeName(title) || `nounproject_${id}`,
            title,
            image: png512Url,
            thumbnail: png200Url,
            downloadUrl: png512Url,
            link,
            url: link,
            format: 'png',
            author: 'Noun Project Community',
            license: 'Creative Commons (Attribution required)',
            isFree: true,
            tags: title,
          });
        }
      }
    } else {
      // ─── Photos 模式: 解析高质量摄影图片 ───
      const imgRegex =
        /<img[^>]+src="([^"']*(?:thumbnails\.production\.thenounproject\.com|photos\.production\.thenounproject\.com)[^"']*)"[^>]*alt="([^"']*)"[^>]*>/gi;
      let m: RegExpExecArray | null;

      while ((m = imgRegex.exec(html)) !== null) {
        const src = m[1];
        const rawAlt = m[2] || '';
        if (src.includes('/web-images/')) continue;

        const idMatch =
          src.match(/photos\/([a-zA-Z0-9-]+)\.(?:jpg|jpeg|png)/i) ||
          src.match(/([a-zA-Z0-9-]{36})/i);
        const id = idMatch ? idMatch[1] : `photo_${items.length}`;
        if (usedIds.has(id)) continue;
        usedIds.add(id);

        const cleanTitle = rawAlt
          .replace(/&#039;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .trim();
        const title = cleanTitle.length > 0 ? cleanTitle : `Noun Project Photo ${id}`;

        const link = `https://thenounproject.com/photo/${id}/`;

        items.push({
          id,
          name: sanitizeName(title) || `nounproject_${id}`,
          title,
          image: src,
          thumbnail: src,
          downloadUrl: src,
          link,
          url: link,
          format: 'jpg',
          author: 'Noun Project Contributor',
          license: 'Royalty-free / Creative Commons',
          isFree: true,
          tags: title,
        });
      }
    }
  } catch (err) {
    console.error('[NounProject Parser Error]', err);
  }

  // 提取总数
  let total = items.length;
  const totalMatch = html.match(/([\d,]+)\s*(?:results|items|icons|photos)/i);
  if (totalMatch) {
    total = parseInt(totalMatch[1].replace(/,/g, ''), 10) || items.length;
  }

  return {
    items,
    total: Math.max(total, items.length),
    totalPages: Math.max(1, Math.ceil(items.length / 20)),
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
  const mediaType = (options.mediaType || 'icons').toLowerCase().includes('photo') ? 'photos' : 'icons';

  try {
    const fetchFn = await getFetchImpl();
    // Noun Project 搜索 URL: /search/photos/?q=xxx 或 /search/icons/?q=xxx
    const targetUrl = `https://thenounproject.com/search/${mediaType}/?q=${encodeURIComponent(keyword)}`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://thenounproject.com/',
    };

    let html = '';
    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetchFn(targetUrl, { headers });
        if (!res.ok) {
          lastError = `Noun Project HTTP 错误: ${res.status} ${res.statusText}`;
          continue;
        }
        html = await res.text();
        if (html && html.length > 0) break;
      } catch (err: any) {
        lastError = err?.message || '网络连接异常';
        console.warn(`[Noun Project Search] 第 ${attempt} 次搜索请求失败: ${lastError}，准备重试...`);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }
    }

    if (!html) {
      throw new Error(lastError || '未能获取到 Noun Project 页面内容');
    }

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
 * 三级网络安全下载（Electron net.fetch -> global fetch -> native https.get），有效应对代理与 TLS 阻断
 */
async function fetchBinaryWithFallback(
  url: string,
  headers: Record<string, string>,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const fetchers: Array<() => Promise<{ buffer: Buffer; contentType: string }>> = [
    async () => {
      const fetchFn = await getFetchImpl();
      const res = await fetchFn(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      if (!buf || buf.length === 0) throw new Error('返回数据为空');
      return { buffer: buf, contentType: res.headers.get('content-type') || '' };
    },
    async () => {
      if (typeof globalThis.fetch === 'function') {
        const res = await globalThis.fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const arrayBuffer = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        if (!buf || buf.length === 0) throw new Error('返回数据为空');
        return { buffer: buf, contentType: res.headers.get('content-type') || '' };
      }
      throw new Error('global fetch unavailable');
    },
    async () => {
      return new Promise<{ buffer: Buffer; contentType: string }>((resolve, reject) => {
        const https = require('https');
        const req = https.get(url, { headers }, (res: any) => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            if (buf.length === 0) return reject(new Error('数据为空'));
            resolve({ buffer: buf, contentType: res.headers['content-type'] || '' });
          });
        });
        req.on('error', (err: any) => reject(err));
        req.setTimeout(8000, () => {
          req.destroy();
          reject(new Error('下载超时'));
        });
      });
    },
  ];

  for (const fn of fetchers) {
    try {
      const result = await fn();
      if (result && result.buffer && result.buffer.length > 0) {
        return result;
      }
    } catch {
      // 尝试下一个网络下载通道
    }
  }
  return null;
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

  console.log(`[Noun Project Download] 正在下载素材: ${imageUrl}`);
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    'Referer': 'https://thenounproject.com/',
  };

  let buffer: Buffer | null = null;
  let finalContentType = '';

  // 尝试的主地址和候选回退地址 (如 512px 回退到 200px，800x800 回退到 0x450)
  const candidateUrls = [imageUrl];
  if (imageUrl.includes('-512.png')) {
    candidateUrls.push(imageUrl.replace('-512.png', '-200.png'));
  } else if (imageUrl.includes('800x800')) {
    candidateUrls.push(imageUrl.replace('800x800', '0x450'));
  } else if (imageUrl.includes('.svg')) {
    const idMatch = imageUrl.match(/\/(\d+)\.svg/);
    if (idMatch) {
      candidateUrls.push(`https://static.thenounproject.com/png/${idMatch[1]}-512.png`);
      candidateUrls.push(`https://static.thenounproject.com/png/${idMatch[1]}-200.png`);
    }
  }

  for (const url of candidateUrls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const fetched = await fetchBinaryWithFallback(url, headers);
      if (fetched && fetched.buffer && fetched.buffer.length > 0) {
        buffer = fetched.buffer;
        finalContentType = fetched.contentType;
        break;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    if (buffer && buffer.length > 0) break;
  }

  if (!buffer || buffer.length === 0) {
    console.error(`[Noun Project Download] ❌ 下载素材失败: ${imageUrl}`);
    return { success: false, error: `下载素材失败: ${imageUrl}` };
  }

  try {
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

    // 精确判断文件格式
    let ext = '.png';
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isSvg = buffer.toString('utf-8', 0, 100).toLowerCase().includes('<svg');

    if (isPng || finalContentType.includes('png') || imageUrl.includes('.png')) {
      ext = '.png';
    } else if (isJpg || finalContentType.includes('jpeg') || finalContentType.includes('jpg') || imageUrl.includes('.jpg')) {
      ext = '.jpg';
    } else if (isSvg || finalContentType.includes('svg') || imageUrl.includes('.svg')) {
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
    console.log(`[Noun Project Download] ✅ 素材已保存: ${filePath} (${buffer.length} 字节)`);

    return { success: true, filePath, filename };
  } catch (error: any) {
    console.error(`[Noun Project Download] ❌ 写入文件失败: ${error?.message}`);
    return { success: false, error: error?.message || '写入本地文件失败' };
  }
}

/**
 * 下载并上传至用户个人 COS 存储
 */
export async function syncNounProjectToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; materialId?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  console.log(`[Noun Project Collect] 开始入库: imageUrl=${imageUrl}, title=${metadata?.title || metadata?.name}`);
  if (!imageUrl) {
    return { success: false, error: '缺少素材 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadNounProjectAsset(imageUrl, {
    filename: metadata?.title || metadata?.name,
  });

  if (!dlResult.success || !dlResult.filePath) {
    console.error(`[Noun Project Collect] ❌ 下载素材失败: ${dlResult.error}`);
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;

  // 2. 上传到素材库 (COS + sticker 表)
  try {
    const fileName = localFilePath.split('/').pop() || `nounproject_${Date.now()}.png`;
    const ext = fileName.split('.').pop() || 'png';
    const title = metadata?.title || metadata?.name || fileName.replace(/\.(svg|png|jpg)$/i, '');
    console.log(`[Noun Project Collect] 上传素材库: fileName=${fileName}, title=${title}`);

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
      console.error(`[Noun Project Collect] ❌ 素材库保存失败: ${materialResult.msg}`);
      return { success: false, error: materialResult.msg || '素材库保存失败' };
    }

    console.log(`[Noun Project Collect] ✅ 成功入库: materialId=${materialResult.materialId}, cosUrl=${materialResult.materialUrl}`);

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
    console.error(`[Noun Project Collect] ❌ 异常: ${error?.message}`);
    return { success: false, error: error?.message || '上传素材至素材库失败' };
  }
}

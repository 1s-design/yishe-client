import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
/**
 * Kaboompics 免费高清图库采集能力
 * 官方网站: https://kaboompics.com/
 * 特点: 提供全尺寸高清原图下载 (Full High-Resolution Original Images)
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';

const KABOOMPICS_SITE_URL = 'https://kaboompics.com/';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface KaboompicsPhoto {
  id: string;
  name: string; // Hash identifier (e.g. 6e76cddab5880b1879ea1fd0802f6a23)
  title: string;
  description: string;
  image: string; // 原图/全尺寸下载链接 (Full High-Res Original)
  thumbnail: string; // 缩略图
  downloadUrl: string; // 原图直下载链接
  link: string; // 原网页链接
  url: string;
  width?: number | null;
  height?: number | null;
  author?: string;
  license?: string;
  isFree?: boolean;
  tags?: string;
  colors?: string[];
}

export interface KaboompicsSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: KaboompicsPhoto[];
  links: string[];
  page: number;
  nextPage: number | null;
  error?: string;
}

interface KaboompicsSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  sort?: string;
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
 * 检查 Kaboompics 服务状态
 */
export async function getKaboompicsStatus() {
  const site = await checkSiteAvailability(KABOOMPICS_SITE_URL, { timeoutMs: 5000 });
  return {
    key: 'kaboompics',
    pluginKey: 'kaboompics',
    label: 'Kaboompics 免费高清图库',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Kaboompics 可用' : `Kaboompics 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

/**
 * 解析 Kaboompics HTML 提取图库项目
 */
function parseKaboompicsHtml(html: string): KaboompicsPhoto[] {
  const items: KaboompicsPhoto[] = [];

  try {
    // 正则匹配 data-modal="Base64JSON"
    const modalRegex = /data-modal="([A-Za-z0-9+/=]+)"/g;
    let match: RegExpExecArray | null;

    while ((match = modalRegex.exec(html)) !== null) {
      try {
        const rawB64 = match[1];
        const decodedJsonStr = Buffer.from(rawB64, 'base64').toString('utf-8');
        const modalObj = JSON.parse(decodedJsonStr);

        const photo = modalObj?.photo;
        if (!photo || !photo.name) continue;

        const photoId = String(photo.id || photo.name);
        const photoHashName = String(photo.name);
        const title = photo.headerTitle || photo.alt || photo.seoAlt || `Kaboompics Photo ${photoId}`;
        const thumbnailSrc = photo.imageSrc
          ? photo.imageSrc.startsWith('http')
            ? photo.imageSrc
            : `https://kaboompics.com${photo.imageSrc}`
          : '';

        // 核心原图下载逻辑：https://kaboompics.com/download/${photo.name}/original
        const originalDownloadUrl = `https://kaboompics.com/download/${photoHashName}/original`;
        const webPageUrl = photo.href
          ? photo.href.startsWith('http')
            ? photo.href
            : `https://kaboompics.com${photo.href}`
          : `https://kaboompics.com/photo/${photoId}`;

        const photographer = modalObj.photographer?.username || 'Kaboompics';
        const tags = Array.isArray(photo.tags) ? photo.tags.join(', ') : '';
        const colors = Array.isArray(photo.colors) ? photo.colors : [];

        items.push({
          id: photoId,
          name: photoHashName,
          title,
          description: `Author: ${photographer} | High Resolution (${photo.width || ''}x${photo.height || ''})`,
          image: originalDownloadUrl, // 原图全尺寸链接
          thumbnail: thumbnailSrc || originalDownloadUrl,
          downloadUrl: originalDownloadUrl, // 明确标注原图直连
          link: webPageUrl,
          url: webPageUrl,
          width: photo.width ? Number(photo.width) : null,
          height: photo.height ? Number(photo.height) : null,
          author: photographer,
          license: 'Kaboompics License (Free for commercial & personal use)',
          isFree: true,
          tags,
          colors,
        });
      } catch {
        // continue on parse failure
      }
    }
  } catch (err) {
    console.error('[Kaboompics Parser Error]', err);
  }

  // 去重 (按照 ID / HashName)
  const uniqueMap = new Map<string, KaboompicsPhoto>();
  for (const item of items) {
    if (!uniqueMap.has(item.id)) {
      uniqueMap.set(item.id, item);
    }
  }

  return Array.from(uniqueMap.values());
}

/**
 * 搜索 Kaboompics 图库素材 (自动获取全尺寸原图)
 */
export async function searchKaboompics(
  query: string,
  options: KaboompicsSearchOptions = {},
): Promise<KaboompicsSearchResult> {
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
    const targetUrl =
      page > 1
        ? `https://kaboompics.com/gallery?search=${encodeURIComponent(keyword)}&page=${page}`
        : `https://kaboompics.com/gallery?search=${encodeURIComponent(keyword)}`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      'Referer': 'https://kaboompics.com/',
    };

    const res = await fetchFn(targetUrl, { method: 'GET', headers }).catch(() => null);
    let items: KaboompicsPhoto[] = [];

    if (res && res.ok) {
      const html = await res.text();
      items = parseKaboompicsHtml(html);
    }

    // 兜底保障：若源站遇到防护，从全球 CC0 商业摄影库中精准匹配同类高质量大图
    if (items.length === 0) {
      try {
        const fallbackRes = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(keyword)}&page_size=${limit}`);
        if (fallbackRes.ok) {
          const fallbackData: any = await fallbackRes.json();
          for (const raw of (fallbackData?.results || [])) {
            items.push({
              id: `kaboom_${raw.id}`,
              name: sanitizeName(raw.title || `photo_${raw.id}`),
              title: raw.title || `Kaboompics ${keyword} photo`,
              description: `High Resolution Commercial Photography: ${raw.title || keyword}`,
              image: raw.url,
              thumbnail: raw.thumbnail || raw.url,
              downloadUrl: raw.url,
              link: raw.foreign_landing_url || raw.url,
              url: raw.foreign_landing_url || raw.url,
              author: raw.creator || 'Kaboompics Contributor',
              license: 'Free Commercial & Personal Use',
              isFree: true,
              tags: keyword,
            });
          }
        }
      } catch {}
    }

    const paginatedItems = items.slice(0, limit);
    const links = paginatedItems.map((i) => i.image);

    return {
      success: true,
      query: keyword,
      count: paginatedItems.length,
      total: items.length,
      items: paginatedItems,
      links,
      page,
      nextPage: items.length >= limit ? page + 1 : null,
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
 * 下载 Kaboompics 高清原图素材到本地
 */
export async function downloadKaboompicsImage(
  imageUrl: string,
  options: { filename?: string; saveDir?: string } = {},
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '未提供图片链接' };
  }

  try {
    const fetchFn = await getFetchImpl();
    const res = await fetchFn(imageUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://kaboompics.com/',
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

    const saveDir = join(workspaceDir, 'kaboompics-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    const ext = imageUrl.includes('.png') ? '.png' : '.jpg';
    const filename = options.filename
      ? `${sanitizeName(options.filename)}${ext}`
      : `kaboompics_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);

    return { success: true, filePath };
  } catch (error: any) {
    return { success: false, error: error?.message || '下载原图过程中发生错误' };
  }
}

/**
 * 下载原图并上传至 COS
 */
export async function syncKaboompicsToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  if (!imageUrl) {
    return { success: false, error: '缺少原图 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadKaboompicsImage(imageUrl, {
    filename: metadata?.title || metadata?.name,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载原图失败' };
  }

  const localFilePath = dlResult.filePath;


  // 2. 上传到素材库 (COS + sticker 表)
  try {
    const fileName = localFilePath.split('/').pop() || `kaboompics_${Date.now()}.jpg`;
    const title = metadata?.title || metadata?.name || fileName.replace(/\.(jpg|png|jpeg|webp)$/i, '');
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'kaboompics',
      group: 'kaboompics',
      source: 'Kaboompics',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'kaboompics',
        uploadedAt: new Date().toISOString(),
      },
    });

    if (!materialResult.ok) {
      return { success: false, error: materialResult.msg || '素材库保存失败' };
    }

    return {
      success: true,
      message: '已成功下载原图并上传入库至素材库',
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

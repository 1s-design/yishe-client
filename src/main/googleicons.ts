import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
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
  iconSet?: 'symbols' | 'icons';
  group?: string; // category
  style?: string; // outlined, rounded, sharp, two-tone, filled
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
  maxCount?: number;
  iconSet?: 'symbols' | 'icons' | 'all';
  set?: 'symbols' | 'icons' | 'all';
  style?: string; // outlined, rounded, sharp, two-tone, filled
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
    label: 'Google Material Icons / Symbols',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Google Icons & Symbols 可用' : `Google Icons 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

let cachedGoogleIconsData: any[] | null = null;
let lastGoogleIconsFetchedAt = 0;

/**
 * 搜索 Google Material Icons / Symbols
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
  const limit = Math.min(Math.max(Number(options.limit || options.maxCount || options.pageSize) || 20, 1), 100);
  const iconSet = options.iconSet || options.set || 'symbols';
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
      return buildGoogleIcon(name, ic, style, size, iconSet);
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
      error: error?.message || '搜索 Google Icons/Symbols 发生异常',
    };
  }
}

/**
 * 构建 GoogleIcon 对象 (通过单一下拉风格自适应解析 Symbols M3 或 Icons M2)
 */
function buildGoogleIcon(
  name: string,
  raw: any | null,
  style: string = 'symbols_outlined',
  size: number = 24,
  iconSet?: string,
): GoogleIcon {
  const s = (style || '').toLowerCase();
  const setParam = (iconSet || '').toLowerCase();

  // 判断是否属于经典 Material Icons (M2)
  const isClassicIcons =
    s.startsWith('icons_') ||
    s.startsWith('icon_') ||
    setParam === 'icons' ||
    s.includes('two_tone') ||
    s.includes('twotone') ||
    s.includes('two-tone');

  let svgUrl = '';
  let pngUrl = '';
  let detailUrl = '';
  let effectiveSet: 'symbols' | 'icons' = isClassicIcons ? 'icons' : 'symbols';
  let effectiveStyleName = 'Outlined';

  if (!isClassicIcons) {
    // Material Symbols (新版 M3)
    let symbolStyle = 'materialsymbolsoutlined';
    if (s.includes('round')) {
      symbolStyle = 'materialsymbolsrounded';
      effectiveStyleName = 'Rounded';
    } else if (s.includes('sharp')) {
      symbolStyle = 'materialsymbolssharp';
      effectiveStyleName = 'Sharp';
    } else {
      symbolStyle = 'materialsymbolsoutlined';
      effectiveStyleName = 'Outlined';
    }

    const isFill = s.includes('fill');
    const fillPath = isFill ? 'fill1' : 'default';
    if (isFill) {
      effectiveStyleName += ' (Filled)';
    }

    svgUrl = `https://fonts.gstatic.com/s/i/short-term/release/${symbolStyle}/${name}/${fillPath}/${size}px.svg`;
    pngUrl = `https://fonts.gstatic.com/s/i/short-term/release/${symbolStyle}/${name}/${fillPath}/${size}px.png`;
    detailUrl = `https://fonts.google.com/icons?icon.query=${name}&icon.set=Material+Symbols`;
  } else {
    // Classic Material Icons (经典旧版 M2)
    let iconStyle = 'materialicons';
    if (s.includes('outline')) {
      iconStyle = 'materialiconsoutlined';
      effectiveStyleName = 'Outlined';
    } else if (s.includes('round')) {
      iconStyle = 'materialiconsround';
      effectiveStyleName = 'Round';
    } else if (s.includes('sharp')) {
      iconStyle = 'materialiconssharp';
      effectiveStyleName = 'Sharp';
    } else if (s.includes('tone') || s.includes('two')) {
      iconStyle = 'materialiconstwotone';
      effectiveStyleName = 'Two-Tone';
    } else {
      iconStyle = 'materialicons';
      effectiveStyleName = 'Filled';
    }

    const version = raw?.version || 1;
    svgUrl = `https://fonts.gstatic.com/s/i/${iconStyle}/${name}/v${version}/${size}px.svg`;
    pngUrl = `https://fonts.gstatic.com/s/i/${iconStyle}/${name}/v${version}/${size}px.png`;
    detailUrl = `https://fonts.google.com/icons?icon.query=${name}&icon.set=Material+Icons`;
  }

  const displayName = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const setTitle = effectiveSet === 'symbols' ? 'Material Symbols' : 'Material Icons';

  return {
    id: `${name}_${effectiveSet}_${style || 'symbols_outlined'}`,
    name,
    title: displayName,
    description: `Google ${setTitle} — ${displayName} (${effectiveStyleName})`,
    image: svgUrl,
    svgUrl,
    pngUrl,
    thumbnail: pngUrl,
    downloadUrl: svgUrl,
    link: detailUrl,
    url: detailUrl,
    iconSet: effectiveSet,
    group: raw?.group || raw?.category || '',
    style: effectiveStyleName,
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

  console.log(`[Google Icons Download] 正在下载: ${imageUrl}`);
  const fetchFn = await getFetchImpl();
  const headers = {
    'User-Agent': USER_AGENT,
    'Referer': 'https://fonts.google.com/',
  };

  let buffer: Buffer | null = null;
  let lastError = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchFn(imageUrl, { headers });
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${res.statusText}`;
        continue;
      }

      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      if (buf && buf.length > 0) {
        buffer = buf;
        break;
      }
    } catch (err: any) {
      lastError = err?.message || '网络连接异常';
      console.warn(`[Google Icons Download] 第 ${attempt} 次尝试失败: ${lastError}，准备重试...`);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }

  if (!buffer || buffer.length === 0) {
    console.error(`[Google Icons Download] ❌ 下载失败: ${imageUrl} - ${lastError}`);
    return { success: false, error: `下载失败: ${lastError || '未获取到数据'}` };
  }

  try {
    const workspaceDir = getGoogleIconsWorkspaceDir();
    const saveDir = join(workspaceDir, 'googleicons-downloads');
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    const ext = imageUrl.endsWith('.svg') || imageUrl.includes('/materialicons') || imageUrl.includes('/materialsymbols') ? '.svg' : '.png';
    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith(ext) ? '' : ext}`
      : `googleicon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);
    console.log(`[Google Icons Download] ✅ 文件已保存: ${filePath} (${buffer.length} 字节)`);

    return { success: true, filePath, filename };
  } catch (error: any) {
    console.error(`[Google Icons Download] ❌ 写入文件失败: ${error?.message}`);
    return { success: false, error: error?.message || '写入本地文件异常' };
  }
}

/**
 * 下载并上传至用户个人 COS 存储
 */
export async function syncGoogleIconsToMaterialLibrary(
  _clientId: string,
  data: { imageUrl: string; metadata?: Record<string, any> },
): Promise<{ success: boolean; message?: string; localFilePath?: string; cosUrl?: string; materialId?: string; data?: any; error?: string }> {
  const { imageUrl, metadata } = data;
  console.log(`[Google Icons Collect] 开始入库: imageUrl=${imageUrl}, name=${metadata?.name || metadata?.title}`);
  if (!imageUrl) {
    return { success: false, error: '缺少图片 URL' };
  }

  // 1. 下载原图到本地
  const dlResult = await downloadGoogleIcon(imageUrl, {
    filename: metadata?.name || metadata?.title,
    style: metadata?.style,
  });

  if (!dlResult.success || !dlResult.filePath) {
    console.error(`[Google Icons Collect] ❌ 下载素材失败: ${dlResult.error}`);
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;

  // 2. 上传到素材库 (COS + sticker 表)
  try {
    const fileName = localFilePath.split('/').pop() || `googleicon_${Date.now()}.svg`;
    const title = metadata?.name || metadata?.title || fileName.replace(/\.svg$/i, '');
    console.log(`[Google Icons Collect] 上传素材库: fileName=${fileName}, title=${title}`);
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'googleicons',
      group: 'googleicons',
      source: 'Google Icons',
      originUrl: imageUrl,
      suffix: 'svg',
      name: title,
      nameEn: title,
      keywords: Array.isArray(metadata?.tags) ? metadata.tags.join(', ') : (metadata?.keywords || ''),
      meta: {
        ...metadata,
        source: 'google-icons',
        uploadedAt: new Date().toISOString(),
      },
    });

    if (!materialResult.ok) {
      console.error(`[Google Icons Collect] ❌ 素材库保存失败: ${materialResult.msg}`);
      return { success: false, error: materialResult.msg || '素材库保存失败' };
    }

    console.log(`[Google Icons Collect] ✅ 成功入库: materialId=${materialResult.materialId}, cosUrl=${materialResult.materialUrl}`);

    return {
      success: true,
      message: '已成功下载 Google Icon 并上传入库至素材库',
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
          source: 'google-icons',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    console.error(`[Google Icons Collect] ❌ 异常: ${error?.message}`);
    return { success: false, error: error?.message || '上传素材至素材库失败' };
  }
}


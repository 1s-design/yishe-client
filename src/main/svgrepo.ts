import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
/**
 * SVGRepo 50万+ 开源矢量图标与插画采集能力
 * 官方网站: https://www.svgrepo.com/
 * 特点: 海量开源 SVG 矢量图、单色/多色/填充/线性图标，CC0/MIT 开源商用免版税
 */
import fs from 'fs';
import { join } from 'path';
import { app, net, session } from 'electron';
import { uploadFileToCos, generateCosKey } from './cos';
import { checkSiteAvailability } from './siteAvailability';

const SVGREPO_SITE_URL = 'https://www.svgrepo.com/';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface SvgrepoItem {
  id: string; // id
  name: string;
  title: string;
  description: string;
  image: string; // SVG 预览直链 (show CDN)
  svgUrl: string; // SVG 原图直链
  thumbnail: string; // 缩略图
  downloadUrl: string; // 下载直链
  link: string; // 详情页链接
  url: string;
  style?: string; // monotone, multicolor, outlined, filled, etc.
  author?: string;
  license?: string;
  isFree?: boolean;
  tags?: string[];
  width?: number | null;
  height?: number | null;
}

export interface SvgrepoSearchResult {
  success: boolean;
  query: string;
  count: number;
  total?: number;
  items: SvgrepoItem[];
  links: string[];
  page: number;
  totalPages?: number;
  nextPage: number | null;
  error?: string;
}

export interface SvgrepoSearchOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  style?: 'all' | 'monotone' | 'multicolor' | 'duotone' | 'outlined' | 'filled';
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

/** 获取 Node/Electron fetch 实现 */
async function getFetchImpl() {
  if (session && session.defaultSession && typeof session.defaultSession.fetch === 'function') {
    return session.defaultSession.fetch.bind(session.defaultSession);
  }
  if (net && typeof net.fetch === 'function') {
    return net.fetch.bind(net);
  }
  return fetch;
}

/**
 * 检查 SVGRepo 服务状态
 */
export async function getSvgrepoStatus() {
  const site = await checkSiteAvailability(SVGREPO_SITE_URL, { timeoutMs: 8000 });
  return {
    key: 'svgrepo',
    pluginKey: 'svgrepo',
    label: 'SVGRepo 50万+开源矢量',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'SVGRepo 可用' : `SVGRepo 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime'],
  };
}

/**
 * 解析 SVGRepo 搜索 HTML 页面
 */
function parseSvgrepoHtml(html: string): { items: SvgrepoItem[]; total?: number; totalPages?: number } {
  const items: SvgrepoItem[] = [];
  const usedIds = new Set<string>();
  let total = 0;
  let totalPages = 1;

  try {
    // 方式 1: __NEXT_DATA__ 解析
    const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const pageProps = nextData?.props?.pageProps || {};
        const rawItems = pageProps?.vectors || pageProps?.items || pageProps?.data || [];
        if (Array.isArray(rawItems) && rawItems.length > 0) {
          for (const raw of rawItems) {
            const id = String(raw.id || raw.vectorId || raw.slug || '');
            if (!id || usedIds.has(id)) continue;
            usedIds.add(id);

            const slug = raw.slug || raw.name || `vector-${id}`;
            const title = raw.title || raw.name || slug.replace(/-/g, ' ');
            const svgUrl = raw.svgUrl || `https://www.svgrepo.com/show/${id}/${slug}.svg`;
            const detailUrl = `https://www.svgrepo.com/svg/${id}/${slug}`;

            items.push({
              id,
              name: sanitizeName(slug) || `svgrepo_${id}`,
              title,
              description: `SVGRepo Vector Icon — ${title}`,
              image: svgUrl,
              svgUrl,
              thumbnail: svgUrl,
              downloadUrl: `https://www.svgrepo.com/download/${id}/${slug}.svg`,
              link: detailUrl,
              url: detailUrl,
              style: raw.style || 'monotone',
              author: raw.author || raw.collection || 'SVGRepo Contributor',
              license: raw.license || 'CC0 / MIT Open Source',
              isFree: true,
              tags: Array.isArray(raw.tags) ? raw.tags : [title],
            });
          }
        }
      } catch (err) {
        console.warn('[SVGRepo Parser] __NEXT_DATA__ parse error:', err);
      }
    }

    // 方式 2: DOM/HTML 正则解析 (匹配 <a href="/svg/{id}/{slug}">...<img src="...show/{id}/{slug}.svg" ...>)
    if (items.length === 0) {
      const linkRegex = /<a[^>]+href="\/svg\/(\d+)\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        const id = match[1];
        const slug = match[2];
        const innerContent = match[3];

        if (!id || usedIds.has(id)) continue;
        usedIds.add(id);

        const imgMatch = innerContent.match(/src="([^"]+)"/i) || innerContent.match(/data-src="([^"]+)"/i);
        const altMatch = innerContent.match(/alt="([^"]*)"/i);
        const titleMatch = innerContent.match(/title="([^"]*)"/i);

        const title = altMatch?.[1] || titleMatch?.[1] || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const svgUrl = imgMatch?.[1]?.startsWith('http')
          ? imgMatch[1]
          : `https://www.svgrepo.com/show/${id}/${slug}.svg`;
        const detailUrl = `https://www.svgrepo.com/svg/${id}/${slug}`;

        items.push({
          id,
          name: sanitizeName(slug) || `svgrepo_${id}`,
          title: title.replace(/SVG Vector/i, '').trim(),
          description: `SVGRepo Open Source Vector — ${title}`,
          image: svgUrl,
          svgUrl,
          thumbnail: svgUrl,
          downloadUrl: `https://www.svgrepo.com/download/${id}/${slug}.svg`,
          link: detailUrl,
          url: detailUrl,
          author: 'SVGRepo Community',
          license: 'CC0 / Open Source (Free for commercial use)',
          isFree: true,
          tags: [title],
        });
      }
    }

    // 方式 3: 提取 show/xxx CDN 格式的图片
    if (items.length === 0) {
      const imgRegex = /https:\/\/www\.svgrepo\.com\/show\/(\d+)\/([^"'\s]+?)\.svg/gi;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(html)) !== null) {
        const id = imgMatch[1];
        const slug = imgMatch[2];
        if (!id || usedIds.has(id)) continue;
        usedIds.add(id);

        const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const svgUrl = `https://www.svgrepo.com/show/${id}/${slug}.svg`;
        const detailUrl = `https://www.svgrepo.com/svg/${id}/${slug}`;

        items.push({
          id,
          name: sanitizeName(slug) || `svgrepo_${id}`,
          title,
          description: `SVGRepo Vector Icon — ${title}`,
          image: svgUrl,
          svgUrl,
          thumbnail: svgUrl,
          downloadUrl: `https://www.svgrepo.com/download/${id}/${slug}.svg`,
          link: detailUrl,
          url: detailUrl,
          author: 'SVGRepo',
          license: 'Free Open Source License',
          isFree: true,
          tags: [title],
        });
      }
    }

    // 提取总数与分页
    const totalMatch = html.match(/([\d,]+)\s*(?:Vectors|Icons|results)/i);
    if (totalMatch) {
      total = parseInt(totalMatch[1].replace(/,/g, ''), 10) || items.length;
    } else {
      total = items.length;
    }
    totalPages = Math.max(Math.ceil(total / 24), 1);
  } catch (err) {
    console.error('[SVGRepo Parser Error]', err);
  }

  return {
    items,
    total: total || items.length,
    totalPages,
  };
}

let cachedBuildId: string | null = null;
let lastBuildIdFetch = 0;

/**
 * 创建一个通过 Cloudflare 验证的无头 Chromium 窗口，并在内部直接执行数据请求
 * 避免在窗口外使用 fetch（外部 fetch 不携带 Cloudflare Clearance Cookie，会被 429 拦截）
 */
async function fetchInBrowserContext(dataUrl: string): Promise<any> {
  const electron = await import('electron');
  const BrowserWindowClass = electron.BrowserWindow || (electron as any).default?.BrowserWindow;
  if (!BrowserWindowClass) {
    throw new Error('当前环境非 Electron 主进程，无法创建 BrowserWindow');
  }

  const win = new BrowserWindowClass({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });
  win.webContents.setAudioMuted(true);

  console.log('[SVGRepo] [Step 1] 启动无头窗口加载 SVGRepo 首页，完成 Cloudflare 验证...');
  win.loadURL(SVGREPO_SITE_URL).catch(() => {});

  // 等待首页通过 Cloudflare 验证并出现 __NEXT_DATA__（最多 20 秒）
  let buildId: string | null = cachedBuildId;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    console.log(`[SVGRepo] [Step 2] 等待 Cloudflare 验证通过 (第 ${i + 1}/20 秒)...`);
    try {
      const result = await win.webContents.executeJavaScript(`
        (() => {
          if (window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId) {
            return window.__NEXT_DATA__.buildId;
          }
          const el = document.getElementById('__NEXT_DATA__');
          if (el && el.textContent) {
            try { return JSON.parse(el.textContent).buildId || null; } catch (e) {}
          }
          return null;
        })()
      `);
      if (result && typeof result === 'string') {
        buildId = result.trim();
        cachedBuildId = buildId;
        lastBuildIdFetch = Date.now();
        console.log(`[SVGRepo] ✅ buildId 已提取: ${buildId}`);
        break;
      }
    } catch {}
  }

  if (!buildId) {
    try { win.destroy(); } catch {}
    throw new Error('SVGRepo Cloudflare 验证超时，未能提取 buildId');
  }

  // 在同一个通过验证的窗口内部，使用 fetch 调用数据接口（携带 Clearance Cookie）
  console.log(`[SVGRepo] [Step 3] 在浏览器上下文内请求数据: ${dataUrl}`);
  let jsonData: any = null;
  try {
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          const res = await fetch(${JSON.stringify(dataUrl)}, {
            headers: {
              'Accept': 'application/json,text/plain,*/*',
              'x-nextjs-data': '1',
              'Referer': 'https://www.svgrepo.com/',
            },
          });
          if (!res.ok) return { ok: false, status: res.status, error: 'HTTP ' + res.status };
          const json = await res.json();
          return { ok: true, data: json };
        } catch (e) {
          return { ok: false, error: e.message || String(e) };
        }
      })()
    `);
    if (result?.ok && result?.data) {
      jsonData = result.data;
      console.log('[SVGRepo] ✅ 浏览器内 fetch 成功获取数据');
    } else {
      console.error('[SVGRepo] 浏览器内 fetch 失败:', result?.error, 'status:', result?.status);
      if (result?.status === 429) {
        throw new Error('SVGRepo 数据接口触发频次限制 (429)，请稍后再试');
      }
      throw new Error(result?.error || '浏览器内 fetch 数据失败');
    }
  } finally {
    try { win.destroy(); } catch {}
  }

  return { buildId, jsonData };
}

/**
 * 搜索 SVGRepo 开源矢量图标
 */
export async function searchSvgrepo(
  query: string,
  options: SvgrepoSearchOptions = {},
): Promise<SvgrepoSearchResult> {
  const keyword = (query || '').trim();
  console.log(`[SVGRepo] 🔍 开始检索关键词: "${keyword}", options:`, options);

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
  const limit = Math.min(Math.max(Number(options.limit || options.pageSize) || 24, 1), 100);

  try {
    const cleanKeyword = keyword.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

    // 先用缓存的 buildId 构造 URL；若无缓存，fetchInBrowserContext 内部会自动获取
    const tempBuildId = cachedBuildId || 'PENDING';
    const dataUrl = tempBuildId === 'PENDING'
      ? `https://www.svgrepo.com/_next/data/PENDING/vectors/${encodeURIComponent(cleanKeyword)}.json?term=${encodeURIComponent(cleanKeyword)}`
      : page > 1
        ? `https://www.svgrepo.com/_next/data/${tempBuildId}/vectors/${encodeURIComponent(cleanKeyword)}/${page}.json?term=${encodeURIComponent(cleanKeyword)}&page=${page}`
        : `https://www.svgrepo.com/_next/data/${tempBuildId}/vectors/${encodeURIComponent(cleanKeyword)}.json?term=${encodeURIComponent(cleanKeyword)}`;

    // 调用浏览器上下文内部 fetch（自动携带 Cloudflare Clearance Cookie）
    const { buildId, jsonData } = await fetchInBrowserContext(
      page > 1
        ? `https://www.svgrepo.com/_next/data/${cachedBuildId || 'PENDING'}/vectors/${encodeURIComponent(cleanKeyword)}/${page}.json?term=${encodeURIComponent(cleanKeyword)}&page=${page}`
        : `https://www.svgrepo.com/_next/data/${cachedBuildId || 'PENDING'}/vectors/${encodeURIComponent(cleanKeyword)}.json?term=${encodeURIComponent(cleanKeyword)}`,
    );

    // 若浏览器内部拿到了最新 buildId，用正确的 buildId 再查一次（如 PENDING 占位被替换）
    const finalUrl = page > 1
      ? `https://www.svgrepo.com/_next/data/${buildId}/vectors/${encodeURIComponent(cleanKeyword)}/${page}.json?term=${encodeURIComponent(cleanKeyword)}&page=${page}`
      : `https://www.svgrepo.com/_next/data/${buildId}/vectors/${encodeURIComponent(cleanKeyword)}.json?term=${encodeURIComponent(cleanKeyword)}`;

    const rawVectors = jsonData?.pageProps?.vectors || jsonData?.pageProps?.items || jsonData?.pageProps?.data || [];
    console.log(`[SVGRepo] ✅ 成功解析出 ${rawVectors.length} 个矢量素材`);

    if (!Array.isArray(rawVectors) || rawVectors.length === 0) {
      return {
        success: false,
        query: keyword,
        count: 0,
        items: [],
        links: [],
        page,
        nextPage: null,
        error: `SVGRepo 未搜索到关键词 "${keyword}" 的矢量图标`,
      };
    }

    const items: SvgrepoItem[] = rawVectors.map((raw: any) => {
      const id = String(raw.id || raw.vectorId || raw.slug || '');
      const slug = raw.slug || raw.name || `vector-${id}`;
      const title = raw.title || raw.name || slug.replace(/-/g, ' ');
      const svgUrl = raw.svgUrl || `https://www.svgrepo.com/show/${id}/${slug}.svg`;
      const detailUrl = `https://www.svgrepo.com/svg/${id}/${slug}`;
      return {
        id,
        name: sanitizeName(slug) || `svgrepo_${id}`,
        title: title.replace(/SVG Vector/i, '').trim(),
        description: `SVGRepo Vector — ${title}`,
        image: svgUrl,
        svgUrl,
        thumbnail: svgUrl,
        downloadUrl: `https://www.svgrepo.com/download/${id}/${slug}.svg`,
        link: detailUrl,
        url: detailUrl,
        style: raw.style || 'monotone',
        author: raw.author || raw.collection || 'SVGRepo Contributor',
        license: raw.license || 'CC0 / MIT Open Source',
        isFree: true,
        tags: Array.isArray(raw.tags) ? raw.tags : [title],
      };
    });

    const pagedItems = items.slice(0, limit);
    const total = Number(jsonData?.pageProps?.total || jsonData?.pageProps?.count) || items.length;
    const totalPages = Number(jsonData?.pageProps?.totalPages) || Math.ceil(total / limit) || 1;

    return {
      success: true,
      query: keyword,
      count: pagedItems.length,
      total,
      totalPages,
      items: pagedItems,
      links: pagedItems.map((i) => i.svgUrl),
      page,
      nextPage: page < totalPages ? page + 1 : null,
    };
  } catch (error: any) {
    console.error('[SVGRepo] 检索发生异常:', error?.message || error);
    return {
      success: false,
      query: keyword,
      count: 0,
      total: 0,
      items: [],
      links: [],
      page,
      nextPage: null,
      error: `SVGRepo 检索失败: ${error?.message || String(error)}`,
    };
  }
}


/**
 * 获取工作空间保存路径
 */
function getSvgrepoWorkspaceDir(): string {
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
 * 下载 SVGRepo 矢量插画/图标到本地
 */
export async function downloadSvgrepoImage(
  imageUrl: string,
  options: { filename?: string } = {},
): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
  if (!imageUrl) {
    return { success: false, error: '缺少图片下载链接' };
  }

  console.log(`[SVGRepo] 📥 开始下载矢量文件: ${imageUrl}`);
  try {
    const fetchFn = await getFetchImpl();
    const headers = {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.svgrepo.com/',
      'Accept': 'image/svg+xml,*/*',
    };

    const res = await fetchFn(imageUrl, { headers });
    if (!res.ok) {
      console.error(`[SVGRepo] 下载失败 HTTP ${res.status}: ${res.statusText}`);
      return {
        success: false,
        error: `下载 SVGRepo 素材失败 (HTTP ${res.status}: ${res.statusText || '源站拒绝请求'})`,
      };
    }

    const text = await res.text();
    if (!text.includes('<svg') || !text.includes('</svg>')) {
      console.error('[SVGRepo] 下载内容非标准 SVG');
      return {
        success: false,
        error: 'SVGRepo 返回的内容不是有效的 SVG 矢量文件 (可能触发源站验证拦截)',
      };
    }

    const buffer = Buffer.from(text, 'utf-8');

    const workspaceDir = getSvgrepoWorkspaceDir();
    let saveDir = join(workspaceDir, 'svgrepo-downloads');
    try {
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
    } catch {
      saveDir = join('/tmp', 'svgrepo-downloads');
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
    }

    const filename = options.filename
      ? `${sanitizeName(options.filename)}${options.filename.endsWith('.svg') ? '' : '.svg'}`
      : `svgrepo_${Date.now()}.svg`;

    const filePath = join(saveDir, filename);
    fs.writeFileSync(filePath, buffer);
    console.log(`[SVGRepo] ✅ 矢量文件已保存至本地: ${filePath}`);

    return {
      success: true,
      filePath,
      filename,
    };
  } catch (error: any) {
    console.error('[SVGRepo] 下载过程发生异常:', error);
    return {
      success: false,
      error: error?.message || '下载 SVGRepo 素材失败',
    };
  }
}


/**
 * 下载并上传至用户个人素材库并落地入库
 */
export async function syncSvgrepoToMaterialLibrary(
  workspaceDir: string,
  options: {
    imageUrl: string;
    metadata?: Record<string, any>;
  }
): Promise<{
  success: boolean;
  message?: string;
  localFilePath?: string;
  cosUrl?: string;
  materialId?: string;
  error?: string;
  data?: any;
}> {
  const { imageUrl, metadata } = options;

  if (!imageUrl) {
    return { success: false, error: '缺少图片 URL' };
  }

  const dlResult = await downloadSvgrepoImage(imageUrl, {
    filename: metadata?.title || metadata?.name,
  });

  if (!dlResult.success || !dlResult.filePath) {
    return { success: false, error: dlResult.error || '下载素材失败' };
  }

  const localFilePath = dlResult.filePath;

  try {
    const fileName = localFilePath.split('/').pop() || `svgrepo_${Date.now()}.svg`;
    const title = metadata?.title || metadata?.name || fileName.replace(/\.svg$/i, '');
    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'svgrepo',
      group: 'svgrepo',
      source: 'SVGRepo',
      originUrl: imageUrl,
      suffix: 'svg',
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'svgrepo',
        uploadedAt: new Date().toISOString(),
      },
    });

    if (!materialResult.ok) {
      return { success: false, error: materialResult.msg || '素材库保存失败' };
    }

    return {
      success: true,
      message: '已成功下载 SVGRepo 矢量图并上传入库至素材库',
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
          source: 'svgrepo',
          uploadedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || '上传素材至个人素材库失败' };
  }
}

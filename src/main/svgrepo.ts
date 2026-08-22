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
 * 动态获取 SVGRepo Next.js buildId
 * 优先从 HTML 中提取，若遇到 Vercel Checkpoint 防护则通过后台无头窗口完成验证并提取
 */
export async function getSvgrepoBuildId(): Promise<string | null> {
  if (cachedBuildId && Date.now() - lastBuildIdFetch < 30 * 60 * 1000) {
    return cachedBuildId;
  }

  const fetchFn = await getFetchImpl();
  try {
    const res = await fetchFn('https://www.svgrepo.com/', {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/"buildId"\s*:\s*"([^"]+)"/);
      if (match && match[1]) {
        cachedBuildId = match[1];
        lastBuildIdFetch = Date.now();
        return cachedBuildId;
      }
    }
  } catch {}

  // 若直接请求被拦截，尝试通过 Electron 后台窗口静默完成 Vercel 挑战并提取 buildId
  try {
    const electron = await import('electron');
    const BrowserWindowClass = electron.BrowserWindow || (electron as any).default?.BrowserWindow;
    if (BrowserWindowClass) {
      const win = new BrowserWindowClass({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      await win.loadURL('https://www.svgrepo.com/');
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const buildId = await win.webContents.executeJavaScript(`
            (() => {
              if (window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId) {
                return window.__NEXT_DATA__.buildId;
              }
              const script = document.getElementById('__NEXT_DATA__');
              if (script && script.textContent) {
                try {
                  const data = JSON.parse(script.textContent);
                  return data.buildId || null;
                } catch (e) {}
              }
              return null;
            })()
          `);
          if (buildId) {
            cachedBuildId = buildId;
            lastBuildIdFetch = Date.now();
            win.destroy();
            return buildId;
          }
        } catch {}
      }
      win.destroy();
    }
  } catch (err) {
    console.warn('[SVGRepo] 通过后台窗口获取 buildId 失败:', err);
  }

  return cachedBuildId;
}

/**
 * 搜索 SVGRepo 开源矢量图标
 */
export async function searchSvgrepo(
  query: string,
  options: SvgrepoSearchOptions = {},
): Promise<SvgrepoSearchResult> {
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
  const limit = Math.min(Math.max(Number(options.limit || options.pageSize) || 24, 1), 100);

  try {
    const fetchFn = await getFetchImpl();
    const cleanKeyword = keyword.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

    // 优先尝试 Next.js Data API 接口
    const buildId = await getSvgrepoBuildId();
    if (buildId) {
      const dataUrl =
        page > 1
          ? `https://www.svgrepo.com/_next/data/${buildId}/vectors/${encodeURIComponent(cleanKeyword)}/${page}.json?term=${encodeURIComponent(cleanKeyword)}`
          : `https://www.svgrepo.com/_next/data/${buildId}/vectors/${encodeURIComponent(cleanKeyword)}.json?term=${encodeURIComponent(cleanKeyword)}`;

      try {
        const dataRes = await fetchFn(dataUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json,text/plain,*/*',
            'Referer': 'https://www.svgrepo.com/',
            'x-nextjs-data': '1',
          },
        });

        if (dataRes.ok) {
          const dataJson = await dataRes.json();
          const rawVectors = dataJson?.pageProps?.vectors || dataJson?.pageProps?.items || [];
          if (Array.isArray(rawVectors) && rawVectors.length > 0) {
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
            const total = Number(dataJson?.pageProps?.total || dataJson?.pageProps?.count) || items.length;
            const totalPages = Math.ceil(total / limit) || 1;

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
          }
        }
      } catch (nextApiErr) {
        console.warn('[SVGRepo] Next.js Data API 请求失败，回退 HTML 页面解析:', nextApiErr);
      }
    }

    // 回退尝试直接请求 HTML 页面
    const targetUrl =
      page > 1
        ? `https://www.svgrepo.com/vectors/${encodeURIComponent(cleanKeyword)}/${page}/`
        : `https://www.svgrepo.com/vectors/${encodeURIComponent(cleanKeyword)}/`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      'Referer': 'https://www.svgrepo.com/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Upgrade-Insecure-Requests': '1',
    };

    const res = await fetchFn(targetUrl, { method: 'GET', headers });
    if (!res.ok) {
      return {
        success: false,
        query: keyword,
        count: 0,
        total: 0,
        items: [],
        links: [],
        page,
        nextPage: null,
        error: `SVGRepo 请求失败 (HTTP ${res.status}: ${res.statusText || '连接异常'})，请检查网络或代理`,
      };
    }

    const html = await res.text();
    const { items, total, totalPages } = parseSvgrepoHtml(html);

    if (items.length === 0) {
      return {
        success: false,
        query: keyword,
        count: 0,
        total: 0,
        items: [],
        links: [],
        page,
        nextPage: null,
        error: `SVGRepo 未匹配到关键词 "${keyword}" 的有效矢量图或触发了源站拦截`,
      };
    }

    const pagedItems = items.slice(0, limit);

    return {
      success: true,
      query: keyword,
      count: pagedItems.length,
      total: total || pagedItems.length,
      totalPages: totalPages || 1,
      items: pagedItems,
      links: pagedItems.map(i => i.svgUrl),
      page,
      nextPage: page < (totalPages || 1) ? page + 1 : null,
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
      error: `SVGRepo 搜索异常: ${error?.message || String(error)}`,
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

  try {
    const fetchFn = await getFetchImpl();
    const headers = {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.svgrepo.com/',
      'Accept': 'image/svg+xml,*/*',
    };

    const res = await fetchFn(imageUrl, { headers });
    if (!res.ok) {
      return {
        success: false,
        error: `下载 SVGRepo 素材失败 (HTTP ${res.status}: ${res.statusText || '源站拒绝请求'})`,
      };
    }

    const text = await res.text();
    if (!text.includes('<svg') || !text.includes('</svg>')) {
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

    return {
      success: true,
      filePath,
      filename,
    };
  } catch (error: any) {
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

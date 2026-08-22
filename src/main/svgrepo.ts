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
let pendingBuildIdPromise: Promise<string | null> | null = null;

/**
 * 动态获取 SVGRepo Next.js buildId
 * 启动后台静默无头 Chromium 窗口完成 Vercel/Cloudflare 挑战并提取真实的 buildId 和会话凭证
 */
export async function getSvgrepoBuildId(): Promise<string | null> {
  if (cachedBuildId && Date.now() - lastBuildIdFetch < 30 * 60 * 1000) {
    console.log(`[SVGRepo] 使用内存缓存的 buildId: ${cachedBuildId}`);
    return cachedBuildId;
  }

  if (pendingBuildIdPromise) {
    console.log('[SVGRepo] 正在等待已有 buildId 解析任务完成...');
    return pendingBuildIdPromise;
  }

  pendingBuildIdPromise = (async () => {
    try {
      const electron = await import('electron');
      const BrowserWindowClass = electron.BrowserWindow || (electron as any).default?.BrowserWindow;
      if (!BrowserWindowClass) {
        throw new Error('当前环境非 Electron 主进程，无法创建 BrowserWindow');
      }

      console.log('[SVGRepo] [Step 1/3] 启动后台无头窗口解析 buildId 并通过安全验证...');
      const win = new BrowserWindowClass({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: false,
        },
      });

      win.webContents.setAudioMuted(true);
      
      // 非阻塞加载页面，不等待 loadURL 完成即可开启轮询
      win.loadURL(SVGREPO_SITE_URL).catch((err) => {
        console.log('[SVGRepo] loadURL 初步导航通知:', err?.message || err);
      });

      // 轮询等待 Cloudflare/Vercel 挑战通过并注入 __NEXT_DATA__
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        console.log(`[SVGRepo] [Step 2/3] 轮询检测页面状态 (第 ${i + 1}/15 秒)...`);
        try {
          const result = await win.webContents.executeJavaScript(`
            (() => {
              if (window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId) {
                return window.__NEXT_DATA__.buildId;
              }
              const el = document.getElementById('__NEXT_DATA__');
              if (el && el.textContent) {
                try {
                  const parsed = JSON.parse(el.textContent);
                  return parsed.buildId || null;
                } catch (e) {}
              }
              return null;
            })()
          `);

          if (result && typeof result === 'string' && result.trim()) {
            cachedBuildId = result.trim();
            lastBuildIdFetch = Date.now();
            console.log(`[SVGRepo] [Step 3/3] ✅ 成功获取并缓存最新 buildId: ${cachedBuildId}`);
            try { win.destroy(); } catch {}
            return cachedBuildId;
          }
        } catch (evalErr: any) {
          // 页面可能还在加载中
        }
      }

      try { win.destroy(); } catch {}
      console.warn('[SVGRepo] ⚠️ 后台无头窗口等待 buildId 超时（15秒）');
    } catch (err: any) {
      console.error('[SVGRepo] ❌ 获取 buildId 发生异常:', err?.message || String(err));
    } finally {
      pendingBuildIdPromise = null;
    }
    return cachedBuildId;
  })();

  return pendingBuildIdPromise;
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
    const fetchFn = await getFetchImpl();
    const cleanKeyword = keyword.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

    // 1. 获取并使用 Next.js buildId 请求纯净 JSON 数据接口
    console.log('[SVGRepo] 正在获取 buildId...');
    const buildId = await getSvgrepoBuildId();
    if (!buildId) {
      console.error('[SVGRepo] 未能获取到 buildId');
      return {
        success: false,
        query: keyword,
        count: 0,
        items: [],
        links: [],
        page,
        nextPage: null,
        error: '无法通过 SVGRepo 源站安全验证获取 buildId，请检查网络连接',
      };
    }

    // 支持第 1 页与后续分页接口格式
    const dataUrl =
      page > 1
        ? `https://www.svgrepo.com/_next/data/${buildId}/vectors/${encodeURIComponent(cleanKeyword)}/${page}.json?term=${encodeURIComponent(cleanKeyword)}&page=${page}`
        : `https://www.svgrepo.com/_next/data/${buildId}/vectors/${encodeURIComponent(cleanKeyword)}.json?term=${encodeURIComponent(cleanKeyword)}`;

    console.log(`[SVGRepo] 📡 正在请求 Next.js 数据接口: ${dataUrl}`);

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json,text/plain,*/*',
      'Referer': `https://www.svgrepo.com/vectors/${encodeURIComponent(cleanKeyword)}/`,
      'x-nextjs-data': '1',
    };

    const res = await fetchFn(dataUrl, { method: 'GET', headers });
    console.log(`[SVGRepo] 数据接口 HTTP 响应状态码: ${res.status}`);

    if (!res.ok) {
      return {
        success: false,
        query: keyword,
        count: 0,
        items: [],
        links: [],
        page,
        nextPage: null,
        error: `SVGRepo 请求失败 (HTTP ${res.status}: ${res.statusText || '源站拒绝'})`,
      };
    }

    const json = await res.json();
    const rawVectors = json?.pageProps?.vectors || json?.pageProps?.items || json?.pageProps?.data || [];
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
    const total = Number(json?.pageProps?.total || json?.pageProps?.count) || items.length;
    const totalPages = Number(json?.pageProps?.totalPages) || Math.ceil(total / limit) || 1;

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
    console.error('[SVGRepo] 检索发生异常:', error);
    return {
      success: false,
      query: keyword,
      count: 0,
      total: 0,
      items: [],
      links: [],
      page,
      nextPage: null,
      error: `SVGRepo 检索异常: ${error?.message || String(error)}`,
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

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
 * 启动无头 Chromium 窗口直接导航至 SVGRepo 目标搜索页，
 * 自动通过 Cloudflare/Vercel 验证后直接提取页面 SSR 注入的 __NEXT_DATA__ 矢量数据
 */
async function searchInBrowserContext(cleanKeyword: string, page: number): Promise<{
  vectors: any[];
  total: number;
  totalPages: number;
  buildId?: string;
}> {
  const electron = await import('electron');
  const BrowserWindowClass = electron.BrowserWindow || (electron as any).default?.BrowserWindow;
  if (!BrowserWindowClass) {
    throw new Error('当前环境非 Electron 主进程，无法创建 BrowserWindow');
  }

  const win = new BrowserWindowClass({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });
  win.webContents.setAudioMuted(true);

  // 同步代理配置
  const proxyServer =
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    'socks5://127.0.0.1:7890';

  if (proxyServer) {
    try {
      await win.webContents.session.setProxy({ proxyRules: proxyServer });
      console.log(`[SVGRepo] 已为无头窗口配置代理: ${proxyServer}`);
    } catch (proxyErr) {
      console.warn('[SVGRepo] 代理配置失败:', proxyErr);
    }
  }

  const targetUrl = page > 1
    ? `https://www.svgrepo.com/vectors/${encodeURIComponent(cleanKeyword)}/${page}/`
    : `https://www.svgrepo.com/vectors/${encodeURIComponent(cleanKeyword)}/`;

  console.log(`[SVGRepo] [Step 1] 启动无头窗口导航至搜索页: ${targetUrl}`);
  win.loadURL(targetUrl).catch(() => {});

  let extractedData: { vectors: any[]; total: number; totalPages: number; buildId?: string } | null = null;

  // 轮询等待 Cloudflare 验证通过并提取 __NEXT_DATA__ 矢量数据（最多 25 秒）
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    console.log(`[SVGRepo] [Step 2] 等待 Cloudflare 验证与数据就绪 (第 ${i + 1}/25 秒)...`);
    try {
      const result = await win.webContents.executeJavaScript(`
        (() => {
          // 1. 从内存中的 window.__NEXT_DATA__ 读取
          if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps) {
            const p = window.__NEXT_DATA__.props.pageProps;
            const vectors = p.vectors || p.items || p.data || [];
            if (Array.isArray(vectors) && vectors.length > 0) {
              return {
                ok: true,
                buildId: window.__NEXT_DATA__.buildId,
                vectors,
                total: Number(p.total || p.count) || vectors.length,
                totalPages: Number(p.totalPages) || 1,
              };
            }
          }

          // 2. 从 DOM <script id="__NEXT_DATA__"> 读取
          const el = document.getElementById('__NEXT_DATA__');
          if (el && el.textContent) {
            try {
              const parsed = JSON.parse(el.textContent);
              const p = parsed.props?.pageProps;
              const vectors = p?.vectors || p?.items || p?.data || [];
              if (Array.isArray(vectors) && vectors.length > 0) {
                return {
                  ok: true,
                  buildId: parsed.buildId,
                  vectors,
                  total: Number(p.total || p.count) || vectors.length,
                  totalPages: Number(p.totalPages) || 1,
                };
              }
            } catch (e) {}
          }

          // 3. 检测是否存在 buildId（如果首页已加载但 vectors 为空，可能是新关键词）
          if (window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId) {
            return {
              ok: true,
              buildId: window.__NEXT_DATA__.buildId,
              vectors: [],
              total: 0,
              totalPages: 1,
            };
          }

          return null;
        })()
      `);

      if (result && result.ok) {
        if (result.buildId) {
          cachedBuildId = result.buildId;
          lastBuildIdFetch = Date.now();
        }
        extractedData = result;
        console.log(`[SVGRepo] ✅ 成功从页面提取 ${result.vectors.length} 个矢量素材 (buildId: ${result.buildId || '未知'})`);
        break;
      }
    } catch {}
  }

  // 4. 若 SSR 数据未直接命中但已获取 buildId，尝试在页面内部使用 fetch 调用 Next.js JSON 接口
  if ((!extractedData || extractedData.vectors.length === 0) && cachedBuildId) {
    console.log(`[SVGRepo] [Step 3] 尝试在页面内 fetch Next.js JSON 数据 (buildId: ${cachedBuildId})...`);
    try {
      const dataApiUrl = page > 1
        ? `https://www.svgrepo.com/_next/data/${cachedBuildId}/vectors/${encodeURIComponent(cleanKeyword)}/${page}.json?term=${encodeURIComponent(cleanKeyword)}&page=${page}`
        : `https://www.svgrepo.com/_next/data/${cachedBuildId}/vectors/${encodeURIComponent(cleanKeyword)}.json?term=${encodeURIComponent(cleanKeyword)}`;

      const fetchResult = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const res = await fetch(${JSON.stringify(dataApiUrl)}, {
              headers: {
                'Accept': 'application/json,text/plain,*/*',
                'x-nextjs-data': '1',
              },
            });
            if (!res.ok) return { ok: false, status: res.status };
            const json = await res.json();
            const p = json?.pageProps;
            const vectors = p?.vectors || p?.items || p?.data || [];
            return {
              ok: true,
              vectors,
              total: Number(p?.total || p?.count) || vectors.length,
              totalPages: Number(p?.totalPages) || 1,
            };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        })()
      `);

      if (fetchResult && fetchResult.ok && Array.isArray(fetchResult.vectors) && fetchResult.vectors.length > 0) {
        extractedData = {
          vectors: fetchResult.vectors,
          total: fetchResult.total,
          totalPages: fetchResult.totalPages,
          buildId: cachedBuildId,
        };
        console.log(`[SVGRepo] ✅ 页面内 fetch 成功获取 ${fetchResult.vectors.length} 个矢量素材`);
      }
    } catch (fetchErr: any) {
      console.warn('[SVGRepo] 页面内 fetch 失败:', fetchErr?.message || fetchErr);
    }
  }

  try { win.destroy(); } catch {}

  if (!extractedData) {
    throw new Error('SVGRepo Cloudflare 验证超时，未能提取素材数据');
  }

  return extractedData;
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

    // 启动无头窗口完成验证并提取矢量列表
    const { vectors: rawVectors, total, totalPages } = await searchInBrowserContext(cleanKeyword, page);

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

    return {
      success: true,
      query: keyword,
      count: pagedItems.length,
      total: total || items.length,
      totalPages: totalPages || Math.ceil((total || items.length) / limit) || 1,
      items: pagedItems,
      links: pagedItems.map((i) => i.svgUrl),
      page,
      nextPage: page < (totalPages || 1) ? page + 1 : null,
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

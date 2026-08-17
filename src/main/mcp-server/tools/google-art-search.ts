/**
 * MCP Tool: google_art_search
 * 直接调用 Google Arts & Culture API 搜索作品链接（无需浏览器）
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

const GOOGLE_ART_API = 'https://artsandculture.google.com/api/search';
const GOOGLE_ART_IMAGES_API = 'https://artsandculture.google.com/api/assets/images';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface GoogleArtAsset {
  id: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
  url: string;
  color: string | null;
  aspectRatio: number | null;
  pixelData: string | null;
  hasPixels: boolean;
  institution: string | null;
}

interface ApiResponse {
  query: string;
  page: number;
  total: number;
  items: GoogleArtAsset[];
  nextCursor: string | null;
}

export const googleArtSearchTool = {
  definition: {
    name: 'google_art_search',
    description: '搜索 Google Arts & Culture 艺术作品。直接调用 API 获取作品链接，无需浏览器。支持关键词搜索和真实分页。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyword: {
          type: 'string' as const,
          description: '搜索关键词（英文效果更佳，如 "van gogh"、"impressionism"）。',
        },
        page: {
          type: 'number' as const,
          description: '页码，从 1 开始（第一页约 58 条，后续每页约 24 条）。默认 1。',
        },
        maxCount: {
          type: 'number' as const,
          description: '最多返回多少条结果（在分页基础上截断）。默认不限制。',
        },
        hl: {
          type: 'string' as const,
          description: '语言代码，默认 "en"。',
        },
      },
      required: [],
    },
  },

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const keyword = ((args.keyword as string) || '').trim() || 'impressionism';
    const page = Math.max(1, Number(args.page) || 1);
    const hl = (args.hl as string) || 'en';
    const countInput = args.maxCount ?? args.limit;
    const maxCount = countInput ? Number(countInput) : undefined;

    try {
      const result = await searchGoogleArts(keyword, page, hl);
      // 截断到 maxCount
      let items = result.items;
      if (maxCount && maxCount > 0) {
        items = items.slice(0, maxCount);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              query: result.query,
              page: result.page,
              total: result.total,
              count: items.length,
              nextCursor: result.nextCursor,
              links: items.map((item) => item.url),
              items,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error?.message || String(error),
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * 搜索 Google Arts & Culture（支持真实游标分页）
 * 第一页走旧方式 /api/search（返回初始 cursor），后续页优先走新方式 /api/assets/images（pt 游标翻页）
 */
async function searchGoogleArts(query: string, page: number, hl: string): Promise<ApiResponse> {
  let cursor: string | null = null;

  // 翻页到目标页
  for (let i = 0; i < page - 1; i++) {
    const result =
      i === 0 ? await fetchPage(query, hl, null) : await fetchImagesPageSafely(query, hl, cursor, i + 1, 24);
    cursor = result.nextCursor;
    if (!cursor) {
      return { query, page, total: result.total, items: [], nextCursor: null };
    }
  }

  if (page === 1) {
    return fetchPage(query, hl, null, page);
  }
  return fetchImagesPageSafely(query, hl, cursor, page, 24);
}

/**
 * 优先新方式 /api/assets/images 翻页，失败时回退旧方式 /api/search
 */
async function fetchImagesPageSafely(
  query: string,
  hl: string,
  pt: string | null,
  page: number,
  size: number,
): Promise<ApiResponse> {
  try {
    return await fetchImagesPage(query, hl, pt, size, page);
  } catch (newErr: any) {
    console.warn(`[GoogleArts] assets/images 翻页失败，回退旧方式: ${newErr?.message || String(newErr)}`);
    return fetchPage(query, hl, pt, page);
  }
}

/**
 * 旧方式：/api/search 单页请求（游标参数已实证被接口忽略，保留兼容）
 * 响应结构 data[0][3]
 */
async function fetchPage(query: string, hl: string, cursor: string | null, page = 1): Promise<ApiResponse> {
  const params = new URLSearchParams({ q: query, hl });
  if (cursor) {
    params.set('cursor', cursor);
  }

  const url = `${GOOGLE_ART_API}?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      Referer: 'https://artsandculture.google.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`Google Arts API 返回 ${response.status}: ${response.statusText}`);
  }

  let raw = await response.text();

  // 去除 XSS 防护前缀 )]}'
  if (raw.startsWith(")]}'")) {
    raw = raw.slice(4).replace(/^\s*\n/, '');
  }

  const data = JSON.parse(raw);
  const inner = data[0];
  const section = inner[3];
  return parseResponse(section, query, page);
}

/**
 * 后续页：/api/assets/images，pt 为必填游标，s 为每批条数（上限约 64）
 * 响应结构 data[0][0]
 */
async function fetchImagesPage(query: string, hl: string, pt: string | null, size = 24, page = 2): Promise<ApiResponse> {
  const params = new URLSearchParams({
    q: query,
    s: String(Math.min(Math.max(size, 1), 64)),
    hl,
    _reqid: String(Math.floor(Math.random() * 9999999)),
    rt: 'j',
  });
  if (pt) {
    params.set('pt', pt);
  }

  const url = `${GOOGLE_ART_IMAGES_API}?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      Referer: 'https://artsandculture.google.com/search/asset?q=' + encodeURIComponent(query),
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!response.ok) {
    throw new Error(`Google Arts API 返回 ${response.status}: ${response.statusText}`);
  }

  let raw = await response.text();

  // 去除 XSS 防护前缀 )]}'
  if (raw.startsWith(")]}'")) {
    raw = raw.slice(4).replace(/^\s*\n/, '');
  }

  const data = JSON.parse(raw);
  const section = data[0][0];
  return parseResponse(section, query, page);
}

/**
 * 解析 API 响应 section
 */
function parseResponse(section: any[], query: string, page: number): ApiResponse {
  const assetsRaw = section[2] || [];
  const total = section[4];
  const nextCursor = section[8];

  const items: GoogleArtAsset[] = [];

  for (const asset of assetsRaw) {
    const info = asset[10] && Array.isArray(asset[10]) ? asset[10] : [];

    items.push({
      id: info[0] || '',
      title: asset[1] || '',
      artist: asset[2] || null,
      thumbnail: asset[3] ? `https:${asset[3]}` : null,
      url: asset[4] ? `https://artsandculture.google.com${asset[4]}` : '',
      color: asset[8] || null,
      aspectRatio: info[1] ?? null,
      pixelData: info[9] || null,
      hasPixels: info[10] || false,
      institution: info[12] || null,
    });
  }

  return {
    query,
    page,
    total,
    items,
    nextCursor: nextCursor || null,
  };
}

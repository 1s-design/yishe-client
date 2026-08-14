/**
 * MCP Tool: google_art_search
 * 直接调用 Google Arts & Culture API 搜索作品链接（无需浏览器）
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

const GOOGLE_ART_API = 'https://artsandculture.google.com/api/search';
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
    description: '搜索 Google Arts & Culture 艺术作品。直接调用 API 获取作品链接，无需浏览器。支持关键词搜索和分页。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyword: {
          type: 'string' as const,
          description: '搜索关键词（英文效果更佳，如 "van gogh"、"impressionism"）。',
        },
        page: {
          type: 'number' as const,
          description: '页码，从 1 开始（每页约 60 条）。默认 1。',
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
 * 搜索 Google Arts & Culture
 */
async function searchGoogleArts(query: string, page: number, hl: string): Promise<ApiResponse> {
  let cursor: string | null = null;

  // 翻页到目标页
  for (let i = 0; i < page - 1; i++) {
    const result = await fetchPage(query, hl, cursor);
    cursor = result.nextCursor;
    if (!cursor) {
      return { query, page, total: result.total, items: [], nextCursor: null };
    }
  }

  return fetchPage(query, hl, cursor, page);
}

/**
 * 请求单页数据
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
  return parseResponse(data, query, page);
}

/**
 * 解析 API 响应
 */
function parseResponse(data: any[], query: string, page: number): ApiResponse {
  const inner = data[0];
  const section = inner[3];
  const assetsRaw = section[2];
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

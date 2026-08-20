/** 上交所 - https://www.sse.com.cn/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface SSEItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  category: string;
}

export interface SSEResult {
  success: boolean;
  category: string;
  count: number;
  items: SSEItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

const SSE_URLS: Record<string, string> = {
  news: 'https://www.sse.com.cn/home/search/?webswd=home',
  announcement: 'https://www.sse.com.cn/disclosure/announcement/',
  market: 'https://www.sse.com.cn/market/',
  listed: 'https://www.sse.com.cn/assortment/stock/list/info/',
};

export async function getSSEStatus() {
  const s = await checkSiteAvailability('https://www.sse.com.cn', { timeoutMs: 8000 });
  return {
    key: 'sse',
    pluginKey: 'sse',
    label: '上交所',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '上交所 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchSSE(category: string = 'news', options: { query?: string; maxCount?: number } = {}): Promise<SSEResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const url = SSE_URLS[category] || SSE_URLS.news;
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.sse.com.cn/',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: SSEItem[] = [];

    // Parse announcement items from the page
    const listRegex = /<li[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*target="[^"]*"[^>]*>([^<]*)<\/a>\s*(?:<span[^>]*>([^<]*)<\/span>)?\s*<\/li>/gi;
    let m;
    while ((m = listRegex.exec(html)) !== null) {
      const link = m[1].startsWith('http') ? m[1] : `https://www.sse.com.cn${m[1]}`;
      items.push({
        title: m[2].trim(),
        link,
        description: m[2].trim(),
        pubDate: m[3]?.trim() || new Date().toISOString(),
        source: '上交所',
        category: '公告',
      });
    }

    // Parse from alternative format
    const altRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>\s*<span[^>]*class="[^"]*time[^"]*"[^>]*>([^<]*)<\/span>/gi;
    while ((m = altRegex.exec(html)) !== null) {
      const title = m[2]?.trim();
      if (title && title.length > 3 && !items.find(it => it.title === title)) {
        items.push({
          title,
          link: m[1].startsWith('http') ? m[1] : `https://www.sse.com.cn${m[1]}`,
          description: title,
          pubDate: m[3]?.trim() || new Date().toISOString(),
          source: '上交所',
          category: '公告',
        });
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取上交所失败' };
  }
}

export async function syncSSEToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'sse', syncedAt: new Date().toISOString() } };
}

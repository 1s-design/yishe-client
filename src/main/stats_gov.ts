/** 国家统计局 - https://www.stats.gov.cn/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface StatsGovItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  category: string;
}

export interface StatsGovResult {
  success: boolean;
  category: string;
  count: number;
  items: StatsGovItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

const STATS_GOV_URLS: Record<string, string> = {
  news: 'https://www.stats.gov.cn/xwfb/',
  data: 'https://www.stats.gov.cn/sj/zxfb/',
  report: 'https://www.stats.gov.cn/zt_18555/zthd/lhfw/',
  indicator: 'https://www.stats.gov.cn/sj/',
};

export async function getStatsGovStatus() {
  const s = await checkSiteAvailability('https://www.stats.gov.cn', { timeoutMs: 8000 });
  return {
    key: 'stats_gov',
    pluginKey: 'stats_gov',
    label: '国家统计局',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '国家统计局 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchStatsGov(category: string = 'news', options: { query?: string; maxCount?: number } = {}): Promise<StatsGovResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const url = STATS_GOV_URLS[category] || STATS_GOV_URLS.news;
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.stats.gov.cn/',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: StatsGovItem[] = [];

    // Parse news items from the page
    const listRegex = /<li[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*target="[^"]*"[^>]*>([^<]*)<\/a>\s*(?:<span[^>]*>([^<]*)<\/span>)?\s*<\/li>/gi;
    let m;
    while ((m = listRegex.exec(html)) !== null) {
      const link = m[1].startsWith('http') ? m[1] : `https://www.stats.gov.cn${m[1]}`;
      items.push({
        title: m[2].trim(),
        link,
        description: m[2].trim(),
        pubDate: m[3]?.trim() || new Date().toISOString(),
        source: '国家统计局',
        category: '统计',
      });
    }

    // Also parse from alternative list format
    const altRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>\s*<span[^>]*>([^<]*)<\/span>/gi;
    while ((m = altRegex.exec(html)) !== null) {
      const title = m[2]?.trim();
      const link = m[1]?.trim();
      if (title && title.length > 3 && !items.find(it => it.title === title)) {
        items.push({
          title,
          link: link.startsWith('http') ? link : `https://www.stats.gov.cn${link}`,
          description: title,
          pubDate: m[3]?.trim() || new Date().toISOString(),
          source: '国家统计局',
          category: '统计',
        });
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取国家统计局失败' };
  }
}

export async function syncStatsGovToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'stats_gov', syncedAt: new Date().toISOString() } };
}

/** 中国货币网 - https://www.chinamoney.com.cn/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ChinaMoneyItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  category: string;
}

export interface ChinaMoneyResult {
  success: boolean;
  category: string;
  count: number;
  items: ChinaMoneyItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

const CHINAMONEY_URLS: Record<string, string> = {
  news: 'https://www.chinamoney.com.cn/chinese/bkccpr/',
  rate: 'https://www.chinamoney.com.cn/chinese/bkccpr/',
  bond: 'https://www.chinamoney.com.cn/chinese/bondcc/',
  market: 'https://www.chinamoney.com.cn/chinese/mkdat/',
};

export async function getChinaMoneyStatus() {
  const s = await checkSiteAvailability('https://www.chinamoney.com.cn', { timeoutMs: 8000 });
  return {
    key: 'chinamoney',
    pluginKey: 'chinamoney',
    label: '中国货币网',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '中国货币网 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchChinaMoney(category: string = 'news', options: { query?: string; maxCount?: number } = {}): Promise<ChinaMoneyResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const url = CHINAMONEY_URLS[category] || CHINAMONEY_URLS.news;
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.chinamoney.com.cn/',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: ChinaMoneyItem[] = [];

    // Parse data items from the page
    const listRegex = /<li[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>\s*(?:<span[^>]*>([^<]*)<\/span>)?\s*<\/li>/gi;
    let m;
    while ((m = listRegex.exec(html)) !== null) {
      const link = m[1].startsWith('http') ? m[1] : `https://www.chinamoney.com.cn${m[1]}`;
      items.push({
        title: m[2].trim(),
        link,
        description: m[2].trim(),
        pubDate: m[3]?.trim() || new Date().toISOString(),
        source: '中国货币网',
        category: '金融',
      });
    }

    // Parse from table rows
    const tableRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    while ((m = tableRegex.exec(html)) !== null) {
      const block = m[1];
      const cellMatch = block.match(/<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/);
      if (cellMatch) {
        const titleMatch = cellMatch[1].match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
        if (titleMatch) {
          const title = titleMatch[2]?.trim();
          if (title && title.length > 2 && !items.find(it => it.title === title)) {
            items.push({
              title,
              link: titleMatch[1].startsWith('http') ? titleMatch[1] : `https://www.chinamoney.com.cn${titleMatch[1]}`,
              description: cellMatch[2]?.replace(/<[^>]+>/g, '').trim() || title,
              pubDate: new Date().toISOString(),
              source: '中国货币网',
              category: '金融',
            });
          }
        }
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取中国货币网失败' };
  }
}

export async function syncChinaMoneyToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'chinamoney', syncedAt: new Date().toISOString() } };
}

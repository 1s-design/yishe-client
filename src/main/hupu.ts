/** 虎扑 体育社区 - https://www.hupu.com/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface HuPuItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  author: string;
  replies: string;
  category: string;
}

export interface HuPuResult {
  success: boolean;
  category: string;
  count: number;
  items: HuPuItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

const HUPU_URLS: Record<string, string> = {
  all: 'https://bbs.hupu.com/all-gambia',
  nba: 'https://bbs.hupu.com/nba',
  cba: 'https://bbs.hupu.com/cba',
  football: 'https://bbs.hupu.com/zuqiu',
  gaming: 'https://bbs.hupu.com/voice',
};

export async function getHuPuStatus() {
  const s = await checkSiteAvailability('https://www.hupu.com', { timeoutMs: 8000 });
  return {
    key: 'hupu',
    pluginKey: 'hupu',
    label: '虎扑',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '虎扑 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchHuPu(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<HuPuResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const url = HUPU_URLS[category] || HUPU_URLS.all;
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.hupu.com/',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: HuPuItem[] = [];

    // Parse topic list items
    const topicRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = topicRegex.exec(html)) !== null) {
      const block = m[1];
      const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*class="[^"]*p-title[^"]*"[^>]*>([^<]*)<\/a>/) ||
        block.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
      const replyMatch = block.match(/<a[^>]*class="[^"]*[^"]*"[^>]*>(\d+)<\/a>/);

      if (titleMatch) {
        const title = titleMatch[2]?.trim();
        if (title && title.length > 2) {
          items.push({
            title,
            link: titleMatch[1].startsWith('http') ? titleMatch[1] : `https://bbs.hupu.com${titleMatch[1]}`,
            description: '',
            pubDate: new Date().toISOString(),
            author: '虎扑用户',
            replies: replyMatch?.[1] || '0',
            category: '话题',
          });
        }
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取虎扑失败' };
  }
}

export async function syncHuPuToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'hupu', syncedAt: new Date().toISOString() } };
}

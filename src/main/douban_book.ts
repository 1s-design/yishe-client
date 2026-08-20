/** 豆瓣读书 - https://book.douban.com/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface DoubanBookItem {
  title: string;
  link: string;
  rating: string;
  pubDate: string;
  description: string;
  author: string;
  poster: string;
  category: string;
}

export interface DoubanBookResult {
  success: boolean;
  category: string;
  count: number;
  items: DoubanBookItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

const DOUBAN_BOOK_URLS: Record<string, string> = {
  hot: 'https://book.douban.com/j/search?start=0&cat=10010',
  fiction: 'https://book.douban.com/tag/小说',
  nonfiction: 'https://book.douban.com/tag/随笔',
  science: 'https://book.douban.com/tag/科幻',
  literature: 'https://book.douban.com/tag/文学',
};

export async function getDoubanBookStatus() {
  const s = await checkSiteAvailability('https://book.douban.com', { timeoutMs: 8000 });
  return {
    key: 'douban_book',
    pluginKey: 'douban_book',
    label: '豆瓣读书',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '豆瓣读书 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchDoubanBook(category: string = 'hot', options: { query?: string; maxCount?: number } = {}): Promise<DoubanBookResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    // Scrape the book page
    const url = DOUBAN_BOOK_URLS[category] || DOUBAN_BOOK_URLS.hot;
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://book.douban.com/',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: DoubanBookItem[] = [];

    // Parse book items from the page
    const bookRegex = /<li[^>]*class="[^"]*subject-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = bookRegex.exec(html)) !== null) {
      const block = m[1];
      const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*title="([^"]*)"[^>]*>/);
      const ratingMatch = block.match(/<span[^>]*class="[^"]*rating_nums[^"]*"[^>]*>([^<]*)<\/span>/);
      const pubMatch = block.match(/<div[^>]*class="[^"]*pub[^"]*"[^>]*>([^<]*)<\/div>/);
      const imgMatch = block.match(/<img[^>]*src="([^"]*)"[^>]*>/);

      if (titleMatch) {
        items.push({
          title: titleMatch[2] || titleMatch[1],
          link: titleMatch[1].startsWith('http') ? titleMatch[1] : `https://book.douban.com${titleMatch[1]}`,
          rating: ratingMatch?.[1] || '暂无评分',
          pubDate: new Date().toISOString(),
          description: pubMatch?.[1]?.trim() || '',
          author: '',
          poster: imgMatch?.[1] || '',
          category: '图书',
        });
      }
    }

    // Also parse from the popular books section
    const altBookRegex = /<a[^>]*href="([^"]*)"[^>]*onclick="[^"]*"[^>]*>([^<]*)<\/a>/gi;
    while ((m = altBookRegex.exec(html)) !== null) {
      const title = m[2]?.trim();
      if (title && title.length > 1 && !items.find(it => it.title === title)) {
        items.push({
          title,
          link: m[1].startsWith('http') ? m[1] : `https://book.douban.com${m[1]}`,
          rating: '',
          pubDate: new Date().toISOString(),
          description: '',
          author: '',
          poster: '',
          category: '图书',
        });
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取豆瓣读书失败' };
  }
}

export async function syncDoubanBookToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'douban_book', syncedAt: new Date().toISOString() } };
}

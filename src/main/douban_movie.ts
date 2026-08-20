/** 豆瓣电影 - https://movie.douban.com/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface DoubanMovieItem {
  title: string;
  link: string;
  rating: string;
  pubDate: string;
  description: string;
  cast: string;
  poster: string;
  category: string;
}

export interface DoubanMovieResult {
  success: boolean;
  category: string;
  count: number;
  items: DoubanMovieItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

const DOUBAN_MOVIE_URLS: Record<string, string> = {
  hot: 'https://movie.douban.com/j/search_subjects?tag=热门&page_limit=20',
  latest: 'https://movie.douban.com/j/search_subjects?tag=最新&page_limit=20',
 经典: 'https://movie.douban.com/j/search_subjects?tag=经典&page_limit=20',
  playable: 'https://movie.douban.com/j/search_subjects?tag=可播放&page_limit=20',
  high_score: 'https://movie.douban.com/j/search_subjects?tag=豆瓣高分&page_limit=20',
};

export async function getDoubanMovieStatus() {
  const s = await checkSiteAvailability('https://movie.douban.com', { timeoutMs: 8000 });
  return {
    key: 'douban_movie',
    pluginKey: 'douban_movie',
    label: '豆瓣电影',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '豆瓣电影 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchDoubanMovie(category: string = 'hot', options: { query?: string; maxCount?: number } = {}): Promise<DoubanMovieResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    // Try the JSON API first
    const apiUrl = DOUBAN_MOVIE_URLS[category] || DOUBAN_MOVIE_URLS.hot;
    const res = await fetchFn(apiUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': 'https://movie.douban.com/',
      },
    });

    if (res.ok) {
      const data = await res.json();
      if (data.subjects && Array.isArray(data.subjects)) {
        const items: DoubanMovieItem[] = data.subjects.map((s: any) => ({
          title: s.title || '',
          link: s.url || '',
          rating: s.rate || '暂无评分',
          pubDate: new Date().toISOString(),
          description: `${s.title} - 评分 ${s.rate}`,
          cast: '',
          poster: s.cover || '',
          category: '电影',
        }));

        const filtered = options.query
          ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()))
          : items;

        return {
          success: true,
          category,
          count: Math.min(filtered.length, limit),
          items: filtered.slice(0, limit),
        };
      }
    }

    // Fallback: scrape the movie homepage
    return await scrapeDoubanMovie(fetchFn, category, options, limit);
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取豆瓣电影失败' };
  }
}

async function scrapeDoubanMovie(fetchFn: any, category: string, options: { query?: string; maxCount?: number }, limit: number): Promise<DoubanMovieResult> {
  try {
    const res = await fetchFn('https://movie.douban.com/', {
      headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://movie.douban.com/' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: DoubanMovieItem[] = [];

    // Parse movie items from the page
    const movieRegex = /<li[^>]*class="[^"]*ui-slide-item[^"]*"[^>]*data-title="([^"]*)"[^>]*data-rate="([^"]*)"[^>]*data-url="([^"]*)"[^>]*>/gi;
    let m;
    while ((m = movieRegex.exec(html)) !== null) {
      items.push({
        title: m[1] || '',
        link: m[3] || '',
        rating: m[2] || '暂无评分',
        pubDate: new Date().toISOString(),
        description: `${m[1]} - 评分 ${m[2]}`,
        cast: '',
        poster: '',
        category: '电影',
      });
    }

    // Also try to parse from the billboard sections
    const titleRegex = /<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/>/gi;
    while ((m = titleRegex.exec(html)) !== null) {
      if (m[1] && !items.find(it => it.title === m[1])) {
        items.push({
          title: m[1],
          link: 'https://movie.douban.com/',
          rating: '',
          pubDate: new Date().toISOString(),
          description: m[1],
          cast: '',
          poster: m[2] || '',
          category: '电影',
        });
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (err: any) {
    return { success: false, category, count: 0, items: [], error: err?.message || '获取豆瓣电影失败' };
  }
}

export async function syncDoubanMovieToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'douban_movie', syncedAt: new Date().toISOString() } };
}

/** 豆瓣广场 - https://www.douban.com/gallery/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface DoubanGalleryItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  author: string;
  category: string;
}

export interface DoubanGalleryResult {
  success: boolean;
  category: string;
  count: number;
  items: DoubanGalleryItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

export async function getDoubanGalleryStatus() {
  const s = await checkSiteAvailability('https://www.douban.com/gallery/', { timeoutMs: 8000 });
  return {
    key: 'douban_gallery',
    pluginKey: 'douban_gallery',
    label: '豆瓣广场',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '豆瓣广场 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchDoubanGallery(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<DoubanGalleryResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const res = await fetchFn('https://www.douban.com/gallery/', {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.douban.com/',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: DoubanGalleryItem[] = [];

    // Parse topic items from the gallery page
    const topicRegex = /<div[^>]*class="[^"]*topic-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let m;
    while ((m = topicRegex.exec(html)) !== null) {
      const block = m[1];
      const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
      const descMatch = block.match(/<p[^>]*>([^<]*)<\/p>/);
      const authorMatch = block.match(/<span[^>]*class="[^"]*author[^"]*"[^>]*>([^<]*)<\/span>/);

      if (titleMatch) {
        items.push({
          title: titleMatch[2]?.trim() || '',
          link: titleMatch[1].startsWith('http') ? titleMatch[1] : `https://www.douban.com${titleMatch[1]}`,
          description: descMatch?.[1]?.trim() || '',
          pubDate: new Date().toISOString(),
          author: authorMatch?.[1]?.trim() || '豆瓣用户',
          category: '话题',
        });
      }
    }

    // Also try alternative parsing for topic list
    const altTopicRegex = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    while ((m = altTopicRegex.exec(html)) !== null) {
      const block = m[1];
      const linkMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
      if (linkMatch) {
        const title = linkMatch[2]?.trim();
        if (title && title.length > 1 && !items.find(it => it.title === title)) {
          items.push({
            title,
            link: linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.douban.com${linkMatch[1]}`,
            description: '',
            pubDate: new Date().toISOString(),
            author: '豆瓣用户',
            category: '话题',
          });
        }
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()) || it.description.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取豆瓣广场失败' };
  }
}

export async function syncDoubanGalleryToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'douban_gallery', syncedAt: new Date().toISOString() } };
}

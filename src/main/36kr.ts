/** 36Kr 资讯与热点 */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';
import kr36Platform from './hotsearch/platforms/36kr';

export async function get36KrStatus() {
  const s = await checkSiteAvailability('https://36kr.com', { timeoutMs: 8000 });
  return {
    key: '36kr',
    pluginKey: '36kr',
    label: '36氪',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '36氪 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetch36Kr(category: string = 'all', options: { query?: string; limit?: number; maxCount?: number } = {}): Promise<RssResult> {
  const limit = options.limit || options.maxCount || 20;
  const query = options.query || (category !== 'all' ? category : '科技');

  // Google News 36kr RSS feed
  const url = `https://news.google.com/rss/search?q=site:36kr.com+${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const rssRes = await fetchAndParseRss(url);
  if (rssRes.success && rssRes.items.length > 0) {
    return {
      ...rssRes,
      count: Math.min(rssRes.items.length, limit),
      items: rssRes.items.slice(0, limit),
    };
  }

  // Fallback to platform scraper
  try {
    const items = await kr36Platform.fetch({ options: {} } as any);
    const filtered = options.query
      ? items.filter((it: any) => it.title?.toLowerCase().includes(options.query!.toLowerCase()))
      : items;
    return {
      success: true,
      url: 'https://36kr.com',
      title: '36氪',
      description: '让一部分人先看到未来',
      count: Math.min(filtered.length, limit),
      items: filtered.slice(0, limit).map((it: any) => ({
        title: it.title,
        link: it.url,
        url: it.url,
        description: it.hot || '',
        pubDate: new Date().toISOString(),
        author: '36Kr',
        category: ['科技', '商业'],
      })),
    };
  } catch (err: any) {
    return { success: false, url: '', title: '', description: '', count: 0, items: [], error: err?.message || '获取36氪失败' };
  }
}

export async function sync36KrToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: '36kr', syncedAt: new Date().toISOString() } };
}

export const get36krStatus = get36KrStatus;

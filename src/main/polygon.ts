/** Polygon 游戏与文化资讯 - https://www.polygon.com/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const POLYGON_FEEDS: Record<string, string> = {
  all: 'https://www.polygon.com/rss/index.xml',
  games: 'https://www.polygon.com/rss/index.xml',
  culture: 'https://www.polygon.com/rss/index.xml',
  reviews: 'https://www.polygon.com/rss/index.xml',
  news: 'https://www.polygon.com/rss/index.xml',
};

export async function getPolygonStatus() {
  const s = await checkSiteAvailability('https://www.polygon.com', { timeoutMs: 8000 });
  return {
    key: 'polygon',
    pluginKey: 'polygon',
    label: 'Polygon',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Polygon 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchPolygon(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = POLYGON_FEEDS[category] || POLYGON_FEEDS.all;
  const rssRes = await fetchAndParseRss(feedUrl);
  if (rssRes.success && rssRes.items.length > 0) {
    const limit = options.maxCount || 20;
    const filtered = options.query
      ? rssRes.items.filter((it) => it.title?.toLowerCase().includes(options.query!.toLowerCase()))
      : rssRes.items;
    return {
      ...rssRes,
      count: Math.min(filtered.length, limit),
      items: filtered.slice(0, limit),
    };
  }

  // Fallback to Google News search for Polygon
  const query = options.query || category || 'Polygon gaming';
  const url = `https://news.google.com/rss/search?q=site:polygon.com+${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;
  const fallbackRes = await fetchAndParseRss(url);
  if (fallbackRes.success) {
    const limit = options.maxCount || 20;
    return {
      ...fallbackRes,
      count: Math.min(fallbackRes.items.length, limit),
      items: fallbackRes.items.slice(0, limit),
    };
  }
  return fallbackRes;
}

export async function syncPolygonToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'polygon', syncedAt: new Date().toISOString() } };
}

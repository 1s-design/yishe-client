/** Billboard - https://www.billboard.com/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const BILLBOARD_FEEDS: Record<string, string> = {
  all: 'https://www.billboard.com/feed/',
  music: 'https://www.billboard.com/c/music/feed/',
  pop: 'https://www.billboard.com/c/music/pop/feed/',
  'hip Hop': 'https://www.billboard.com/c/music/rb-hip-hop/feed/',
  charts: 'https://www.billboard.com/c/music/charts/feed/',
};

export async function getBillboardStatus() {
  const s = await checkSiteAvailability('https://www.billboard.com', { timeoutMs: 8000 });
  return {
    key: 'billboard',
    pluginKey: 'billboard',
    label: 'Billboard',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Billboard 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchBillboard(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = BILLBOARD_FEEDS[category] || BILLBOARD_FEEDS.all;
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

  // Fallback to Google News search
  try {
    const query = options.query || category || 'music';
    const url = `https://news.google.com/rss/search?q=site:billboard.com+${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const fallbackRes = await fetchAndParseRss(url);
    if (fallbackRes.success) {
      const limit = options.maxCount || 20;
      return {
        ...fallbackRes,
        count: Math.min(fallbackRes.items.length, limit),
        items: fallbackRes.items.slice(0, limit),
      };
    }
  } catch {}

  return rssRes;
}

export async function syncBillboardToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'billboard', syncedAt: new Date().toISOString() } };
}

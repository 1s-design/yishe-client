/** IGN 游戏与娱乐资讯 - https://www.ign.com/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const IGN_FEEDS: Record<string, string> = {
  all: 'https://www.ign.com/feed.xml',
  games: 'https://www.ign.com/feed.xml',
  movies: 'https://www.ign.com/feed.xml',
  tv: 'https://www.ign.com/feed.xml',
  tech: 'https://www.ign.com/feed.xml',
  comics: 'https://www.ign.com/feed.xml',
};

export async function getIGNStatus() {
  const s = await checkSiteAvailability('https://www.ign.com', { timeoutMs: 8000 });
  return {
    key: 'ign',
    pluginKey: 'ign',
    label: 'IGN',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'IGN 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchIGN(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = IGN_FEEDS[category] || IGN_FEEDS.all;
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

  // Fallback to Google News search for IGN
  const query = options.query || category || 'IGN gaming';
  const url = `https://news.google.com/rss/search?q=site:ign.com+${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;
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

export async function syncIGNToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'ign', syncedAt: new Date().toISOString() } };
}

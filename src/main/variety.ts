/** Variety RSS - https://variety.com/feed/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const VARIETY_FEEDS: Record<string, string> = {
  all: 'https://variety.com/feed/',
  film: 'https://variety.com/v/film/feed/',
  tv: 'https://variety.com/v/tv/feed/',
  music: 'https://variety.com/v/music/feed/',
  tech: 'https://variety.com/v/digital/feed/',
};

export async function getVarietyStatus() {
  const s = await checkSiteAvailability('https://variety.com', { timeoutMs: 8000 });
  return {
    key: 'variety',
    pluginKey: 'variety',
    label: 'Variety',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Variety 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchVariety(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = VARIETY_FEEDS[category] || VARIETY_FEEDS.all;
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
  return rssRes;
}

export async function syncVarietyToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'variety', syncedAt: new Date().toISOString() } };
}

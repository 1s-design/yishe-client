/** Space.com RSS - https://www.space.com/feeds/all */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const SPACECOM_FEEDS: Record<string, string> = {
  all: 'https://www.space.com/feeds/all',
  space: 'https://www.space.com/feeds/all',
  tech: 'https://www.space.com/feeds/tech',
  astronomy: 'https://www.space.com/feeds/astronomy',
  spaceflight: 'https://www.space.com/feeds/spaceflight',
};

export async function getSpacecomStatus() {
  const s = await checkSiteAvailability('https://www.space.com', { timeoutMs: 8000 });
  return {
    key: 'spacecom',
    pluginKey: 'spacecom',
    label: 'Space.com',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Space.com 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchSpacecom(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = SPACECOM_FEEDS[category] || SPACECOM_FEEDS.all;
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

export async function syncSpacecomToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'spacecom', syncedAt: new Date().toISOString() } };
}

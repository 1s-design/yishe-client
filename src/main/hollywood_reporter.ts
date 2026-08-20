/** Hollywood Reporter RSS - https://www.hollywoodreporter.com/feed/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const THR_FEEDS: Record<string, string> = {
  all: 'https://www.hollywoodreporter.com/feed/',
  film: 'https://www.hollywoodreporter.com/c/film/feed/',
  tv: 'https://www.hollywoodreporter.com/c/tv/feed/',
  music: 'https://www.hollywoodreporter.com/c/music/feed/',
  business: 'https://www.hollywoodreporter.com/c/business/feed/',
};

export async function getHollywoodReporterStatus() {
  const s = await checkSiteAvailability('https://www.hollywoodreporter.com', { timeoutMs: 8000 });
  return {
    key: 'hollywood_reporter',
    pluginKey: 'hollywood_reporter',
    label: 'Hollywood Reporter',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Hollywood Reporter 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchHollywoodReporter(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = THR_FEEDS[category] || THR_FEEDS.all;
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

export async function syncHollywoodReporterToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'hollywood_reporter', syncedAt: new Date().toISOString() } };
}

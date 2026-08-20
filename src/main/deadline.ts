/** Deadline - https://deadline.com/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const DEADLINE_FEEDS: Record<string, string> = {
  all: 'https://deadline.com/feed/',
  film: 'https://deadline.com/category/film/feed/',
  tv: 'https://deadline.com/category/tv/feed/',
  business: 'https://deadline.com/category/business/feed/',
};

export async function getDeadlineStatus() {
  const s = await checkSiteAvailability('https://deadline.com', { timeoutMs: 8000 });
  return {
    key: 'deadline',
    pluginKey: 'deadline',
    label: 'Deadline',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Deadline 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchDeadline(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = DEADLINE_FEEDS[category] || DEADLINE_FEEDS.all;
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
    const query = options.query || category || 'entertainment';
    const url = `https://news.google.com/rss/search?q=site:deadline.com+${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
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

export async function syncDeadlineToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'deadline', syncedAt: new Date().toISOString() } };
}

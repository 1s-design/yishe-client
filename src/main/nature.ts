/** Nature RSS - https://www.nature.com/nature.rss */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const NATURE_FEEDS: Record<string, string> = {
  all: 'https://www.nature.com/nature.rss',
  news: 'https://www.nature.com/news.rss',
  research: 'https://www.nature.com/nature/research-articles.rss',
  commentary: 'https://www.nature.com/nature/commentary.rss',
};

export async function getNatureStatus() {
  const s = await checkSiteAvailability('https://www.nature.com', { timeoutMs: 8000 });
  return {
    key: 'nature',
    pluginKey: 'nature',
    label: 'Nature',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Nature 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchNature(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = NATURE_FEEDS[category] || NATURE_FEEDS.all;
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

export async function syncNatureToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'nature', syncedAt: new Date().toISOString() } };
}

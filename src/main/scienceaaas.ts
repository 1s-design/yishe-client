/** Science AAAS RSS - https://www.science.org/rss/news_current.xml */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const AAAS_FEEDS: Record<string, string> = {
  news: 'https://www.science.org/rss/news_current.xml',
  research: 'https://www.science.org/rss/news_current.xml',
  all: 'https://www.science.org/rss/news_current.xml',
};

export async function getScienceAaasStatus() {
  const s = await checkSiteAvailability('https://www.science.org', { timeoutMs: 8000 });
  return {
    key: 'scienceaaas',
    pluginKey: 'scienceaaas',
    label: 'Science AAAS',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Science AAAS 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchScienceAaas(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = AAAS_FEEDS[category] || AAAS_FEEDS.all;
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

export async function syncScienceAaasToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'scienceaaas', syncedAt: new Date().toISOString() } };
}

/** Quanta Magazine RSS - https://www.quantamagazine.org/feed/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const QUANTA_FEEDS: Record<string, string> = {
  all: 'https://www.quantamagazine.org/feed/',
  math: 'https://www.quantamagazine.org/feed/mathematics/',
  physics: 'https://www.quantamagazine.org/feed/physics/',
  biology: 'https://www.quantamagazine.org/feed/biology/',
  cs: 'https://www.quantamagazine.org/feed/computer-science/',
};

export async function getQuantaStatus() {
  const s = await checkSiteAvailability('https://www.quantamagazine.org', { timeoutMs: 8000 });
  return {
    key: 'quantamagazine',
    pluginKey: 'quantamagazine',
    label: 'Quanta Magazine',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Quanta Magazine 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchQuanta(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = QUANTA_FEEDS[category] || QUANTA_FEEDS.all;
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

export async function syncQuantaToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'quantamagazine', syncedAt: new Date().toISOString() } };
}

/** 路透社 Reuters RSS */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

export async function getReutersStatus() {
  const s = await checkSiteAvailability('https://www.reuters.com', { timeoutMs: 8000 });
  return {
    key: 'reuters',
    pluginKey: 'reuters',
    label: 'Reuters',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Reuters 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchReuters(category: string = 'technology', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const query = options.query || category || 'technology';
  const url = `https://news.google.com/rss/search?q=site:reuters.com+${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const rssRes = await fetchAndParseRss(url);
  if (rssRes.success) {
    const limit = options.maxCount || 20;
    return {
      ...rssRes,
      count: Math.min(rssRes.items.length, limit),
      items: rssRes.items.slice(0, limit),
    };
  }
  return rssRes;
}

export async function syncReutersToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'reuters', syncedAt: new Date().toISOString() } };
}

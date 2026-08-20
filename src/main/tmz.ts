/** TMZ - https://www.tmz.com/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

export async function getTmzStatus() {
  const s = await checkSiteAvailability('https://www.tmz.com', { timeoutMs: 8000 });
  return {
    key: 'tmz',
    pluginKey: 'tmz',
    label: 'TMZ',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'TMZ 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchTmz(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const limit = options.maxCount || 20;
  const query = options.query || (category !== 'all' ? category : 'celebrity');

  // Google News search for tmz.com
  const url = `https://news.google.com/rss/search?q=site:tmz.com+${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const rssRes = await fetchAndParseRss(url);
  if (rssRes.success && rssRes.items.length > 0) {
    return {
      ...rssRes,
      count: Math.min(rssRes.items.length, limit),
      items: rssRes.items.slice(0, limit),
    };
  }

  // Fallback: broader Google News search for TMZ
  try {
    const fallbackUrl = `https://news.google.com/rss/search?q=TMZ+${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const fallbackRes = await fetchAndParseRss(fallbackUrl);
    if (fallbackRes.success) {
      return {
        ...fallbackRes,
        count: Math.min(fallbackRes.items.length, limit),
        items: fallbackRes.items.slice(0, limit),
      };
    }
  } catch {}

  return { success: false, url: '', title: '', description: '', count: 0, items: [], error: '获取TMZ失败' };
}

export async function syncTmzToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'tmz', syncedAt: new Date().toISOString() } };
}

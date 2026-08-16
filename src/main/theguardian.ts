/** The Guardian 卫报 RSS / API */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const GUARDIAN_FEEDS: Record<string, string> = {
  technology: 'https://www.theguardian.com/technology/rss',
  world: 'https://www.theguardian.com/world/rss',
  business: 'https://www.theguardian.com/uk/business/rss',
  science: 'https://www.theguardian.com/science/rss',
  environment: 'https://www.theguardian.com/environment/rss',
};

export async function getGuardianStatus() {
  const s = await checkSiteAvailability('https://www.theguardian.com', { timeoutMs: 8000 });
  return {
    key: 'theguardian',
    pluginKey: 'theguardian',
    label: 'The Guardian',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'The Guardian 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'fetch', 'status'],
  };
}
export const getTheguardianStatus = getGuardianStatus;


export async function searchGuardian(apiKey: string = '', options: { query?: string; category?: string; maxCount?: number } = {}): Promise<RssResult> {
  const category = options.category || 'technology';
  const feedUrl = GUARDIAN_FEEDS[category] || GUARDIAN_FEEDS.technology;
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

export async function syncGuardianToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'theguardian', syncedAt: new Date().toISOString() } };
}

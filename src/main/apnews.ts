/** AP News Technology - https://apnews.com/hub/technology
 * 注：AP News 已停止官方 RSS，通过 Google News RSS 搜索获取 */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const TOPIC_QUERIES: Record<string, string> = {
  technology: 'technology',
  world: 'world',
  us: 'US news',
  politics: 'politics',
  sports: 'sports',
  business: 'business',
  science: 'science',
  health: 'health',
};

export async function getApnewsStatus() {
  const s = await checkSiteAvailability('https://apnews.com/hub/technology', { timeoutMs: 8000 });
  return {
    key: 'apnews',
    pluginKey: 'apnews',
    label: 'AP News',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'AP News 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchApnews(category: string = 'technology', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const query = options.query || TOPIC_QUERIES[category] || category || 'technology';
  const url = `https://news.google.com/rss/search?q=site:apnews.com+${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
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

export async function syncApnewsToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'apnews', syncedAt: new Date().toISOString() } };
}

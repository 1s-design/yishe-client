/** Our World in Data 全球数据统计 - https://ourworldindata.org/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const OWID_FEEDS: Record<string, string> = {
  all: 'https://ourworldindata.org/feed',
  health: 'https://ourworldindata.org/feed',
  energy: 'https://ourworldindata.org/feed',
  environment: 'https://ourworldindata.org/feed',
  poverty: 'https://ourworldindata.org/feed',
};

export async function getOurWorldInDataStatus() {
  const s = await checkSiteAvailability('https://ourworldindata.org', { timeoutMs: 8000 });
  return {
    key: 'ourworldindata',
    pluginKey: 'ourworldindata',
    label: 'Our World in Data',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Our World in Data 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchOurWorldInData(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = OWID_FEEDS[category] || OWID_FEEDS.all;
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

export async function syncOurWorldInDataToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'ourworldindata', syncedAt: new Date().toISOString() } };
}

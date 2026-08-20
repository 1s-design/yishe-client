/** BBC Sport 体育资讯 - https://www.bbc.com/sport */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const BBC_SPORT_FEEDS: Record<string, string> = {
  all: 'https://feeds.bbci.co.uk/sport/rss.xml',
  football: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
  cricket: 'https://feeds.bbci.co.uk/sport/cricket/rss.xml',
  tennis: 'https://feeds.bbci.co.uk/sport/tennis/rss.xml',
  golf: 'https://feeds.bbci.co.uk/sport/golf/rss.xml',
  athletics: 'https://feeds.bbci.co.uk/sport/athletics/rss.xml',
  formula1: 'https://feeds.bbci.co.uk/sport/formula1/rss.xml',
  rugby: 'https://feeds.bbci.co.uk/sport/rugby-union/rss.xml',
};

export async function getBBCSportStatus() {
  const s = await checkSiteAvailability('https://www.bbc.com/sport', { timeoutMs: 8000 });
  return {
    key: 'bbc_sport',
    pluginKey: 'bbc_sport',
    label: 'BBC Sport',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'BBC Sport 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchBBCSport(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = BBC_SPORT_FEEDS[category] || BBC_SPORT_FEEDS.all;
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

export async function syncBBCSportToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'bbc_sport', syncedAt: new Date().toISOString() } };
}

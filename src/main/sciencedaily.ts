/** ScienceDaily RSS - https://www.sciencedaily.com/rss/all.xml */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const SD_FEEDS: Record<string, string> = {
  all: 'https://www.sciencedaily.com/rss/all.xml',
  tech: 'https://www.sciencedaily.com/rss/computers_math.xml',
  health: 'https://www.sciencedaily.com/rss/health_medicine.xml',
  science: 'https://www.sciencedaily.com/rss/mind_brain.xml',
  environment: 'https://www.sciencedaily.com/rss/earth_climate.xml',
  society: 'https://www.sciencedaily.com/rss/science_society.xml',
};

export async function getScienceDailyStatus() {
  const s = await checkSiteAvailability('https://www.sciencedaily.com', { timeoutMs: 8000 });
  return {
    key: 'sciencedaily',
    pluginKey: 'sciencedaily',
    label: 'ScienceDaily',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'ScienceDaily 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchScienceDaily(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = SD_FEEDS[category] || SD_FEEDS.all;
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

export async function syncScienceDailyToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'sciencedaily', syncedAt: new Date().toISOString() } };
}

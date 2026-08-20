/** MIT Technology Review RSS - https://www.technologyreview.com/feed/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const FEEDS: Record<string, string> = {
  all: 'https://www.technologyreview.com/feed/',
  ai: 'https://www.technologyreview.com/topic/artificial-intelligence/feed/',
  computing: 'https://www.technologyreview.com/topic/computing/feed/',
  biotech: 'https://www.technologyreview.com/topic/biotechnology/feed/',
  energy: 'https://www.technologyreview.com/topic/energy/feed/',
  ethics: 'https://www.technologyreview.com/topic/ethics/feed/',
};

export async function getMittechreviewrssStatus() {
  const s = await checkSiteAvailability('https://www.technologyreview.com', { timeoutMs: 8000 });
  return {
    key: 'mittechreviewrss',
    pluginKey: 'mittechreviewrss',
    label: 'MIT Tech Review RSS',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'MIT Tech Review RSS 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchMittechreviewrss(category: string = 'all'): Promise<RssResult> {
  return fetchAndParseRss(FEEDS[category] || FEEDS.all);
}

export async function syncMittechreviewrssToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'mittechreviewrss', syncedAt: new Date().toISOString() } };
}

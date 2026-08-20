/** TIME RSS - https://time.com/feed/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const FEEDS: Record<string, string> = {
  all: 'https://time.com/feed/',
  tech: 'https://time.com/section/tech/feed/',
  science: 'https://time.com/section/science/feed/',
  health: 'https://time.com/section/health/feed/',
  business: 'https://time.com/section/business/feed/',
  politics: 'https://time.com/section/politics/feed/',
  world: 'https://time.com/section/world/feed/',
};

export async function getTimeStatus() {
  const s = await checkSiteAvailability('https://time.com', { timeoutMs: 8000 });
  return {
    key: 'time',
    pluginKey: 'time',
    label: 'TIME',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'TIME 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchTime(category: string = 'all'): Promise<RssResult> {
  return fetchAndParseRss(FEEDS[category] || FEEDS.all);
}

export async function syncTimeToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'time', syncedAt: new Date().toISOString() } };
}

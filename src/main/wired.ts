/** Wired RSS - https://www.wired.com/feed/rss */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const FEEDS: Record<string, string> = {
  all: 'https://www.wired.com/feed/rss',
  business: 'https://www.wired.com/feed/tag/business/latest/rss',
  culture: 'https://www.wired.com/feed/tag/culture/latest/rss',
  gear: 'https://www.wired.com/feed/tag/gear/latest/rss',
  science: 'https://www.wired.com/feed/tag/science/latest/rss',
  security: 'https://www.wired.com/feed/tag/security/latest/rss',
  transportation: 'https://www.wired.com/feed/tag/transportation/latest/rss',
  ai: 'https://www.wired.com/feed/tag/ai/latest/rss',
};

export async function getWiredStatus() {
  const s = await checkSiteAvailability('https://www.wired.com', { timeoutMs: 8000 });
  return {
    key: 'wired',
    pluginKey: 'wired',
    label: 'Wired',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Wired 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchWired(category: string = 'all'): Promise<RssResult> {
  return fetchAndParseRss(FEEDS[category] || FEEDS.all);
}

export async function syncWiredToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'wired', syncedAt: new Date().toISOString() } };
}

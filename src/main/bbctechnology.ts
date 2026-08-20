/** BBC Technology RSS - https://feeds.bbci.co.uk/news/technology/rss.xml */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const FEEDS: Record<string, string> = {
  technology: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
  science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
  health: 'https://feeds.bbci.co.uk/news/health/rss.xml',
  world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
};

export async function getBbctechnologyStatus() {
  const s = await checkSiteAvailability('https://www.bbc.com/news/technology', { timeoutMs: 8000 });
  return {
    key: 'bbctechnology',
    pluginKey: 'bbctechnology',
    label: 'BBC Technology',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'BBC Technology 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchBbctechnology(category: string = 'technology'): Promise<RssResult> {
  return fetchAndParseRss(FEEDS[category] || FEEDS.technology);
}

export async function syncBbctechnologyToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'bbctechnology', syncedAt: new Date().toISOString() } };
}

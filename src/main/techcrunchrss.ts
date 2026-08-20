/** TechCrunch RSS - https://techcrunch.com/feed/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const FEEDS: Record<string, string> = {
  all: 'https://techcrunch.com/feed/',
  startup: 'https://techcrunch.com/category/startups/feed/',
  ai: 'https://techcrunch.com/category/artificial-intelligence/feed/',
  crypto: 'https://techcrunch.com/category/cryptocurrency/feed/',
  apps: 'https://techcrunch.com/category/apps/feed/',
  gadgets: 'https://techcrunch.com/category/gadgets/feed/',
  venture: 'https://techcrunch.com/category/venture/feed/',
  security: 'https://techcrunch.com/category/security/feed/',
};

export async function getTechcrunchrssStatus() {
  const s = await checkSiteAvailability('https://techcrunch.com', { timeoutMs: 8000 });
  return {
    key: 'techcrunchrss',
    pluginKey: 'techcrunchrss',
    label: 'TechCrunch RSS',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'TechCrunch RSS 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchTechcrunchrss(category: string = 'all'): Promise<RssResult> {
  return fetchAndParseRss(FEEDS[category] || FEEDS.all);
}

export async function syncTechcrunchrssToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'techcrunchrss', syncedAt: new Date().toISOString() } };
}

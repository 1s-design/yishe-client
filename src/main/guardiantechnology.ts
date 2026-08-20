/** The Guardian Technology RSS - https://www.theguardian.com/technology/rss */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const FEEDS: Record<string, string> = {
  technology: 'https://www.theguardian.com/technology/rss',
  world: 'https://www.theguardian.com/world/rss',
  business: 'https://www.theguardian.com/uk/business/rss',
  science: 'https://www.theguardian.com/science/rss',
  environment: 'https://www.theguardian.com/environment/rss',
  culture: 'https://www.theguardian.com/uk/culture/rss',
};

export async function getGuardiantechnologyStatus() {
  const s = await checkSiteAvailability('https://www.theguardian.com/technology', { timeoutMs: 8000 });
  return {
    key: 'guardiantechnology',
    pluginKey: 'guardiantechnology',
    label: 'The Guardian Technology',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'The Guardian Technology 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchGuardiantechnology(category: string = 'technology'): Promise<RssResult> {
  return fetchAndParseRss(FEEDS[category] || FEEDS.technology);
}

export async function syncGuardiantechnologyToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'guardiantechnology', syncedAt: new Date().toISOString() } };
}

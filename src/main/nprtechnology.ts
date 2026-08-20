/** NPR Technology RSS - https://www.npr.org/sections/technology/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const FEEDS: Record<string, string> = {
  technology: 'https://feeds.npr.org/1014/rss.xml',
  news: 'https://feeds.npr.org/1001/rss.xml',
  world: 'https://feeds.npr.org/1004/rss.xml',
  business: 'https://feeds.npr.org/1006/rss.xml',
  science: 'https://feeds.npr.org/1007/rss.xml',
  health: 'https://feeds.npr.org/1128/rss.xml',
  arts: 'https://feeds.npr.org/1008/rss.xml',
  music: 'https://feeds.npr.org/1039/rss.xml',
};

export async function getNprtechnologyStatus() {
  const s = await checkSiteAvailability('https://www.npr.org/sections/technology/', { timeoutMs: 8000 });
  return {
    key: 'nprtechnology',
    pluginKey: 'nprtechnology',
    label: 'NPR Technology',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'NPR Technology 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchNprtechnology(category: string = 'technology'): Promise<RssResult> {
  return fetchAndParseRss(FEEDS[category] || FEEDS.technology);
}

export async function syncNprtechnologyToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'nprtechnology', syncedAt: new Date().toISOString() } };
}

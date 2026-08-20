/** Ars Technica RSS - https://feeds.arstechnica.com/arstechnica/index */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const FEEDS: Record<string, string> = {
  all: 'https://feeds.arstechnica.com/arstechnica/index',
  tech: 'https://feeds.arstechnica.com/arstechnica/technology-policy',
  science: 'https://feeds.arstechnica.com/arstechnica/science',
  gadgets: 'https://feeds.arstechnica.com/arstechnica/gadgets',
  security: 'https://feeds.arstechnica.com/arstechnica/security',
  ai: 'https://feeds.arstechnica.com/arstechnica/ai',
};

export async function getArstechnicarssStatus() {
  const s = await checkSiteAvailability('https://arstechnica.com', { timeoutMs: 8000 });
  return {
    key: 'arstechnicarss',
    pluginKey: 'arstechnicarss',
    label: 'Ars Technica RSS',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Ars Technica RSS 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchArstechnicarss(category: string = 'all'): Promise<RssResult> {
  return fetchAndParseRss(FEEDS[category] || FEEDS.all);
}

export async function syncArstechnicarssToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'arstechnicarss', syncedAt: new Date().toISOString() } };
}

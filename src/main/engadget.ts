/** Engadget RSS - https://www.engadget.com/feed/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const FEEDS: Record<string, string> = {
  all: 'https://www.engadget.com/feed/',
  gear: 'https://www.engadget.com/rss.xml',
  gaming: 'https://www.engadget.com/gaming/rss.xml',
  entertainment: 'https://www.engadget.com/entertainment/rss.xml',
  science: 'https://www.engadget.com/science/rss.xml',
  ai: 'https://www.engadget.com/tag/ai/rss.xml',
};

export async function getEngadgetStatus() {
  const s = await checkSiteAvailability('https://www.engadget.com', { timeoutMs: 8000 });
  return {
    key: 'engadget',
    pluginKey: 'engadget',
    label: 'Engadget',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Engadget 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchEngadget(category: string = 'all'): Promise<RssResult> {
  return fetchAndParseRss(FEEDS[category] || FEEDS.all);
}

export async function syncEngadgetToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'engadget', syncedAt: new Date().toISOString() } };
}

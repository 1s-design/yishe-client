/** The Verge RSS - https://www.theverge.com/rss/index.xml */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const FEEDS: Record<string, string> = {
  all: 'https://www.theverge.com/rss/index.xml',
  ai: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
  tech: 'https://www.theverge.com/rss/tech/index.xml',
  reviews: 'https://www.theverge.com/rss/reviews/index.xml',
  science: 'https://www.theverge.com/rss/science/index.xml',
  entertainment: 'https://www.theverge.com/rss/entertainment/index.xml',
  transportation: 'https://www.theverge.com/rss/transportation/index.xml',
};

export async function getThevergerssStatus() {
  const s = await checkSiteAvailability('https://www.theverge.com', { timeoutMs: 8000 });
  return {
    key: 'thevergerss',
    pluginKey: 'thevergerss',
    label: 'The Verge RSS',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'The Verge RSS 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchThevergerss(category: string = 'all'): Promise<RssResult> {
  return fetchAndParseRss(FEEDS[category] || FEEDS.all);
}

export async function syncThevergerssToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'thevergerss', syncedAt: new Date().toISOString() } };
}

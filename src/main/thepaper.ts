/** 澎湃新闻 RSS / 资讯 */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const THEPAPER_FEEDS: Record<string, string> = {
  all: 'https://feedx.net/rss/thepaper.xml',
  society: 'https://feedx.net/rss/thepaper.xml',
  finance: 'https://feedx.net/rss/thepaper.xml',
  tech: 'https://feedx.net/rss/thepaper.xml',
};

export async function getThePaperStatus() {
  const s = await checkSiteAvailability('https://www.thepaper.cn', { timeoutMs: 8000 });
  return {
    key: 'thepaper',
    pluginKey: 'thepaper',
    label: '澎湃新闻',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '澎湃新闻 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchThePaper(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = THEPAPER_FEEDS[category] || THEPAPER_FEEDS.all;
  try {
    const rssRes = await fetchAndParseRss(feedUrl);
    if (rssRes.success && rssRes.items.length > 0) {
      const limit = options.maxCount || 20;
      const filtered = options.query
        ? rssRes.items.filter((it) => it.title?.toLowerCase().includes(options.query!.toLowerCase()))
        : rssRes.items;
      return {
        ...rssRes,
        count: Math.min(filtered.length, limit),
        items: filtered.slice(0, limit),
      };
    }
  } catch {}

  // Fallback to Google News search for The Paper
  const query = options.query || category || '澎湃新闻';
  const url = `https://news.google.com/rss/search?q=site:thepaper.cn+${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const fallbackRes = await fetchAndParseRss(url);
  if (fallbackRes.success) {
    const limit = options.maxCount || 20;
    return {
      ...fallbackRes,
      count: Math.min(fallbackRes.items.length, limit),
      items: fallbackRes.items.slice(0, limit),
    };
  }
  return fallbackRes;
}

export async function syncThePaperToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'thepaper', syncedAt: new Date().toISOString() } };
}

export const getThepaperStatus = getThePaperStatus;

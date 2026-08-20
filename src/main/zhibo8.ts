/** 直播吧 体育资讯 - https://www.zhibo8.com/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const ZHIBO8_FEEDS: Record<string, string> = {
  all: 'https://www.zhibo8.com/rss/news.xml',
  nba: 'https://www.zhibo8.com/rss/nba.xml',
  football: 'https://www.zhibo8.com/rss/zuqiu.xml',
  cba: 'https://www.zhibo8.com/rss/cba.xml',
};

export async function getZhibo8Status() {
  const s = await checkSiteAvailability('https://www.zhibo8.com', { timeoutMs: 8000 });
  return {
    key: 'zhibo8',
    pluginKey: 'zhibo8',
    label: '直播吧',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '直播吧 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchZhibo8(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = ZHIBO8_FEEDS[category] || ZHIBO8_FEEDS.all;
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

  // Fallback to Google News search for Zhibo8
  const query = options.query || category || '直播吧';
  const url = `https://news.google.com/rss/search?q=site:zhibo8.com+${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
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

export async function syncZhibo8ToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'zhibo8', syncedAt: new Date().toISOString() } };
}

/** 新华网 RSS */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const XH_FEEDS: Record<string, string> = {
  tech: 'http://www.news.cn/tech/news_tech.xml',
  auto: 'http://www.news.cn/auto/news_auto.xml',
  world: 'http://www.news.cn/tech/news_tech.xml',
  finance: 'http://www.news.cn/tech/news_tech.xml',
};

export async function getXHStatus() {
  const s = await checkSiteAvailability('http://www.news.cn', { timeoutMs: 8000 });
  return {
    key: 'xinhuanet',
    pluginKey: 'xinhuanet',
    label: '新华网',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '新华网 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}
export const getXinhuanetStatus = getXHStatus;


export async function fetchXH(category: string = 'tech', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = XH_FEEDS[category] || XH_FEEDS.tech;
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
  return rssRes;
}

export async function syncXHToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'xinhuanet', syncedAt: new Date().toISOString() } };
}

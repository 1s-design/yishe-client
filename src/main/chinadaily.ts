/** 中国日报 RSS - https://www.chinadaily.com.cn/rss */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const CD_FEEDS: Record<string, string> = {
  china: 'https://www.chinadaily.com.cn/rss/china_rss.xml',
  world: 'https://www.chinadaily.com.cn/rss/world_rss.xml',
  business: 'https://www.chinadaily.com.cn/rss/business_rss.xml',
  tech: 'https://www.chinadaily.com.cn/rss/china_rss.xml',
  culture: 'https://www.chinadaily.com.cn/rss/culture_rss.xml',
  sports: 'https://www.chinadaily.com.cn/rss/sports_rss.xml',
  opinion: 'https://www.chinadaily.com.cn/rss/opinion_rss.xml',
};

export async function getChinaDailyStatus() {
  const s = await checkSiteAvailability('https://www.chinadaily.com.cn', { timeoutMs: 8000 });
  return {
    key: 'chinadaily',
    pluginKey: 'chinadaily',
    label: '中国日报',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '中国日报 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}
export const getChinadailyStatus = getChinaDailyStatus;


export async function fetchChinaDaily(category: string = 'china', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = CD_FEEDS[category] || CD_FEEDS.china;
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

export async function syncChinaDailyToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'chinadaily', syncedAt: new Date().toISOString() } };
}

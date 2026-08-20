/** 少数派 - https://sspai.com/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';
import sspaiPlatform from './hotsearch/platforms/sspai';

export async function getSspaiStatus() {
  const s = await checkSiteAvailability('https://sspai.com', { timeoutMs: 8000 });
  return {
    key: 'sspai',
    pluginKey: 'sspai',
    label: '少数派',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '少数派 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchSspai(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const limit = options.maxCount || 20;
  const query = options.query || (category !== 'all' ? category : '');

  // Try Google News search for sspai.com
  if (query) {
    const url = `https://news.google.com/rss/search?q=site:sspai.com+${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
    const rssRes = await fetchAndParseRss(url);
    if (rssRes.success && rssRes.items.length > 0) {
      return {
        ...rssRes,
        count: Math.min(rssRes.items.length, limit),
        items: rssRes.items.slice(0, limit),
      };
    }
  }

  // Fallback to platform scraper
  try {
    const items = await sspaiPlatform.fetch({ options: {} } as any);
    const filtered = query
      ? items.filter((it: any) => it.title?.toLowerCase().includes(query!.toLowerCase()))
      : items;
    return {
      success: true,
      url: 'https://sspai.com',
      title: '少数派',
      description: '少数派优质文章与推荐',
      count: Math.min(filtered.length, limit),
      items: filtered.slice(0, limit).map((it: any) => ({
        title: it.title,
        link: it.url,
        url: it.url,
        description: it.hot || '',
        pubDate: new Date().toISOString(),
        author: '少数派',
        category: ['科技', '数码'],
      })),
    };
  } catch (err: any) {
    return { success: false, url: '', title: '', description: '', count: 0, items: [], error: err?.message || '获取少数派失败' };
  }
}

export async function syncSspaiToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'sspai', syncedAt: new Date().toISOString() } };
}

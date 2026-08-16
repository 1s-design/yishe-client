/** 虎嗅 资讯与深度文章 */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';
import huxiuPlatform from './hotsearch/platforms/huxiu';

const HUXIU_FEED = 'https://rss.huxiu.com/';

export async function getHuxiuStatus() {
  const s = await checkSiteAvailability('https://www.huxiu.com', { timeoutMs: 8000 });
  return {
    key: 'huxiu',
    pluginKey: 'huxiu',
    label: '虎嗅',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '虎嗅 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchHuxiu(_category: string = 'all', options: { query?: string; limit?: number } = {}): Promise<RssResult> {
  try {
    const rssRes = await fetchAndParseRss(HUXIU_FEED);
    if (rssRes.success && rssRes.items.length > 0) {
      const limit = options.limit || 20;
      const filtered = options.query
        ? rssRes.items.filter((it: any) => it.title?.toLowerCase().includes(options.query!.toLowerCase()))
        : rssRes.items;
      return {
        ...rssRes,
        count: Math.min(filtered.length, limit),
        items: filtered.slice(0, limit),
      };
    }
  } catch {}

  // Fallback to platform scraper
  try {
    const items = await huxiuPlatform.fetch({ options: {} } as any);
    const limit = options.limit || 20;
    const filtered = options.query
      ? items.filter((it: any) => it.title?.toLowerCase().includes(options.query!.toLowerCase()))
      : items;
    return {
      success: true,
      url: 'https://www.huxiu.com',
      title: '虎嗅',
      description: '虎嗅网文章与资讯',
      count: Math.min(filtered.length, limit),
      items: filtered.slice(0, limit).map((it: any) => ({
        title: it.title,
        link: it.url,
        url: it.url,
        description: it.hot || '',
        pubDate: new Date().toISOString(),
        author: '虎嗅',
        category: ['商业', '科技'],
      })),
    };
  } catch (err: any) {
    return { success: false, url: '', title: '', description: '', count: 0, items: [], error: err?.message || '获取虎嗅失败' };
  }
}

export async function syncHuxiuToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'huxiu', syncedAt: new Date().toISOString() } };
}

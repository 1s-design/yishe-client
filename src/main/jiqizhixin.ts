/** 机器之心 - https://www.jiqizhixin.com/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

export async function getJiqizhixinStatus() {
  const s = await checkSiteAvailability('https://www.jiqizhixin.com', { timeoutMs: 8000 });
  return {
    key: 'jiqizhixin',
    pluginKey: 'jiqizhixin',
    label: '机器之心',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '机器之心 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchJiqizhixin(category: string = 'ai', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const limit = options.maxCount || 20;
  const query = options.query || (category !== 'all' ? category : 'AI');

  // Google News search for jiqizhixin.com
  const url = `https://news.google.com/rss/search?q=site:jiqizhixin.com+${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const rssRes = await fetchAndParseRss(url);
  if (rssRes.success && rssRes.items.length > 0) {
    return {
      ...rssRes,
      count: Math.min(rssRes.items.length, limit),
      items: rssRes.items.slice(0, limit),
    };
  }

  // Fallback: broader Google News search for 机器之心
  try {
    const fallbackUrl = `https://news.google.com/rss/search?q=%E6%9C%BA%E5%99%A8%E4%B9%8B%E5%BF%83+${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
    const fallbackRes = await fetchAndParseRss(fallbackUrl);
    if (fallbackRes.success) {
      return {
        ...fallbackRes,
        count: Math.min(fallbackRes.items.length, limit),
        items: fallbackRes.items.slice(0, limit),
      };
    }
  } catch {}

  return { success: false, url: '', title: '', description: '', count: 0, items: [], error: '获取机器之心失败' };
}

export async function syncJiqizhixinToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'jiqizhixin', syncedAt: new Date().toISOString() } };
}

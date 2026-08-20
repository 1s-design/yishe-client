/** Phys.org RSS - https://phys.org/rss-feed/breaking/ */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';

const PHYSORG_FEEDS: Record<string, string> = {
  breaking: 'https://phys.org/rss-feed/breaking/',
  science: 'https://phys.org/rss-feed/science-news/',
  tech: 'https://phys.org/rss-feed/technology-news/',
  space: 'https://phys.org/rss-feed/space-astronomy-news/',
  biology: 'https://phys.org/rss-feed/biology-news/',
  physics: 'https://phys.org/rss-feed/physics-news/',
};

export async function getPhysorgStatus() {
  const s = await checkSiteAvailability('https://phys.org', { timeoutMs: 8000 });
  return {
    key: 'physorg',
    pluginKey: 'physorg',
    label: 'Phys.org',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Phys.org 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'status'],
  };
}

export async function fetchPhysorg(category: string = 'breaking', options: { query?: string; maxCount?: number } = {}): Promise<RssResult> {
  const feedUrl = PHYSORG_FEEDS[category] || PHYSORG_FEEDS.breaking;
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

export async function syncPhysorgToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'physorg', syncedAt: new Date().toISOString() } };
}

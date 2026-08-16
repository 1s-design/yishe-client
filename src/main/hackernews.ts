/**
 * Hacker News 热帖搜索能力 - https://news.ycombinator.com
 * API: Firebase REST API (无需key)
 */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const API_BASE = 'https://hacker-news.firebaseio.com/v0';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface HNItem {
  id: number;
  title: string;
  url?: string;
  score: number;
  by: string;
  time: number;
  descendants: number;
  type: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  text?: string;
  kids?: number[];
  parent?: number;
  deleted?: boolean;
  dead?: boolean;
}

export interface HNSearchResult {
  success: boolean;
  query: string;
  count: number;
  total: number;
  items: HNItem[];
  error?: string;
}

export type HNStoryType = 'top' | 'new' | 'best' | 'ask' | 'show' | 'job';

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

export async function getHNStatus() {
  const site = await checkSiteAvailability('https://news.ycombinator.com', { timeoutMs: 8000 });
  return { key: 'hackernews', pluginKey: 'hackernews', label: 'Hacker News', connected: site.ok, available: site.ok, status: site.ok ? 'connected' : 'error', state: site.ok ? 'idle' : 'offline', message: site.ok ? 'Hacker News 可用' : `无法连接: ${site.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'fetch', 'status'] };
}
export const getHackernewsStatus = getHNStatus;


export async function searchHN(type: HNStoryType = 'top', options: { limit?: number; offset?: number; keyword?: string; minScore?: number; since?: number } = {}): Promise<HNSearchResult> {
  const limit = Math.min(options.limit || 30, 100);
  const offset = options.offset || 0;
  try {
    const fetchFn = await getFetchImpl();
    const typeRes = await fetchFn(`${API_BASE}/${type}stories.json`, { headers: { 'User-Agent': USER_AGENT } });
    if (!typeRes.ok) throw new Error(`HTTP ${typeRes.status}`);
    const ids = (await typeRes.json()) as number[];
    const slicedIds = ids.slice(offset, offset + limit);
    const items = await Promise.all(slicedIds.map(async (id) => {
      const res = await fetchFn(`${API_BASE}/item/${id}.json`, { headers: { 'User-Agent': USER_AGENT } });
      return res.ok ? ((await res.json()) as HNItem) : null;
    }));
    let filtered = items.filter((i): i is HNItem => i != null && !i.deleted && !i.dead);
    if (options.keyword) {
      const kw = options.keyword.toLowerCase();
      filtered = filtered.filter(i => i.title?.toLowerCase().includes(kw) || i.text?.toLowerCase().includes(kw));
    }
    if (options.minScore != null) filtered = filtered.filter(i => i.score >= options.minScore!);
    if (options.since != null) filtered = filtered.filter(i => i.time >= options.since!);
    return { success: true, query: type, count: filtered.length, total: ids.length, items: filtered };
  } catch (error: any) {
    return { success: false, query: type, count: 0, total: 0, items: [], error: error?.message || '搜索失败' };
  }
}

export async function getHNItem(id: number): Promise<HNItem | null> {
  try {
    const fetchFn = await getFetchImpl();
    const res = await fetchFn(`${API_BASE}/item/${id}.json`, { headers: { 'User-Agent': USER_AGENT } });
    return res.ok ? ((await res.json()) as HNItem) : null;
  } catch { return null; }
}

export async function syncHNToLibrary(_clientId: string, data: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...data.metadata, source: 'hackernews', syncedAt: new Date().toISOString() } };
}

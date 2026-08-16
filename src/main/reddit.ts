/**
 * Reddit 社区热帖搜索 - https://www.reddit.com
 * API: .json 后缀 (公开JSON，无需key)
 */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const API_BASE = 'https://www.reddit.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface RedditPost {
  id: string; title: string; selftext: string; url: string; permalink: string;
  score: number; upvote_ratio: number; num_comments: number; author: string;
  created_utc: number; subreddit: string; thumbnail: string; is_video: boolean;
  link_flair_text: string; over_18: boolean; stickied: boolean;
}

export interface RedditResult {
  success: boolean; query: string; count: number; total: number; items: RedditPost[]; error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

export async function getRedditStatus() {
  const site = await checkSiteAvailability('https://www.reddit.com', { timeoutMs: 8000 });
  return { key: 'reddit', pluginKey: 'reddit', label: 'Reddit', connected: site.ok, available: site.ok, status: site.ok ? 'connected' : 'error', state: site.ok ? 'idle' : 'offline', message: site.ok ? 'Reddit 可用' : `无法连接: ${site.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'fetch', 'status'] };
}

export async function searchReddit(query: string, options: { subreddit?: string; sort?: 'hot' | 'new' | 'top' | 'rising' | 'relevance'; t?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all'; limit?: number; after?: string } = {}): Promise<RedditResult> {
  const limit = Math.min(options.limit || 25, 100);
  try {
    const fetchFn = await getFetchImpl();
    let url: string;
    if (options.subreddit) {
      url = `${API_BASE}/r/${options.subreddit}/${options.sort || 'hot'}.json?limit=${limit}&t=${options.t || 'day'}`;
      if (options.after) url += `&after=${options.after}`;
    } else {
      const params = new URLSearchParams({ q: query, sort: options.sort || 'relevance', t: options.t || 'day', limit: String(limit), type: 'link' });
      if (options.after) params.set('after', options.after);
      url = `${API_BASE}/search.json?${params}`;
    }
    const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const posts: RedditPost[] = (data.data?.children || []).map((c: any) => {
      const d = c.data || {};
      return { id: d.id, title: d.title, selftext: d.selftext, url: d.url, permalink: `https://reddit.com${d.permalink}`, score: d.score, upvote_ratio: d.upvote_ratio, num_comments: d.num_comments, author: d.author, created_utc: d.created_utc, subreddit: d.subreddit, thumbnail: d.thumbnail, is_video: d.is_video, link_flair_text: d.link_flair_text, over_18: d.over_18, stickied: d.stickied };
    });
    return { success: true, query, count: posts.length, total: posts.length, items: posts };
  } catch (error: any) {
    return { success: false, query, count: 0, total: 0, items: [], error: error?.message || '搜索失败' };
  }
}

export async function syncRedditToLibrary(_clientId: string, data: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...data.metadata, source: 'reddit', syncedAt: new Date().toISOString() } };
}

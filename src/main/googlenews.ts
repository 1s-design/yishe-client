/**
 * Google News RSS 新闻聚合 - https://news.google.com
 * RSS: news.google.com/rss/search?q= (无需key)
 */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const RSS_BASE = 'https://news.google.com/rss';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface GoogleNewsItem {
  title: string; link: string; guid: string; pubDate: string;
  description: string; source: string; category?: string;
}

export interface GoogleNewsResult {
  success: boolean; query: string; count: number; total: number; items: GoogleNewsItem[]; error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

function parseRssXml(xml: string): GoogleNewsItem[] {
  const items: GoogleNewsItem[] = [];
  const entries = xml.split('<item>').slice(1);
  for (const entry of entries) {
    const getText = (tag: string) => { const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() : ''; };
    items.push({ title: getText('title'), link: getText('link'), guid: getText('guid'), pubDate: getText('pubDate'), description: getText('description'), source: getText('source') });
  }
  return items;
}

export async function getGoogleNewsStatus() {
  const site = await checkSiteAvailability('https://news.google.com', { timeoutMs: 8000 });
  return { key: 'googlenews', pluginKey: 'googlenews', label: 'Google News', connected: site.ok, available: site.ok, status: site.ok ? 'connected' : 'error', state: site.ok ? 'idle' : 'offline', message: site.ok ? 'Google News 可用' : `无法连接: ${site.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'fetch', 'status'] };
}
export const getGooglenewsStatus = getGoogleNewsStatus;


export async function searchGoogleNews(query: string, options: { hl?: string; gl?: string; ceid?: string; topic?: string; after?: string } = {}): Promise<GoogleNewsResult> {
  try {
    const fetchFn = await getFetchImpl();
    let url: string;
    if (options.topic) {
      url = `${RSS_BASE}/topics/${options.topic}?hl=${options.hl || 'en-US'}&gl=${options.gl || 'US'}&ceid=${options.ceid || 'US:en'}`;
    } else {
      const params = new URLSearchParams({ q: query, hl: options.hl || 'en-US', gl: options.gl || 'US', ceid: options.ceid || 'US:en' });
      if (options.after) params.set('after', options.after);
      url = `${RSS_BASE}/search?${params}`;
    }
    const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseRssXml(xml);
    return { success: true, query, count: items.length, total: items.length, items };
  } catch (error: any) {
    return { success: false, query, count: 0, total: 0, items: [], error: error?.message || '搜索失败' };
  }
}

export async function syncGoogleNewsToLibrary(_clientId: string, data: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...data.metadata, source: 'googlenews', syncedAt: new Date().toISOString() } };
}

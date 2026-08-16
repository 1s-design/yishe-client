/**
 * GDELT 全球新闻事件监测 - https://www.gdeltproject.org
 * API: api.gdeltproject.org/api/v2/ (免费，无需key)
 */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const API_BASE = 'https://api.gdeltproject.org/api/v2';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface GDELTArticle {
  url: string; title: string; date: string; domain: string; language: string;
  country: string; tone: number; persons: string[]; organizations: string[];
  locations: string[]; cameo_event: string;
}

export interface GDELTTrend {
  date: string; tone: number; count: number;
}

export interface GDELTResult<T> {
  success: boolean; query: string; count: number; total: number; items: T[]; error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

export async function getGdeltStatus() {
  const site = await checkSiteAvailability('https://www.gdeltproject.org', { timeoutMs: 8000 });
  return { key: 'gdelt', pluginKey: 'gdelt', label: 'GDELT 全球事件', connected: site.ok, available: site.ok, status: site.ok ? 'connected' : 'error', state: site.ok ? 'idle' : 'offline', message: site.ok ? 'GDELT 可用' : `无法连接: ${site.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'fetch', 'status'] };
}

export async function searchGdeltNews(query: string, options: { mode?: 'ArtList' | 'TVList' | 'ImageList'; format?: 'json' | 'csv'; maxrecords?: number; timespan?: string; sourceLang?: string; sourceCountry?: string; STARTDATETIME?: string; ENDDATETIME?: string } = {}): Promise<GDELTResult<GDELTArticle>> {
  const maxrecords = Math.min(options.maxrecords || 250, 25000);
  try {
    const fetchFn = await getFetchImpl();
    const params = new URLSearchParams({ query, mode: options.mode || 'ArtList', format: options.format || 'json', maxrecords: String(maxrecords) });
    if (options.timespan) params.set('timespan', options.timespan);
    if (options.sourceLang) params.set('sourceLang', options.sourceLang);
    if (options.sourceCountry) params.set('sourceCountry', options.sourceCountry);
    if (options.STARTDATETIME) params.set('STARTDATETIME', options.STARTDATETIME);
    if (options.ENDDATETIME) params.set('ENDDATETIME', options.ENDDATETIME);
    const res = await fetchFn(`${API_BASE}/doc/doc?${params}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const articles: GDELTArticle[] = (data.articles || []).map((a: any) => ({ url: a.url, title: a.title, date: a.date, domain: a.domain, language: a.lang, country: a.sourcecountry, tone: a.tone || 0, persons: a.persons || [], organizations: a.organizations || [], locations: a.locations || [], cameo_event: a.cameo || '' }));
    return { success: true, query, count: articles.length, total: articles.length, items: articles };
  } catch (error: any) {
    return { success: false, query, count: 0, total: 0, items: [], error: error?.message || '搜索失败' };
  }
}

export async function getGdeltTrends(query: string, options: { timespan?: string; format?: 'json' | 'csv' } = {}): Promise<GDELTResult<GDELTTrend>> {
  try {
    const fetchFn = await getFetchImpl();
    const params = new URLSearchParams({ query, mode: 'ToneChart', format: options.format || 'json', timespan: options.timespan || '30d' });
    const res = await fetchFn(`${API_BASE}/doc/doc?${params}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const series: GDELTTrend[] = (data.series || []).map((s: any) => ({ date: s.date, tone: s.value || 0, count: s.count || 0 }));
    return { success: true, query, count: series.length, total: series.length, items: series };
  } catch (error: any) {
    return { success: false, query, count: 0, total: 0, items: [], error: error?.message || '获取趋势失败' };
  }
}

export async function syncGdeltToLibrary(_clientId: string, data: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...data.metadata, source: 'gdelt', syncedAt: new Date().toISOString() } };
}

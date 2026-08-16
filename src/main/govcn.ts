/** 中国政府网政策/新闻 - https://www.gov.cn */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface GovCNItem { title: string; url: string; summary: string; pubDate: string; source: string; }
export interface GovCNResult { success: boolean; category: string; count: number; items: GovCNItem[]; error?: string; }
const GOVCN_URLS: Record<string, string> = { policy: 'https://www.gov.cn/zhengce/zuixin/', news: 'https://www.gov.cn/xinwen/', announce: 'https://www.gov.cn/xinwen/gongbao/', local: 'https://www.gov.cn/xinwen/difang/', dept: 'https://www.gov.cn/xinwen/buwei/' };
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getGovCNStatus() { const s = await checkSiteAvailability('https://www.gov.cn', { timeoutMs: 8000 }); return { key: 'govcn', pluginKey: 'govcn', label: '中国政府网', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? '中国政府网 可用' : `无法连接: ${s.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['fetch', 'status'] }; }
export const getGovcnStatus = getGovCNStatus;

export async function fetchGovCN(category: string = 'policy'): Promise<GovCNResult> {
  try {
    const fetchFn = await getFetchImpl();
    const url = GOVCN_URLS[category] || GOVCN_URLS.policy;
    const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: GovCNItem[] = [];
    const listRegex = /<li[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*target="[^"]*"[^>]*>([^<]*)<\/a>\s*(?:<span[^>]*>([^<]*)<\/span>)?\s*<\/li>/gi;
    let m;
    while ((m = listRegex.exec(html)) !== null) {
      const link = m[1].startsWith('http') ? m[1] : `https://www.gov.cn${m[1]}`;
      items.push({ title: m[2].trim(), url: link, summary: '', pubDate: m[3]?.trim() || '', source: '中国政府网' });
    }
    return { success: true, category, count: items.length, items };
  } catch (error: any) { return { success: false, category, count: 0, items: [], error: error?.message || '获取失败' }; }
}
export async function syncGovCNToLibrary(_c: string, d: { metadata?: Record<string, any> }) { return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'govcn', syncedAt: new Date().toISOString() } }; }

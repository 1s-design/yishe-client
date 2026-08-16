/** open.er-api 汇率 - https://open.er-api.com */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface RateResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getErApiStatus() { const s = await checkSiteAvailability('https://open.er-api.com', { timeoutMs: 8000 }); return { key: 'erapi', pluginKey: 'erapi', label: 'open.er-api 汇率', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? '可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export const getErapiStatus = getErApiStatus;

export async function searchErApi(base: string = 'USD'): Promise<RateResult> {
  try { const f = await getFetchImpl(); const res = await f(`https://open.er-api.com/v6/latest/${base}`, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: base, error: `HTTP ${res.status}` }; return { success: true, query: base, data: await res.json() };
  } catch (e: any) { return { success: false, query: base, error: e?.message || '获取失败' }; }
}
export async function syncErApiToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'erapi', syncedAt: new Date().toISOString() } }; }

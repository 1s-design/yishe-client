/** fawazahmed CDN 汇率 - https://cdn.jsdelivr.net */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface RateResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getFawazahmedStatus() { const s = await checkSiteAvailability('https://cdn.jsdelivr.net', { timeoutMs: 8000 }); return { key: 'fawazahmed', pluginKey: 'fawazahmed', label: 'fawazahmed 汇率', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? '可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export async function searchFawazahmed(base: string = 'usd'): Promise<RateResult> {
  try { const f = await getFetchImpl(); const res = await f(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base.toLowerCase()}.json`, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: base, error: `HTTP ${res.status}` }; return { success: true, query: base, data: await res.json() };
  } catch (e: any) { return { success: false, query: base, error: e?.message || '获取失败' }; }
}
export async function syncFawazahmedToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'fawazahmed', syncedAt: new Date().toISOString() } }; }

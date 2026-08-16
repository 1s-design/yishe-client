/** Frankfurter 汇率 - https://api.frankfurter.dev */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface RateResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getFrankfurterStatus() { const s = await checkSiteAvailability('https://api.frankfurter.dev', { timeoutMs: 8000 }); return { key: 'frankfurter', pluginKey: 'frankfurter', label: 'Frankfurter 汇率', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'Frankfurter 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export async function searchFrankfurter(opts: { from?: string; to?: string; date?: string } = {}): Promise<RateResult> {
  try { const f = await getFetchImpl(); const from = opts.from || 'USD'; const to = opts.to || 'CNY,EUR,JPY'; const date = opts.date || 'latest'; const res = await f(`https://api.frankfurter.dev/v1/${date}?base=${from}&symbols=${to}`, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: `${from}->${to}`, error: `HTTP ${res.status}` }; return { success: true, query: `${from}->${to}`, data: await res.json() };
  } catch (e: any) { return { success: false, query: opts.from || 'USD', error: e?.message || '获取失败' }; }
}
export async function syncFrankfurterToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'frankfurter', syncedAt: new Date().toISOString() } }; }

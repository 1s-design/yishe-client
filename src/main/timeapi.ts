/** timeapi.io 时区时间 - https://timeapi.io */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface TimeResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getTimeApiStatus() { const s = await checkSiteAvailability('https://timeapi.io', { timeoutMs: 8000 }); return { key: 'timeapi', pluginKey: 'timeapi', label: 'timeapi.io 时区时间', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'timeapi.io 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export const getTimeapiStatus = getTimeApiStatus;

export async function searchTimeApi(timezone: string): Promise<TimeResult> {
  try { const f = await getFetchImpl(); const res = await f(`https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(timezone)}`, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: timezone, error: `HTTP ${res.status}` }; return { success: true, query: timezone, data: await res.json() };
  } catch (e: any) { return { success: false, query: timezone, error: e?.message || '获取失败' }; }
}
export async function syncTimeApiToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'timeapi', syncedAt: new Date().toISOString() } }; }

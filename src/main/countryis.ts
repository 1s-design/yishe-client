/** country.is IP归属 - https://api.country.is */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface CountryResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getCountryIsStatus() { const s = await checkSiteAvailability('https://api.country.is', { timeoutMs: 8000 }); return { key: 'countryis', pluginKey: 'countryis', label: 'country.is IP归属', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'country.is 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export const getCountryisStatus = getCountryIsStatus;

export async function searchCountryIs(ip: string): Promise<CountryResult> {
  try { const f = await getFetchImpl(); const res = await f(`https://api.country.is/${ip}`, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: ip, error: `HTTP ${res.status}` }; return { success: true, query: ip, data: await res.json() };
  } catch (e: any) { return { success: false, query: ip, error: e?.message || '获取失败' }; }
}
export async function syncCountryIsToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'countryis', syncedAt: new Date().toISOString() } }; }

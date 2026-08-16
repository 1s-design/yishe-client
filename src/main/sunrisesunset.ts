/** Sunrise-Sunset 日出日落 - https://api.sunrise-sunset.org */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface SunriseResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getSunriseStatus() { const s = await checkSiteAvailability('https://api.sunrise-sunset.org', { timeoutMs: 8000 }); return { key: 'sunrisesunset', pluginKey: 'sunrisesunset', label: 'Sunrise-Sunset 日出日落', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'Sunrise-Sunset 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export const getSunrisesunsetStatus = getSunriseStatus;

export async function searchSunrise(opts: { lat: number; lng: number; date?: string; formatted?: boolean }): Promise<SunriseResult> {
  try { const f = await getFetchImpl(); const params = new URLSearchParams({ lat: String(opts.lat), lng: String(opts.lng), formatted: opts.formatted === false ? '0' : '1' }); if (opts.date) params.set('date', opts.date); const res = await f(`https://api.sunrise-sunset.org/json?${params}`, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: `${opts.lat},${opts.lng}`, error: `HTTP ${res.status}` }; return { success: true, query: `${opts.lat},${opts.lng}`, data: await res.json() };
  } catch (e: any) { return { success: false, query: `${opts.lat},${opts.lng}`, error: e?.message || '获取失败' }; }
}
export async function syncSunriseToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'sunrisesunset', syncedAt: new Date().toISOString() } }; }

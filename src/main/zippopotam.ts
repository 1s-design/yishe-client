/** Zippopotam 邮编查询 - https://api.zippopotam.us */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface ZipResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getZippopotamStatus() { const s = await checkSiteAvailability('https://api.zippopotam.us', { timeoutMs: 8000 }); return { key: 'zippopotam', pluginKey: 'zippopotam', label: 'Zippopotam 邮编查询', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'Zippopotam 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export async function searchZippopotam(countryCode: string, zipCode: string): Promise<ZipResult> {
  try { const f = await getFetchImpl(); const res = await f(`https://api.zippopotam.us/${countryCode}/${zipCode}`, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: `${countryCode}/${zipCode}`, error: `HTTP ${res.status}` }; return { success: true, query: `${countryCode}/${zipCode}`, data: await res.json() };
  } catch (e: any) { return { success: false, query: `${countryCode}/${zipCode}`, error: e?.message || '获取失败' }; }
}
export async function syncZippopotamToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'zippopotam', syncedAt: new Date().toISOString() } }; }

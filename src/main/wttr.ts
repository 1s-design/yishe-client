/** wttr.in 天气 - https://wttr.in */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface WttrResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getWttrStatus() { const s = await checkSiteAvailability('https://wttr.in', { timeoutMs: 8000 }); return { key: 'wttr', pluginKey: 'wttr', label: 'wttr.in 天气', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'wttr.in 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export async function searchWttr(city: string): Promise<WttrResult> {
  try { const f = await getFetchImpl(); const res = await f(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: city, error: `HTTP ${res.status}` }; return { success: true, query: city, data: await res.json() };
  } catch (e: any) { return { success: false, query: city, error: e?.message || '获取失败' }; }
}
export async function syncWttrToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'wttr', syncedAt: new Date().toISOString() } }; }

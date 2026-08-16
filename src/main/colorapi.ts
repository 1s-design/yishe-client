/** The Color API - https://www.thecolorapi.com */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface ColorResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getColorApiStatus() { const s = await checkSiteAvailability('https://www.thecolorapi.com', { timeoutMs: 8000 }); return { key: 'colorapi', pluginKey: 'colorapi', label: 'The Color API', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? '可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export const getColorapiStatus = getColorApiStatus;

export async function searchColorApi(hex: string): Promise<ColorResult> {
  try { const f = await getFetchImpl(); const res = await f(`https://www.thecolorapi.com/id?hex=${hex.replace('#', '')}`, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: hex, error: `HTTP ${res.status}` }; return { success: true, query: hex, data: await res.json() };
  } catch (e: any) { return { success: false, query: hex, error: e?.message || '获取失败' }; }
}
export async function syncColorApiToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'colorapi', syncedAt: new Date().toISOString() } }; }

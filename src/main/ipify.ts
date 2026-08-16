/** ipify - https://api.ipify.org */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface IpResult { success: boolean; query: string; data?: { ip: string }; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getIpifyStatus() { const s = await checkSiteAvailability('https://api.ipify.org', { timeoutMs: 8000 }); return { key: 'ipify', pluginKey: 'ipify', label: 'ipify IP查询', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'ipify 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export async function searchIpify(): Promise<IpResult> {
  try { const f = await getFetchImpl(); const res = await f('https://api.ipify.org?format=json', { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: 'ip', error: `HTTP ${res.status}` }; return { success: true, query: 'ip', data: await res.json() };
  } catch (e: any) { return { success: false, query: 'ip', error: e?.message || '获取失败' }; }
}
export async function syncIpifyToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'ipify', syncedAt: new Date().toISOString() } }; }

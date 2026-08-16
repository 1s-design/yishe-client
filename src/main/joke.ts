/** Official Joke API - https://official-joke-api.appspot.com */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface JokeResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getJokeStatus() { const s = await checkSiteAvailability('https://official-joke-api.appspot.com', { timeoutMs: 8000 }); return { key: 'joke', pluginKey: 'joke', label: 'Joke API', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'Joke API 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export async function searchJoke(): Promise<JokeResult> {
  try { const f = await getFetchImpl(); const res = await f('https://official-joke-api.appspot.com/random_joke', { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: 'random', error: `HTTP ${res.status}` }; return { success: true, query: 'random', data: await res.json() };
  } catch (e: any) { return { success: false, query: 'random', error: e?.message || '获取失败' }; }
}
export async function syncJokeToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'joke', syncedAt: new Date().toISOString() } }; }

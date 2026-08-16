/** Free Dictionary API - https://api.dictionaryapi.dev */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface DictResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getDictionaryStatus() { const s = await checkSiteAvailability('https://api.dictionaryapi.dev', { timeoutMs: 8000 }); return { key: 'dictionary', pluginKey: 'dictionary', label: 'Free Dictionary', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'Dictionary 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export async function searchDictionary(word: string = 'technology'): Promise<DictResult> {
  try {
    const f = await getFetchImpl();
    const cleanWord = (word || 'technology').trim();
    const res = await f(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return { success: false, query: cleanWord, error: `HTTP ${res.status}` };
    const text = await res.text();
    if (!text) return { success: false, query: cleanWord, error: '空响应' };
    const data = JSON.parse(text);
    return { success: true, query: cleanWord, data };
  } catch (e: any) {
    return { success: false, query: word, error: e?.message || '获取失败' };
  }
}

export async function syncDictionaryToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'dictionary', syncedAt: new Date().toISOString() } }; }

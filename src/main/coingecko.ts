/** CoinGecko 加密货币 - https://api.coingecko.com */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface CryptoResult { success: boolean; query: string; data?: any; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getCoinGeckoStatus() { const s = await checkSiteAvailability('https://api.coingecko.com', { timeoutMs: 8000 }); return { key: 'coingecko', pluginKey: 'coingecko', label: 'CoinGecko 加密货币', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'CoinGecko 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export const getCoingeckoStatus = getCoinGeckoStatus;

export async function searchCoinGecko(opts: { ids?: string; vs_currencies?: string } = {}): Promise<CryptoResult> {
  try { const f = await getFetchImpl(); const params = new URLSearchParams({ ids: opts.ids || 'bitcoin,ethereum', vs_currencies: opts.vs_currencies || 'usd,cny' }); const res = await f(`https://api.coingecko.com/api/v3/simple/price?${params}`, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) return { success: false, query: opts.ids || 'bitcoin', error: `HTTP ${res.status}` }; return { success: true, query: opts.ids || 'bitcoin', data: await res.json() };
  } catch (e: any) { return { success: false, query: opts.ids || 'bitcoin', error: e?.message || '获取失败' }; }
}
export async function syncCoinGeckoToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'coingecko', syncedAt: new Date().toISOString() } }; }

/** NPR RSS - https://www.npr.org/rss */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';
const NPR_FEEDS: Record<string, string> = { news: 'https://feeds.npr.org/1001/rss.xml', world: 'https://feeds.npr.org/1004/rss.xml', business: 'https://feeds.npr.org/1006/rss.xml', science: 'https://feeds.npr.org/1007/rss.xml', technology: 'https://feeds.npr.org/1014/rss.xml', health: 'https://feeds.npr.org/1128/rss.xml', arts: 'https://feeds.npr.org/1008/rss.xml', music: 'https://feeds.npr.org/1039/rss.xml' };
export async function getNPRStatus() { const s = await checkSiteAvailability('https://www.npr.org', { timeoutMs: 8000 }); return { key: 'npr', pluginKey: 'npr', label: 'NPR', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'NPR 可用' : `无法连接: ${s.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['fetch', 'status'] }; }
export const getNprStatus = getNPRStatus;

export async function fetchNPR(category: string = 'technology'): Promise<RssResult> { return fetchAndParseRss(NPR_FEEDS[category] || NPR_FEEDS.news); }
export async function syncNPRToLibrary(_c: string, d: { metadata?: Record<string, any> }) { return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'npr', syncedAt: new Date().toISOString() } }; }

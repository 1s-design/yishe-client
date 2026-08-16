/** BBC News RSS - https://feeds.bbci.co.uk/news */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';
const BBC_FEEDS: Record<string, string> = { world: 'https://feeds.bbci.co.uk/news/world/rss.xml', uk: 'https://feeds.bbci.co.uk/news/uk/rss.xml', politics: 'https://feeds.bbci.co.uk/news/politics/rss.xml', business: 'https://feeds.bbci.co.uk/news/business/rss.xml', science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', technology: 'https://feeds.bbci.co.uk/news/technology/rss.xml', health: 'https://feeds.bbci.co.uk/news/health/rss.xml' };
export async function getBBCStatus() { const s = await checkSiteAvailability('https://www.bbc.com/news', { timeoutMs: 8000 }); return { key: 'bbcnews', pluginKey: 'bbcnews', label: 'BBC News', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'BBC News 可用' : `无法连接: ${s.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['fetch', 'status'] }; }
export const getBbcnewsStatus = getBBCStatus;

export async function fetchBBC(category: string = 'technology'): Promise<RssResult> { return fetchAndParseRss(BBC_FEEDS[category] || BBC_FEEDS.technology); }
export async function syncBBCToLibrary(_c: string, d: { metadata?: Record<string, any> }) { return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'bbcnews', syncedAt: new Date().toISOString() } }; }

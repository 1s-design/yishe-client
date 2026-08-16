/** TechCrunch RSS - https://techcrunch.com/feed */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';
const TC_FEEDS: Record<string, string> = { all: 'https://techcrunch.com/feed/', startup: 'https://techcrunch.com/category/startups/feed/', ai: 'https://techcrunch.com/category/artificial-intelligence/feed/', crypto: 'https://techcrunch.com/category/cryptocurrency/feed/', apps: 'https://techcrunch.com/category/apps/feed/', gadgets: 'https://techcrunch.com/category/gadgets/feed/' };
export async function getTCStatus() { const s = await checkSiteAvailability('https://techcrunch.com', { timeoutMs: 8000 }); return { key: 'techcrunch', pluginKey: 'techcrunch', label: 'TechCrunch', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'TechCrunch 可用' : `无法连接: ${s.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['fetch', 'status'] }; }
export const getTechcrunchStatus = getTCStatus;

export async function fetchTC(category: string = 'ai'): Promise<RssResult> { return fetchAndParseRss(TC_FEEDS[category] || TC_FEEDS.all); }
export async function syncTCToLibrary(_c: string, d: { metadata?: Record<string, any> }) { return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'techcrunch', syncedAt: new Date().toISOString() } }; }

/** MIT Technology Review RSS - https://www.technologyreview.com/feed */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';
const MIT_FEEDS: Record<string, string> = { all: 'https://www.technologyreview.com/feed/', ai: 'https://www.technologyreview.com/topic/artificial-intelligence/feed/', computing: 'https://www.technologyreview.com/topic/computing/feed/', biotech: 'https://www.technologyreview.com/topic/biotechnology/feed/', energy: 'https://www.technologyreview.com/topic/energy/feed/', ethics: 'https://www.technologyreview.com/topic/ethics/feed/' };
export async function getMITStatus() { const s = await checkSiteAvailability('https://www.technologyreview.com', { timeoutMs: 8000 }); return { key: 'mittechreview', pluginKey: 'mittechreview', label: 'MIT Tech Review', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'MIT Tech Review 可用' : `无法连接: ${s.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['fetch', 'status'] }; }
export const getMittechreviewStatus = getMITStatus;

export async function fetchMIT(category: string = 'ai'): Promise<RssResult> { return fetchAndParseRss(MIT_FEEDS[category] || MIT_FEEDS.all); }
export async function syncMITToLibrary(_c: string, d: { metadata?: Record<string, any> }) { return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'mittechreview', syncedAt: new Date().toISOString() } }; }

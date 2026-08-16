/** Ars Technica RSS - https://feeds.arstechnica.com/arstechnica */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';
const ARS_FEEDS: Record<string, string> = { all: 'https://arstechnica.com/feed/', tech: 'https://arstechnica.com/technology-policy/feed/', science: 'https://arstechnica.com/science/feed/', gadgets: 'https://arstechnica.com/gadgets/feed/', security: 'https://arstechnica.com/security/feed/', ai: 'https://arstechnica.com/ai/feed/' };

export async function getArsStatus() { const s = await checkSiteAvailability('https://arstechnica.com', { timeoutMs: 8000 }); return { key: 'arstechnica', pluginKey: 'arstechnica', label: 'Ars Technica', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'Ars Technica 可用' : `无法连接: ${s.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['fetch', 'status'] }; }
export const getArstechnicaStatus = getArsStatus;

export async function fetchArs(category: string = 'ai'): Promise<RssResult> { return fetchAndParseRss(ARS_FEEDS[category] || ARS_FEEDS.all); }
export async function syncArsToLibrary(_c: string, d: { metadata?: Record<string, any> }) { return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'arstechnica', syncedAt: new Date().toISOString() } }; }

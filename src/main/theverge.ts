/** The Verge RSS - https://www.theverge.com/rss */
import { fetchAndParseRss, RssResult } from './rss-common';
import { checkSiteAvailability } from './siteAvailability';
const VERGE_FEEDS: Record<string, string> = { all: 'https://www.theverge.com/rss/index.xml', ai: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', tech: 'https://www.theverge.com/rss/tech/index.xml', reviews: 'https://www.theverge.com/rss/reviews/index.xml', science: 'https://www.theverge.com/rss/science/index.xml', entertainment: 'https://www.theverge.com/rss/entertainment/index.xml' };
export async function getVergeStatus() { const s = await checkSiteAvailability('https://www.theverge.com', { timeoutMs: 8000 }); return { key: 'theverge', pluginKey: 'theverge', label: 'The Verge', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'The Verge 可用' : `无法连接: ${s.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['fetch', 'status'] }; }
export const getThevergeStatus = getVergeStatus;

export async function fetchVerge(category: string = 'ai'): Promise<RssResult> { return fetchAndParseRss(VERGE_FEEDS[category] || VERGE_FEEDS.all); }
export async function syncVergeToLibrary(_c: string, d: { metadata?: Record<string, any> }) { return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'theverge', syncedAt: new Date().toISOString() } }; }

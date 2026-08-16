/** Product Hunt 产品搜索 - https://www.producthunt.com API: GraphQL (需key) */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const API_BASE = 'https://api.producthunt.com/v2/api/graphql';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface PHPost { id: string; name: string; tagline: string; description: string; url: string; votesCount: number; commentsCount: number; topics: string[]; thumbnail: string; featuredDate: string; user: { name: string; username: string }; }
export interface PHResult<T> { success: boolean; query: string; count: number; total: number; items: T[]; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getPHStatus() { const site = await checkSiteAvailability('https://www.producthunt.com', { timeoutMs: 8000 }); return { key: 'producthunt', pluginKey: 'producthunt', label: 'Product Hunt', connected: site.ok, available: site.ok, status: site.ok ? 'connected' : 'error', state: site.ok ? 'idle' : 'offline', message: site.ok ? 'Product Hunt 可用' : `无法连接: ${site.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'fetch', 'status'] }; }
export const getProducthuntStatus = getPHStatus;

export async function searchPH(accessToken: string, options: { featuredDate?: string; order?: 'VOTES' | 'NEWEST'; topics?: string[]; first?: number; after?: string } = {}): Promise<PHResult<PHPost>> {
  const first = Math.min(options.first || 20, 50);
  try {
    const fetchFn = await getFetchImpl();
    const topicFilter = options.topics?.length ? `, topics: [${options.topics.map(t => `"${t}"`).join(',')}]` : '';
    const dateFilter = options.featuredDate ? `, featuredDate: "${options.featuredDate}"` : '';
    const query = `{ posts(order: ${options.order || 'VOTES'}, first: ${first}${dateFilter}${topicFilter}) { edges { node { id name tagline description url votesCount commentsCount topics { name } thumbnail { url } featuredDate user { name username } } } } }`;
    const res = await fetchFn(API_BASE, { method: 'POST', headers: { 'User-Agent': USER_AGENT, 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const posts: PHPost[] = (data.data?.posts?.edges || []).map((e: any) => { const n = e.node; return { id: n.id, name: n.name, tagline: n.tagline, description: n.description, url: n.url, votesCount: n.votesCount, commentsCount: n.commentsCount, topics: (n.topics || []).map((t: any) => t.name), thumbnail: n.thumbnail?.url || '', featuredDate: n.featuredDate, user: { name: n.user?.name || '', username: n.user?.username || '' } }; });
    return { success: true, query: 'posts', count: posts.length, total: posts.length, items: posts };
  } catch (error: any) { return { success: false, query: 'posts', count: 0, total: 0, items: [], error: error?.message || '搜索失败' }; }
}
export async function syncPHToLibrary(_clientId: string, data: { metadata?: Record<string, any> }) { return { success: true, message: '数据已获取', data: { ...data.metadata, source: 'producthunt', syncedAt: new Date().toISOString() } }; }

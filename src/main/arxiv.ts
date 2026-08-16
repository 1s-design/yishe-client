/**
 * arXiv 学术论文搜索能力 - https://arxiv.org
 * API: export.arxiv.org/api/query (无需key)
 */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const API_BASE = 'http://export.arxiv.org/api/query';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  updated: string;
  categories: string[];
  links: { href: string; title?: string; type?: string }[];
  comment?: string;
  journalRef?: string;
  doi?: string;
}

export interface ArxivSearchResult {
  success: boolean;
  query: string;
  count: number;
  total: number;
  items: ArxivPaper[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

export async function getArxivStatus() {
  const site = await checkSiteAvailability('https://arxiv.org', { timeoutMs: 8000 });
  return { key: 'arxiv', pluginKey: 'arxiv', label: 'arXiv 学术论文', connected: site.ok, available: site.ok, status: site.ok ? 'connected' : 'error', state: site.ok ? 'idle' : 'offline', message: site.ok ? 'arXiv 可用' : `无法连接: ${site.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'fetch', 'status'] };
}

function parseArxivXml(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  const entries = xml.split('<entry>').slice(1);
  for (const entry of entries) {
    const getText = (tag: string) => { const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)); return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : ''; };
    const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
    const id = idMatch ? idMatch[1].trim() : '';
    const authors = (entry.match(/<author[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g) || []).map(a => a.match(/<name>([\s\S]*?)<\/name>/)?.[1] || '');
    const links: { href: string; title?: string; type?: string }[] = [];
    const linkMatches = entry.match(/<link[^>]*href="([^"]*)"[^>]*(?:title="([^"]*)")?[^>]*(?:type="([^"]*)")?[^>]*\/>/g) || [];
    for (const l of linkMatches) {
      const hm = l.match(/href="([^"]*)"/);
      if (hm) links.push({ href: hm[1], title: l.match(/title="([^"]*)"/)?.[1], type: l.match(/type="([^"]*)"/)?.[1] });
    }
    papers.push({ id, title: getText('title'), summary: getText('summary'), authors, published: getText('published'), updated: getText('updated'), categories: (entry.match(/<category[^>]*term="([^"]*)"[^>]*\/>/g) || []).map(c => c.match(/term="([^"]*)"/)?.[1] || ''), links, comment: getText('comment') || undefined, journalRef: getText('journal_ref') || undefined, doi: getText('doi') || undefined });
  }
  return papers;
}

export async function searchArxiv(query: string, options: { start?: number; maxResults?: number; sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate'; sortOrder?: 'ascending' | 'descending'; category?: string } = {}): Promise<ArxivSearchResult> {
  const maxResults = Math.min(options.maxResults || 20, 30000);
  try {
    const fetchFn = await getFetchImpl();
    let searchQuery = query;
    if (options.category) searchQuery = `cat:${options.category} AND (${query})`;
    const params = new URLSearchParams({ search_query: searchQuery, start: String(options.start || 0), max_results: String(maxResults), sortBy: options.sortBy || 'relevance', sortOrder: options.sortOrder || 'descending' });
    const res = await fetchFn(`${API_BASE}?${params}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseArxivXml(xml);
    const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
    return { success: true, query, count: items.length, total: totalMatch ? parseInt(totalMatch[1]) : items.length, items };
  } catch (error: any) {
    return { success: false, query, count: 0, total: 0, items: [], error: error?.message || '搜索失败' };
  }
}

export async function getArxivPaper(id: string): Promise<ArxivPaper | null> {
  try {
    const fetchFn = await getFetchImpl();
    const res = await fetchFn(`${API_BASE}?id_list=${id}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const xml = await res.text();
    const papers = parseArxivXml(xml);
    return papers[0] || null;
  } catch { return null; }
}

export async function syncArxivToLibrary(_clientId: string, data: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...data.metadata, source: 'arxiv', syncedAt: new Date().toISOString() } };
}

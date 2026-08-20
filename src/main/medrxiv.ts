/** medRxiv 医学预印本 - https://www.medrxiv.org/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface MedRxivItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  authors: string;
  category: string;
  doi: string;
}

export interface MedRxivResult {
  success: boolean;
  category: string;
  count: number;
  items: MedRxivItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

// medRxiv API endpoint for latest papers
const MEDRXIV_API_BASE = 'https://api.medrxiv.org/details/medrxiv';

export async function getMedRxivStatus() {
  const s = await checkSiteAvailability('https://www.medrxiv.org', { timeoutMs: 8000 });
  return {
    key: 'medrxiv',
    pluginKey: 'medrxiv',
    label: 'medRxiv',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'medRxiv 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchMedRxiv(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<MedRxivResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;
    const today = new Date();
    const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const formatDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Use the medRxiv API to fetch recent papers
    const searchTerm = options.query || category || '';
    let apiUrl: string;
    if (searchTerm && searchTerm !== 'all') {
      apiUrl = `${MEDRXIV_API_BASE}/${formatDate(oneWeekAgo)}/${formatDate(today)}/0/medrxiv_json.json`;
    } else {
      apiUrl = `${MEDRXIV_API_BASE}/${formatDate(oneWeekAgo)}/${formatDate(today)}/0/medrxiv_json.json`;
    }

    const res = await fetchFn(apiUrl, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const items: MedRxivItem[] = [];
    if (data.collection && Array.isArray(data.collection)) {
      for (const paper of data.collection) {
        const title = paper.title || '';
        const matchesQuery = !searchTerm || searchTerm === 'all' ||
          title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (paper.category || '').toLowerCase().includes(searchTerm.toLowerCase());

        if (matchesQuery) {
          items.push({
            title,
            link: paper.link || `https://www.medrxiv.org/content/${paper.doi}`,
            description: paper.abstract || paper.description || '',
            pubDate: paper.date || new Date().toISOString(),
            authors: paper.authors || '',
            category: paper.category || '医学',
            doi: paper.doi || '',
          });
        }
      }
    }

    return {
      success: true,
      category,
      count: Math.min(items.length, limit),
      items: items.slice(0, limit),
    };
  } catch (error: any) {
    // Fallback: try scraping the medRxiv recent papers page
    try {
      const fetchFn = await getFetchImpl();
      const res = await fetchFn('https://www.medrxiv.org/recent', {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const items: MedRxivItem[] = [];

      // Parse recent papers from HTML
      const paperRegex = /<li[^>]*class="[^"]*highwire-article[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
      let m;
      while ((m = paperRegex.exec(html)) !== null) {
        const block = m[1];
        const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
        const doiMatch = block.match(/10\.1101\/([^"<]*)/);
        if (titleMatch) {
          const link = titleMatch[1].startsWith('http') ? titleMatch[1] : `https://www.medrxiv.org${titleMatch[1]}`;
          items.push({
            title: titleMatch[2].trim(),
            link,
            description: '',
            pubDate: new Date().toISOString(),
            authors: '',
            category: '医学预印本',
            doi: doiMatch ? `10.1101/${doiMatch[1]}` : '',
          });
        }
      }

      const limit = options.maxCount || 20;
      return { success: true, category, count: Math.min(items.length, limit), items: items.slice(0, limit) };
    } catch (err: any) {
      return { success: false, category, count: 0, items: [], error: err?.message || error?.message || '获取medRxiv失败' };
    }
  }
}

export async function syncMedRxivToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'medrxiv', syncedAt: new Date().toISOString() } };
}

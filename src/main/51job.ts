/** 前程无忧 51job - https://www.51job.com/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface Job51Item {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  company: string;
  salary: string;
  location: string;
  category: string;
}

export interface Job51Result {
  success: boolean;
  category: string;
  count: number;
  items: Job51Item[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

const JOB51_URLS: Record<string, string> = {
  all: 'https://search.51job.com/list/000000,000000,0000,00,9,99,+,2,1.html',
  tech: 'https://search.51job.com/list/000000,000000,0000,00,9,99,%25E6%258A%2580%25E6%259C%25AF,2,1.html',
  product: 'https://search.51job.com/list/000000,000000,0000,00,9,99,%25E4%25BA%25A7%25E5%2593%2581,2,1.html',
  design: 'https://search.51job.com/list/000000,000000,0000,00,9,99,%25E8%25AE%25BE%25E8%25AE%25A1,2,1.html',
  marketing: 'https://search.51job.com/list/000000,000000,0000,00,9,99,%25E8%2590%25A5%25E9%2594%2580,2,1.html',
};

export async function get51JobStatus() {
  const s = await checkSiteAvailability('https://www.51job.com', { timeoutMs: 8000 });
  return {
    key: '51job',
    pluginKey: '51job',
    label: '前程无忧',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '前程无忧 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetch51Job(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<Job51Result> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const url = JOB51_URLS[category] || JOB51_URLS.all;
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.51job.com/',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: Job51Item[] = [];

    // Parse job listings from the page
    const jobRegex = /<div[^>]*class="[^"]*el[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let m;
    while ((m = jobRegex.exec(html)) !== null) {
      const block = m[1];
      const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*target="[^"]*"[^>]*>([^<]*)<\/a>/);
      const companyMatch = block.match(/<a[^>]*class="[^"]*[^"]*"[^>]*target="[^"]*"[^>]*>([^<]*)<\/a>/);
      const salaryMatch = block.match(/<span[^>]*class="[^"]*[^"]*"[^>]*>([^<]*)<\/span>/);
      const locMatch = block.match(/<span[^>]*class="[^"]*d[^"]*"[^>]*>([^<]*)<\/span>/);

      if (titleMatch) {
        const title = titleMatch[2]?.trim();
        if (title && title.length > 1) {
          items.push({
            title,
            link: titleMatch[1].startsWith('http') ? titleMatch[1] : `https:${titleMatch[1]}`,
            description: `${companyMatch?.[1]?.trim() || ''} - ${locMatch?.[1]?.trim() || ''}`,
            pubDate: new Date().toISOString(),
            company: companyMatch?.[1]?.trim() || '',
            salary: salaryMatch?.[1]?.trim() || '',
            location: locMatch?.[1]?.trim() || '',
            category: '招聘',
          });
        }
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()) || it.company.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取前程无忧失败' };
  }
}

export async function sync51JobToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: '51job', syncedAt: new Date().toISOString() } };
}

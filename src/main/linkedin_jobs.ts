/** LinkedIn Jobs - https://www.linkedin.com/jobs/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface LinkedInJobItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  company: string;
  location: string;
  category: string;
}

export interface LinkedInJobResult {
  success: boolean;
  category: string;
  count: number;
  items: LinkedInJobItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

const LINKEDIN_URLS: Record<string, string> = {
  all: 'https://www.linkedin.com/jobs/search/?f_TPR=r86400',
  tech: 'https://www.linkedin.com/jobs/search/?f_TPR=r86400&keywords=technology',
  marketing: 'https://www.linkedin.com/jobs/search/?f_TPR=r86400&keywords=marketing',
  design: 'https://www.linkedin.com/jobs/search/?f_TPR=r86400&keywords=design',
  finance: 'https://www.linkedin.com/jobs/search/?f_TPR=r86400&keywords=finance',
};

export async function getLinkedInJobsStatus() {
  const s = await checkSiteAvailability('https://www.linkedin.com/jobs/', { timeoutMs: 8000 });
  return {
    key: 'linkedin_jobs',
    pluginKey: 'linkedin_jobs',
    label: 'LinkedIn Jobs',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'LinkedIn Jobs 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchLinkedInJobs(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<LinkedInJobResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const url = LINKEDIN_URLS[category] || LINKEDIN_URLS.all;
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: LinkedInJobItem[] = [];

    // Parse job cards from the page
    const jobRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = jobRegex.exec(html)) !== null) {
      const block = m[1];
      const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*class="[^"]*job-card-list__title[^"]*"[^>]*>([^<]*)<\/a>/) ||
        block.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
      const companyMatch = block.match(/<span[^>]*class="[^"]*job-card-container__primary-description[^"]*"[^>]*>([^<]*)<\/span>/);
      const locMatch = block.match(/<span[^>]*class="[^"]*job-card-container__metadata-item[^"]*"[^>]*>([^<]*)<\/span>/);

      if (titleMatch) {
        const title = titleMatch[2]?.trim();
        if (title && title.length > 2) {
          items.push({
            title,
            link: titleMatch[1].startsWith('http') ? titleMatch[1] : `https://www.linkedin.com${titleMatch[1]}`,
            description: `${companyMatch?.[1]?.trim() || ''} - ${locMatch?.[1]?.trim() || ''}`,
            pubDate: new Date().toISOString(),
            company: companyMatch?.[1]?.trim() || '',
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
    return { success: false, category, count: 0, items: [], error: error?.message || '获取LinkedIn Jobs失败' };
  }
}

export async function syncLinkedInJobsToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'linkedin_jobs', syncedAt: new Date().toISOString() } };
}

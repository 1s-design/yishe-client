/** 拉勾招聘 - https://www.lagou.com/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface LagouItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  company: string;
  salary: string;
  location: string;
  category: string;
}

export interface LagouResult {
  success: boolean;
  category: string;
  count: number;
  items: LagouItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

const LAGOU_URLS: Record<string, string> = {
  all: 'https://www.lagou.com/jobs/list_%E6%9C%80%E6%96%B0?city=%%E5%85%A8%E5%9B%BD&fromSearch=true&labelWords=&suginput=',
  tech: 'https://www.lagou.com/jobs/list_%E6%8A%80%E6%9C%AF?city=%%E5%85%A8%E5%9B%BD&fromSearch=true',
  product: 'https://www.lagou.com/jobs/list_%E4%BA%A7%E5%93%81?city=%%E5%85%A8%E5%9B%BD&fromSearch=true',
  design: 'https://www.lagou.com/jobs/list_%E8%AE%BE%E8%AE%A1?city=%%E5%85%A8%E5%9B%BD&fromSearch=true',
  marketing: 'https://www.lagou.com/jobs/list_%E8%90%A5%E9%94%80?city=%%E5%85%A8%E5%9B%BD&fromSearch=true',
};

export async function getLagouStatus() {
  const s = await checkSiteAvailability('https://www.lagou.com', { timeoutMs: 8000 });
  return {
    key: 'lagou',
    pluginKey: 'lagou',
    label: '拉勾',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '拉勾 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchLagou(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<LagouResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const url = LAGOU_URLS[category] || LAGOU_URLS.all;
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.lagou.com/',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: LagouItem[] = [];

    // Parse job listings from the page
    const jobRegex = /<li[^>]*class="[^"]*con_list_item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = jobRegex.exec(html)) !== null) {
      const block = m[1];
      const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
      const companyMatch = block.match(/<div[^>]*class="[^"]*company_name[^"]*"[^>]*>(?:<a[^>]*>)?([^<]*)/);
      const salaryMatch = block.match(/<span[^>]*class="[^"]*money[^"]*"[^>]*>([^<]*)<\/span>/);
      const locMatch = block.match(/<span[^>]*class="[^"]*add[^"]*"[^>]*>([^<]*)<\/span>/);

      if (titleMatch) {
        items.push({
          title: titleMatch[2]?.trim() || '',
          link: titleMatch[1].startsWith('http') ? titleMatch[1] : `https://www.lagou.com${titleMatch[1]}`,
          description: `${companyMatch?.[1]?.trim() || ''} - ${locMatch?.[1]?.trim() || ''}`,
          pubDate: new Date().toISOString(),
          company: companyMatch?.[1]?.trim() || '',
          salary: salaryMatch?.[1]?.trim() || '',
          location: locMatch?.[1]?.trim() || '',
          category: '招聘',
        });
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()) || it.company.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取拉勾失败' };
  }
}

export async function syncLagouToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'lagou', syncedAt: new Date().toISOString() } };
}

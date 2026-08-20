/** BOSS直聘 - https://www.zhipin.com/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ZhipinItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  company: string;
  salary: string;
  location: string;
  category: string;
}

export interface ZhipinResult {
  success: boolean;
  category: string;
  count: number;
  items: ZhipinItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

const ZHIPIN_URLS: Record<string, string> = {
  all: 'https://www.zhipin.com/web/geek/job?query=&city=101010100',
  tech: 'https://www.zhipin.com/web/geek/job?query=%E6%8A%80%E6%9C%AF&city=101010100',
  product: 'https://www.zhipin.com/web/geek/job?query=%E4%BA%A7%E5%93%81&city=101010100',
  design: 'https://www.zhipin.com/web/geek/job?query=%E8%AE%BE%E8%AE%A1&city=101010100',
  marketing: 'https://www.zhipin.com/web/geek/job?query=%E8%90%A5%E9%94%80&city=101010100',
};

export async function getZhipinStatus() {
  const s = await checkSiteAvailability('https://www.zhipin.com', { timeoutMs: 8000 });
  return {
    key: 'zhipin',
    pluginKey: 'zhipin',
    label: 'BOSS直聘',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'BOSS直聘 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchZhipin(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<ZhipinResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const url = ZHIPIN_URLS[category] || ZHIPIN_URLS.all;
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.zhipin.com/',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: ZhipinItem[] = [];

    // Parse job cards from the page
    const jobRegex = /<li[^>]*class="[^"]*job-card-wrapper[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = jobRegex.exec(html)) !== null) {
      const block = m[1];
      const titleMatch = block.match(/<span[^>]*class="[^"]*job-name[^"]*"[^>]*>([^<]*)<\/span>/);
      const linkMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*class="[^"]*job-card-left[^"]*"/);
      const salaryMatch = block.match(/<span[^>]*class="[^"]*salary[^"]*"[^>]*>([^<]*)<\/span>/);
      const companyMatch = block.match(/<h3[^>]*class="[^"]*company-name[^"]*"[^>]*>(?:<a[^>]*>)?([^<]*)/);
      const locMatch = block.match(/<span[^>]*class="[^"]*job-area[^"]*"[^>]*>([^<]*)<\/span>/);

      if (titleMatch) {
        items.push({
          title: titleMatch[1]?.trim() || '',
          link: linkMatch?.[1] ? (linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.zhipin.com${linkMatch[1]}`) : 'https://www.zhipin.com/',
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
    return { success: false, category, count: 0, items: [], error: error?.message || '获取BOSS直聘失败' };
  }
}

export async function syncZhipinToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'zhipin', syncedAt: new Date().toISOString() } };
}

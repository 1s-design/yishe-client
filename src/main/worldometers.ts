/** Worldometers 全球实时统计 - https://www.worldometers.info/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface WorldometersItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  value: string;
  category: string;
}

export interface WorldometersResult {
  success: boolean;
  category: string;
  count: number;
  items: WorldometersItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

export async function getWorldometersStatus() {
  const s = await checkSiteAvailability('https://www.worldometers.info', { timeoutMs: 8000 });
  return {
    key: 'worldometers',
    pluginKey: 'worldometers',
    label: 'Worldometers',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Worldometers 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchWorldometers(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<WorldometersResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const res = await fetchFn('https://www.worldometers.info/', {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: WorldometersItem[] = [];

    // Parse counter items from the page
    const counterRegex = /<div[^>]*class="[^"]*counter-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let m;
    while ((m = counterRegex.exec(html)) !== null) {
      const block = m[1];
      const titleMatch = block.match(/<span[^>]*class="[^"]*counter-item-name[^"]*"[^>]*>([^<]*)<\/span>/);
      const valueMatch = block.match(/<span[^>]*class="[^"]*[^"]*"[^>]*>([\d,]+)<\/span>/) ||
        block.match(/<span[^>]*style="[^"]*"[^>]*>([\d,]+)<\/span>/);

      if (titleMatch) {
        items.push({
          title: titleMatch[1]?.trim() || '',
          link: 'https://www.worldometers.info/',
          description: `${titleMatch[1]?.trim()}: ${valueMatch?.[1] || ''}`,
          pubDate: new Date().toISOString(),
          value: valueMatch?.[1] || '',
          category: '实时统计',
        });
      }
    }

    // Parse main counter numbers
    const mainCounterRegex = /<span[^>]*class="[^"]*rts-counter[^"]*"[^>]*>([\d,]+)<\/span>/gi;
    const labelRegex = /<div[^>]*class="[^"]*[^"]*label[^"]*"[^>]*>([^<]*)<\/div>/gi;
    const counters: string[] = [];
    const labels: string[] = [];

    while ((m = mainCounterRegex.exec(html)) !== null) {
      counters.push(m[1]);
    }
    while ((m = labelRegex.exec(html)) !== null) {
      labels.push(m[1].trim());
    }

    for (let i = 0; i < Math.min(counters.length, labels.length); i++) {
      const label = labels[i];
      if (label && !items.find(it => it.title === label)) {
        items.push({
          title: label,
          link: 'https://www.worldometers.info/',
          description: `${label}: ${counters[i]}`,
          pubDate: new Date().toISOString(),
          value: counters[i],
          category: '实时统计',
        });
      }
    }

    // Also parse news/headline items
    const headlineRegex = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    while ((m = headlineRegex.exec(html)) !== null) {
      const block = m[1];
      const linkMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
      if (linkMatch) {
        const title = linkMatch[2]?.trim();
        if (title && title.length > 3 && !items.find(it => it.title === title)) {
          items.push({
            title,
            link: linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.worldometers.info${linkMatch[1]}`,
            description: title,
            pubDate: new Date().toISOString(),
            value: '',
            category: '资讯',
          });
        }
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取Worldometers失败' };
  }
}

export async function syncWorldometersToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'worldometers', syncedAt: new Date().toISOString() } };
}

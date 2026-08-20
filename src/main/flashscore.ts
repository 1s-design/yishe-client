/** Flashscore 足球比分 - https://www.flashscore.com/ */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface FlashScoreItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  homeTeam: string;
  awayTeam: string;
  score: string;
  category: string;
}

export interface FlashScoreResult {
  success: boolean;
  category: string;
  count: number;
  items: FlashScoreItem[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

export async function getFlashScoreStatus() {
  const s = await checkSiteAvailability('https://www.flashscore.com', { timeoutMs: 8000 });
  return {
    key: 'flashscore',
    pluginKey: 'flashscore',
    label: 'Flashscore',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Flashscore 可用' : `无法连接: ${s.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['fetch', 'search', 'status'],
  };
}

export async function fetchFlashScore(category: string = 'all', options: { query?: string; maxCount?: number } = {}): Promise<FlashScoreResult> {
  try {
    const fetchFn = await getFetchImpl();
    const limit = options.maxCount || 20;

    const res = await fetchFn('https://www.flashscore.com/', {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: FlashScoreItem[] = [];

    // Parse match events from the page
    const eventRegex = /<div[^>]*class="[^"]*event__match[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    let m;
    while ((m = eventRegex.exec(html)) !== null) {
      const block = m[1];
      const homeMatch = block.match(/<div[^>]*class="[^"]*event__participant[^"]*home[^"]*"[^>]*>([^<]*)<\/div>/) ||
        block.match(/<div[^>]*class="[^"]*event__participant[^"]*"[^>]*>([^<]*)<\/div>/);
      const awayMatch = block.match(/<div[^>]*class="[^"]*event__participant[^"]*away[^"]*"[^>]*>([^<]*)<\/div>/);
      const scoreMatch = block.match(/<div[^>]*class="[^"]*event__score[^"]*"[^>]*>([^<]*)<\/div>/);

      if (homeMatch || awayMatch) {
        const home = homeMatch?.[1]?.trim() || '';
        const away = awayMatch?.[1]?.trim() || '';
        const score = scoreMatch?.[1]?.trim() || '';
        items.push({
          title: `${home} ${score} ${away}`,
          link: 'https://www.flashscore.com/',
          description: `${home} vs ${away}`,
          pubDate: new Date().toISOString(),
          homeTeam: home,
          awayTeam: away,
          score,
          category: '足球',
        });
      }
    }

    // Alternative parsing for match data
    const altMatchRegex = /<span[^>]*class="[^"]*[^"]*"[^>]*>([^<]*)<\/span>\s*<span[^>]*class="[^"]*[^"]*"[^>]*>([^<]*)<\/span>/gi;
    while ((m = altMatchRegex.exec(html)) !== null) {
      const t1 = m[1]?.trim();
      const t2 = m[2]?.trim();
      if (t1 && t2 && t1.length > 1 && t2.length > 1 && !items.find(it => it.homeTeam === t1 && it.awayTeam === t2)) {
        items.push({
          title: `${t1} vs ${t2}`,
          link: 'https://www.flashscore.com/',
          description: `${t1} vs ${t2}`,
          pubDate: new Date().toISOString(),
          homeTeam: t1,
          awayTeam: t2,
          score: '',
          category: '足球',
        });
      }
    }

    const filtered = options.query
      ? items.filter((it) => it.title.toLowerCase().includes(options.query!.toLowerCase()))
      : items;

    return { success: true, category, count: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
  } catch (error: any) {
    return { success: false, category, count: 0, items: [], error: error?.message || '获取Flashscore失败' };
  }
}

export async function syncFlashScoreToLibrary(_c: string, d: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...d.metadata, source: 'flashscore', syncedAt: new Date().toISOString() } };
}

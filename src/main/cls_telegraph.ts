/** 财联社电报 - https://www.cls.cn/telegraph */
import axios from 'axios';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ClsTelegraphResult {
  success: boolean;
  query: string;
  data?: any;
  error?: string;
}

export async function getClsTelegraphStatus() {
  const s = await checkSiteAvailability('https://www.cls.cn', { timeoutMs: 8000 });
  return {
    key: 'cls_telegraph',
    pluginKey: 'cls_telegraph',
    label: '财联社电报',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '财联社 可用' : '无法连接',
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'status'],
  };
}

/**
 * 抓取财联社电报页面，从 HTML 中提取电报列表。
 * 财联社 API 需登录态认证，此处通过解析页面静态内容获取最新电报。
 */
export async function searchClsTelegraph(): Promise<ClsTelegraphResult> {
  try {
    const res = await axios.get('https://www.cls.cn/telegraph', {
      timeout: 12000,
      responseType: 'text',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://www.cls.cn/',
      },
    });

    const html = String(res.data || '');
    const items: any[] = [];

    // 尝试从 HTML 中的电报卡片提取标题与时间
    // 电报标题通常位于 class 含 telegraph 或 title 的元素中
    const titleRegex = /class="[^"]*(?:telegraph|item|news)[^"]*title[^"]*"[^>]*>([^<]+)<\/[^>]+>/gi;
    let m: RegExpExecArray | null;
    let rank = 0;
    while ((m = titleRegex.exec(html))) {
      rank++;
      items.push({ rank, title: m[1].trim() });
      if (rank >= 50) break;
    }

    // 若上述模式未匹配，尝试从页面中所有链接文本提取
    if (items.length === 0) {
      const linkRegex = /<a[^>]*href="\/depth\/\d+"[^>]*>([^<]{10,100})<\/a>/gi;
      while ((m = linkRegex.exec(html))) {
        rank++;
        items.push({ rank, title: m[1].trim() });
        if (rank >= 50) break;
      }
    }

    return {
      success: true,
      query: 'telegraph',
      data: {
        source: 'cls.cn/telegraph',
        items,
        count: items.length,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (e: any) {
    return { success: false, query: 'telegraph', error: e?.message || '获取失败' };
  }
}

export async function syncClsTelegraphToLibrary(_c: string, d: any) {
  return {
    success: true,
    message: '数据已获取',
    data: { ...d?.metadata, source: 'cls_telegraph', syncedAt: new Date().toISOString() },
  };
}

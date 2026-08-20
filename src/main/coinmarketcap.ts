/** CoinMarketCap - https://coinmarketcap.com */
import axios from 'axios';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface CoinmarketcapResult {
  success: boolean;
  query: string;
  data?: any;
  error?: string;
}

export async function getCoinmarketcapStatus() {
  const s = await checkSiteAvailability('https://coinmarketcap.com', { timeoutMs: 8000 });
  return {
    key: 'coinmarketcap',
    pluginKey: 'coinmarketcap',
    label: 'CoinMarketCap',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'CoinMarketCap 可用' : '无法连接',
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'status'],
  };
}

/**
 * 抓取 CoinMarketCap 首页加密货币行情。
 * 解析 HTML 表格中的币种、价格、涨跌幅等信息。
 * @param limit 返回条数，默认 20
 */
export async function searchCoinmarketcap(limit: number = 20): Promise<CoinmarketcapResult> {
  try {
    const res = await axios.get('https://coinmarketcap.com/', {
      timeout: 15000,
      responseType: 'text',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    const html = String(res.data || '');
    const items: any[] = [];

    // 尝试从表格行提取数据: 排名、名称、价格、24h 涨跌幅
    // CMC 表格行通常含 data-rank 属性
    const rowRegex = /data-rank="(\d+)"[\s\S]*?<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(html))) {
      const rank = parseInt(rowMatch[1], 10);
      const row = rowMatch[0];

      // 币种名称 (通常含 class 含 "name" 或 coin-name)
      const nameMatch = row.match(/class="[^"]*(?:name|coin-name|symbol)[^"]*"[^>]*>([^<]+)</i);
      const symbolMatch = row.match(/class="[^"]*(?:symbol|ticker)[^"]*"[^>]*>([^<]+)</i);

      // 价格
      const priceMatch = row.match(/\$([0-9,]+\.?[0-9]*)/);

      // 涨跌幅 (含正负号)
      const changeMatch = row.match(/([+-][0-9]+\.?[0-9]*)%/);

      items.push({
        rank,
        name: nameMatch ? nameMatch[1].trim() : `Rank ${rank}`,
        symbol: symbolMatch ? symbolMatch[1].trim() : '',
        priceUsd: priceMatch ? priceMatch[1] : '',
        change24h: changeMatch ? changeMatch[1] : '',
      });

      if (items.length >= limit) break;
    }

    // 若表格解析未命中，尝试从 href 链接中提取币种信息
    if (items.length === 0) {
      const coinLinkRegex = /href="\/currencies\/([^\/]+)\/"[\s\S]*?>([^<]{2,30})<\/a>/gi;
      let idx = 0;
      let linkMatch: RegExpExecArray | null;
      while ((linkMatch = coinLinkRegex.exec(html))) {
        idx++;
        items.push({ rank: idx, name: linkMatch[2].trim(), slug: linkMatch[1] });
        if (idx >= limit) break;
      }
    }

    return {
      success: true,
      query: `top-${limit}`,
      data: {
        source: 'coinmarketcap.com',
        items,
        count: items.length,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (e: any) {
    return { success: false, query: `top-${limit}`, error: e?.message || '获取失败' };
  }
}

export async function syncCoinmarketcapToLibrary(_c: string, d: any) {
  return {
    success: true,
    message: '数据已获取',
    data: { ...d?.metadata, source: 'coinmarketcap', syncedAt: new Date().toISOString() },
  };
}

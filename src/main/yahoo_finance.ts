/** Yahoo Finance - https://finance.yahoo.com */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface YahooFinanceResult {
  success: boolean;
  query: string;
  data?: any;
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

export async function getYahooFinanceStatus() {
  const s = await checkSiteAvailability('https://finance.yahoo.com', { timeoutMs: 8000 });
  return {
    key: 'yahoo_finance',
    pluginKey: 'yahoo_finance',
    label: 'Yahoo Finance',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? 'Yahoo Finance 可用' : '无法连接',
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'status'],
  };
}

/**
 * 查询 Yahoo Finance 行情图表数据。
 * 使用 v8 chart API 获取股票/指数行情。
 * @param symbol 代码，如 AAPL、^GSPC、BTC-USD，默认 AAPL
 * @param range 时间范围：1d/5d/1mo/3mo/6mo/1y/2y/5y/10y/ytd/max
 * @param interval 周期：1m/5m/15m/30m/1h/1d/1wk/1mo
 */
export async function searchYahooFinance(opts: {
  symbol?: string;
  range?: string;
  interval?: string;
} = {}): Promise<YahooFinanceResult> {
  try {
    const fetchFn = await getFetchImpl();
    const symbol = opts.symbol || 'AAPL';
    const range = opts.range || '1d';
    const interval = opts.interval || '1d';

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
    const res = await fetchFn(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
    if (!res.ok) return { success: false, query: symbol, error: `HTTP ${res.status}` };

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta || {};

    return {
      success: true,
      query: symbol,
      data: {
        symbol: meta.symbol,
        currency: meta.currency,
        exchange: meta.fullExchangeName || meta.exchangeName,
        regularMarketPrice: meta.regularMarketPrice,
        previousClose: meta.chartPreviousClose,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
        regularMarketVolume: meta.regularMarketVolume,
        range,
        interval,
      },
    };
  } catch (e: any) {
    return { success: false, query: opts.symbol || 'AAPL', error: e?.message || '获取失败' };
  }
}

export async function syncYahooFinanceToLibrary(_c: string, d: any) {
  return {
    success: true,
    message: '数据已获取',
    data: { ...d?.metadata, source: 'yahoo_finance', syncedAt: new Date().toISOString() },
  };
}

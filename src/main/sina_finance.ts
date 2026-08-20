/** 新浪财经 - https://finance.sina.com.cn */
import axios from 'axios';
import { checkSiteAvailability } from './siteAvailability';
import iconv from 'iconv-lite';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface SinaFinanceResult {
  success: boolean;
  query: string;
  data?: any;
  error?: string;
}

export async function getSinaFinanceStatus() {
  const s = await checkSiteAvailability('https://finance.sina.com.cn', { timeoutMs: 8000 });
  return {
    key: 'sina_finance',
    pluginKey: 'sina_finance',
    label: '新浪财经',
    connected: s.ok,
    available: s.ok,
    status: s.ok ? 'connected' : 'error',
    state: s.ok ? 'idle' : 'offline',
    message: s.ok ? '新浪财经 可用' : '无法连接',
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'status'],
  };
}

/**
 * 查询新浪财经实时行情。
 * 使用 Sina HQ 接口（返回 GBK 编码文本）。
 * @param codes 代码列表，如 s_sh000001,s_sz399001 或 sh600519
 *        s_ 前缀表示指数，sh/sz 前缀表示个股
 */
export async function searchSinaFinance(codes: string = 's_sh000001,s_sz399001,s_sz399006'): Promise<SinaFinanceResult> {
  try {
    const res = await axios.get(`https://hq.sinajs.cn/list=${codes}`, {
      timeout: 10000,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://finance.sina.com.cn/',
      },
    });

    const text = iconv.decode(Buffer.from(res.data), 'gbk');
    const lines = text.split(';').map((l) => l.trim()).filter(Boolean);

    const items = lines.map((line) => {
      // 格式: var hq_str_sh600519="贵州茅台,1800.00,...";
      const match = line.match(/hq_str_(\w+)="(.*)"/);
      if (!match) return null;
      const code = match[1];
      const fields = match[2].split(',');
      // 指数格式（s_ 前缀）
      if (code.startsWith('s_')) {
        const realCode = code.slice(2);
        return {
          code: realCode,
          name: fields[0] || '',
          open: fields[1] || '',
          closePrev: fields[2] || '',
          price: fields[3] || '',
          high: fields[4] || '',
          low: fields[5] || '',
          volume: fields[6] || '',
          amount: fields[7] || '',
        };
      }
      // 个股格式
      return {
        code,
        name: fields[0] || '',
        open: fields[1] || '',
        closePrev: fields[2] || '',
        price: fields[3] || '',
        high: fields[4] || '',
        low: fields[5] || '',
        volume: fields[8] || '',
        amount: fields[9] || '',
        date: fields[30] || '',
        time: fields[31] || '',
      };
    }).filter(Boolean);

    return { success: true, query: codes, data: items };
  } catch (e: any) {
    return { success: false, query: codes, error: e?.message || '获取失败' };
  }
}

export async function syncSinaFinanceToLibrary(_c: string, d: any) {
  return {
    success: true,
    message: '数据已获取',
    data: { ...d?.metadata, source: 'sina_finance', syncedAt: new Date().toISOString() },
  };
}

/** 东方财富 - https://quote.eastmoney.com */
import axios from "axios";
import { checkSiteAvailability } from "./siteAvailability";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface EastmoneyResult {
  success: boolean;
  query: string;
  data?: any;
  error?: string;
}

export async function getEastmoneyStatus() {
  const s = await checkSiteAvailability("https://quote.eastmoney.com", {
    timeoutMs: 8000,
  });
  return {
    key: "eastmoney",
    pluginKey: "eastmoney",
    label: "东方财富",
    connected: s.ok,
    available: s.ok,
    status: s.ok ? "connected" : "error",
    state: s.ok ? "idle" : "offline",
    message: s.ok ? "东方财富 可用" : "无法连接",
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ["search", "status"],
  };
}

/**
 * 查询东方财富实时行情。
 * 使用 push2 接口（secid 格式: 市场.代码，如 1.000001 上证指数，0.399001 深证成指）。
 * @param secid 合约 ID，如 1.000001
 */
export async function searchEastmoney(
  secid: string = "1.000001",
): Promise<EastmoneyResult> {
  const fields =
    "f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f60,f116,f117,f162,f167,f168,f169,f170,f171";
  let lastError = "获取失败";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await axios.get(
        `https://push2.eastmoney.com/api/qt/stock/get`,
        {
          timeout: 10000,
          params: { secid, fields, ut: "fa5fd1943c7b386f172d6893dbbd1" },
          headers: {
            "User-Agent": USER_AGENT,
            Referer: "https://quote.eastmoney.com/",
            Accept: "application/json, text/plain, */*",
            Connection: "keep-alive",
          },
        },
      );
      const d = res?.data?.data || null;
      if (!d)
        return {
          success: false,
          query: secid,
          error: "东方财富接口返回空数据",
        };

      // 字段含义（价格类字段需除以相应倍数）
      const priceHint = d.f50 || 2; // 价格倍数
      const div = Math.pow(10, priceHint);

      return {
        success: true,
        query: secid,
        data: {
          code: d.f57,
          name: d.f58,
          open: d.f46 ? d.f46 / div : null,
          high: d.f44 ? d.f44 / div : null,
          low: d.f45 ? d.f45 / div : null,
          price: d.f43 ? d.f43 / div : null,
          closePrev: d.f60 ? d.f60 / div : null,
          volume: d.f47 || null,
          amount: d.f48 || null,
          change: d.f169 != null ? d.f169 / div : null,
          changePercent: d.f170 != null ? d.f170 / 100 : null,
          amplitude: d.f171 != null ? d.f171 / 100 : null,
          turnover: d.f168 != null ? d.f168 / 100 : null,
          pe: d.f162 != null ? d.f162 / 100 : null,
          totalMarketCap: d.f116 || null,
          circMarketCap: d.f117 || null,
        },
      };
    } catch (e: any) {
      lastError = e?.message || "获取失败";
      if (attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  return {
    success: false,
    query: secid,
    error: `东方财富请求失败（已重试 3 次）: ${lastError}`,
  };
}

export async function syncEastmoneyToLibrary(_c: string, d: any) {
  return {
    success: true,
    message: "数据已获取",
    data: {
      ...d?.metadata,
      source: "eastmoney",
      syncedAt: new Date().toISOString(),
    },
  };
}

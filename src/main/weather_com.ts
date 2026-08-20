/** Weather.com (The Weather Channel) - https://weather.com */
import { net } from "electron";
import { checkSiteAvailability } from "./siteAvailability";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface WeatherComResult {
  success: boolean;
  query: string;
  data?: any;
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === "function") return net.fetch.bind(net);
  return fetch;
}

export async function getWeatherComStatus() {
  const s = await checkSiteAvailability("https://weather.com", {
    timeoutMs: 8000,
  });
  return {
    key: "weather_com",
    pluginKey: "weather_com",
    label: "Weather.com",
    connected: s.ok,
    available: s.ok,
    status: s.ok ? "connected" : "error",
    state: s.ok ? "idle" : "offline",
    message: s.ok ? "Weather.com 可用" : "无法连接",
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ["search", "status"],
  };
}

/**
 * 查询 Weather.com 天气信息。
 * Weather.com 为 JS 渲染页面，此处抓取静态 HTML 中可用的地点与描述信息。
 * @param loc 位置，支持城市名（如 NewYork）或 Weather.com 位置编码（如 USNY0996:1:US）
 */
export async function searchWeatherCom(
  loc: string = "USNY0996:1:US",
): Promise<WeatherComResult> {
  try {
    const fetchFn = await getFetchImpl();
    const isCode = /^[A-Z]{4}/.test(loc) || loc.includes(":");
    // 已经是 Weather.com 位置编码时不能再次追加 :1:US，否则会生成
    // USNY0996%3A1%3AUS:1:US 并稳定返回 404。
    const path = isCode ? loc : `${loc}:1:US`;
    const url = `https://weather.com/weather/today/l/${isCode ? path : encodeURIComponent(path)}`;

    const res = await fetchFn(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok)
      return { success: false, query: loc, error: `HTTP ${res.status}` };

    const html = await res.text();

    // 提取页面标题（含地点信息）
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // 提取 meta 描述
    const descMatch = html.match(
      /<meta[^>]*name="description"[^>]*content="([^"]*)"/i,
    );
    const description = descMatch ? descMatch[1] : "";

    // 提取 JSON-LD 结构化数据
    const ldMatch = html.match(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i,
    );
    let structured: any = null;
    if (ldMatch) {
      try {
        structured = JSON.parse(ldMatch[1]);
      } catch {
        /* ignore */
      }
    }

    // 从标题解析地点（格式: "Weather Forecast and Conditions for CITY, STATE ..."）
    let location = loc;
    const locMatch = title.match(
      /Weather Forecast and Conditions for (.+?) - The Weather Channel/i,
    );
    if (locMatch) location = locMatch[1].trim();

    return {
      success: true,
      query: loc,
      data: {
        location,
        title,
        description,
        structured,
        sourceUrl: url,
      },
    };
  } catch (e: any) {
    return { success: false, query: loc, error: e?.message || "获取失败" };
  }
}

export async function syncWeatherComToLibrary(_c: string, d: any) {
  return {
    success: true,
    message: "数据已获取",
    data: {
      ...d?.metadata,
      source: "weather_com",
      syncedAt: new Date().toISOString(),
    },
  };
}

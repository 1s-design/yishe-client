/** 中国天气网 - https://www.weather.com.cn/ */
import axios from "axios";
import { checkSiteAvailability } from "./siteAvailability";
import iconv from "iconv-lite";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface WeatherCnResult {
  success: boolean;
  query: string;
  data?: any;
  error?: string;
}

export async function getWeatherCnStatus() {
  const s = await checkSiteAvailability("https://www.weather.com.cn", {
    timeoutMs: 8000,
  });
  return {
    key: "weather_cn",
    pluginKey: "weather_cn",
    label: "中国天气网",
    connected: s.ok,
    available: s.ok,
    status: s.ok ? "connected" : "error",
    state: s.ok ? "idle" : "offline",
    message: s.ok ? "中国天气网 可用" : "无法连接",
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ["search", "status"],
  };
}

/**
 * 查询中国城市天气。
 * @param cityCode 城市编码，默认北京 101010100（参见 weather.com.cn 城市编码表）
 */
export async function searchWeatherCn(
  cityCode: string = "101010100",
): Promise<WeatherCnResult> {
  try {
    // 实时天气数据（JSON API，需 https）
    const skRes = await axios.get(
      `https://www.weather.com.cn/data/sk/${cityCode}.html`,
      {
        timeout: 10000,
        responseType: "arraybuffer",
        headers: {
          "User-Agent": USER_AGENT,
          Referer: "https://www.weather.com.cn/",
        },
      },
    );
    const decoded = iconv.decode(Buffer.from(skRes.data), "utf-8").trim();
    let skJson: any;
    try {
      skJson = JSON.parse(decoded);
    } catch {
      const contentType = String(skRes.headers?.["content-type"] || "");
      return {
        success: false,
        query: cityCode,
        error: `中国天气接口返回非 JSON 内容（${contentType || "可能被上游拦截"}）`,
      };
    }
    const weatherinfo = skJson?.weatherinfo || {};

    // 7天预报（页面抓取，补充信息）
    let forecast: any[] = [];
    try {
      const fcRes = await axios.get(
        `https://www.weather.com.cn/weather/${cityCode}.html`,
        {
          timeout: 10000,
          responseType: "arraybuffer",
          headers: {
            "User-Agent": USER_AGENT,
            Referer: "https://www.weather.com.cn/",
          },
        },
      );
      const html = iconv.decode(Buffer.from(fcRes.data), "utf-8");
      // 解析 forecast 数据（隐藏域中的 JSON）
      const match = html.match(/var\s+forecast\s*=\s*(\{[\s\S]*?\});/);
      if (match) {
        const fcData = JSON.parse(match[1]);
        const f1 = fcData?.f?.f1 || [];
        forecast = f1.map((d: any) => ({
          date: d.fja,
          weather: d.fjb,
          tempHigh: d.fjc,
          tempLow: d.fjd,
          wind: d.fjf,
        }));
      }
    } catch {
      /* 预报解析失败不影响主数据 */
    }

    return {
      success: true,
      query: cityCode,
      data: {
        city: weatherinfo.city || cityCode,
        cityid: weatherinfo.cityid,
        temp: weatherinfo.temp,
        windDirection: weatherinfo.WD,
        windPower: weatherinfo.WS,
        humidity: weatherinfo.SD,
        weather: weatherinfo.weather,
        reportTime: weatherinfo.time,
        forecast,
      },
    };
  } catch (e: any) {
    return { success: false, query: cityCode, error: e?.message || "获取失败" };
  }
}

export async function syncWeatherCnToLibrary(_c: string, d: any) {
  return {
    success: true,
    message: "数据已获取",
    data: {
      ...d?.metadata,
      source: "weather_cn",
      syncedAt: new Date().toISOString(),
    },
  };
}

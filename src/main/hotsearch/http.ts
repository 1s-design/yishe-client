/**
 * 热搜采集 HTTP 工具
 * 支持代理的 axios 实例
 */

import axios, { type AxiosRequestConfig } from "axios";
import http from "http";
import https from "https";
import type { FetchContext } from "./types";

// 延迟加载 proxy-agent
let HttpsProxyAgent: any = null;
try {
  // 尝试从 node_modules 加载
  HttpsProxyAgent = require("https-proxy-agent").HttpsProxyAgent;
} catch {
  try {
    // 备选：尝试从父依赖加载
    const mod = require(require.resolve("https-proxy-agent", { paths: [process.cwd(), __dirname] }));
    HttpsProxyAgent = mod.HttpsProxyAgent;
  } catch {
    /* 代理模块不可用时忽略 */
  }
}

/**
 * 创建支持代理的 axios 实例
 * 仅当 ctx.proxy 存在且 proxy-agent 可用时才走代理
 */
export function createHttpClient(ctx: FetchContext) {
  const config: AxiosRequestConfig = {
    timeout: ctx.timeout,
    headers: {
      "User-Agent": ctx.userAgent,
    },
    // 最大并发连接数
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 6 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 6 }),
  };

  // 如果有代理配置且 proxy-agent 可用，设置代理
  if (ctx.proxy && HttpsProxyAgent) {
    const proxyUrl = `${ctx.proxy.protocol || "http"}://${ctx.proxy.host}:${ctx.proxy.port}`;
    config.httpsAgent = new HttpsProxyAgent(proxyUrl);
    config.httpAgent = new HttpsProxyAgent(proxyUrl);
    config.proxy = false; // 禁用 axios 内置代理，使用 agent 代替
  } else if (ctx.proxy && !HttpsProxyAgent) {
    console.warn("[HotSearch] 代理配置存在但 https-proxy-agent 不可用，将直连");
  }

  return axios.create(config);
}

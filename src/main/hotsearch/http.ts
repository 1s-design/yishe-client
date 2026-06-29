/**
 * 热搜采集 HTTP 工具
 * 支持代理的 axios 实例
 */

import axios, { type AxiosRequestConfig } from "axios";
import type { FetchContext } from "./types";

// 延迟加载 proxy-agent（避免在不需要代理时加载）
let HttpsProxyAgent: any = null;
try {
  HttpsProxyAgent = require("https-proxy-agent").HttpsProxyAgent;
} catch {
  /* 代理模块不可用时忽略 */
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
  };

  // 如果有代理配置且 proxy-agent 可用，设置代理
  if (ctx.proxy && HttpsProxyAgent) {
    const proxyUrl = `${ctx.proxy.protocol || "http"}://${ctx.proxy.host}:${ctx.proxy.port}`;
    config.httpsAgent = new HttpsProxyAgent(proxyUrl);
    config.proxy = false; // 禁用 axios 内置代理，使用 agent 代替
  }

  return axios.create(config);
}

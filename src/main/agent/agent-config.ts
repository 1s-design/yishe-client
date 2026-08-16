/**
 * 客户端 Agent 配置管理器
 * 优先从云端接口获取 ai.client-agent.execute 绑定的配置，支持本地私有配置与 Ollama 覆盖
 */

import { app } from "electron";
import path from "path";
import fs from "fs";
import axios, { type AxiosResponse } from "axios";
import { Agent as HttpsAgent } from "https";

export interface ClientAgentConfig {
  keyId: number | null;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  isCustom: boolean; // 是否是用户手动配置覆盖
}

const DEFAULT_CONFIG: ClientAgentConfig = {
  keyId: null,
  provider: "openai",
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  enabled: false,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: `你是「衣设客户端」智能副驾 Agent，具备调用桌面原生工具、本地文件系统、Photoshop 自动化、网页数据抓取与 178+ 项本地能力的高级智能助手。
请根据用户的需求，合理规划步骤并调用相应的工具来高效完成任务。如果调用了工具，请在回答中对执行结果做出清晰明了的总结。`,
  isCustom: false,
};

let cachedConfig: ClientAgentConfig = { ...DEFAULT_CONFIG };
let localConfigLoaded = false;

const expiredCertificateAgent = new HttpsAgent({ rejectUnauthorized: false });

/**
 * 正常情况下始终校验证书。当前生产配置域名的证书过期时，才对该固定域名作一次
 * 有范围的回退，保证已登录客户端仍能读取服务端绑定；证书续期后会自动回到严格校验。
 */
async function requestServerConfig<T>(
  method: "GET" | "POST",
  url: string,
  token: string,
  data?: unknown,
): Promise<AxiosResponse<T>> {
  const request = (httpsAgent?: HttpsAgent) =>
    axios.request<T>({
      method,
      url,
      data,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 6000,
      ...(httpsAgent ? { httpsAgent } : {}),
    });

  try {
    return await request();
  } catch (error: any) {
    const hostname = new URL(url).hostname;
    if (error?.code === "CERT_HAS_EXPIRED" && hostname === "1s.design") {
      console.warn(
        "[AgentConfig] 服务端 TLS 证书已过期，临时回退读取客户端 Agent 绑定配置",
      );
      return request(expiredCertificateAgent);
    }
    throw error;
  }
}

function getConfigFilePath(): string {
  const userData = app?.getPath ? app.getPath("userData") : "/tmp";
  return path.join(userData, "yishe-client-agent-config.json");
}

/**
 * 读取本地持久化配置
 */
export function loadLocalAgentConfig(): ClientAgentConfig {
  try {
    const file = getConfigFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      cachedConfig = { ...DEFAULT_CONFIG, ...data };
      localConfigLoaded = true;
      return cachedConfig;
    }
  } catch (err) {
    console.warn("[AgentConfig] 读取本地配置失败:", err);
  }
  localConfigLoaded = true;
  return cachedConfig;
}

/**
 * 保存本地持久化配置
 */
export function saveLocalAgentConfig(
  config: Partial<ClientAgentConfig>,
): ClientAgentConfig {
  try {
    if (!localConfigLoaded) loadLocalAgentConfig();
    cachedConfig = { ...cachedConfig, ...config };
    const file = getConfigFilePath();
    fs.writeFileSync(file, JSON.stringify(cachedConfig, null, 2), "utf-8");
  } catch (err) {
    console.error("[AgentConfig] 保存本地配置失败:", err);
  }
  return cachedConfig;
}

/**
 * 从云端 design-server 同步 ai.client-agent.execute 场景绑定的配置
 */
export async function syncCloudAgentConfig(
  serverBase: string,
  token: string,
): Promise<ClientAgentConfig> {
  if (!localConfigLoaded) loadLocalAgentConfig();
  if (!serverBase || !token) {
    return cachedConfig;
  }

  try {
    const apiBase = serverBase.replace(/\/+$/, "");
    // 1. 读取当前用户的 featureBindings。usage-options 在新版服务端返回的是可用 Key 列表，
    // 并不包含功能 code，因此不能用于定位 ai.client-agent.execute。
    const settingRes = await requestServerConfig<any>(
      "POST",
      `${apiBase}/user/getAiSetting`,
      token,
      {},
    );
    const aiSetting = settingRes.data?.data || settingRes.data || {};
    const bindings = aiSetting.featureBindings || {};
    const clientAgentItem =
      bindings["ai.client-agent.execute"] || bindings["ai.agent.execute"];

    if (!clientAgentItem?.keyId) {
      // 用户切换或解除绑定时不能继续使用上一账号残留的 Key。
      cachedConfig = { ...DEFAULT_CONFIG, isCustom: false };
      return cachedConfig;
    }

    // 2. 获取具体 Key 的明细（BaseURL、ApiKey、Model）。该请求仅发生在主进程，密钥不会暴露给 Renderer。
    const keyRes = await requestServerConfig<any>(
      "GET",
      `${apiBase}/system/ai-api-key/${clientAgentItem.keyId}`,
      token,
    );

    const keyData = keyRes.data?.data || keyRes.data;
    const apiKey = String(keyData?.apiKey || keyData?.secret || "").trim();
    if (!keyData || !apiKey) {
      cachedConfig = { ...DEFAULT_CONFIG, isCustom: false };
      throw new Error("已绑定客户端 Agent，但未获取到可用模型密钥");
    }

    cachedConfig = {
      ...DEFAULT_CONFIG,
      keyId: clientAgentItem.keyId,
      provider: keyData.provider || "openai",
      model: clientAgentItem.model || keyData.model || "deepseek-chat",
      baseUrl: keyData.baseUrl || "https://api.deepseek.com/v1",
      apiKey,
      enabled: true,
      isCustom: false,
    };
    console.log(
      `[AgentConfig] 成功同步云端 Agent 配置: provider=${cachedConfig.provider}, model=${cachedConfig.model}`,
    );
    return cachedConfig;
  } catch (err: any) {
    console.warn("[AgentConfig] 同步云端 Agent 配置失败:", err?.message || err);
    throw err;
  }
}

/**
 * 获取当前生效的 Agent 配置
 */
export function getActiveAgentConfig(): ClientAgentConfig {
  if (!localConfigLoaded) {
    loadLocalAgentConfig();
  }
  return cachedConfig;
}

/** 用户退出时清除模型凭据，避免下一位登录用户沿用旧账号的 Agent 权限。 */
export function clearActiveAgentConfig(): ClientAgentConfig {
  cachedConfig = { ...DEFAULT_CONFIG };
  localConfigLoaded = true;
  try {
    const file = getConfigFilePath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    console.warn("[AgentConfig] 清除本地配置失败:", err);
  }
  return cachedConfig;
}

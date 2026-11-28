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
  model: "",
  baseUrl: "",
  // Never ship a credential in the application bundle.  The model credential
  // is populated in the main process by syncCloudAgentConfig() after the user
  // signs in and has an ai.client-agent.execute binding.
  apiKey: "",
  enabled: false,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: `你是「衣设客户端」智能副驾 Agent，运行在用户本机桌面端，可调度本机原生工具与衣设云端业务能力。
核心协作规则：
1. 涉及衣设平台业务数据与操作（素材库/贴纸/组图/PSD模板/PS套图/独立站商品/多平台发布/工作流等），直接调用对应云端能力（server_* 开头），禁止反问“指哪个平台”，严禁用本地 filesystem_* 替代。
2. 仅当用户明确给出本机磁盘路径或要求读写本地文件时，才调用 filesystem_* 工具。
3. 涉及下载、入库或高风险写操作且存在多个选项时，先只读查询并向用户展示选项，确认后再执行。
4. 涉及文件路径、素材 ID、链接或数据时，只能引用工具真实返回字段，绝不编造；若工具返回图片 URL，用 ![描述](URL) 展示。`,
  isCustom: false,
};

let cachedConfig: ClientAgentConfig = { ...DEFAULT_CONFIG };
let localConfigLoaded = false;

const expiredCertificateAgent = new HttpsAgent({ rejectUnauthorized: false });

/** 服务端请求统一入口（含证书过期回退），供 Agent 配置与能力目录共用。 */
export async function requestDesignServer<T>(
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
      proxy: false,
      ...(httpsAgent ? { httpsAgent } : {}),
    });

  try {
    return await request();
  } catch (error: any) {
    if (
      error?.code === "CERT_HAS_EXPIRED" ||
      error?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      error?.code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    ) {
      console.warn(
        `[AgentConfig] 服务端 TLS 证书验证异常 (${error.code})，临时回退读取客户端 Agent 绑定配置`,
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
 *
 * 只认该功能自己绑定的 Key：统一走 /ai/runtime-config，由服务端 resolveRuntimeConfig
 * 收敛（不接受跨功能回退、不接受跨 spec 回退、不接受硬编码模型/地址兜底）。
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

    // 该请求仅发生在主进程，密钥不会暴露给 Renderer。
    const res = await requestDesignServer<any>(
      "GET",
      `${apiBase}/ai/runtime-config?featureCode=ai.client-agent.execute`,
      token,
    );

    const config = res.data?.data || res.data || {};
    const apiKey = String(config.apiKey || "").trim();
    const baseUrl = String(config.baseURL || config.baseUrl || "").trim();
    const model = String(config.model || "").trim();
    const keyId = Number(config.keyId) > 0 ? Number(config.keyId) : null;

    if (!apiKey || !baseUrl || !model) {
      // 用户未绑定、绑定的 Key 已删除/停用/过期，或 Key 未填默认模型 ——
      // 不能继续使用上一账号残留的 Key。
      cachedConfig = { ...DEFAULT_CONFIG, isCustom: false };
      throw new Error(
        "未获取到可用的客户端 Agent 模型配置，请在「AI 使用设置」中为「客户端 Agent」绑定已启用且填写默认模型的 AI Key",
      );
    }

    cachedConfig = {
      ...DEFAULT_CONFIG,
      keyId,
      provider: "openai",
      model,
      baseUrl,
      apiKey,
      enabled: true,
      isCustom: false,
    };
    console.log(
      `[AgentConfig] 成功同步云端 Agent 配置: keyId=${keyId}, model=${cachedConfig.model}`,
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

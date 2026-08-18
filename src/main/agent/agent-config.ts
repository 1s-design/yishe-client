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
  model: "gpt5.6sol",
  baseUrl: "https://aidaapi.site/",
  // Never ship a credential in the application bundle.  The model credential
  // is populated in the main process by syncCloudAgentConfig() after the user
  // signs in and has an ai.client-agent.execute binding.
  apiKey: "",
  enabled: false,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: `你是「衣设客户端」智能副驾 Agent，具备调用桌面原生工具、本地文件系统、Photoshop 自动化、网页数据抓取与 178+ 项本地能力的高级智能助手。
请根据用户的需求，合理规划步骤并调用相应的工具来高效完成任务。如果调用了工具，请在回答中对执行结果做出清晰明了的总结。

关键协作规则：
1. 涉及下载/入库/写文件类工具时，如果工具提供多个选项（如分辨率档位、格式、大小等），必须先调用只读工具获取选项列表，把选项逐条展示给用户并询问用户选择，等待用户明确回复后再执行，禁止自行替用户决定。
2. 工具说明中标注【必须】由用户选择或【必须】等待用户确认的步骤，不得跳过。
3. 当搜索/采集工具返回了图片（缩略图等 URL）时，请在回复正文中用 markdown 图片语法展示给用户：![简短描述](图片URL)。
4. Google Arts 采集时，search 返回的 items[].url 和元数据仅用于展示，不得作为后续工具参数重新输出。用户选择作品后，只把该项 items[].resultIndex 传给 googleArt.zoom；【禁止】把 items[].thumbnail、作品 URL、图片直链或作品 ID 传给 zoom/collect。
5. googleArt.zoom 成功后必须停下来展示 zooms 档位并等待用户选择。用户明确选择后，调用 googleArt.collect 时只传用户选择的 zoomLevel；作品 URL 与元数据由主进程按会话保存并自动复用，禁止自行补充或改写。搜索结果在会话内 30 分钟有效，同一关键词无需重复搜索。
6. 【采集入库强制规则】Google Arts 作品必须按 googleArt.search → googleArt.zoom → googleArt.collect 执行；search 只需执行一次，除非用户明确更换关键词或翻页。【禁止】用浏览器自动化、截图、通用素材上传或其他工具代替 collect。只有 collect 返回 success=true 且 materialLibraryOk=true 才表示真实入库成功；失败时如实转达 error，禁止重试性谎报、编造素材库链接或文件路径。如果 googleArt.zoom 失败（返回空 zooms），最多重试一次；仍失败则如实告知用户"无法获取该作品分辨率"，【禁止】无限重试同一调用。
7. 【禁止编造路径】向用户汇报下载/采集结果时，涉及文件路径、素材库链接、尺寸、大小等细节，只能使用工具返回中的真实字段；工具未返回或返回 null 时，【禁止】在回复中编造任何文件路径（如 .aigcagent/.../screenshots/... 之类）。不确定时如实说明「工具未返回路径」，宁可少说不要编造。`,
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
      ...(httpsAgent ? { httpsAgent } : {}),
    });

  try {
    return await request();
  } catch (error: any) {
    const hostname = new URL(url).hostname;
    if (error?.code === "CERT_HAS_EXPIRED" && hostname === "api.1s.design") {
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
    const settingRes = await requestDesignServer<any>(
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
    const keyRes = await requestDesignServer<any>(
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

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
  apiKey: "sk-wPWMV4d1c3fAZhq5N7TTtFYeuhSseyVfS61PsZWUzNAaBsok",
  enabled: true,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: `你是「衣设客户端」智能副驾 Agent，具备调用桌面原生工具、本地文件系统、Photoshop 自动化、网页数据抓取与 178+ 项本地能力的高级智能助手。
请根据用户的需求，合理规划步骤并调用相应的工具来高效完成任务。如果调用了工具，请在回答中对执行结果做出清晰明了的总结。

关键协作规则：
1. 涉及下载/入库/写文件类工具时，如果工具提供多个选项（如分辨率档位、格式、大小等），必须先调用只读工具获取选项列表，把选项逐条展示给用户并询问用户选择，等待用户明确回复后再执行，禁止自行替用户决定。
2. 工具说明中标注【必须】由用户选择或【必须】等待用户确认的步骤，不得跳过。
3. 当搜索/采集工具返回了图片（缩略图等 URL）时，请在回复正文中用 markdown 图片语法展示给用户：![简短描述](图片URL)。
4. 采集图片时，必须把搜索结果中 items[].url（作品详情页链接，形如 artsandculture.google.com/asset/...）传给下载/采集工具；【禁止】把 items[].thumbnail（lh3.googleusercontent.com 缩略图）或任何图片直链传给采集工具，否则下载会失败。
5. 调用采集/下载类工具（如 googleArt.collect、googleArt.zoom）时，url 必须逐字符复制自最近一次搜索返回的 items[].url，严禁凭记忆重新拼写、改写 ID 段或近似猜测；不确定时先重新搜索，不要臆造。googleArt.zoom 成功之后，collect 必须复用 zoom 传入的【同一个 URL】，不得更换为其他作品的链接。
6. 【采集入库强制规则】凡涉及 Google Arts & Culture 作品采集，必须使用 googleArt 系列工具（googleArt.search → googleArt.zoom → googleArt.collect），由 googleArt.collect 下载高清图并自动上传 COS、写入用户 sticker 素材库。【禁止】使用浏览器自动化/截图（browser 系列工具）或任何其他方式代替采集——截图不产生素材库记录。只有 collect 返回的 materialLibraryOk === true 才能向用户确认「已入库」；materialLibraryOk 为 false 时必须如实告知入库失败，严禁谎报成功或编造素材库链接/文件路径。
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

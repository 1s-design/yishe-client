/*
 * 通用素材库上传模块（COS 上传 + 服务端 sticker/create 入库）
 *
 * 各采集平台（google-art / pinterest / wikimedia / …）共用本模块：
 * 上传链路、apiBase 解析、登录 token 均在此统一处理，
 * 平台侧只需提供本地文件路径与元数据，避免三处重复实现与 apiBase 写死导致的入库失败。
 */
import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { URL } from "url";
import { uploadFileToCos, generateCosKey, getBackendApiBase, getCurrentAccessToken } from "./cos";

type ServerModule = typeof import("./server");

let serverModulePromise: Promise<ServerModule> | null = null;

function getServerModule() {
  if (!serverModulePromise) {
    serverModulePromise = import("./server");
  }
  return serverModulePromise;
}

/** 入库 payload 通用字段（对齐服务端 sticker/create 契约） */
export interface MaterialLibraryPayload {
  /** COS 路径分类目录，如 google-art / pinterest / wikimedia */
  category: string;
  /** 素材分组标识，与 category 通常一致 */
  group: string;
  /** 来源描述，如 Google Arts & Culture - MoMA */
  source: string;
  /** 原始来源链接 */
  originUrl?: string;
  suffix?: string;
  name?: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  keywords?: string;
  keywordsEn?: string;
  colorPalette?: string;
  isPublic?: boolean;
  isTexture?: boolean;
  isCustom?: boolean;
  /** 平台扩展元数据（写入 meta 字段） */
  meta?: Record<string, unknown>;
}

export interface MaterialLibraryResult {
  ok: boolean;
  msg?: string;
  /** 服务端新建贴纸记录的唯一 ID（uuid） */
  materialId?: string;
  /** 服务端贴纸记录的 URL（COS 直链） */
  materialUrl?: string;
}

/**
 * 上传本地文件到 COS 并写入服务端素材库（sticker 表）。
 *
 * apiBase 未显式指定时，与 COS 配置一致地按当前服务模式动态解析
 * （local → 本地开发后端，remote → api.1s.design），保证 token 与后端同源。
 */
export async function uploadToMaterialLibrary(
  localPath: string,
  fileName: string,
  payload: MaterialLibraryPayload,
): Promise<MaterialLibraryResult> {
  const category = payload?.category || "uncategorized";
  console.log(`[MaterialLibrary] 准备入库: localPath=${localPath}, fileName=${fileName}, category=${category}`);

  // 1. 上传 COS
  const cosKey = await generateCosKey({ category, filename: fileName });
  console.log(`[MaterialLibrary] 开始上传 COS: cosKey=${cosKey}`);
  const cosResult = await uploadFileToCos(localPath, cosKey);
  if (!cosResult.ok || !cosResult.url) {
    console.error(`[MaterialLibrary] ❌ COS 上传失败:`, cosResult);
    return {
      ok: false,
      msg: "msg" in cosResult ? (cosResult.msg as string) : "COS 上传失败",
    };
  }
  console.log(`[MaterialLibrary] ✅ COS 上传成功: url=${cosResult.url}, key=${cosResult.key}`);

  // 2. 入库 sticker/create
  try {
    const { getTokenValue } = await getServerModule();
    const serverToken = getTokenValue();
    const windowToken = await getCurrentAccessToken();
    const token = serverToken || windowToken || "";
    const apiBase = (await getBackendApiBase()).replace(/\/+$/, "");

    const clean4ByteEmoji = (s: any) =>
      typeof s === "string" ? s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "").trim() : s;

    const name =
      clean4ByteEmoji(payload?.name) ||
      clean4ByteEmoji(payload?.nameEn) ||
      clean4ByteEmoji(fileName.replace(/\.(jpg|png|jpeg|webp|svg)$/i, "")) ||
      `material_${Date.now()}`;
    const nameEn = clean4ByteEmoji(payload?.nameEn) || name;
    const description = clean4ByteEmoji(payload?.description || "");
    const descriptionEn = clean4ByteEmoji(payload?.descriptionEn || payload?.description || "");
    const keywords = clean4ByteEmoji(payload?.keywords || "");
    const keywordsEn = clean4ByteEmoji(payload?.keywordsEn || payload?.keywords || "");
    const group = clean4ByteEmoji(payload?.group || category);

    const postData = JSON.stringify({
      url: cosResult.url,
      key: cosResult.key,
      suffix: payload?.suffix || "jpg",
      originUrl: payload?.originUrl || "",
      source: payload?.source || "",
      group,
      isPublic: payload?.isPublic ?? true,
      isTexture: payload?.isTexture ?? false,
      isCustom: payload?.isCustom ?? false,
      name,
      nameEn,
      description,
      descriptionEn,
      keywords,
      keywordsEn,
      colorPalette: payload?.colorPalette || "",
      meta: {
        collectedAt: new Date().toISOString(),
        ...(payload?.meta || {}),
      },
    });

    const apiUrl = new URL(`${apiBase}/sticker/create`);
    console.log(`[MaterialLibrary] 发起 sticker/create 请求: ${apiUrl.toString()}, tokenPresent=${Boolean(token)}`);
    const options = {
      hostname: apiUrl.hostname,
      port: apiUrl.port || (apiUrl.protocol === "https:" ? 443 : 80),
      path: apiUrl.pathname + apiUrl.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      rejectUnauthorized: false,
    };

    return new Promise((resolve) => {
      // 本地开发后端可能是 http://；不能无条件使用 https.request。
      const transport = apiUrl.protocol === "http:" ? http : https;
      const req = transport.request(options, (res: any) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          try {
            console.log(`[MaterialLibrary] sticker/create 响应状态码: ${res.statusCode}, 响应体: ${data.slice(0, 300)}`);
            if (res.statusCode && res.statusCode >= 400) {
              console.error(`[MaterialLibrary] ❌ sticker/create 响应 HTTP ${res.statusCode}: ${data}`);
              resolve({ ok: false, msg: `HTTP ${res.statusCode}: 请求失败 (${data || '无详情'})` });
              return;
            }
            const result = JSON.parse(data);
            // 后端 TransformInterceptor：{ code: 0, data, status: true }；data 即新建的 sticker 实体
            if (result.code === 0 && result.status === true) {
              const created = result.data && typeof result.data === "object" ? result.data : null;
              console.log(`[MaterialLibrary] ✅ sticker 创建成功: materialId=${created?.id}, materialUrl=${created?.url}`);
              resolve({
                ok: true,
                materialId: created?.id || undefined,
                materialUrl: created?.url || undefined,
              });
            } else {
              console.error(`[MaterialLibrary] ❌ sticker 创建业务失败:`, result);
              resolve({
                ok: false,
                msg: result.message || result.msg || "素材库保存失败",
              });
            }
          } catch (e: any) {
            console.error(`[MaterialLibrary] ❌ sticker 响应解析异常: ${e?.message}`);
            resolve({ ok: false, msg: "素材库 API 响应解析失败" });
          }
        });
      });

      req.on("error", (err: Error) => {
        console.error(`[MaterialLibrary] ❌ sticker API 请求网络异常: ${err.message}`);
        resolve({ ok: false, msg: `素材库 API 请求失败: ${err.message}` });
      });

      req.write(postData);
      req.end();
    });
  } catch (error: any) {
    console.error(`[MaterialLibrary] ❌ 上传到素材库外层捕获异常: ${error?.message}`);
    return {
      ok: false,
      msg: `上传到素材库失败: ${error?.message || String(error)}`,
    };
  }
}

/** 将本地文件上传到素材库的完整辅助函数（供能力工具组装元数据用） */
export async function syncLocalFileToMaterialLibrary(options: {
  filePath: string;
  fileName?: string;
  category: string;
  group?: string;
  source: string;
  originUrl?: string;
  title?: string;
  description?: string;
  keywords?: string[];
  keywordsEn?: string[];
  meta?: Record<string, unknown>;
}): Promise<
  MaterialLibraryResult & {
    filePath?: string;
    fileName?: string;
    fileSize?: number;
    materialLibraryOk?: boolean;
  }> {
  const { filePath, category, source } = options;
  if (!fs.existsSync(filePath)) {
    return { ok: false, msg: "文件不存在，无法上传" };
  }
  const fileName = options.fileName || path.basename(filePath);
  const title =
    options.title || fileName.replace(/\.(jpg|png|jpeg|webp)$/i, "");
  const size = await fs.promises
    .stat(filePath)
    .then((s) => s.size)
    .catch(() => 0);

  const result = await uploadToMaterialLibrary(filePath, fileName, {
    category,
    group: options.group || category,
    source,
    originUrl: options.originUrl,
    name: title,
    nameEn: title,
    description: options.description || "",
    descriptionEn: options.description || "",
    keywords: (options.keywords || []).join(","),
    keywordsEn: (options.keywordsEn || options.keywords || []).join(","),
    meta: options.meta,
  });

  return {
    ok: result.ok,
    msg: result.msg,
    materialId: result.materialId,
    materialUrl: result.materialUrl,
    filePath,
    fileName,
    fileSize: size,
    materialLibraryOk: result.ok,
  };
}

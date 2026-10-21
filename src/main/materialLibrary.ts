/*
 * 通用素材库上传模块（COS 上传 + 服务端 sticker/create 入库）
 *
 * 各采集平台（google-art / pinterest / wikimedia / …）共用本模块：
 * 上传链路、apiBase 解析、登录 token 均在此统一处理，
 * 平台侧只需提供本地文件路径与元数据，避免三处重复实现与 apiBase 写死导致的入库失败。
 */
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import https from "https";
import { URL } from "url";
import sharp from "sharp";
import * as imghash from "imghash";
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
  /**
   * 入库目标：crawler_material（采集素材，默认）| collect_file（采集文件，媒体采集）
   */
  materialTarget?: string;
  /** 文件大小（字节），不传则从本地文件自动提取 */
  fileSize?: number;
  /** 图片宽度（像素），不传则从本地文件自动提取 */
  width?: number;
  /** 图片高度（像素），不传则从本地文件自动提取 */
  height?: number;
  /** 是否抠图素材 */
  isCutout?: boolean;
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
 * 本地计算感知哈希（与服务端 imghash.hash(path, 12, "hex") 同参数，保证哈希可比）。
 * 重活在客户端：服务端不再下载图片算 phash。失败返回空串，不阻断入库。
 */
export async function computePhashLocal(localPath: string, suffix = "jpg"): Promise<string> {
  try {
    const isSvg = String(suffix).toLowerCase() === "svg";
    const tmpPath = path.join(
      os.tmpdir(),
      `mat-phash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${isSvg ? "png" : "jpg"}`,
    );
    if (isSvg) {
      await sharp(localPath, { limitInputPixels: false, failOn: "none", density: 300 })
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .png()
        .toFile(tmpPath);
    } else {
      const analysisBuffer = await sharp(localPath, { limitInputPixels: false, failOn: "none" })
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .toBuffer();
      fs.writeFileSync(tmpPath, analysisBuffer);
    }
    const phash = await imghash.hash(tmpPath, 12, "hex");
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* 忽略清理失败 */
    }
    return phash || "";
  } catch (e: any) {
    console.warn("[MaterialLibrary] phash 本地计算失败:", e?.message || e);
    return "";
  }
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
  const materialTarget = payload?.materialTarget === "collect_file" ? "collect_file" : "crawler_material";
  console.log(`[MaterialLibrary] 准备入库: localPath=${localPath}, fileName=${fileName}, category=${category}, target=${materialTarget}`);

  // 1. 客户端本地校验图片有效性并提取宽高/大小（必须在上传 COS 前执行，防止无效/错误页文件浪费云存储）
  let fileSize = payload?.fileSize ?? 0;
  let imgWidth = payload?.width ?? 0;
  let imgHeight = payload?.height ?? 0;
  const isSvgFile = /\.(svg|svgz)$/i.test(fileName) || /\.(svg|svgz)$/i.test(localPath);
  try {
    const stat = await fs.promises.stat(localPath);
    if (!fileSize) fileSize = stat.size;
    const meta = await sharp(localPath).metadata();
    imgWidth = meta.width || 0;
    imgHeight = meta.height || 0;
    // 如果是 SVG 但没有声明宽高，赋予默认视口
    if (isSvgFile && (!imgWidth || !imgHeight)) {
      imgWidth = imgWidth || 800;
      imgHeight = imgHeight || 800;
    }
  } catch (e: any) {
    // sharp 解析失败说明文件不是有效图片（如 HTML 404/429 错误页或空文件），阻断上传及入库
    throw new Error(`图片解析失败，拒绝上传及入库: ${e?.message || e}`);
  }
  if (!imgWidth || !imgHeight) {
    throw new Error("图片解析失败（宽高为 0），拒绝上传及入库");
  }
  const aspectRatio = imgWidth && imgHeight ? Number((imgWidth / imgHeight).toFixed(6)) : null;

  // 2. 校验通过后，上传 COS
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

  // 3. 入库
  try {
    const { getTokenValue } = await getServerModule();
    const serverToken = getTokenValue();
    const windowToken = await getCurrentAccessToken();
    const token = serverToken || windowToken || "";
    const apiBase = (await getBackendApiBase()).replace(/\/+$/, "");

    const clean4ByteEmoji = (s: any) =>
      typeof s === "string" ? s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "").trim() : s;

    // 感知哈希本地计算（服务端不下载图片算 phash）
    const phash = await computePhashLocal(localPath, payload?.suffix || "jpg");

    const name = (
      clean4ByteEmoji(payload?.name) ||
      clean4ByteEmoji(payload?.nameEn) ||
      clean4ByteEmoji(fileName.replace(/\.(jpg|png|jpeg|webp|svg)$/i, "")) ||
      `material_${Date.now()}`
    ).slice(0, 500);
    const nameEn = (clean4ByteEmoji(payload?.nameEn) || name).slice(0, 500);
    const description = clean4ByteEmoji(payload?.description || "").slice(0, 990);
    const descriptionEn = clean4ByteEmoji(payload?.descriptionEn || payload?.description || "").slice(0, 990);
    const keywords = clean4ByteEmoji(payload?.keywords || "").slice(0, 990);
    const keywordsEn = clean4ByteEmoji(payload?.keywordsEn || payload?.keywords || "").slice(0, 990);
    const group = clean4ByteEmoji(payload?.group || category).slice(0, 500);

    // 入库目标：collect_file（采集文件）或 crawler_material（采集素材，默认）
    const importItem = {
      url: cosResult.url,
      originUrl: (payload?.originUrl || "").slice(0, 1000),
      name,
      description,
      suffix: payload?.suffix || "jpg",
      source: clean4ByteEmoji(payload?.source || "").slice(0, 500),
      fileSize: fileSize || null,
      width: imgWidth || null,
      height: imgHeight || null,
      aspectRatio,
      phash: phash || "",
      isCutout: payload?.isCutout ?? false,
      meta: {
        collectedAt: new Date().toISOString(),
        cosKey: cosResult.key,
        ...(payload?.meta || {}),
      },
    };
    const postData = JSON.stringify({
      items: [materialTarget === "collect_file" ? { ...importItem, keywords: clean4ByteEmoji(payload?.keywords || "").slice(0, 1000) } : importItem],
    });

    const apiUrl = new URL(
      materialTarget === "collect_file"
        ? `${apiBase}/collect-file/import-from-cos`
        : `${apiBase}/crawler/material/import-from-cos`,
    );
    console.log(`[MaterialLibrary] 发起入库请求(${materialTarget}): ${apiUrl.toString()}, tokenPresent=${Boolean(token)}`);
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
            console.log(`[MaterialLibrary] 入库响应(${materialTarget}) 状态码: ${res.statusCode}, 响应体: ${data.slice(0, 300)}`);
            if (res.statusCode && res.statusCode >= 400) {
              console.error(`[MaterialLibrary] ❌ 入库响应(${materialTarget}) HTTP ${res.statusCode}: ${data}`);
              resolve({ ok: false, msg: `HTTP ${res.statusCode}: 请求失败 (${data || '无详情'})` });
              return;
            }
            const result = JSON.parse(data);
            // 后端 TransformInterceptor：{ code: 0, data: { success, failed, items, errors }, status: true }
            const innerData = result.data || result;
            if (innerData.success > 0 && innerData.items?.length > 0) {
              const created = innerData.items[0];
              console.log(`[MaterialLibrary] ✅ ${materialTarget} 创建成功: id=${created?.id}, url=${created?.url}`);
              resolve({
                ok: true,
                materialId: created?.id || undefined,
                materialUrl: created?.url || undefined,
              });
            } else {
              console.error(`[MaterialLibrary] ❌ ${materialTarget} 创建失败:`, result);
              resolve({
                ok: false,
                msg: (innerData.errors?.[0]?.error) || innerData.message || "素材库保存失败",
              });
            }
          } catch (e: any) {
            console.error(`[MaterialLibrary] ❌ 入库响应解析异常(${materialTarget}): ${e?.message}`);
            resolve({ ok: false, msg: "素材库 API 响应解析失败" });
          }
        });
      });

      req.on("error", (err: Error) => {
        console.error(`[MaterialLibrary] ❌ 入库 API 请求网络异常(${materialTarget}): ${err.message}`);
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

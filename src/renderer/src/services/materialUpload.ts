/*
 * @Description: 素材上传服务 - 在 renderer 端拉图并按目标落库
 */

import request from "../api/request";
import { LOCAL_API_BASE } from "../config/api";

export type MaterialUploadTarget = "sticker" | "crawler-material";

export interface MaterialUploadParams {
  url: string;
  name?: string;
  description?: string;
  keywords?: string;
  imageData?: string;
  fileName?: string;
  contentType?: string;
  fileSize?: number;
  suffix?: string;
  originUrl?: string;
  width?: number;
  height?: number;
  target?: MaterialUploadTarget;
}

export interface MaterialUploadResult {
  ok: boolean;
  message?: string;
  data?: {
    cosUrl: string;
    material: any;
  };
}

interface LocalClientSessionUser {
  id?: string | number | null;
  userId?: string | number | null;
  account?: string | null;
}

function readRendererUserId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const runtimeUser = (window as any).__currentUserInfo;
  if (runtimeUser?.id) {
    return String(runtimeUser.id).trim();
  }
  if (runtimeUser?.userId) {
    return String(runtimeUser.userId).trim();
  }

  try {
    const raw = localStorage.getItem("userInfo");
    if (!raw) {
      return "";
    }
    const parsed = JSON.parse(raw);
    return String(parsed?.id || parsed?.userId || "").trim();
  } catch (error) {
    console.warn("读取 renderer 用户信息失败:", error);
    return "";
  }
}

async function fetchLocalClientSessionUser(): Promise<LocalClientSessionUser | null> {
  try {
    const response = await fetch(`${LOCAL_API_BASE}/auth/session`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    if (!payload?.authorized || !payload?.user) {
      return null;
    }

    return payload.user as LocalClientSessionUser;
  } catch (error) {
    console.warn("读取本地客户端会话失败:", error);
    return null;
  }
}

async function fetchImageFromUrl(
  url: string,
): Promise<{ file: File; extension: string; width?: number; height?: number }> {
  const response = await fetch(url, {
    method: "GET",
    mode: "cors",
    headers: {
      Accept: "image/*",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.startsWith("image/")) {
    throw new Error("URL指向的不是图片文件");
  }

  const blob = await response.blob();
  if (blob.size > 50 * 1024 * 1024) {
    throw new Error("图片文件过大，请选择小于50MB的图片");
  }

  let extension = "jpg";
  const urlMatch = url.match(/\.([a-zA-Z0-9]+)(\?.*)?$/i);
  if (urlMatch) {
    extension = urlMatch[1].toLowerCase();
  } else {
    const typeMatch = contentType.match(/image\/([a-zA-Z0-9]+)/i);
    if (typeMatch) {
      extension = typeMatch[1].toLowerCase();
      if (extension === "jpeg") extension = "jpg";
    }
  }

  let width: number | undefined;
  let height: number | undefined;

  try {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        width = img.naturalWidth;
        height = img.naturalHeight;
        URL.revokeObjectURL(objectUrl);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("无法读取图片尺寸"));
      };
      img.src = objectUrl;
    });
  } catch (error) {
    console.warn("获取图片尺寸失败:", error);
  }

  const fileName = `image_${Date.now()}.${extension}`;
  const file = new File([blob], fileName, { type: blob.type });

  return { file, extension, width, height };
}

async function createFileFromInlineImage(
  params: MaterialUploadParams,
): Promise<{ file: File; extension: string; width?: number; height?: number }> {
  const imageData = String(params.imageData || "").trim();
  if (!imageData) {
    throw new Error("缺少图片数据");
  }

  const matched = imageData.match(/^data:([^;,]+);base64,(.+)$/);
  if (!matched) {
    throw new Error("图片数据格式无效");
  }

  const contentType = String(params.contentType || matched[1] || "image/jpeg").trim();
  if (!contentType.startsWith("image/")) {
    throw new Error("图片数据不是有效的图片格式");
  }

  const base64Data = matched[2];
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: contentType });
  if (blob.size > 50 * 1024 * 1024) {
    throw new Error("图片文件过大，请选择小于50MB的图片");
  }

  const extensionFromContentType = contentType
    .replace(/^image\//i, "")
    .split("+")[0]
    .toLowerCase();
  const extension = (
    String(params.suffix || extensionFromContentType || "jpg")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase() || "jpg"
  ).replace(/^jpeg$/, "jpg");

  const fileName =
    String(params.fileName || "").trim() || `image_${Date.now()}.${extension}`;
  const file = new File([blob], fileName, { type: contentType });

  return {
    file,
    extension,
    width: params.width,
    height: params.height,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadToCosViaMainProcess(
  fileData: string,
  fileName: string,
): Promise<{ url: string; key: string }> {
  const response = await fetch("http://localhost:1519/api/upload-to-cos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileData,
      fileName,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`上传失败: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  if (!result.success || !result.url) {
    throw new Error(result.message || "上传到COS失败");
  }

  return { url: result.url, key: result.key || "" };
}

async function saveToServer(params: {
  url: string;
  name: string;
  description: string;
  keywords: string;
  suffix: string;
  originUrl: string;
  width?: number;
  height?: number;
  target: MaterialUploadTarget;
}): Promise<any> {
  const sessionUser = await fetchLocalClientSessionUser();
  const userId =
    readRendererUserId() ||
    String(sessionUser?.id || sessionUser?.userId || "").trim();

  if (params.target === "crawler-material") {
    return request.post({
      url: "/crawler/material/add",
      data: {
        userId,
        url: params.url,
        name: params.name,
        description: params.description,
        keywords: params.keywords,
        suffix: params.suffix,
        originUrl: params.originUrl,
        source: "browser-extension",
        meta: {
          width: params.width,
          height: params.height,
        },
      },
    });
  }

  return request.post({
    url: "/sticker/create",
    data: {
      userId,
      url: params.url,
      name: params.name,
      description: params.description,
      keywords: params.keywords,
      suffix: params.suffix,
      originUrl: params.originUrl,
      width: params.width,
      height: params.height,
      isPublic: true,
      isTexture: false,
    },
  });
}

export async function downloadImageAndUploadMaterial(
  params: MaterialUploadParams,
): Promise<MaterialUploadResult> {
  try {
    const {
      url,
      name,
      description,
      keywords,
      imageData,
      target = "sticker",
    } = params;

    if (!url || !url.trim()) {
      return {
        ok: false,
        message: "URL 参数必填",
      };
    }

    const { file, extension, width, height } = imageData
      ? await createFileFromInlineImage(params)
      : await fetchImageFromUrl(url);
    const fileData = await fileToBase64(file);
    const cosResult = await uploadToCosViaMainProcess(fileData, file.name);

    const serverResult = await saveToServer({
      url: cosResult.url,
      name: name || `素材_${Date.now()}`,
      description: description || "",
      keywords: keywords || "",
      suffix: extension,
      originUrl: url,
      width,
      height,
      target,
    });

    if (serverResult.code === 0) {
      return {
        ok: true,
        message:
          target === "crawler-material"
            ? "已上传到爬图素材"
            : "已上传到图片素材",
        data: {
          cosUrl: cosResult.url,
          material: serverResult.data,
        },
      };
    }

    return {
      ok: false,
      message: serverResult.message || "保存到服务端失败",
    };
  } catch (error: any) {
    console.error("下载并上传失败:", error);
    const status = error?.response?.status;
    if (status === 401) {
      return {
        ok: false,
        message: "客户端登录已失效，请重新登录 YiShe 客户端后重试",
      };
    }
    if (status === 403) {
      return {
        ok: false,
        message: "素材落库被服务端拒绝，请确认客户端已登录且用户信息已完成初始化",
      };
    }
    return {
      ok: false,
      message: error?.message || "上传失败",
    };
  }
}

export type CrawlerMaterialUploadParams = MaterialUploadParams;
export type CrawlerMaterialUploadResult = MaterialUploadResult;
// 兼容旧命名，内部已统一到 downloadImageAndUploadMaterial。
export const downloadImageAndUploadToCrawler = downloadImageAndUploadMaterial;

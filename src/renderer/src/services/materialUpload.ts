/*
 * @Description: 素材上传服务 - 在 renderer 端拉图并按目标落库
 */

import request from "../api/request";

export type MaterialUploadTarget = "sticker" | "crawler-material";

export interface MaterialUploadParams {
  url: string;
  name?: string;
  description?: string;
  keywords?: string;
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
  if (params.target === "crawler-material") {
    return request.post({
      url: "/crawler/material/add",
      data: {
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
      target = "sticker",
    } = params;

    if (!url || !url.trim()) {
      return {
        ok: false,
        message: "URL 参数必填",
      };
    }

    const { file, extension, width, height } = await fetchImageFromUrl(url);
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
    return {
      ok: false,
      message: error?.message || "上传失败",
    };
  }
}

export type CrawlerMaterialUploadParams = MaterialUploadParams;
export type CrawlerMaterialUploadResult = MaterialUploadResult;
export const downloadImageAndUploadToCrawler = downloadImageAndUploadMaterial;

import request from "../api/request";
import { LOCAL_API_BASE } from "../config/api";

export interface FileUploadParams {
  url: string;
  name?: string;
  description?: string;
  fileData?: string;
  localFilePath?: string;
  fileName: string;
  contentType?: string;
  fileSize?: number;
  suffix?: string;
}

export interface FileUploadResult {
  ok: boolean;
  message?: string;
  data?: {
    cosUrl: string;
    file: any;
  };
}

async function uploadToCosViaMainProcess(
  fileData: string,
  fileName: string,
): Promise<{ url: string; key: string }> {
  const response = await fetch(`${LOCAL_API_BASE}/upload-to-cos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileData,
      fileName,
      category: "file-resource",
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

async function uploadLocalFileToCosViaMainProcess(
  localFilePath: string,
  fileName: string,
): Promise<{ url: string; key: string }> {
  const nativeApi = typeof window === "undefined" ? undefined : window.api;
  if (!nativeApi?.generateCosKey || !nativeApi?.uploadFileToCos) {
    throw new Error("本地文件上传能力不可用，请升级或重启 YiShe 客户端");
  }

  const keyResult = await nativeApi.generateCosKey({
    category: "file-resource",
    filename: fileName,
  });
  if (!keyResult.ok || !keyResult.key) {
    throw new Error(keyResult.msg || "生成COS Key失败");
  }

  const uploadResult = await nativeApi.uploadFileToCos({
    filePath: localFilePath,
    key: keyResult.key,
  });
  if (!uploadResult.ok || !uploadResult.url) {
    throw new Error(uploadResult.msg || "上传到COS失败");
  }

  return { url: uploadResult.url, key: uploadResult.key || keyResult.key };
}

export async function uploadFileResource(
  params: FileUploadParams,
): Promise<FileUploadResult> {
  try {
    const fileName = String(params.fileName || "").trim();
    const fileData = String(params.fileData || "").trim();
    const localFilePath = String(params.localFilePath || "").trim();
    if (!fileName) {
      return { ok: false, message: "文件名必填" };
    }
    if (!fileData && !localFilePath) {
      return { ok: false, message: "文件数据或本地文件路径必填" };
    }

    const suffix =
      String(params.suffix || fileName.split(".").pop() || "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase() || "bin";
    const cosResult = localFilePath
      ? await uploadLocalFileToCosViaMainProcess(localFilePath, fileName)
      : await uploadToCosViaMainProcess(fileData, fileName);
    const serverResult = await request.post({
      url: "/file-resource/create",
      data: {
        url: cosResult.url,
        name: params.name || fileName,
        description: params.description || "",
        suffix,
        category: "browser-extension",
        meta: {
          source: "browser-extension",
          originUrl: params.url || "",
          contentType: params.contentType || "",
          cosKey: cosResult.key,
          fileName,
          size: Number(params.fileSize || 0),
        },
      },
    });

    if (serverResult.code === 0) {
      return {
        ok: true,
        message: "文件已保存到文件资源",
        data: {
          cosUrl: cosResult.url,
          file: serverResult.data,
        },
      };
    }

    return {
      ok: false,
      message: serverResult.message || "保存到文件资源失败",
    };
  } catch (error: any) {
    console.error("保存文件资源失败:", error);
    const status = error?.response?.status;
    if (status === 401) {
      return { ok: false, message: "客户端登录已失效，请重新登录 YiShe 客户端后重试" };
    }
    return {
      ok: false,
      message: error?.message || "保存文件资源失败",
    };
  }
}

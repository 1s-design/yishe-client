import request from "./request";
import { LOCAL_API_BASE } from "../config/api";

function getNativeApi() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as typeof window & { api?: typeof window.api }).api;
}

export async function saveTokenToClient(token: string): Promise<boolean> {
  try {
    const nativeApi = getNativeApi();
    if (!nativeApi?.saveToken) {
      console.warn("saveTokenToClient: 当前环境未注入桌面端 token 保存能力");
      return false;
    }

    console.log("saveTokenToClient: 开始保存 token", {
      tokenLength: token?.length,
      tokenPreview: token ? `${token.substring(0, 30)}...` : "null",
    });
    const result = await nativeApi.saveToken(token);
    console.log("saveTokenToClient: 保存结果", { success: result });

    // 立即验证 token 是否已保存
    const savedToken = await getTokenFromClient();
    console.log("saveTokenToClient: 验证保存结果", {
      saved: !!savedToken,
      matches: savedToken === token,
      savedLength: savedToken?.length,
    });

    return result;
  } catch (error) {
    console.error("saveTokenToClient: 保存失败", error);
    throw error;
  }
}

export async function getTokenFromClient(): Promise<string | undefined> {
  try {
    const nativeApi = getNativeApi();
    if (!nativeApi?.getToken) {
      return undefined;
    }

    const token = await nativeApi.getToken();
    console.log("getTokenFromClient 返回:", {
      hasToken: !!token,
      tokenType: typeof token,
      tokenLength: token?.length,
    });
    return token;
  } catch (error) {
    console.error("getTokenFromClient 错误:", error);
    return undefined;
  }
}

export function isClientAuthorized() {
  const nativeApi = getNativeApi();
  if (!nativeApi?.isTokenExist) {
    return Promise.resolve(false);
  }

  return nativeApi.isTokenExist();
}

export function logoutToken(): Promise<boolean> {
  return fetch(`${LOCAL_API_BASE}/logoutToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) return true;
      return Promise.reject(new Error(data.message || "退出授权失败"));
    });
}

export interface UserPlatformSessionsQuery {
  platform?: string;
  profileId?: string;
}

export interface UserPlatformSessionsUpdatePayload {
  platform: string;
  profileId?: string;
  data: Record<string, any>;
}

export function getPlatformSessions(data?: UserPlatformSessionsQuery) {
  return request.post<Record<string, any>>({
    url: "/user/getPlatformSessions",
    data: data || {},
  });
}

export function updatePlatformSessions(data: UserPlatformSessionsUpdatePayload) {
  return request.post<Record<string, any>>({
    url: "/user/updatePlatformSessions",
    data,
  });
}

// 社交媒体登录状态检测
export function checkSocialMediaLogin() {
  return request.get({
    url: "/checkSocialMediaLogin",
  });
}

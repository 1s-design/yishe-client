/**
 * OAuth 2.0 简化流程客户端（Electron）
 *
 * 流程：
 * 1. Electron 打开系统浏览器跳转到 yishe-admin 授权页面
 * 2. 用户授权后，admin 直接生成 token 并回调到本地 HTTP 服务器
 * 3. 本地服务器接收 token，通过 IPC 通知渲染进程完成登录
 */

import { getRemoteApiBase } from '../config/api'
import { saveTokenToClient } from './user'

/** OAuth 客户端配置 */
const OAUTH_CLIENT_ID = 'yishe-client'
const OAUTH_SCOPE = 'user:read user:write'

/** 本地回调服务器端口（与本地 Express 服务器一致） */
const LOCAL_CALLBACK_PORT = 1519

/** 获取授权页面 URL */
function getAuthorizeBaseUrl(): string {
  const apiBase = getRemoteApiBase()
  if (apiBase.includes('localhost')) {
    return 'http://localhost:1521'
  }
  return 'https://admin.1s.design'
}

/** 获取回调地址（指向本地服务器） */
function getRedirectUri(): string {
  return `http://localhost:${LOCAL_CALLBACK_PORT}/oauth/callback`
}

/** 生成授权 URL */
export function buildAuthorizeUrl(): string {
  const baseUrl = getAuthorizeBaseUrl()
  const redirectUri = getRedirectUri()
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPE,
  })
  return `${baseUrl}/#/oauth/authorize?${params.toString()}`
}

/** 打开授权页面 */
export function openAuthorizePage(): void {
  const url = buildAuthorizeUrl()
  console.log('[OAuth] 打开授权页面:', url)
  // Electron 中用 shell.openExternal 打开系统浏览器
  if (window.api?.openExternal) {
    window.api.openExternal(url)
  } else {
    window.open(url, '_blank')
  }
}

/** 一键授权登录（打开浏览器 + 等待本地回调） */
export function oauthLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = buildAuthorizeUrl()
    console.log('[OAuth] 打开授权页面:', url)

    // 打开浏览器
    if (window.api?.openExternal) {
      window.api.openExternal(url)
    } else {
      window.open(url, '_blank')
    }

    // 监听主进程通过 IPC 发送的 token
    const handleToken = (token: string) => {
      cleanup()
      saveTokenToClient(token)
      resolve(token)
    }

    const handleError = (error: string) => {
      cleanup()
      reject(new Error(error))
    }

    const cleanup = () => {
      window.api?.offOAuthToken?.(handleToken)
      window.api?.offOAuthError?.(handleError)
      if (timeoutId) clearTimeout(timeoutId)
    }

    // 注册 IPC 监听
    window.api?.onOAuthToken?.(handleToken)
    window.api?.onOAuthError?.(handleError)

    // 2 分钟超时
    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error('授权超时，请重试'))
    }, 120_000)
  })
}

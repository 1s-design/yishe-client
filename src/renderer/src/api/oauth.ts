/**
 * OAuth 2.0 授权码模式客户端
 *
 * 流程：
 * 1. 打开浏览器跳转到 yishe-admin 授权页面
 * 2. 用户授权后回调携带 code
 * 3. 用 code 换取 token
 *
 * 环境兼容：
 * - 开发环境：localhost:1521
 * - 生产环境：admin.1s.design
 */

import { getRemoteApiBase } from '../config/api'
import { saveTokenToClient } from './user'

/** OAuth 客户端配置 */
const OAUTH_CLIENT_ID = 'yishe-client'
const OAUTH_CLIENT_SECRET = 'yishe-client-secret-2026'
const OAUTH_SCOPE = 'user:read user:write'

/** 获取授权页面 URL（根据环境自动切换） */
function getAuthorizeBaseUrl(): string {
  const apiBase = getRemoteApiBase()
  // API 基础地址转换到 admin 地址
  // 开发环境: http://localhost:1520/api → http://localhost:1521
  // 生产环境: https://api.1s.design/api → https://admin.1s.design
  if (apiBase.includes('localhost')) {
    return 'http://localhost:1521'
  }
  return 'https://admin.1s.design'
}

/** 获取回调地址 */
function getRedirectUri(): string {
  // 使用自定义协议或本地回调
  const apiBase = getRemoteApiBase()
  if (apiBase.includes('localhost')) {
    return 'http://localhost:1521/oauth/callback'
  }
  return 'https://admin.1s.design/oauth/callback'
}

/** 生成授权 URL */
export function buildAuthorizeUrl(state?: string): string {
  const baseUrl = getAuthorizeBaseUrl()
  const redirectUri = getRedirectUri()
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPE,
  })
  if (state) {
    params.set('state', state)
  }
  return `${baseUrl}/oauth/authorize?${params.toString()}`
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

/** 用授权码换取 token */
export async function exchangeToken(code: string): Promise<string> {
  const apiBase = getRemoteApiBase()
  const redirectUri = getRedirectUri()

  const response = await fetch(`${apiBase}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Token 交换失败')
    throw new Error(errorText)
  }

  const data = await response.json()
  const token = data.accessToken || data.access_token
  if (!token) {
    throw new Error('响应中未找到 token')
  }

  // 保存 token
  await saveTokenToClient(token)
  return token
}

/** 一键授权登录（打开浏览器 + 等待回调） */
export async function oauthLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const baseUrl = getAuthorizeBaseUrl()
    const redirectUri = getRedirectUri()

    // 生成 state 防 CSRF
    const state = Math.random().toString(36).substring(2, 15)
    const params = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPE,
      state,
    })

    const authorizeUrl = `${baseUrl}/oauth/authorize?${params.toString()}`
    console.log('[OAuth] 打开授权页面:', authorizeUrl)

    // 打开浏览器
    if (window.api?.openExternal) {
      window.api.openExternal(authorizeUrl)
    } else {
      window.open(authorizeUrl, '_blank')
    }

    // 监听回调消息（主进程通过 IPC 传递）
    const handleCallback = async (event: MessageEvent) => {
      if (event.data?.type === 'oauth-callback') {
        window.removeEventListener('message', handleCallback)
        try {
          const token = await exchangeToken(event.data.code)
          resolve(token)
        } catch (err) {
          reject(err)
        }
      }
    }
    window.addEventListener('message', handleCallback)

    // 10 分钟超时
    setTimeout(() => {
      window.removeEventListener('message', handleCallback)
      reject(new Error('授权超时'))
    }, 600_000)
  })
}

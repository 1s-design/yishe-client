/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-01-XX XX:XX:XX
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-01-XX XX:XX:XX
 * @FilePath: /yishe-electron/src/renderer/src/config/api.ts
 * @Description: API 地址配置
 */

const isDev = process.env.NODE_ENV === 'development'

// 服务模式类型
export type ServiceMode = 'local' | 'remote'

// 存储键名
export const SERVICE_MODE_STORAGE_KEY = 'yishe.serviceMode'
export const CUSTOM_SERVER_URL_STORAGE_KEY = 'yishe.customServerUrl'

// 默认服务器地址
export const DEFAULT_LOCAL_SERVER_URL = 'http://localhost:1520'
export const DEFAULT_REMOTE_SERVER_URL = 'https://api.1s.design'

// 获取自定义远程服务器地址
export function getCustomServerUrl(): string {
  try {
    const stored = localStorage.getItem(CUSTOM_SERVER_URL_STORAGE_KEY)
    if (stored && typeof stored === 'string' && stored.trim()) {
      return stored.trim().replace(/\/+$/, '')
    }
  } catch (error) {
    console.warn('读取自定义服务地址失败:', error)
  }
  return ''
}

// 保存自定义远程服务器地址
export function setCustomServerUrl(url: string): void {
  try {
    const cleaned = String(url || '').trim().replace(/\/+$/, '')
    if (!cleaned) {
      localStorage.removeItem(CUSTOM_SERVER_URL_STORAGE_KEY)
    } else {
      localStorage.setItem(CUSTOM_SERVER_URL_STORAGE_KEY, cleaned)
    }
    window.dispatchEvent(
      new CustomEvent('server-config-changed', {
        detail: { customServerUrl: cleaned, apiBase: getRemoteApiBase(), wsEndpoint: getWsEndpoint() }
      })
    )
  } catch (error) {
    console.error('保存自定义服务地址失败:', error)
  }
}

// 获取当前生效的服务根地址 (origin / host)
export function getServerOrigin(mode?: ServiceMode): string {
  const currentMode = mode || getServiceMode()
  if (currentMode === 'local') {
    return DEFAULT_LOCAL_SERVER_URL
  }

  const customUrl = getCustomServerUrl()
  if (customUrl) {
    return customUrl.replace(/\/api$/, '')
  }

  return DEFAULT_REMOTE_SERVER_URL
}

// 获取服务模式（支持开发与生产环境自定义）
export function getServiceMode(): ServiceMode {
  try {
    const stored = localStorage.getItem(SERVICE_MODE_STORAGE_KEY)
    if (stored === 'local' || stored === 'remote') {
      return stored
    }
  } catch (error) {
    console.warn('读取服务模式配置失败:', error)
  }
  
  return isDev ? 'local' : 'remote'
}

// 保存服务模式
export function setServiceMode(mode: ServiceMode): void {
  try {
    localStorage.setItem(SERVICE_MODE_STORAGE_KEY, mode)
    window.dispatchEvent(new CustomEvent('service-mode-changed', { detail: { mode } }))
  } catch (error) {
    console.error('保存服务模式配置失败:', error)
  }
}

export function getApiBaseByMode(mode: ServiceMode): string {
  const origin = getServerOrigin(mode)
  return `${origin}/api`
}

export function getWsEndpointByMode(mode: ServiceMode): string {
  const origin = getServerOrigin(mode)
  const isHttps = origin.startsWith('https:')
  const wsProtocol = isHttps ? 'wss:' : 'ws:'
  const hostPart = origin.replace(/^https?:\/\//, '')
  return `${wsProtocol}//${hostPart}/ws`
}

// 动态获取生效的API地址
export function getRemoteApiBase(): string {
  return getApiBaseByMode(getServiceMode())
}

// 动态获取生效的WebSocket地址
export function getWsEndpoint(): string {
  return getWsEndpointByMode(getServiceMode())
}

// 本地 Electron 服务地址（健康检查、token 管理等，固定不变）
export const LOCAL_API_BASE = 'http://localhost:1519/api'

// 浏览器自动化服务（yishe-uploader）地址，与客户端配合使用
export const UPLOADER_API_BASE = 'http://127.0.0.1:7010'

// 兼容性导出
export const REMOTE_API_BASE = getRemoteApiBase()
export const WS_ENDPOINT = getWsEndpoint()


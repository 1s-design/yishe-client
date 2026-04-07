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

// 服务模式存储键名
const SERVICE_MODE_STORAGE_KEY = 'yishe.serviceMode'

// 获取服务模式（优先从localStorage读取）
export function getServiceMode(): ServiceMode {
  // 生产环境强制使用remote
  if (!isDev) {
    return 'remote'
  }
  
  // 开发环境从localStorage读取，默认local
  try {
    const stored = localStorage.getItem(SERVICE_MODE_STORAGE_KEY)
    if (stored === 'local' || stored === 'remote') {
      return stored
    }
  } catch (error) {
    console.warn('读取服务模式配置失败:', error)
  }
  
  return 'local' // 默认本地服务
}

// 保存服务模式
export function setServiceMode(mode: ServiceMode): void {
  if (!isDev) {
    console.warn('生产环境不允许切换服务模式')
    return
  }
  
  try {
    localStorage.setItem(SERVICE_MODE_STORAGE_KEY, mode)
    // 触发自定义事件，通知其他模块配置已更改
    window.dispatchEvent(new CustomEvent('service-mode-changed', { detail: { mode } }))
  } catch (error) {
    console.error('保存服务模式配置失败:', error)
  }
}

export function getApiBaseByMode(mode: ServiceMode): string {
  return mode === 'local'
    ? 'http://localhost:1520/api'
    : 'https://1s.design:1520/api'
}

export function getWsEndpointByMode(mode: ServiceMode): string {
  return mode === 'local'
    ? 'http://localhost:1520/ws'
    : 'https://1s.design:1520/ws'
}

// 动态获取远程API地址
export function getRemoteApiBase(): string {
  return getApiBaseByMode(getServiceMode())
}

// 动态获取WebSocket地址
export function getWsEndpoint(): string {
  return getWsEndpointByMode(getServiceMode())
}

// 本地 Electron 服务地址（健康检查、token 管理等，固定不变）
export const LOCAL_API_BASE = 'http://localhost:1519/api'

// 浏览器自动化服务（yishe-uploader）地址，与客户端配合使用
export const UPLOADER_API_BASE = 'http://127.0.0.1:7010'

// 兼容性导出（保持现有代码可用，但会在模块加载时确定值）
// 注意：这些值在模块加载时确定，如果需要动态获取，请使用上面的函数
export const REMOTE_API_BASE = getRemoteApiBase()
export const WS_ENDPOINT = getWsEndpoint()

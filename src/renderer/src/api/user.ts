import request from './request'
import { LOCAL_API_BASE } from '../config/api'
 
export async function saveTokenToClient(token: string): Promise<boolean> {
  try {
    console.log('saveTokenToClient: 开始保存 token', {
      tokenLength: token?.length,
      tokenPreview: token ? `${token.substring(0, 30)}...` : 'null'
    })
    const result = await (window.api as any).saveToken(token)
    console.log('saveTokenToClient: 保存结果', { success: result })
    
    // 立即验证 token 是否已保存
    const savedToken = await getTokenFromClient()
    console.log('saveTokenToClient: 验证保存结果', {
      saved: !!savedToken,
      matches: savedToken === token,
      savedLength: savedToken?.length
    })
    
    return result
  } catch (error) {
    console.error('saveTokenToClient: 保存失败', error)
    throw error
  }
}

export async function getTokenFromClient(): Promise<string | undefined> {
  try {
    const token = await (window.api as any).getToken()
    console.log('getTokenFromClient 返回:', {
      hasToken: !!token,
      tokenType: typeof token,
      tokenLength: token?.length
    })
    return token
  } catch (error) {
    console.error('getTokenFromClient 错误:', error)
    return undefined
  }
}

export function isClientAuthorized() {
  return (window.api as any).isTokenExist()
}

export function logoutToken(): Promise<boolean> {
  return fetch(`${LOCAL_API_BASE}/logoutToken`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) return true
      return Promise.reject(new Error(data.message || '退出授权失败'))
    })
}

// 社交媒体登录状态检测
export function checkSocialMediaLogin() {
  return request.get({
    url: '/checkSocialMediaLogin'
  })
}
 
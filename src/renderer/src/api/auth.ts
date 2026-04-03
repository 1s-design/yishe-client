/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-01-XX XX:XX:XX
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-01-XX XX:XX:XX
 * @FilePath: /yishe-electron/src/renderer/src/api/auth.ts
 * @Description: 登录相关API
 */
import request from './request'
import { saveTokenToClient, getTokenFromClient } from './user'
import { LOCAL_API_BASE } from '../config/api'

export interface LoginParams {
  username: string  // 后端 LocalStrategy 期望的字段名是 username
  password: string
}

export interface LoginResponse {
  data: {
    token: string
  }
  code: number
  status: boolean
}

export interface UserInfo {
  id: string
  account: string
  username?: string
  company?: string
  isAdmin?: boolean
  [key: string]: any
}

// 检查 token 是否有效（通过尝试获取用户信息）
const validateToken = async (): Promise<boolean> => {
  try {
    // 尝试获取用户信息来验证当前 token 是否有效
    await getUserInfo()
    return true
  } catch (error: any) {
    // 如果是 401 错误，说明 token 无效
    if (error?.response?.status === 401) {
      console.log('Token 验证失败：401 Unauthorized')
      return false
    }
    // 其他错误也认为 token 无效
    console.warn('Token 验证失败:', error)
    return false
  }
}

// 登录
export const login = async (params: LoginParams): Promise<LoginResponse> => {
  // 先检查是否已有 token
  const existingToken = await getTokenFromClient()
  
  if (existingToken) {
    console.log('登录前检测到已有 token，先验证有效性:', {
      hasToken: true,
      tokenPreview: existingToken.substring(0, 30) + '...'
    })
    
    // 验证现有 token 是否有效
    const isValid = await validateToken()
    
    if (isValid) {
      console.log('已有 token 有效，直接使用，不调用登录接口')
      // 返回模拟的登录响应，使用现有 token
      // 这样前端可以正常处理登录成功流程
      return {
        data: {
          token: existingToken
        },
        code: 0,
        status: true
      }
    } else {
      console.log('已有 token 无效，需要重新登录')
      // token 无效，清除本地 token，继续执行登录流程
      try {
        await fetch(`${LOCAL_API_BASE}/logoutToken`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        }).catch(() => {})
      } catch (e) {
        // 静默处理
      }
    }
  }
  
  // 如果没有 token 或 token 无效，调用登录接口
  // 后端应该检查：如果用户已登录且有有效 token，返回已有 token，而不是生成新 token
  const response = await request.post<LoginResponse>({
    url: '/auth/login',
    data: {
      username: params.username,  // 使用 username 字段
      password: params.password
    }
  })
  
  console.log('登录响应:', response)
  
  // 从 response.data.token 中提取 token
  const token = response?.data?.token
  if (token) {
    console.log('获取到 token，开始保存:', { 
      tokenLength: token.length, 
      tokenPreview: token.substring(0, 30) + '...',
      isNewToken: existingToken !== token
    })
    await saveTokenToClient(token)
    // 验证 token 是否已成功保存（最多重试 5 次）
    let retries = 0
    while (retries < 5) {
      const savedToken = await getTokenFromClient()
      if (savedToken === token) {
        console.log('Token 已成功保存并验证')
        break
      }
      await new Promise(resolve => setTimeout(resolve, 50))
      retries++
    }
    if (retries >= 5) {
      console.warn('Token 保存验证失败，但继续执行')
    }
  } else {
    console.error('登录响应中未找到 token:', response)
    throw new Error('登录失败：未获取到 token')
  }
  
  return response
}

// 获取用户信息
export const getUserInfo = async (): Promise<UserInfo> => {
  // 在调用前先验证 token 是否存在
  const token = await getTokenFromClient()
  console.log('getUserInfo 调用前检查 token:', {
    hasToken: !!token,
    tokenLength: token?.length,
    tokenPreview: token ? `${token.substring(0, 20)}...` : 'null'
  })
  
  const response = await request.post<{ data: UserInfo } | UserInfo>({
    url: '/user/getUserInfo',
    data: {}
  })
  
  console.log('getUserInfo 响应:', response)
  
  // 处理嵌套结构：如果响应有 data 字段，则从 data 中提取用户信息
  if (response && typeof response === 'object' && 'data' in response && response.data) {
    return response.data as UserInfo
  }
  
  // 否则直接返回响应（兼容非嵌套结构）
  return response as UserInfo
}

// 登出
export const logout = async (): Promise<void> => {
  try {
    // 先获取当前 token，用于后端识别要清除的 token
    const currentToken = await getTokenFromClient()
    
    // 如果后端支持多端登录，应该只清除当前 token
    // 后端应该从 Authorization header 中识别要清除的 token
    if (currentToken) {
      try {
        await request.post({
          url: '/auth/logout'
          // 注意：token 会通过请求拦截器自动添加到 Authorization header
        })
        console.log('后端登出成功（已清除当前 token）')
      } catch (error) {
        // 如果后端登出失败，仍然清除本地 token
        console.warn('后端登出失败，但继续清除本地 token:', error)
      }
    }
  } catch (error) {
    console.error('登出过程出错:', error)
  } finally {
    // 无论后端登出是否成功，都清除本地 token
    const currentToken = await getTokenFromClient()
    if (currentToken) {
      // 通过本地服务清除 token
      try {
        await fetch(`${LOCAL_API_BASE}/logoutToken`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
        console.log('本地 token 已清除')
      } catch (error) {
        console.error('清除本地 token 失败:', error)
      }
    }
  }
}


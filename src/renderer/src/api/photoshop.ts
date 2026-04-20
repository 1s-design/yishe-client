/*
 * Photoshop API 服务
 * 封装调用 yishe-ps API 的方法
 */

import axios from 'axios'

// yishe-ps 服务默认地址
const PS_API_BASE = 'http://localhost:1595'

// 创建 axios 实例
const psApiClient = axios.create({
  baseURL: PS_API_BASE,
  timeout: 300000, // 5分钟超时（PSD 处理可能需要较长时间）
  headers: {
    'Content-Type': 'application/json'
  }
})

// 响应拦截器
psApiClient.interceptors.response.use(
  response => response,
  error => {
    // 统一错误处理
    const errorMessage = error.response?.data?.detail?.message || 
                         error.response?.data?.detail?.error || 
                         error.message || 
                         '请求失败'
    return Promise.reject(new Error(errorMessage))
  }
)

// API 接口类型定义
export interface PhotoshopStatusResponse {
  is_running: boolean
  is_available: boolean
  executable_path?: string
  com_registered: boolean
  connection_test?: {
    success: boolean
    error?: string
    version?: string
  }
  diagnostics: string
  timestamp: string
}

export interface PSDAnalysisResponse {
  file_info: {
    file_path: string
    file_name: string
    file_size: number
    file_size_mb: number
  }
  document_info: {
    width: number
    height: number
    color_mode: string
    depth?: number
    channels?: number
    resolution?: {
      horizontal: number
      vertical: number
      unit: string
    }
  }
  smart_objects: Array<{
    name: string
    path: string
    visible: boolean
    opacity: number
    blend_mode: string
    position: {
      x: number
      y: number
      left: number
      top: number
      right: number
      bottom: number
    }
    size: {
      width: number
      height: number
      aspect_ratio: number
    }
    bounds?: {
      x1: number
      y1: number
      x2: number
      y2: number
    }
    smart_object?: {
      unique_id?: string
      file_type?: string
      kind?: string
      embedded_document?: {
        width?: number
        height?: number
      }
    }
    transform?: any
    has_effects: boolean
    effects?: string[]
    has_mask: boolean
    mask?: any
  }>
  statistics: {
    total_smart_objects: number
    total_layers: number
    has_smart_objects: boolean
  }
  timestamp: string
}

// 自定义选项配置
export interface CustomOptions {
  position: {
    x: number
    y: number
    unit: 'px' | '%'
  }
  size: {
    width: number
    height: number
    unit: 'px' | '%'
    maintain_aspect_ratio?: boolean
    aspect_ratio_base?: 'width' | 'height'
  }
}

// 单个智能对象配置
export interface SmartObjectConfig {
  smart_object_name?: string
  image_path: string
  resize_mode?: 'stretch' | 'contain' | 'cover' | 'custom'
  custom_options?: CustomOptions
  tile_size?: number
}

export interface ColorLayerConfig {
  layer_name?: string
  layer_path?: string
  color: string
}

// 全局默认配置
export interface DefaultOptions {
  resize_mode?: 'stretch' | 'contain' | 'cover' | 'custom'
  custom_options?: CustomOptions
  tile_size?: number
}

export interface ProcessRequest {
  psd_path: string
  // ========== 新格式：支持多个智能对象 ==========
  smart_objects?: SmartObjectConfig[]
  color_layers?: ColorLayerConfig[]
  defaults?: DefaultOptions
  // ========== 旧格式：向后兼容（单个智能对象） ==========
  image_path?: string
  export_dir?: string
  smart_object_name?: string
  output_filename?: string
  tile_size?: number
  resize_mode?: 'stretch' | 'contain' | 'cover' | 'custom'
  custom_options?: CustomOptions
  verbose?: boolean
}

// 导出文件信息
export interface ExportFileInfo {
  export_path: string | null
  export_file: string | null
  export_dir: string
  file_size: number
  file_size_mb: number
  success: boolean
  error?: string
}

export interface ProcessResponse {
  success: boolean
  message: string
  data?: {
    export_files: ExportFileInfo[]
  }
  timestamp: string
}

export interface HealthResponse {
  status: string
  version: string
  timestamp: string
}

// API 方法
export const photoshopApi = {
  /**
   * 健康检查
   */
  async checkHealth(): Promise<HealthResponse> {
    const response = await psApiClient.get<HealthResponse>('/health')
    return response.data
  },

  /**
   * 检测 Photoshop 状态
   * @param testConnection 是否测试实际连接（较慢但更准确）
   */
  async checkPhotoshopStatus(testConnection: boolean = false): Promise<PhotoshopStatusResponse> {
    const response = await psApiClient.get<PhotoshopStatusResponse>('/photoshopStatus', {
      params: { test_connection: testConnection }
    })
    return response.data
  },

  /**
   * 启动 Photoshop
   * @param timeout 超时时间（秒）
   */
  async startPhotoshop(timeout: number = 30): Promise<{ success: boolean; message: string; timestamp: string }> {
    const response = await psApiClient.post('/startPhotoshop', null, {
      params: { timeout }
    })
    return response.data
  },

  /**
   * 关闭 Photoshop
   * @param force 是否强制关闭（kill），默认 false（优雅关闭）
   */
  async stopPhotoshop(force: boolean = false): Promise<{ success: boolean; message: string; timestamp: string }> {
    const response = await psApiClient.post('/stopPhotoshop', null, {
      params: { force }
    })
    return response.data
  },

  /**
   * 重启 Photoshop
   * @param timeout 启动超时时间（秒）
   */
  async restartPhotoshop(timeout: number = 30): Promise<{ success: boolean; message: string; timestamp: string }> {
    const response = await psApiClient.post('/restartPhotoshop', null, {
      params: { timeout }
    })
    return response.data
  },

  /**
   * 分析 PSD 文件
   * @param psdPath PSD 文件路径
   */
  async analyzePsd(psdPath: string): Promise<PSDAnalysisResponse> {
    const response = await psApiClient.post<PSDAnalysisResponse>('/analyzePsd', {
      psd_path: psdPath
    })
    return response.data
  },

  /**
   * 使用 Photoshop 运行时分析 PSD 文件
   * @param psdPath PSD 文件路径
   */
  async analyzePsdRuntime(psdPath: string): Promise<PSDAnalysisResponse> {
    const response = await psApiClient.post<PSDAnalysisResponse>('/analyzePsdRuntime', {
      psd_path: psdPath
    })
    return response.data
  },

  /**
   * 处理 PSD 文件（替换智能对象并导出）
   * @param request 处理请求参数
   */
  async processPsd(request: ProcessRequest): Promise<ProcessResponse> {
    console.log('处理psd参数',request)
    const response = await psApiClient.post<ProcessResponse>('/processPsd', request)
    return response.data
  }
}

export default photoshopApi


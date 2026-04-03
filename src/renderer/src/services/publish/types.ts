/**
 * 发布平台数据处理类型定义
 */

/**
 * 平台类型枚举
 */
export enum PlatformType {
  DOUYIN = 'douyin',
  XIAOHONGSHU = 'xiaohongshu',
  WEIBO = 'weibo',
  KUAISHOU = 'kuaishou',
  XIANYU = 'xianyu',
  SHUMAIYUN = 'shumaiyun',
  AMAZON = 'amazon',
  SHEIN = 'shein'
}

/**
 * 内容类型
 */
export enum ContentType {
  IMAGE = 'image',
  VIDEO = 'video',
  MIXED = 'mixed'
}

/**
 * 原始发布数据（来自admin端）
 */
export interface PublishRawData {
  productTitle?: string
  productName?: string
  title?: string
  
  productDesc?: string
  description?: string
  desc?: string
  content?: string
  
  images?: Array<{
    url: string
    ext: string
    size?: number
    width?: number
    height?: number
  }>
  videos?: Array<{
    url: string
    duration: number
    size?: number
    ext?: string
  }>
  
  // 其他可能的字段
  [key: string]: any
}

/**
 * 平台特定的发布数据（处理后）
 */
export interface PlatformPublishData {
  title: string
  description?: string
  content?: string
  images?: Array<{
    url: string
    ext: string
  }>
  videos?: Array<{
    url: string
    duration?: number
  }>
  // 平台特定字段
  [key: string]: any
}

/**
 * 数据验证结果
 */
export interface ValidationResult {
  valid: boolean
  error?: string
  warnings: string[]
}

/**
 * 转换结果
 */
export interface TransformResult extends ValidationResult {
  data?: PlatformPublishData
}

/**
 * 平台配置规则
 */
export interface PlatformConfig {
  name: string
  
  // 支持的内容类型
  contentTypes: ContentType[]
  
  // 字段限制
  limits: {
    title?: { min?: number; max?: number }
    description?: { min?: number; max?: number }
    images?: { min?: number; max?: number; formats?: string[] }
    videos?: { min?: number; max?: number; maxDuration?: number }
  }
  
  // 必需字段
  requiredFields: string[]
  
  // 字段映射规则：原始字段名 -> 平台字段名
  fieldMapping: Record<string, string>
  
  // 自定义验证规则
  customValidation?: (data: PublishRawData) => ValidationResult
  
  // 自定义转换函数
  customTransform?: (data: PublishRawData) => PlatformPublishData
}

/**
 * 预处理选项
 */
export interface PreprocessOptions {
  // 是否允许超出限制的图片（会自动截取）
  autoTrimImages?: boolean
  
  // 是否允许超出限制的视频
  autoTrimVideos?: boolean
  
  // 是否验证文件可访问性
  validateFileAccess?: boolean
  
  // 自定义数据处理函数
  customPreprocess?: (data: PublishRawData) => Promise<PublishRawData>
}

/**
 * 发布结果
 */
export interface PublishResult {
  success: boolean
  platform: PlatformType
  data?: PlatformPublishData
  warnings?: string[]
  error?: string
  metadata?: {
    processedAt: string
    originalDataSize: number
    processedDataSize: number
  }
}

/**
 * 转换器接口
 */
export interface ITransformer {
  /**
   * 平台类型
   */
  platform: PlatformType
  
  /**
   * 平台配置
   */
  config: PlatformConfig
  
  /**
   * 验证数据
   */
  validate(data: PublishRawData): ValidationResult
  
  /**
   * 转换数据
   */
  transform(data: PublishRawData, options?: PreprocessOptions): Promise<TransformResult>
  
  /**
   * 获取平台特定的预处理逻辑
   */
  getPreprocessor(): (data: PublishRawData) => Promise<PublishRawData>
}

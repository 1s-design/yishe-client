/**
 * 基础转换器抽象类
 * 定义所有平台转换器的通用接口和共享方法
 */

import type {
  PlatformType,
  ContentType,
  PublishRawData,
  PlatformPublishData,
  ValidationResult,
  TransformResult,
  PlatformConfig,
  PreprocessOptions,
  ITransformer
} from './types'

/**
 * 基础转换器
 * 每个平台的转换器都应继承此类
 */
export abstract class BaseTransformer implements ITransformer {
  abstract platform: PlatformType
  abstract config: PlatformConfig

  /**
   * 验证数据
   * 检查必需字段、字段限制等
   */
  validate(data: PublishRawData): ValidationResult {
    const warnings: string[] = []
    
    // 验证必需字段
    const missingFields = this.config.requiredFields.filter(
      field => !this.getFieldValue(data, field)
    )
    
    if (missingFields.length > 0) {
      return {
        valid: false,
        error: `缺少必需字段: ${missingFields.join(', ')}`,
        warnings
      }
    }
    
    // 验证字段限制
    for (const [field, limit] of Object.entries(this.config.limits || {})) {
      const value = this.getFieldValue(data, field)
      
      if (!value) continue
      
      // 文本字段限制
      if (typeof value === 'string') {
        if (limit.max && value.length > limit.max) {
          warnings.push(`${field} 长度超过限制 (最多${limit.max}字符)`)
        }
        if (limit.min && value.length < limit.min) {
          return {
            valid: false,
            error: `${field} 长度不足 (最少${limit.min}字符)`,
            warnings
          }
        }
      }
      
      // 图片限制
      if (field === 'images' && Array.isArray(value)) {
        if (limit.min && value.length < limit.min) {
          return {
            valid: false,
            error: `至少需要 ${limit.min} 张图片`,
            warnings
          }
        }
        if (limit.max && value.length > limit.max) {
          warnings.push(`图片数量超过限制 (最多${limit.max}张)`)
        }
        
        // 验证格式
        if (limit.formats) {
          const invalidImages = value.filter(
            img => !limit.formats.includes(img.ext?.toLowerCase())
          )
          if (invalidImages.length > 0) {
            return {
              valid: false,
              error: `不支持的图片格式，仅支持: ${limit.formats.join(', ')}`,
              warnings
            }
          }
        }
      }
      
      // 视频限制
      if (field === 'videos' && Array.isArray(value)) {
        if (limit.min && value.length < limit.min) {
          return {
            valid: false,
            error: `至少需要 ${limit.min} 个视频`,
            warnings
          }
        }
        if (limit.max && value.length > limit.max) {
          warnings.push(`视频数量超过限制 (最多${limit.max}个)`)
        }
        
        // 验证时长
        if (limit.maxDuration) {
          const tooLongVideos = value.filter(v => v.duration > limit.maxDuration)
          if (tooLongVideos.length > 0) {
            const maxMin = Math.floor(limit.maxDuration / 60)
            return {
              valid: false,
              error: `视频时长超过限制 (最长${maxMin}分钟)`,
              warnings
            }
          }
        }
      }
    }
    
    // 调用平台特定的自定义验证
    if (this.config.customValidation) {
      const customResult = this.config.customValidation(data)
      if (!customResult.valid) {
        return customResult
      }
      warnings.push(...customResult.warnings)
    }
    
    return {
      valid: true,
      warnings
    }
  }

  /**
   * 转换数据
   */
  async transform(
    data: PublishRawData,
    options?: PreprocessOptions
  ): Promise<TransformResult> {
    try {
      // 1. 验证数据
      const validation = this.validate(data)
      if (!validation.valid) {
        return {
          valid: false,
          error: validation.error,
          warnings: validation.warnings
        }
      }
      
      // 2. 预处理数据
      let processedData = data
      const preprocessor = this.getPreprocessor()
      if (preprocessor) {
        processedData = await preprocessor(processedData)
      }
      
      // 3. 自定义预处理（如果提供）
      if (options?.customPreprocess) {
        processedData = await options.customPreprocess(processedData)
      }
      
      // 4. 转换数据
      let transformedData: PlatformPublishData
      if (this.config.customTransform) {
        transformedData = this.config.customTransform(processedData)
      } else {
        transformedData = this.defaultTransform(processedData)
      }
      
      // 5. 应用字段限制
      transformedData = this.applyLimits(transformedData, options)
      
      return {
        valid: true,
        data: transformedData,
        warnings: validation.warnings
      }
    } catch (error) {
      return {
        valid: false,
        error: `转换数据失败: ${error instanceof Error ? error.message : String(error)}`,
        warnings: []
      }
    }
  }

  /**
   * 获取预处理器
   * 子类可以重写此方法提供平台特定的预处理逻辑
   */
  getPreprocessor(): (data: PublishRawData) => Promise<PublishRawData> {
    return async (data) => data
  }

  /**
   * 默认转换逻辑
   * 根据字段映射进行转换
   */
  protected defaultTransform(data: PublishRawData): PlatformPublishData {
    const transformed: PlatformPublishData = {}
    
    // 应用字段映射
    for (const [sourceField, targetField] of Object.entries(this.config.fieldMapping)) {
      const value = this.getFieldValue(data, sourceField)
      if (value !== undefined && value !== null) {
        transformed[targetField] = value
      }
    }
    
    // 保留数组类型的字段
    if (data.images) {
      transformed.images = data.images
    }
    if (data.videos) {
      transformed.videos = data.videos
    }
    
    return transformed
  }

  /**
   * 应用字段限制
   */
  protected applyLimits(
    data: PlatformPublishData,
    options?: PreprocessOptions
  ): PlatformPublishData {
    const result = { ...data }
    
    // 应用图片限制
    if (result.images && this.config.limits.images?.max) {
      const maxImages = this.config.limits.images.max
      if (result.images.length > maxImages) {
        if (options?.autoTrimImages !== false) {
          result.images = result.images.slice(0, maxImages)
        }
      }
    }
    
    // 应用视频限制
    if (result.videos && this.config.limits.videos?.max) {
      const maxVideos = this.config.limits.videos.max
      if (result.videos.length > maxVideos) {
        if (options?.autoTrimVideos !== false) {
          result.videos = result.videos.slice(0, maxVideos)
        }
      }
    }
    
    return result
  }

  /**
   * 获取字段值（支持多个可能的字段名）
   */
  protected getFieldValue(data: PublishRawData, field: string): any {
    // 直接返回
    if (field in data) {
      return data[field]
    }
    
    // 常见的字段别名
    const aliases: Record<string, string[]> = {
      title: ['productTitle', 'productName', 'name'],
      description: ['productDesc', 'desc', 'content'],
      images: ['imageList', 'pictures'],
      videos: ['videoList']
    }
    
    if (field in aliases) {
      for (const alias of aliases[field]) {
        if (alias in data && data[alias]) {
          return data[alias]
        }
      }
    }
    
    return undefined
  }

  /**
   * 工具方法：验证文件是否可访问
   */
  protected async validateFileAccess(urls: string[]): Promise<string[]> {
    const inaccessible: string[] = []
    
    for (const url of urls) {
      try {
        const response = await fetch(url, { method: 'HEAD', mode: 'no-cors' })
        if (!response.ok) {
          inaccessible.push(url)
        }
      } catch (error) {
        inaccessible.push(url)
      }
    }
    
    return inaccessible
  }

  /**
   * 工具方法：获取内容类型
   */
  protected detectContentType(data: PublishRawData): ContentType {
    const hasImages = data.images && data.images.length > 0
    const hasVideos = data.videos && data.videos.length > 0
    
    if (hasImages && hasVideos) return 'mixed' as any
    if (hasVideos) return 'video' as any
    return 'image' as any
  }

  /**
   * 工具方法：验证内容类型是否支持
   */
  protected isSupportedContentType(contentType: ContentType): boolean {
    return this.config.contentTypes.includes(contentType)
  }
}

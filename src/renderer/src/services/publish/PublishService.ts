/**
 * 发布数据处理服务
 * 协调数据验证、转换、预处理的整个流程
 */

import { getTransformer } from './transformers'
import type {
  PlatformType,
  PublishRawData,
  PublishResult,
  PreprocessOptions
} from './types'
import { logger } from '../logger' // 假设有日志服务

/**
 * 发布服务
 */
export class PublishService {
  /**
   * 处理发布请求
   * 完整的数据流程：验证 -> 预处理 -> 转换
   */
  async processPublish(
    platform: PlatformType,
    rawData: PublishRawData,
    options?: PreprocessOptions
  ): Promise<PublishResult> {
    const startTime = Date.now()
    const originalDataSize = JSON.stringify(rawData).length

    try {
      logger.info(`开始处理 ${platform} 平台的发布数据`, {
        dataSize: originalDataSize
      })

      // 1. 获取平台转换器
      const transformer = getTransformer(platform)
      if (!transformer) {
        return {
          success: false,
          platform,
          error: `不支持的平台: ${platform}`
        }
      }

      logger.info(`已获取 ${platform} 转换器`)

      // 2. 验证数据
      const validation = transformer.validate(rawData)
      if (!validation.valid) {
        logger.warn(`${platform} 数据验证失败`, {
          error: validation.error,
          warnings: validation.warnings
        })

        return {
          success: false,
          platform,
          error: validation.error,
          warnings: validation.warnings
        }
      }

      logger.info(`${platform} 数据验证通过`, {
        warnings: validation.warnings
      })

      // 3. 转换数据
      const transformResult = await transformer.transform(rawData, options)
      if (!transformResult.valid) {
        logger.error(`${platform} 数据转换失败`, {
          error: transformResult.error,
          warnings: transformResult.warnings
        })

        return {
          success: false,
          platform,
          error: transformResult.error,
          warnings: transformResult.warnings
        }
      }

      logger.info(`${platform} 数据转换成功`, {
        warnings: transformResult.warnings
      })

      // 4. 计算处理后的数据大小
      const processedDataSize = JSON.stringify(transformResult.data).length

      // 5. 返回成功结果
      const result: PublishResult = {
        success: true,
        platform,
        data: transformResult.data,
        warnings: transformResult.warnings,
        metadata: {
          processedAt: new Date().toISOString(),
          originalDataSize,
          processedDataSize
        }
      }

      const duration = Date.now() - startTime
      logger.info(`${platform} 发布数据处理完成`, {
        duration,
        compression: (
          ((originalDataSize - processedDataSize) / originalDataSize) *
          100
        ).toFixed(2)
      })

      return result
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`${platform} 发布数据处理异常`, {
        error: error instanceof Error ? error.message : String(error),
        duration
      })

      return {
        success: false,
        platform,
        error: `数据处理异常: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * 批量处理多个平台的发布数据
   */
  async processMultiplePlatforms(
    platforms: PlatformType[],
    rawData: PublishRawData,
    options?: PreprocessOptions
  ): Promise<PublishResult[]> {
    const results = await Promise.all(
      platforms.map(platform => this.processPublish(platform, rawData, options))
    )

    logger.info(`批量发布数据处理完成`, {
      platforms: platforms.join(','),
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length
    })

    return results
  }

  /**
   * 获取平台支持情况
   */
  getSupportedPlatforms(): Array<{
    platform: PlatformType
    name: string
    contentTypes: string[]
  }> {
    const supportedPlatforms: PlatformType[] = [
      'douyin',
      'xiaohongshu',
      'weibo',
      'kuaishou',
      'xianyu',
      'shumaiyun',
      'amazon',
      'shein'
    ]

    return supportedPlatforms
      .map(platform => {
        const transformer = getTransformer(platform)
        return {
          platform,
          name: transformer?.config.name || platform,
          contentTypes: transformer?.config.contentTypes || []
        }
      })
      .filter(p => p.name !== platform) // 过滤掉没有找到转换器的
  }

  /**
   * 验证单个字段
   */
  validateField(
    platform: PlatformType,
    fieldName: string,
    value: any
  ): { valid: boolean; error?: string; suggestions?: string[] } {
    const transformer = getTransformer(platform)
    if (!transformer) {
      return {
        valid: false,
        error: `不支持的平台: ${platform}`
      }
    }

    const config = transformer.config
    const fieldLimit = config.limits[fieldName]

    if (!fieldLimit) {
      return { valid: true }
    }

    // 文本字段验证
    if (typeof value === 'string') {
      if (fieldLimit.min && value.length < fieldLimit.min) {
        return {
          valid: false,
          error: `${fieldName} 长度不足 (最少${fieldLimit.min}字符)`
        }
      }
      if (fieldLimit.max && value.length > fieldLimit.max) {
        return {
          valid: false,
          error: `${fieldName} 长度超过限制 (最多${fieldLimit.max}字符)`,
          suggestions: [
            `可删除 ${value.length - fieldLimit.max} 个字符`,
            '建议保留最重要的信息'
          ]
        }
      }
    }

    // 数组字段验证
    if (Array.isArray(value)) {
      if (fieldLimit.min && value.length < fieldLimit.min) {
        return {
          valid: false,
          error: `至少需要 ${fieldLimit.min} 项`
        }
      }
      if (fieldLimit.max && value.length > fieldLimit.max) {
        return {
          valid: false,
          error: `最多只能 ${fieldLimit.max} 项`,
          suggestions: [
            `需要移除 ${value.length - fieldLimit.max} 项`,
            '建议保留质量最好的项'
          ]
        }
      }
    }

    return { valid: true }
  }
}

// 导出单例
export const publishService = new PublishService()

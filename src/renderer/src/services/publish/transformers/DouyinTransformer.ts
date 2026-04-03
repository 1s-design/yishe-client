/**
 * 抖音发布数据转换器
 * 处理抖音特定的数据需求和预处理
 */

import { BaseTransformer } from '../BaseTransformer'
import type {
  PlatformType,
  ContentType,
  PublishRawData,
  PlatformPublishData,
  ValidationResult,
  PlatformConfig
} from '../types'

export class DouyinTransformer extends BaseTransformer {
  platform: PlatformType = 'douyin'

  config: PlatformConfig = {
    name: '抖音',
    contentTypes: ['image', 'video'],
    limits: {
      title: { min: 1, max: 150 },
      description: { max: 2200 },
      images: { min: 1, max: 16, formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
      videos: { min: 1, max: 1, maxDuration: 1800 } // 最长30分钟
    },
    requiredFields: ['title', 'images'],
    fieldMapping: {
      productTitle: 'title',
      productDesc: 'content'
    }
  }

  /**
   * 抖音特定的验证规则
   */
  override validate(data: PublishRawData): ValidationResult {
    const baseValidation = super.validate(data)
    if (!baseValidation.valid) {
      return baseValidation
    }

    const warnings: string[] = [...baseValidation.warnings]

    // 抖音特定验证：检测内容类型
    const contentType = this.detectContentType(data)
    if (!this.isSupportedContentType(contentType)) {
      return {
        valid: false,
        error: `抖音暂不支持 ${contentType} 类型的发布`,
        warnings
      }
    }

    // 检测话题标签
    const description = this.getFieldValue(data, 'description') || ''
    if (!description.includes('#')) {
      warnings.push('建议在描述中添加话题标签 (如 #xxx)，以提高曝光度')
    }

    // 检测文案长度优化建议
    const title = this.getFieldValue(data, 'title') || ''
    if (title.length < 10) {
      warnings.push('标题较短，建议添加更多描述以提高曝光度')
    }

    return {
      valid: true,
      warnings
    }
  }

  /**
   * 抖音预处理器
   * 处理特殊的UI交互或内容格式
   */
  override getPreprocessor() {
    return async (data: PublishRawData) => {
      // 基础预处理
      let processed = { ...data }

      // 1. 内容类型检测，选择合适的URL
      const contentType = this.detectContentType(data)
      processed.contentType = contentType

      // 2. 提取和保留话题标签
      const description = this.getFieldValue(processed, 'description') || ''
      const hashtags = this.extractHashtags(description)
      if (hashtags.length > 0) {
        processed.hashtags = hashtags
      }

      // 3. 提取@提及
      const mentions = this.extractMentions(description)
      if (mentions.length > 0) {
        processed.mentions = mentions
      }

      // 4. 处理图片顺序：抖音默认按上传顺序展示
      if (processed.images && processed.images.length > 0) {
        // 确保所有图片都有有效的URL
        processed.images = processed.images.filter(img => img && img.url)
      }

      // 5. 如果是视频，保留第一张图作为封面
      if (contentType === 'video' && processed.videos && processed.videos.length > 0) {
        if (processed.images && processed.images.length > 0) {
          processed.coverImage = processed.images[0]
        }
      }

      return processed
    }
  }

  /**
   * 自定义转换逻辑
   */
  override protected defaultTransform(data: PublishRawData): PlatformPublishData {
    const contentType = this.detectContentType(data)
    const baseTransform = super.defaultTransform(data)

    // 抖音特定的字段处理
    const result: PlatformPublishData = {
      ...baseTransform
    }

    // 添加抖音特定字段
    result.contentType = contentType

    // 如果有话题标签，添加到结果中
    if ((data as any).hashtags) {
      result.hashtags = (data as any).hashtags
    }

    // 如果是视频内容
    if (contentType === 'video' && (data as any).coverImage) {
      result.coverImage = (data as any).coverImage
    }

    // 抖音最多16张图片
    if (result.images && result.images.length > 16) {
      result.images = result.images.slice(0, 16)
    }

    return result
  }

  /**
   * 工具方法：提取话题标签
   */
  private extractHashtags(text: string): string[] {
    const matches = text.match(/#[\u4e00-\u9fa5a-zA-Z0-9_]+/g) || []
    return Array.from(new Set(matches)) // 去重
  }

  /**
   * 工具方法：提取@提及
   */
  private extractMentions(text: string): string[] {
    const matches = text.match(/@[\u4e00-\u9fa5a-zA-Z0-9_]+/g) || []
    return Array.from(new Set(matches)) // 去重
  }
}

export const douyinTransformer = new DouyinTransformer()

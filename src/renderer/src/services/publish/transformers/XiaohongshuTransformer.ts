/**
 * 小红书发布数据转换器
 * 处理小红书特定的数据需求和预处理
 */

import { BaseTransformer } from '../BaseTransformer'
import {
  PlatformType,
  ContentType
} from '../types'
import type {
  PublishRawData,
  PlatformPublishData,
  ValidationResult,
  PlatformConfig
} from '../types'

export class XiaohongshuTransformer extends BaseTransformer {
  platform: PlatformType = PlatformType.XIAOHONGSHU

  config: PlatformConfig = {
    name: '小红书',
    contentTypes: [ContentType.IMAGE, ContentType.VIDEO],
    limits: {
      title: { min: 1, max: 20 }, // 小红书标题上限通常是20字
      description: { max: 1000 }, // 小红书正文上限通常是1000字
      images: { min: 1, max: 9, formats: ['jpg', 'jpeg', 'png', 'webp'] }, // 笔记最多9张图
      videos: { min: 1, max: 1, maxDuration: 900 } // 普通发布最长15分钟
    },
    requiredFields: ['title'],
    fieldMapping: {
      productTitle: 'title',
      productDesc: 'content'
    }
  }

  /**
   * 小红书特定的验证规则
   */
  override validate(data: PublishRawData): ValidationResult {
    const baseValidation = super.validate(data)
    if (!baseValidation.valid) {
      return baseValidation
    }

    const warnings: string[] = [...baseValidation.warnings]

    // 小红书特定验证：标题长度
    const title = this.getFieldValue(data, 'title') || ''
    if (title.length > 20) {
      warnings.push('小红书标题建议控制在20字以内，超出部分可能会被截断')
    }

    // 检测话题标签
    const content = this.getFieldValue(data, 'description') || this.getFieldValue(data, 'content') || ''
    if (!content.includes('#')) {
      warnings.push('建议在正文中添加话题标签 (如 #xxx)，小红书的话题标签是流量关键')
    }

    return {
      valid: true,
      warnings
    }
  }

  /**
   * 小红书预处理器
   */
  override getPreprocessor() {
    return async (data: PublishRawData) => {
      let processed = { ...data }
      const contentType = this.detectContentType(data)
      processed.contentType = contentType

      // 处理小红书的话题：提取正文中的 #话题 并确保它们存在
      const description = this.getFieldValue(processed, 'description') || ''
      processed.hashtags = this.extractHashtags(description)

      return processed
    }
  }

  /**
   * 自定义转换逻辑
   */
  override protected defaultTransform(data: PublishRawData): PlatformPublishData {
    const baseTransform = super.defaultTransform(data)
    const result: PlatformPublishData = {
      ...baseTransform
    }

    // 限制图片数量为 9
    if (result.images && result.images.length > 9) {
      result.images = result.images.slice(0, 9)
    }

    // 提取话题字段
    if ((data as any).hashtags) {
      result.tags = (data as any).hashtags.map((h: string) => h.replace('#', ''))
    }

    return result
  }

  /**
   * 工具方法：提取话题标签
   */
  private extractHashtags(text: string): string[] {
    const matches = text.match(/#[\u4e00-\u9fa5a-zA-Z0-9_]+/g) || []
    return Array.from(new Set(matches))
  }
}

export const xiaohongshuTransformer = new XiaohongshuTransformer()

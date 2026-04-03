/**
 * 咸鱼发布数据转换器
 * 处理咸鱼特定的数据需求和预处理
 */

import { BaseTransformer } from '../BaseTransformer'
import type {
  PlatformType,
  PublishRawData,
  PlatformPublishData,
  ValidationResult,
  PlatformConfig
} from '../types'

export class XianyuTransformer extends BaseTransformer {
  platform: PlatformType = 'xianyu'

  config: PlatformConfig = {
    name: '咸鱼',
    contentTypes: ['image'],
    limits: {
      title: { min: 5, max: 60 },
      description: { max: 1000 },
      images: { min: 1, max: 9, formats: ['jpg', 'jpeg', 'png', 'webp'] }
    },
    requiredFields: ['title', 'description', 'images'],
    fieldMapping: {
      productTitle: 'title',
      productDesc: 'description'
    }
  }

  /**
   * 咸鱼特定的验证规则
   */
  override validate(data: PublishRawData): ValidationResult {
    const baseValidation = super.validate(data)
    if (!baseValidation.valid) {
      return baseValidation
    }

    const warnings: string[] = [...baseValidation.warnings]

    // 咸鱼不支持视频
    if (data.videos && data.videos.length > 0) {
      return {
        valid: false,
        error: '咸鱼不支持视频发布',
        warnings
      }
    }

    // 检查是否可能是二手物品（根据描述）
    const description = this.getFieldValue(data, 'description') || ''
    if (description.toLowerCase().includes('new')) {
      warnings.push('咸鱼主要用于二手物品交易，确认这是二手物品吗？')
    }

    // 建议添加价格信息
    if (!(data as any).price) {
      warnings.push('建议添加价格信息以提高转化率')
    }

    return {
      valid: true,
      warnings
    }
  }

  /**
   * 咸鱼预处理器
   */
  override getPreprocessor() {
    return async (data: PublishRawData) => {
      let processed = { ...data }

      // 1. 提取价格信息（如果没有，可能从标题中提取）
      if (!(processed as any).price) {
        const priceMatch = this.getFieldValue(processed, 'title')?.match(/¥?(\d+)/)
        if (priceMatch) {
          (processed as any).price = priceMatch[1]
        }
      }

      // 2. 检测物品新旧状态
      const description = this.getFieldValue(processed, 'description') || ''
      if (!((processed as any).condition)) {
        if (description.includes('全新') || description.includes('未使用')) {
          (processed as any).condition = 'new'
        } else if (description.includes('99新') || description.includes('几乎全新')) {
          (processed as any).condition = 'like-new'
        } else {
          (processed as any).condition = 'used'
        }
      }

      // 3. 清理图片：咸鱼最多9张
      if (processed.images && processed.images.length > 9) {
        processed.images = processed.images.slice(0, 9)
      }

      // 4. 确保描述不含禁用词
      processed = this.cleanDescription(processed)

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

    // 添加咸鱼特定字段
    if ((data as any).price) {
      result.price = (data as any).price
    }

    if ((data as any).condition) {
      result.condition = (data as any).condition
    }

    // 咸鱼最多9张图片
    if (result.images && result.images.length > 9) {
      result.images = result.images.slice(0, 9)
    }

    return result
  }

  /**
   * 清理描述：移除可能违规的词汇
   */
  private cleanDescription(data: PublishRawData): PublishRawData {
    const processed = { ...data }
    const description = this.getFieldValue(processed, 'description') || ''

    // 禁用词列表（示例）
    const bannedWords = [
      'fake', 'copy', 'replicas', // 假货
      '钓鱼', '骗', // 诈骗
      '赌博', '色情' // 违规内容
    ]

    let cleanedDesc = description
    for (const word of bannedWords) {
      const regex = new RegExp(word, 'gi')
      cleanedDesc = cleanedDesc.replace(regex, '***')
    }

    if (cleanedDesc !== description) {
      (processed as any).description = cleanedDesc
    }

    return processed
  }
}

export const xianyuTransformer = new XianyuTransformer()

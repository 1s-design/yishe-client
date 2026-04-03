/**
 * 速卖通发布数据转换器
 * 处理速卖通特定的数据需求和预处理
 */

import { BaseTransformer } from '../BaseTransformer'
import type {
  PlatformType,
  PublishRawData,
  PlatformPublishData,
  ValidationResult,
  PlatformConfig
} from '../types'

export class ShumaiyunTransformer extends BaseTransformer {
  platform: PlatformType = 'shumaiyun'

  config: PlatformConfig = {
    name: '速卖通',
    contentTypes: ['image'],
    limits: {
      title: { min: 5, max: 128 },
      description: { max: 3000 },
      images: { min: 3, max: 10, formats: ['jpg', 'jpeg', 'png', 'webp'] }
    },
    requiredFields: ['title', 'description', 'images'],
    fieldMapping: {
      productTitle: 'title',
      productDesc: 'description'
    }
  }

  /**
   * 速卖通特定的验证规则
   */
  override validate(data: PublishRawData): ValidationResult {
    const baseValidation = super.validate(data)
    if (!baseValidation.valid) {
      return baseValidation
    }

    const warnings: string[] = [...baseValidation.warnings]

    // 速卖通不支持视频
    if (data.videos && data.videos.length > 0) {
      return {
        valid: false,
        error: '速卖通不支持视频发布',
        warnings
      }
    }

    // 检查是否有英文标题（速卖通面向国际）
    const title = this.getFieldValue(data, 'title') || ''
    if (!/[a-zA-Z]/.test(title)) {
      warnings.push('建议添加英文标题或描述以提高国际买家搜索到的概率')
    }

    // 检查图片数量
    if (data.images && data.images.length < 3) {
      return {
        valid: false,
        error: '速卖通至少需要3张图片',
        warnings
      }
    }

    return {
      valid: true,
      warnings
    }
  }

  /**
   * 速卖通预处理器
   */
  override getPreprocessor() {
    return async (data: PublishRawData) => {
      let processed = { ...data }

      // 1. 提取或生成SKU
      if (!(processed as any).sku) {
        (processed as any).sku = this.generateSKU()
      }

      // 2. 提取分类信息（从标题或描述）
      if (!(processed as any).category) {
        (processed as any).category = this.extractCategory(
          this.getFieldValue(processed, 'title') || ''
        )
      }

      // 3. 提取价格信息
      if (!(processed as any).price) {
        const priceMatch = this.getFieldValue(processed, 'description')?.match(
          /\$?(\d+\.?\d*)/
        )
        if (priceMatch) {
          (processed as any).price = priceMatch[1]
        }
      }

      // 4. 确保至少3张图片，最多10张
      if (processed.images) {
        if (processed.images.length > 10) {
          processed.images = processed.images.slice(0, 10)
        }
        if (processed.images.length < 3) {
          return processed // 会在验证中被发现
        }
      }

      // 5. 提取关键词
      (processed as any).keywords = this.extractKeywords(
        this.getFieldValue(processed, 'title') || '',
        this.getFieldValue(processed, 'description') || ''
      )

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

    // 添加速卖通特定字段
    if ((data as any).sku) {
      result.sku = (data as any).sku
    }

    if ((data as any).category) {
      result.category = (data as any).category
    }

    if ((data as any).price) {
      result.price = (data as any).price
    }

    if ((data as any).keywords) {
      result.keywords = (data as any).keywords
    }

    // 速卖通最多10张图片
    if (result.images && result.images.length > 10) {
      result.images = result.images.slice(0, 10)
    }

    return result
  }

  /**
   * 生成SKU
   */
  private generateSKU(): string {
    return `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 从标题提取分类信息
   */
  private extractCategory(title: string): string {
    // 简单的分类识别（实际应该更复杂）
    const categories = {
      '手机': 'Electronics',
      '衣服': 'Clothing',
      '鞋': 'Shoes',
      '包': 'Bags',
      '配件': 'Accessories'
    }

    for (const [cn, en] of Object.entries(categories)) {
      if (title.includes(cn)) {
        return en
      }
    }

    return 'General'
  }

  /**
   * 提取关键词
   */
  private extractKeywords(title: string, description: string): string[] {
    const combined = `${title} ${description}`
    // 简单的分词（实际应该用专业的分词库）
    const words = combined
      .split(/[\s,，、；;]+/)
      .filter(w => w.length > 2 && w.length < 50)
      .slice(0, 10)

    return Array.from(new Set(words))
  }
}

export const shumaiyunTransformer = new ShumaiyunTransformer()

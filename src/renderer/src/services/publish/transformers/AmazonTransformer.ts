/**
 * 亚马逊发布数据转换器
 * 处理亚马逊特定的数据需求和预处理
 */

import { BaseTransformer } from '../BaseTransformer'
import type {
  PlatformType,
  PublishRawData,
  PlatformPublishData,
  ValidationResult,
  PlatformConfig
} from '../types'

export class AmazonTransformer extends BaseTransformer {
  platform: PlatformType = 'amazon'

  config: PlatformConfig = {
    name: '亚马逊',
    contentTypes: ['image'],
    limits: {
      title: { min: 5, max: 200 },
      description: { max: 2000 },
      images: { min: 1, max: 8, formats: ['jpg', 'jpeg', 'png', 'webp'] }
    },
    requiredFields: ['title', 'description', 'images'],
    fieldMapping: {
      productTitle: 'title',
      productDesc: 'description'
    }
  }

  /**
   * 亚马逊特定的验证规则
   */
  override validate(data: PublishRawData): ValidationResult {
    const baseValidation = super.validate(data)
    if (!baseValidation.valid) {
      return baseValidation
    }

    const warnings: string[] = [...baseValidation.warnings]

    // 亚马逊不支持视频
    if (data.videos && data.videos.length > 0) {
      return {
        valid: false,
        error: '亚马逊不支持视频发布，仅支持图片',
        warnings
      }
    }

    // 必须有ASIN或者SKU（通常需要先创建变体）
    if (!((data as any).asin || (data as any).sku)) {
      warnings.push('建议提供ASIN或SKU信息')
    }

    // 检查UPC/GTIN
    if (!((data as any).upc || (data as any).gtin)) {
      warnings.push('建议提供UPC/GTIN（条形码）信息')
    }

    // 检查品牌信息
    if (!((data as any).brand)) {
      warnings.push('建议提供品牌信息')
    }

    return {
      valid: true,
      warnings
    }
  }

  /**
   * 亚马逊预处理器
   */
  override getPreprocessor() {
    return async (data: PublishRawData) => {
      let processed = { ...data }

      // 1. 生成或验证ASIN/SKU
      if (!((processed as any).asin) && !((processed as any).sku)) {
        (processed as any).sku = this.generateSKU()
      }

      // 2. 提取或生成UPC/GTIN
      if (!((processed as any).upc || (processed as any).gtin)) {
        (processed as any).gtin = this.generateGTIN()
      }

      // 3. 提取品牌信息
      if (!((processed as any).brand)) {
        (processed as any).brand = this.extractBrand(
          this.getFieldValue(processed, 'title') || ''
        )
      }

      // 4. 分解标题为不同部分（亚马逊需要结构化的标题）
      const titleParts = this.parseTitle(this.getFieldValue(processed, 'title') || '')
      (processed as any).titleParts = titleParts

      // 5. 提取特性/bullet points（亚马逊的关键字段）
      (processed as any).bulletPoints = this.extractBulletPoints(
        this.getFieldValue(processed, 'description') || ''
      )

      // 6. 确保图片不超过8张
      if (processed.images && processed.images.length > 8) {
        processed.images = processed.images.slice(0, 8)
      }

      // 7. 提取价格
      if (!((processed as any).price)) {
        const priceMatch = this.getFieldValue(processed, 'description')?.match(
          /\$?(\d+\.?\d*)/
        )
        if (priceMatch) {
          (processed as any).price = priceMatch[1]
        }
      }

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

    // 添加亚马逊特定字段
    if ((data as any).asin) {
      result.asin = (data as any).asin
    }

    if ((data as any).sku) {
      result.sku = (data as any).sku
    }

    if ((data as any).gtin || (data as any).upc) {
      result.gtin = (data as any).gtin || (data as any).upc
    }

    if ((data as any).brand) {
      result.brand = (data as any).brand
    }

    if ((data as any).price) {
      result.price = (data as any).price
    }

    if ((data as any).bulletPoints) {
      result.bulletPoints = (data as any).bulletPoints
    }

    // 亚马逊最多8张图片
    if (result.images && result.images.length > 8) {
      result.images = result.images.slice(0, 8)
    }

    return result
  }

  /**
   * 生成SKU
   */
  private generateSKU(): string {
    return `ASN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
  }

  /**
   * 生成GTIN
   */
  private generateGTIN(): string {
    // 简单的GTIN-14生成（实际应该有更复杂的校验码算法）
    const randomDigits = Array.from({ length: 13 }, () =>
      Math.floor(Math.random() * 10)
    ).join('')
    return randomDigits
  }

  /**
   * 从标题提取品牌
   */
  private extractBrand(title: string): string {
    // 常见品牌列表（示例）
    const brands = [
      'Apple',
      'Samsung',
      'Sony',
      'LG',
      'Nike',
      'Adidas',
      'Puma',
      'Canon',
      'Nikon'
    ]

    for (const brand of brands) {
      if (title.toLowerCase().includes(brand.toLowerCase())) {
        return brand
      }
    }

    // 如果找不到，尝试提取第一个词
    const firstWord = title.split(/[\s,，]/)[0]
    return firstWord && firstWord.length > 1 ? firstWord : 'Generic'
  }

  /**
   * 解析标题为结构化部分
   * 亚马逊标题通常包含: 品牌 + 产品类型 + 颜色 + 容量等
   */
  private parseTitle(title: string): Record<string, string> {
    const parts = title.split(/[,，|\/]/).map(p => p.trim())

    return {
      main: parts[0] || title,
      secondary: parts[1] || '',
      tertiary: parts[2] || ''
    }
  }

  /**
   * 从描述提取bullet points
   * 亚马逊最多5个bullet points
   */
  private extractBulletPoints(description: string): string[] {
    // 尝试按照常见的分隔符分割
    const separators = [/\n+/, /•/, /\*/]

    let points: string[] = []

    for (const separator of separators) {
      if (separator.test(description)) {
        points = description.split(separator).filter(p => p.trim().length > 0)
        break
      }
    }

    // 如果没有分隔符，就按句子分割
    if (points.length === 0) {
      points = description.split(/[.。！!?？]/).filter(p => p.trim().length > 0)
    }

    // 取前5个，每个限制在200字符以内
    return points.slice(0, 5).map(p => p.trim().substring(0, 200))
  }
}

export const amazonTransformer = new AmazonTransformer()

/**
 * 希音发布数据转换器
 * 处理希音特定的数据需求和预处理
 */

import { BaseTransformer } from '../BaseTransformer'
import type {
  PlatformType,
  PublishRawData,
  PlatformPublishData,
  ValidationResult,
  PlatformConfig
} from '../types'

export class SheinTransformer extends BaseTransformer {
  platform: PlatformType = 'shein'

  config: PlatformConfig = {
    name: '希音',
    contentTypes: ['image'],
    limits: {
      title: { min: 5, max: 120 },
      description: { max: 2000 },
      images: { min: 1, max: 12, formats: ['jpg', 'jpeg', 'png', 'webp'] }
    },
    requiredFields: ['title', 'description', 'images'],
    fieldMapping: {
      productTitle: 'title',
      productDesc: 'description'
    }
  }

  /**
   * 希音特定的验证规则
   */
  override validate(data: PublishRawData): ValidationResult {
    const baseValidation = super.validate(data)
    if (!baseValidation.valid) {
      return baseValidation
    }

    const warnings: string[] = [...baseValidation.warnings]

    // 希音不支持视频
    if (data.videos && data.videos.length > 0) {
      return {
        valid: false,
        error: '希音不支持视频发布',
        warnings
      }
    }

    // 检查是否包含尺码信息（服装重要信息）
    const description = this.getFieldValue(data, 'description') || ''
    const title = this.getFieldValue(data, 'title') || ''
    const combined = `${title}${description}`.toLowerCase()

    if (!this.hasSizeInfo(combined)) {
      warnings.push('服装类商品建议提供尺码信息以降低退货率')
    }

    // 检查是否包含材质信息
    if (!this.hasMaterialInfo(combined)) {
      warnings.push('建议提供材质信息（如：棉、聚酯等）')
    }

    return {
      valid: true,
      warnings
    }
  }

  /**
   * 希音预处理器
   */
  override getPreprocessor() {
    return async (data: PublishRawData) => {
      let processed = { ...data }

      // 1. 提取尺码信息
      (processed as any).sizes = this.extractSizes(
        `${this.getFieldValue(processed, 'title') || ''} ${this.getFieldValue(processed, 'description') || ''}`
      )

      // 2. 提取材质信息
      (processed as any).materials = this.extractMaterials(
        this.getFieldValue(processed, 'description') || ''
      )

      // 3. 提取颜色信息
      (processed as any).colors = this.extractColors(
        `${this.getFieldValue(processed, 'title') || ''} ${this.getFieldValue(processed, 'description') || ''}`
      )

      // 4. 提取风格/分类
      (processed as any).style = this.detectStyle(
        this.getFieldValue(processed, 'title') || ''
      )

      // 5. 提取价格（希音以美元计价）
      if (!((processed as any).price)) {
        const priceMatch = this.getFieldValue(processed, 'description')?.match(
          /\$?(\d+\.?\d*)/
        )
        if (priceMatch) {
          (processed as any).price = priceMatch[1]
        }
      }

      // 6. 生成SKU
      if (!((processed as any).sku)) {
        (processed as any).sku = this.generateSKU()
      }

      // 7. 确保图片不超过12张
      if (processed.images && processed.images.length > 12) {
        processed.images = processed.images.slice(0, 12)
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

    // 添加希音特定字段
    if ((data as any).sizes) {
      result.sizes = (data as any).sizes
    }

    if ((data as any).materials) {
      result.materials = (data as any).materials
    }

    if ((data as any).colors) {
      result.colors = (data as any).colors
    }

    if ((data as any).style) {
      result.style = (data as any).style
    }

    if ((data as any).price) {
      result.price = (data as any).price
    }

    if ((data as any).sku) {
      result.sku = (data as any).sku
    }

    // 希音最多12张图片
    if (result.images && result.images.length > 12) {
      result.images = result.images.slice(0, 12)
    }

    return result
  }

  /**
   * 检查是否包含尺码信息
   */
  private hasSizeInfo(text: string): boolean {
    const sizePatterns = [
      /\b(xs|s|m|l|xl|xxl|xxxl|2xl|3xl)\b/,
      /\b(size\s*[a-z0-9]+|尺码|size)/i,
      /\d+\s*(cm|in|inch|米|米|厘米)/
    ]

    return sizePatterns.some(pattern => pattern.test(text))
  }

  /**
   * 检查是否包含材质信息
   */
  private hasMaterialInfo(text: string): boolean {
    const materials = [
      '棉',
      'cotton',
      '聚酯',
      'polyester',
      '尼龙',
      'nylon',
      '丝绸',
      'silk',
      '羊毛',
      'wool',
      'linen',
      '麻'
    ]

    return materials.some(material => text.includes(material.toLowerCase()))
  }

  /**
   * 提取尺码信息
   */
  private extractSizes(text: string): string[] {
    const sizeMatch = text.match(/(?:size|sizes|尺码)[\s:]*([a-zA-Z0-9\s,，、]+)/i)
    if (sizeMatch) {
      return sizeMatch[1].split(/[,，、]/).map(s => s.trim())
    }

    // 尝试匹配常见尺码
    const commonSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL']
    return commonSizes.filter(size => text.toUpperCase().includes(size))
  }

  /**
   * 提取材质信息
   */
  private extractMaterials(text: string): string[] {
    const materialMap: Record<string, string[]> = {
      cotton: ['棉', 'cotton', '纯棉'],
      polyester: ['聚酯', 'polyester', '涤纶'],
      nylon: ['尼龙', 'nylon', 'nylon'],
      silk: ['丝绸', 'silk', '真丝'],
      wool: ['羊毛', 'wool', 'wool'],
      linen: ['麻', 'linen', '亚麻']
    }

    const materials: string[] = []
    for (const [key, aliases] of Object.entries(materialMap)) {
      if (aliases.some(alias => text.toLowerCase().includes(alias.toLowerCase()))) {
        materials.push(key)
      }
    }

    return materials
  }

  /**
   * 提取颜色信息
   */
  private extractColors(text: string): string[] {
    const colors = [
      '红',
      'red',
      '蓝',
      'blue',
      '黑',
      'black',
      '白',
      'white',
      '黄',
      'yellow',
      '绿',
      'green',
      '粉',
      'pink',
      '紫',
      'purple',
      '灰',
      'gray',
      '棕',
      'brown'
    ]

    return colors.filter(color => text.toLowerCase().includes(color.toLowerCase()))
  }

  /**
   * 检测商品风格
   */
  private detectStyle(title: string): string {
    const stylePatterns: Record<string, RegExp> = {
      casual: /casual|休闲/i,
      formal: /formal|正式|商务/i,
      sporty: /sport|运动/i,
      vintage: /vintage|复古/i,
      bohemian: /bohemian|波西米亚/i,
      minimalist: /minimalist|极简/i
    }

    for (const [style, pattern] of Object.entries(stylePatterns)) {
      if (pattern.test(title)) {
        return style
      }
    }

    return 'casual' // 默认风格
  }

  /**
   * 生成SKU
   */
  private generateSKU(): string {
    return `SHEIN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
  }
}

export const sheinTransformer = new SheinTransformer()

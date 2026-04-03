/**
 * 浏览器自动化服务集成示例
 * 展示如何在现有的自动化流程中集成数据处理框架（支持多平台发布、表单填充等）
 */

import { publishService } from './PublishService'
import type { PlatformType, PublishRawData, PreprocessOptions } from './types'

/**
 * 使用示例 1: 单个平台自动化操作
 */
export async function exampleSinglePlatformPublish() {
  const platform: PlatformType = 'xianyu'
  const rawData: PublishRawData = {
    productTitle: 'iPhone 12 128GB 黑色',
    productDesc: '商品描述：全新未拆封，带原装配件。价格：¥2999',
    images: [
      { url: 'https://example.com/img1.jpg', ext: 'jpg' },
      { url: 'https://example.com/img2.jpg', ext: 'jpg' },
      { url: 'https://example.com/img3.jpg', ext: 'jpg' }
    ]
  }

  const result = await publishService.processPublish(platform, rawData)

  if (result.success) {
    console.log('✅ 数据处理成功')
    console.log('转换后的数据:', result.data)
    console.log('警告信息:', result.warnings)
  } else {
    console.error('❌ 数据处理失败:', result.error)
  }
}

/**
 * 使用示例 2: 多平台自动化操作
 */
export async function exampleMultiplePlatformsPublish() {
  const platforms: PlatformType[] = ['douyin', 'xianyu', 'amazon']
  const rawData: PublishRawData = {
    productTitle: '休闲T恤',
    productDesc: '100%棉质，舒适透气。多种颜色可选。',
    images: Array.from({ length: 5 }, (_, i) => ({
      url: `https://example.com/img${i + 1}.jpg`,
      ext: 'jpg'
    }))
  }

  const results = await publishService.processMultiplePlatforms(
    platforms,
    rawData
  )

  console.log('发布结果汇总:')
  results.forEach(result => {
    if (result.success) {
      console.log(`✅ ${result.platform}: 成功`)
    } else {
      console.log(`❌ ${result.platform}: ${result.error}`)
    }
  })
}

/**
 * 使用示例 3: 带预处理选项的发布
 */
export async function examplePublishWithOptions() {
  const platform: PlatformType = 'douyin'
  const rawData: PublishRawData = {
    productTitle: '【限时优惠】北欧风格台灯 #居家 #装饰',
    productDesc:
      '精心设计的北欧风格台灯\n✨ 采用环保木材\n💡 暖白光源\n📱 支持APP控制\n🎁 赠送灯泡',
    images: Array.from({ length: 20 }, (_, i) => ({
      url: `https://example.com/img${i + 1}.jpg`,
      ext: 'jpg'
    }))
  }

  const options: PreprocessOptions = {
    autoTrimImages: true, // 超出限制时自动截取
    validateFileAccess: true // 验证文件是否可访问
  }

  const result = await publishService.processPublish(platform, rawData, options)

  if (result.success) {
    console.log('✅ 数据处理成功（已应用预处理选项）')
    console.log(`原始图片数: 20, 处理后: ${result.data?.images?.length}`)
  }
}

/**
 * 使用示例 4: 字段验证
 */
export function exampleFieldValidation() {
  const platform: PlatformType = 'amazon'
  const title = '这是一个非常长的标题但超过了亚马逊的限制长度' +
    '这是一个非常长的标题但超过了亚马逊的限制长度' +
    '这是一个非常长的标题但超过了亚马逊的限制长度'

  const validation = publishService.validateField(platform, 'title', title)

  if (!validation.valid) {
    console.error(`❌ ${validation.error}`)
    console.log('建议:', validation.suggestions?.join('; '))
  } else {
    console.log('✅ 字段验证通过')
  }
}

/**
 * 使用示例 5: 获取支持的平台列表
 */
export function exampleGetSupportedPlatforms() {
  const platforms = publishService.getSupportedPlatforms()

  console.log('支持的发布平台:')
  platforms.forEach(p => {
    console.log(`- ${p.name} (${p.platform}): ${p.contentTypes.join(', ')}`)
  })
}

/**
 * 在现有发布 API 中的集成示例
 */
export async function integrateWithExistingAPI(
  platform: PlatformType,
  publishData: PublishRawData
) {
  try {
    // Step 1: 使用新的发布服务处理数据
    const processResult = await publishService.processPublish(
      platform,
      publishData
    )

    if (!processResult.success) {
      // 处理失败，返回错误给用户
      return {
        code: 400,
        message: processResult.error,
        data: null
      }
    }

    // Step 2: 如果有警告，可以记录或返回给用户
    if (processResult.warnings && processResult.warnings.length > 0) {
      console.warn('处理警告:', processResult.warnings)
    }

    // Step 3: 将处理后的数据发送到 uploader
    const uploaderResponse = await fetch(
      `${process.env.UPLOADER_API_BASE}/api/browser/open-platform`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          data: processResult.data,
          metadata: processResult.metadata
        })
      }
    )

    const result = await uploaderResponse.json()

    return {
      code: result.success ? 200 : 500,
      message: result.success
        ? '发布成功'
        : result.message || '发布失败',
      data: result.data
    }
  } catch (error) {
    return {
      code: 500,
      message: `发布异常: ${error instanceof Error ? error.message : String(error)}`,
      data: null
    }
  }
}

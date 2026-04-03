/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-01-XX XX:XX:XX
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-01-XX XX:XX:XX
 * @FilePath: /yishe-electron/src/renderer/src/services/crawlerMaterialUpload.ts
 * @Description: 素材库上传服务 - 在 renderer 端拉图并直接上传到素材库
 */

import request from '../api/request'

export interface CrawlerMaterialUploadParams {
  url: string // 图片远程 URL
  name?: string
  description?: string
  keywords?: string
  suffix?: string
  originUrl?: string
  width?: number
  height?: number
  useAiGenerate?: boolean // 是否使用AI自动生成图片信息
  aiGenerateRawInfo?: string // AI分析时使用的源信息
}

export interface CrawlerMaterialUploadResult {
  ok: boolean
  message?: string
  data?: {
    cosUrl: string
    material: any
  }
}

/**
 * 从 URL 获取图片文件（在浏览器端执行）
 */
async function fetchImageFromUrl(url: string): Promise<{ file: File; extension: string; width?: number; height?: number }> {
  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    headers: {
      Accept: 'image/*'
    }
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.startsWith('image/')) {
    throw new Error('URL指向的不是图片文件')
  }

  const blob = await response.blob()

  // 检查文件大小（限制50MB）
  if (blob.size > 50 * 1024 * 1024) {
    throw new Error('图片文件过大，请选择小于50MB的图片')
  }

  // 从URL或content-type获取文件扩展名
  let extension = 'jpg'
  const urlMatch = url.match(/\.([a-zA-Z0-9]+)(\?.*)?$/i)
  if (urlMatch) {
    extension = urlMatch[1].toLowerCase()
  } else if (contentType) {
    const typeMatch = contentType.match(/image\/([a-zA-Z0-9]+)/i)
    if (typeMatch) {
      extension = typeMatch[1].toLowerCase()
      if (extension === 'jpeg') extension = 'jpg'
    }
  }

  // 获取图片尺寸
  let width: number | undefined
  let height: number | undefined
  try {
    const img = new Image()
    const objectUrl = URL.createObjectURL(blob)
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        width = img.naturalWidth
        height = img.naturalHeight
        URL.revokeObjectURL(objectUrl)
        resolve()
      }
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('无法读取图片尺寸'))
      }
      img.src = objectUrl
    })
  } catch (e) {
    console.warn('获取图片尺寸失败:', e)
  }

  // 创建File对象
  const fileName = `image_${Date.now()}.${extension}`
  const file = new File([blob], fileName, { type: blob.type })

  return { file, extension, width, height }
}

/**
 * 将 File 转换为 base64
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * 上传图片到 COS（通过主进程 IPC）
 */
async function uploadToCosViaMainProcess(fileData: string, fileName: string): Promise<{ url: string; key: string }> {
  // 通过 IPC 调用主进程上传到 COS
  // 主进程会保存临时文件并上传
  const response = await fetch('http://localhost:1519/api/upload-to-cos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileData,
      fileName
    })
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`上传失败: ${response.status} ${errorText}`)
  }

  const result = await response.json()
  if (!result.success || !result.url) {
    throw new Error(result.message || '上传到COS失败')
  }

  return { url: result.url, key: result.key || '' }
}

/**
 * 保存素材到素材库服务端（直接上传到素材库，无需入库流程）
 */
async function saveToServer(params: {
  url: string
  name: string
  description: string
  keywords: string
  suffix: string
  originUrl: string
  width?: number
  height?: number
  useAiGenerate?: boolean
  aiGenerateRawInfo?: string
}): Promise<any> {
  // 映射参数到素材库API格式
  const stickerParams = {
    url: params.url,
    name: params.name,
    description: params.description,
    keywords: params.keywords,
    suffix: params.suffix,
    originUrl: params.originUrl,
    width: params.width,
    height: params.height,
    // 默认设置为公开和非材质（根据业务需求调整）
    isPublic: true,
    isTexture: false,
    // AI生成相关参数
    useAiGenerate: params.useAiGenerate !== false, // 默认为 true，除非明确设置为 false
    aiGenerateRawInfo: params.aiGenerateRawInfo
  }

  return request.post({
    url: '/sticker/create',
    data: stickerParams
  })
}

/**
 * 下载图片并直接上传到素材库（全部在 renderer 端执行，无需入库流程）
 */
export async function downloadImageAndUploadToCrawler(
  params: CrawlerMaterialUploadParams
): Promise<CrawlerMaterialUploadResult> {
  try {
    const { url, name, description, keywords, useAiGenerate, aiGenerateRawInfo } = params

    if (!url || !url.trim()) {
      return {
        ok: false,
        message: 'URL 参数必填'
      }
    }

    // 步骤1：在浏览器端拉取图片
    const { file, extension, width, height } = await fetchImageFromUrl(url)

    // 步骤2：转换为 base64
    const fileData = await fileToBase64(file)

    // 步骤3：上传到 COS（通过主进程接口）
    const cosResult = await uploadToCosViaMainProcess(fileData, file.name)

    // 步骤4：保存到服务端
    const serverResult = await saveToServer({
      url: cosResult.url,
      name: name || `素材_${Date.now()}`,
      description: description || '',
      keywords: keywords || '',
      suffix: extension,
      originUrl: url,
      width,
      height,
      useAiGenerate,
      aiGenerateRawInfo
    })

    if (serverResult.code === 0) {
      return {
        ok: true,
        message: '上传成功',
        data: {
          cosUrl: cosResult.url,
          material: serverResult.data
        }
      }
    } else {
      return {
        ok: false,
        message: serverResult.message || '保存到服务端失败'
      }
    }
  } catch (error: any) {
    console.error('下载并上传失败:', error)
    return {
      ok: false,
      message: error?.message || '上传失败'
    }
  }
}


import { getRemoteApiBase } from './api'
import {
  createUploaderExecutionTask,
  queryUploaderTaskLogsBySource,
  queryUploaderTasksBySource,
  type UploaderTaskSourceId,
  type UploaderTaskSummary,
} from '../api/uploader'
import { getTokenFromClient } from '../api/user'

const IMAGE_LIMITS_DEFAULT = {
  maxSide: 2000,
  maxBytes: 2 * 1024 * 1024,
}

const DEFAULT_IMAGE_PROCESS_RULE = {
  width: 2000,
  height: 2000,
  maxBytes: IMAGE_LIMITS_DEFAULT.maxBytes,
  format: 'jpeg' as const,
  fit: 'cover' as const,
  position: 'centre',
  background: '#ffffff',
}

export type PlatformExecutionBackend = 'uploader_api' | 'server_managed'

type PlatformCapability = {
  id: string
  taskType: string
  label: string
  executionBackend: PlatformExecutionBackend
  imageRule?: Partial<typeof DEFAULT_IMAGE_PROCESS_RULE>
}

const PLATFORM_CAPABILITIES: Record<string, PlatformCapability> = {
  douyin: {
    id: 'douyin',
    taskType: 'publish-product-douyin',
    label: '发布商品-抖音',
    executionBackend: 'uploader_api',
  },
  kuaishou: {
    id: 'kuaishou',
    taskType: 'publish-product-kuaishou',
    label: '发布商品-快手',
    executionBackend: 'uploader_api',
  },
  doudian: {
    id: 'doudian',
    taskType: 'publish-product-doudian',
    label: '发布商品-抖店',
    executionBackend: 'uploader_api',
  },
  kuaishou_shop: {
    id: 'kuaishou_shop',
    taskType: 'publish-product-kuaishou_shop',
    label: '发布商品-快手小店',
    executionBackend: 'uploader_api',
  },
  tiktok: {
    id: 'tiktok',
    taskType: 'publish-product-tiktok',
    label: '发布商品-TikTok',
    executionBackend: 'uploader_api',
  },
  youtube: {
    id: 'youtube',
    taskType: 'publish-product-youtube',
    label: '发布商品-YouTube',
    executionBackend: 'uploader_api',
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    taskType: 'publish-product-xiaohongshu',
    label: '发布商品-小红书',
    executionBackend: 'uploader_api',
  },
  weibo: {
    id: 'weibo',
    taskType: 'publish-product-weibo',
    label: '发布商品-微博',
    executionBackend: 'uploader_api',
  },
  xianyu: {
    id: 'xianyu',
    taskType: 'publish-product-xianyu',
    label: '发布商品-咸鱼',
    executionBackend: 'uploader_api',
  },
}

const PLATFORM_IMAGE_PROCESS_RULES: Record<string, Partial<typeof DEFAULT_IMAGE_PROCESS_RULE>> = {
  default: DEFAULT_IMAGE_PROCESS_RULE,
  doudian: DEFAULT_IMAGE_PROCESS_RULE,
  kuaishou_shop: DEFAULT_IMAGE_PROCESS_RULE,
}

export interface PlatformExecutor {
  platform: string
  execute(row: any, context?: PlatformTaskExecutionContext): Promise<void>
}

export interface PlatformTaskExecutionContext {
  onTaskStatusUpdate?: (payload: {
    status: 'processing' | 'completed' | 'failed'
    error?: string
    row: any
  }) => void | Promise<void>
  onRuntimeUpdate?: (payload: {
    sourceId: UploaderTaskSourceId
    runtime: Record<string, any>
    runtimeTask?: UploaderTaskSummary | null
    runtimeLogs?: Array<Record<string, any>>
    mappedStatus: 'processing' | 'completed' | 'failed'
    task?: UploaderTaskSummary | null
    row: any
  }) => void | Promise<void>
}

const UPLOADER_POLL_INTERVAL_MS = 2000
const UPLOADER_POLL_TIMEOUT_MS = 30 * 60 * 1000

function getPlatformCapability(platform: string): PlatformCapability | null {
  return PLATFORM_CAPABILITIES[platform] || null
}

type ResourceProcessing = {
  localizePrimaryFile?: boolean
  localizeImages?: boolean
  localizeVideos?: boolean
  imagePolicy?: {
    width?: number
    height?: number
    maxSide?: number
    maxBytes?: number
    fit?: 'inside' | 'cover' | 'contain' | 'fill'
    position?: string
    background?: string
    format?: 'jpeg' | 'png' | 'webp'
  }
}

type NormalizedPublishTask = {
  platform: string
  publishData: Record<string, any>
  resourceProcessing: ResourceProcessing
}

export type ProcessedAssetPreview = {
  originalPath: string
  localPath: string
  processedPath: string
  previewDataUrl?: string
  width?: number
  height?: number
  fileSize?: number
  cached?: boolean
}

export type PublishRequestPreviewResult = {
  requestBody: Record<string, any>
  processedAssets: {
    images: ProcessedAssetPreview[]
    thumbnail?: ProcessedAssetPreview | null
    videoSource?: {
      originalPath: string
      localPath: string
    } | null
  }
}

function isHttpUrl(pathLike: any): boolean {
  return typeof pathLike === 'string' && /^https?:\/\//i.test(pathLike)
}

function isImagePath(pathLike: any): boolean {
  if (typeof pathLike !== 'string') return false
  const cleaned = pathLike.split('?')[0].toLowerCase()
  return /\.(jpg|jpeg|png|webp|gif|bmp|tiff|svg)$/.test(cleaned)
}

function normalizeTags(input: any): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean)
  }
  return String(input || '')
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeStringArray(input: any): string[] {
  if (!Array.isArray(input)) return []
  return input.map((item) => String(item).trim()).filter(Boolean)
}

function compactObject<T extends Record<string, any>>(input: T): T {
  const next = { ...input }
  Object.keys(next).forEach((key) => {
    const value = next[key]
    if (value === undefined || value === null) {
      delete next[key]
      return
    }
    if (typeof value === 'string' && !value.trim()) {
      delete next[key]
      return
    }
    if (Array.isArray(value) && value.length === 0) {
      delete next[key]
    }
  })
  return next
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function buildAuthorizedJsonHeaders() {
  const token = await getTokenFromClient()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function buildUploaderTaskSourceId(row: any, platform: string): UploaderTaskSourceId {
  const rowId = String(row?.id || '').trim()
  if (!rowId) {
    return `${platform}:${Date.now()}`
  }
  return rowId
}

function mapUploaderTaskStatus(status?: string): 'processing' | 'completed' | 'failed' {
  if (status === 'success') return 'completed'
  if (status === 'failed') return 'failed'
  return 'processing'
}

function buildRuntimeSnapshot(
  _sourceId: UploaderTaskSourceId,
  runtimeTask?: UploaderTaskSummary | null,
  runtimeLogs?: Array<Record<string, any>> | null,
) {
  const logItems = Array.isArray(runtimeLogs)
    ? runtimeLogs
    : Array.isArray(runtimeTask?.logInfo?.items)
      ? runtimeTask.logInfo.items
      : []

  const normalizedLogs = logItems.map((item) => compactObject({
    time: item?.time || item?.timestamp || undefined,
    level: item?.level || 'info',
    message: item?.message || '',
    data: item?.data,
  }))

  return compactObject({
    source: 'uploader',
    platform: runtimeTask?.platform || undefined,
    logs: normalizedLogs,
  })
}

function normalizeFromFlatPublishData(platform: string, publishData: any, meta: any): NormalizedPublishTask {
  const nestedPlatformOptions = publishData?.platformOptions && typeof publishData.platformOptions === 'object'
    ? publishData.platformOptions
    : {}
  const nestedPublishOptions = publishData?.publishOptions && typeof publishData.publishOptions === 'object'
    ? publishData.publishOptions
    : {}
  const nestedPlatformSettings = publishData?.platformSettings?.[platform] && typeof publishData.platformSettings[platform] === 'object'
    ? publishData.platformSettings[platform]
    : {}

  const nextPublishData = compactObject({
    ...publishData,
    platform: publishData?.platform || meta?.platform || platform,
    tags: normalizeTags(publishData?.tags),
    imageSources: normalizeStringArray(publishData?.imageSources),
    videoSource: typeof publishData?.videoSource === 'string' ? publishData.videoSource.trim() : undefined,
    thumbnail: typeof publishData?.thumbnail === 'string' ? publishData.thumbnail.trim() : undefined,
    productCode: typeof publishData?.productCode === 'string' && publishData.productCode.trim()
      ? publishData.productCode.trim()
      : (
        typeof nestedPlatformOptions?.productCode === 'string' && nestedPlatformOptions.productCode.trim()
          ? nestedPlatformOptions.productCode.trim()
          : (
            typeof nestedPublishOptions?.productCode === 'string' && nestedPublishOptions.productCode.trim()
              ? nestedPublishOptions.productCode.trim()
              : (
                typeof nestedPlatformSettings?.productCode === 'string' && nestedPlatformSettings.productCode.trim()
                  ? nestedPlatformSettings.productCode.trim()
                  : undefined
              )
          )
      ),
  })

  return {
    platform: nextPublishData.platform || platform,
    publishData: nextPublishData,
    resourceProcessing: meta?.resourceProcessing || {},
  }
}

function normalizeFromPostAssets(platform: string, data: any, meta: any): NormalizedPublishTask {
  const post = data?.post && typeof data.post === 'object' ? data.post : {}
  const assets = data?.assets && typeof data.assets === 'object' ? data.assets : {}
  const options = data?.options && typeof data.options === 'object' ? data.options : {}
  const nextPublishData = compactObject({
    platform: data?.platform || meta?.platform || platform,
    title: typeof post?.title === 'string' ? post.title.trim() : undefined,
    description: typeof post?.description === 'string' ? post.description.trim() : undefined,
    content: typeof post?.content === 'string' ? post.content.trim() : undefined,
    tags: normalizeTags(post?.tags),
    imageSources: normalizeStringArray(assets?.images),
    videoSource: Array.isArray(assets?.videos) && assets.videos[0] ? String(assets.videos[0]).trim() : undefined,
    ...options,
  })

  return {
    platform: nextPublishData.platform || platform,
    publishData: nextPublishData,
    resourceProcessing: data?.processing || meta?.resourceProcessing || {},
  }
}

function normalizeLegacyTask(platform: string, row: any): NormalizedPublishTask {
  const data = row?.data || {}
  const metadata = row?.metadata || {}
  const resolvedPlatform = data?.platform || metadata?.platform || platform
  const platformOptions = data?.platformOptions && typeof data.platformOptions === 'object'
    ? data.platformOptions
    : (
      data?.publishOptions && typeof data.publishOptions === 'object'
        ? data.publishOptions
        : (
          data?.platformSettings?.[resolvedPlatform] && typeof data.platformSettings[resolvedPlatform] === 'object'
            ? data.platformSettings[resolvedPlatform]
            : {}
        )
    )
  const imageSources = Array.isArray(data?.imageUrls) && data.imageUrls.length > 0
    ? data.imageUrls
    : (Array.isArray(data?.images) ? data.images : [])
  const videoSource = typeof data?.videoUrl === 'string' && data.videoUrl.trim()
    ? data.videoUrl.trim()
    : (typeof data?.filePathSource === 'string' && data.filePathSource.trim() && !isImagePath(data.filePathSource) ? data.filePathSource.trim() : undefined)

  return {
    platform: resolvedPlatform,
    publishData: compactObject({
      platform: resolvedPlatform,
      title: typeof data?.title === 'string' ? data.title.trim() : undefined,
      description: typeof data?.description === 'string' ? data.description.trim() : undefined,
      content: typeof data?.content === 'string' ? data.content.trim() : undefined,
      tags: normalizeTags(data?.tags),
      imageSources: normalizeStringArray(imageSources),
      videoSource,
      ...platformOptions,
    }),
    resourceProcessing: data?.executionHints?.resourceProcessing || {},
  }
}

function normalizePublishTask(platform: string, row: any): NormalizedPublishTask {
  const data = row?.data || {}
  const meta = data?.meta && typeof data.meta === 'object' ? data.meta : {}
  const publishData = data?.publishData

  if (publishData && typeof publishData === 'object') {
    if (publishData.post || publishData.assets || publishData.options) {
      return normalizeFromPostAssets(platform, publishData, meta)
    }
    return normalizeFromFlatPublishData(platform, publishData, meta)
  }

  return normalizeLegacyTask(platform, row)
}

async function ensureLocalFile(pathLike: string): Promise<string> {
  if (isHttpUrl(pathLike)) {
    const downloadResult = await window.api.downloadFile(pathLike)
    if (!downloadResult?.success || !downloadResult.filePath) {
      throw new Error('资源下载失败：' + (downloadResult?.message || '未知错误'))
    }
    return downloadResult.filePath
  }
  return pathLike
}

function resolveImageProcessRule(platform: string, resourceProcessing: ResourceProcessing) {
  const capabilityRule = getPlatformCapability(platform)?.imageRule || {}
  const platformRule = {
    ...(PLATFORM_IMAGE_PROCESS_RULES.default || DEFAULT_IMAGE_PROCESS_RULE),
    ...(PLATFORM_IMAGE_PROCESS_RULES[platform] || {}),
    ...capabilityRule,
  }
  const imagePolicy = resourceProcessing?.imagePolicy || {}

  const width = Number(imagePolicy?.width) || Number(imagePolicy?.maxSide) || platformRule.width || DEFAULT_IMAGE_PROCESS_RULE.width
  const height = Number(imagePolicy?.height) || Number(imagePolicy?.maxSide) || platformRule.height || DEFAULT_IMAGE_PROCESS_RULE.height
  const maxBytes = Number(imagePolicy?.maxBytes) || platformRule.maxBytes || DEFAULT_IMAGE_PROCESS_RULE.maxBytes

  return {
    width,
    height,
    maxBytes,
    fit: imagePolicy?.fit || platformRule.fit || DEFAULT_IMAGE_PROCESS_RULE.fit,
    position: imagePolicy?.position || platformRule.position || DEFAULT_IMAGE_PROCESS_RULE.position,
    background: imagePolicy?.background || platformRule.background || DEFAULT_IMAGE_PROCESS_RULE.background,
    format: imagePolicy?.format || platformRule.format || DEFAULT_IMAGE_PROCESS_RULE.format,
  }
}

function buildImageCacheKey(platform: string, localPath: string, rule: ReturnType<typeof resolveImageProcessRule>) {
  return JSON.stringify({
    platform,
    localPath,
    width: rule.width,
    height: rule.height,
    maxBytes: rule.maxBytes,
    fit: rule.fit,
    position: rule.position,
    background: rule.background,
    format: rule.format,
  })
}

async function compressImageByPolicy(localPath: string, platform: string, resourceProcessing: ResourceProcessing) {
  const rule = resolveImageProcessRule(platform, resourceProcessing)
  const result = await window.api.processImageWithLimits({
    sourcePath: localPath,
    maxWidth: rule.width,
    maxHeight: rule.height,
    maxBytes: rule.maxBytes,
    fit: rule.fit,
    position: rule.position,
    background: rule.background,
    format: rule.format,
    quality: 85,
    minQuality: 45,
    cacheKey: buildImageCacheKey(platform, localPath, rule),
    cacheFolder: 'publish-assets',
  })

  if (!result?.success || !result.filePath) {
    throw new Error(result?.error || '图片压缩失败')
  }
  if (result.underLimit === false) {
    throw new Error(`图片压缩后仍超过大小限制：${result.fileSize || 0} bytes`)
  }

  return {
    processedPath: result.filePath,
    width: result.width,
    height: result.height,
    fileSize: result.fileSize,
    cached: result.cached,
    rule,
  }
}

async function localizeImage(pathLike: string, platform: string, resourceProcessing: ResourceProcessing) {
  const localPath = await ensureLocalFile(pathLike)
  if (!isImagePath(localPath)) {
    return {
      originalPath: pathLike,
      localPath,
      processedPath: localPath,
      cached: true,
    }
  }
  const processed = await compressImageByPolicy(localPath, platform, resourceProcessing)
  return {
    originalPath: pathLike,
    localPath,
    processedPath: processed.processedPath,
    width: processed.width,
    height: processed.height,
    fileSize: processed.fileSize,
    cached: processed.cached,
  }
}

async function localizeVideo(pathLike: string): Promise<string> {
  return ensureLocalFile(pathLike)
}

async function preparePublishTask(row: any, platform: string): Promise<NormalizedPublishTask & { processedAssets: PublishRequestPreviewResult['processedAssets'] }> {
  const normalized = normalizePublishTask(platform, row)
  const nextPublishData = {
    ...normalized.publishData,
  }
  const resourceProcessing = normalized.resourceProcessing || {}
  const processedAssets: PublishRequestPreviewResult['processedAssets'] = {
    images: [],
    thumbnail: null,
    videoSource: null,
  }

  if (resourceProcessing.localizeImages !== false && Array.isArray(nextPublishData.imageSources) && nextPublishData.imageSources.length > 0) {
    const localizedImages: string[] = []
    for (const imageSource of nextPublishData.imageSources) {
      const processed = await localizeImage(String(imageSource), platform, resourceProcessing)
      localizedImages.push(processed.processedPath)
      processedAssets.images.push(processed)
    }
    nextPublishData.imageSources = localizedImages
  }

  if (resourceProcessing.localizeVideos !== false && typeof nextPublishData.videoSource === 'string' && nextPublishData.videoSource.trim()) {
    const originalPath = nextPublishData.videoSource.trim()
    const localPath = await localizeVideo(originalPath)
    nextPublishData.videoSource = localPath
    processedAssets.videoSource = { originalPath, localPath }
  }

  if (resourceProcessing.localizeImages !== false && typeof nextPublishData.thumbnail === 'string' && nextPublishData.thumbnail.trim()) {
    const processed = await localizeImage(nextPublishData.thumbnail.trim(), platform, resourceProcessing)
    nextPublishData.thumbnail = processed.processedPath
    processedAssets.thumbnail = processed
  }

  return {
    platform: normalized.platform,
    publishData: compactObject({
      ...nextPublishData,
      platform: normalized.platform,
    }),
    resourceProcessing,
    processedAssets,
  }
}

function buildPublishRequestBody(task: NormalizedPublishTask): Record<string, any> {
  const platform = task.platform
  const platformOptions = task.publishData?.platformOptions && typeof task.publishData.platformOptions === 'object'
    ? task.publishData.platformOptions
    : {}
  const publishOptions = task.publishData?.publishOptions && typeof task.publishData.publishOptions === 'object'
    ? task.publishData.publishOptions
    : {}
  const platformSettings = task.publishData?.platformSettings?.[platform] && typeof task.publishData.platformSettings[platform] === 'object'
    ? task.publishData.platformSettings[platform]
    : {}

  return compactObject({
    ...task.publishData,
    productCode: typeof task.publishData?.productCode === 'string' && task.publishData.productCode.trim()
      ? task.publishData.productCode.trim()
      : (
        typeof platformOptions?.productCode === 'string' && platformOptions.productCode.trim()
          ? platformOptions.productCode.trim()
          : (
            typeof publishOptions?.productCode === 'string' && publishOptions.productCode.trim()
              ? publishOptions.productCode.trim()
              : (
                typeof platformSettings?.productCode === 'string' && platformSettings.productCode.trim()
                  ? platformSettings.productCode.trim()
                  : undefined
              )
          )
      ),
    platform: task.platform,
    platforms: [task.platform],
  })
}

export async function buildProcessedPublishPreview(row: any): Promise<PublishRequestPreviewResult> {
  const fallbackPlatform = String(row?.type || '').replace('publish-product-', '')
  const platform = row?.data?.meta?.platform || row?.data?.publishData?.platform || fallbackPlatform
  const task = await preparePublishTask(row, platform)

  const imagesWithPreview = await Promise.all(
    task.processedAssets.images.map(async (image) => {
      try {
        const preview = await window.api.processImageForPreview({
          sourcePath: image.localPath,
          outputPath: image.processedPath,
          cacheFolder: 'publish-assets',
        })

        return {
          ...image,
          previewDataUrl: preview?.previewDataUrl,
          cached: preview?.cached ?? image.cached,
          width: preview?.width ?? image.width,
          height: preview?.height ?? image.height,
          fileSize: preview?.fileSize ?? image.fileSize,
        }
      } catch {
        return image
      }
    }),
  )

  return {
    requestBody: buildPublishRequestBody(task),
    processedAssets: {
      ...task.processedAssets,
      images: imagesWithPreview,
    },
  }
}

abstract class BasePlatformExecutor implements PlatformExecutor {
  abstract platform: string

  async execute(row: any, context?: PlatformTaskExecutionContext): Promise<void> {
    const capability = getPlatformCapability(this.platform)
    if (!capability) {
      throw new Error(`平台未注册：${this.platform}`)
    }

    await this.updateTaskStatus(row, 'processing', undefined, context)

    try {
      await this.dispatchByBackend(row, capability, context)

      await this.updateTaskStatus(row, 'completed', undefined, context)
    } catch (error: any) {
      await this.updateTaskStatus(row, 'failed', error?.message || String(error), context)
      throw error
    }
  }

  protected extractErrorMessage(result: any): string {
    if (Array.isArray(result?.results)) {
      return result.results
        .filter((item: any) => !item?.success)
        .map((item: any) => `${item.platform || '未知平台'}: ${item?.message || item?.error || '未知错误'}`)
        .join('；')
    }
    return result?.message || result?.error || '服务器未返回成功状态'
  }

  protected async updateTaskStatus(
    row: any,
    status: 'processing' | 'completed' | 'failed',
    error?: string,
    context?: PlatformTaskExecutionContext,
  ) {
    const apiBase = getRemoteApiBase()
    const headers = await buildAuthorizedJsonHeaders()
    const response = await fetch(`${apiBase}/queue/message/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: row.type,
        messageId: row.id,
        status,
        error,
      }),
    })

    const result = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(result?.message || `HTTP ${response.status}`)
    }

    if (result?.success === false) {
      throw new Error(result?.message || '任务状态更新失败')
    }

    row.status = status
    row.error = error
    await context?.onTaskStatusUpdate?.({
      status,
      error,
      row,
    })
    console.log(`[${this.platform}] 任务状态已更新: ${status}`)
  }

  protected async updateTaskRuntime(row: any, runtime: Record<string, any>) {
    try {
      const currentData = row?.data && typeof row.data === 'object' ? row.data : {}
      const nextData = {
        ...currentData,
        taskLogs: runtime,
      }

      if ('taskRuntime' in nextData) {
        delete nextData.taskRuntime
      }
      if ('executionRuntime' in nextData) {
        delete nextData.executionRuntime
      }

      const apiBase = getRemoteApiBase()
      const headers = await buildAuthorizedJsonHeaders()
      const response = await fetch(`${apiBase}/queue/message/data`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          queue: row.type,
          messageId: row.id,
          data: nextData,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      row.data = nextData
    } catch (e) {
      console.warn('更新任务运行态失败:', e)
    }
  }

  protected async dispatchByBackend(
    row: any,
    capability: PlatformCapability,
    context?: PlatformTaskExecutionContext,
  ): Promise<void> {
    switch (capability.executionBackend) {
      case 'uploader_api':
        await this.executeViaUploaderApi(row, context)
        return
      case 'server_managed':
        throw new Error(`平台 ${capability.label} 已标记为服务端执行，客户端暂未实现代理逻辑`)
      default:
        throw new Error(`未知执行后端：${String(capability.executionBackend)}`)
    }
  }

  protected async executeViaUploaderApi(row: any, context?: PlatformTaskExecutionContext): Promise<void> {
    const task = await preparePublishTask(row, this.platform)
    const body = buildPublishRequestBody(task)
    const sourceId = buildUploaderTaskSourceId(row, this.platform)

    await this.updateTaskRuntime(row, buildRuntimeSnapshot(sourceId))

    const createResult = await createUploaderExecutionTask({
      kind: 'publish',
      action: 'publish',
      platform: this.platform,
      platforms: [this.platform],
      sourceId,
      metadata: {
        clientTaskType: row?.type,
      },
      ...body,
    })

    if (!createResult.success || !createResult.data) {
      throw new Error(createResult.message || '创建发布端任务失败')
    }

    await this.pollUploaderTaskUntilFinished(row, sourceId, context)
  }

  protected async pollUploaderTaskUntilFinished(
    row: any,
    sourceId: UploaderTaskSourceId,
    context?: PlatformTaskExecutionContext,
  ): Promise<void> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < UPLOADER_POLL_TIMEOUT_MS) {
      const queryResult = await queryUploaderTasksBySource([sourceId])
      if (!queryResult.success) {
        throw new Error(queryResult.message || '查询发布端任务状态失败')
      }

      const logsResult = await queryUploaderTaskLogsBySource([sourceId])
      const logMatch = logsResult.success && Array.isArray(logsResult.data) ? logsResult.data[0] : undefined
      const runtimeLogs = Array.isArray(logMatch?.logs) ? logMatch.logs : []

      const match = Array.isArray(queryResult.data) ? queryResult.data[0] : undefined
      const runtimeTask = match?.task || null

      if (!match?.exists || !runtimeTask) {
        await sleep(UPLOADER_POLL_INTERVAL_MS)
        continue
      }

      await this.updateTaskRuntime(row, buildRuntimeSnapshot(sourceId, runtimeTask, runtimeLogs))

      const mappedStatus = mapUploaderTaskStatus(runtimeTask.status)
      await context?.onRuntimeUpdate?.({
        sourceId,
        runtime: buildRuntimeSnapshot(sourceId, runtimeTask, runtimeLogs),
        runtimeTask,
        runtimeLogs,
        mappedStatus,
        task: runtimeTask,
        row,
      })
      if (mappedStatus === 'processing') {
        await sleep(UPLOADER_POLL_INTERVAL_MS)
        continue
      }

      if (mappedStatus === 'failed') {
        const resultMessage = this.extractErrorMessage(runtimeTask.result)
        const runtimeError = runtimeTask.error?.message || resultMessage || '发布端任务执行失败'
        throw new Error(runtimeError)
      }

      const result = runtimeTask.result
      if (result?.success !== true) {
        throw new Error(`发布失败：${this.extractErrorMessage(result)}`)
      }

      return
    }

    throw new Error('等待发布端任务完成超时')
  }
}

class GenericPlatformExecutor extends BasePlatformExecutor {
  platform: string

  constructor(platform: string) {
    super()
    this.platform = platform
  }
}

class PlatformExecutorFactory {
  private static executors: Map<string, PlatformExecutor> = new Map(
    Object.keys(PLATFORM_CAPABILITIES).map((platform) => [platform, new GenericPlatformExecutor(platform)]),
  )

  static getExecutor(platform: string): PlatformExecutor | null {
    return this.executors.get(platform) || null
  }

  static registerExecutor(platform: string, executor: PlatformExecutor): void {
    this.executors.set(platform, executor)
  }
}

export function getPlatformExecutor(platform: string): PlatformExecutor | null {
  return PlatformExecutorFactory.getExecutor(platform)
}

export async function executePlatformTask(
  platform: string,
  row: any,
  context?: PlatformTaskExecutionContext,
): Promise<void> {
  const executor = getPlatformExecutor(platform)
  if (!executor) {
    throw new Error(`不支持的平台：${platform}`)
  }
  await executor.execute(row, context)
}

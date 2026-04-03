/**
 * 爬虫自动采集服务
 * 调用 yishe-uploader 的爬虫接口，下载图片并上传到素材库
 */

import axios from 'axios'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'https'
import { generateCosKey, uploadFileToCos } from './cos'

type CrawlerSite = 'sora' | 'pinterest'

// 爬虫采集配置
interface CrawlerCollectionConfig {
  enabled: boolean
  site: CrawlerSite
  maxImages: number
  interval: number // 定时间隔（毫秒）
  category?: string // 素材分类
  isPublic?: boolean // 是否公开
}

// 爬虫结果
interface CrawlerImage {
  url: string
  alt?: string
  title?: string
  description?: string
  index?: number
}

type CrawlerProgressStage = 'idle' | 'crawling' | 'downloading' | 'uploading' | 'saving' | 'completed' | 'failed'

interface CrawlerProgressLog {
  time: string
  stage: CrawlerProgressStage
  success: boolean
  message: string
  image?: string
  index?: number
  total?: number
}

interface CrawlerProgressState {
  site: CrawlerSite
  running: boolean
  stage: CrawlerProgressStage
  startedAt: string | null
  finishedAt: string | null
  total: number
  current: number
  successCount: number
  failCount: number
  lastError?: string
  logs: CrawlerProgressLog[]
}

class CrawlerCollectorService {
  private timers: Partial<Record<CrawlerSite, NodeJS.Timeout>> = {}
  private configs: Record<CrawlerSite, CrawlerCollectionConfig> = {
    sora: {
      enabled: false,
      site: 'sora',
      maxImages: 20,
      interval: 3600000, // 默认1小时
      category: 'crawler',
      isPublic: false,
    },
    pinterest: {
      enabled: false,
      site: 'pinterest',
      maxImages: 20,
      interval: 3600000, // 默认1小时
      category: 'crawler',
      isPublic: false,
    },
  }

  private progress: Record<CrawlerSite, CrawlerProgressState> = {
    sora: {
      site: 'sora',
      running: false,
      stage: 'idle',
      startedAt: null,
      finishedAt: null,
      total: 0,
      current: 0,
      successCount: 0,
      failCount: 0,
      logs: [],
    },
    pinterest: {
      site: 'pinterest',
      running: false,
      stage: 'idle',
      startedAt: null,
      finishedAt: null,
      total: 0,
      current: 0,
      successCount: 0,
      failCount: 0,
      logs: [],
    },
  }

  // 爬虫服务地址
  private readonly CRAWLER_API_BASE = process.env.CRAWLER_API_BASE || 'http://localhost:7010'
  // 后端服务地址
  private readonly BACKEND_API_BASE = process.env.BACKEND_API_BASE || 'http://localhost:1519'

  /**
   * 启动定时采集
   */
  async startSchedule(site: CrawlerSite, config?: Partial<CrawlerCollectionConfig>): Promise<{
    success: boolean
    message: string
    config: CrawlerCollectionConfig
  }> {
    if (!site) {
      throw new Error('site 不能为空')
    }

    if (config) {
      this.configs[site] = { ...this.configs[site], ...config, site }
    }

    this.stopSchedule(site)

    this.configs[site].enabled = true
    const interval = this.configs[site].interval

    this.timers[site] = setInterval(async () => {
      try {
        console.log(`🤖 [CrawlerCollector] 定时任务触发: ${site}`)
        await this.collectImages(site)
      } catch (error: any) {
        console.error(`❌ [CrawlerCollector] 定时任务失败: ${error.message}`)
      }
    }, interval)

    console.log(`✅ [CrawlerCollector] 定时器已启动: ${site}, 间隔 ${interval / 1000}s`)

    return {
      success: true,
      message: '定时器已启动',
      config: this.configs[site],
    }
  }

  /**
   * 停止定时采集
   */
  stopSchedule(site: CrawlerSite): { success: boolean; message: string } {
    const timer = this.timers[site]
    if (timer) {
      clearInterval(timer)
      this.timers[site] = undefined
      this.configs[site].enabled = false
      console.log(`🛑 [CrawlerCollector] 定时器已停止: ${site}`)
      return { success: true, message: '定时器已停止' }
    }

    return { success: false, message: '没有运行中的定时器' }
  }

  /**
   * 获取定时器状态
   */
  getStatus(site?: CrawlerSite):
    | { enabled: boolean; config: CrawlerCollectionConfig; isRunning: boolean }
    | Record<CrawlerSite, { enabled: boolean; config: CrawlerCollectionConfig; isRunning: boolean }> {
    const buildStatus = (target: CrawlerSite) => ({
      enabled: this.configs[target].enabled,
      config: this.configs[target],
      isRunning: !!this.timers[target],
    })

    if (site) {
      return buildStatus(site)
    }

    return {
      sora: buildStatus('sora'),
      pinterest: buildStatus('pinterest'),
    }
  }

  getProgress(site?: CrawlerSite): CrawlerProgressState | Record<CrawlerSite, CrawlerProgressState> {
    const clone = (target: CrawlerSite): CrawlerProgressState => ({
      ...this.progress[target],
      logs: [...this.progress[target].logs],
    })

    if (site) {
      return clone(site)
    }

    return {
      sora: clone('sora'),
      pinterest: clone('pinterest'),
    }
  }

  /**
   * 更新配置
   */
  updateConfig(site: CrawlerSite, config: Partial<CrawlerCollectionConfig>): void {
    if (!site) {
      throw new Error('site 不能为空')
    }
    this.configs[site] = { ...this.configs[site], ...config, site }
  }

  /**
   * 手动触发一次采集
   */
  async manualCollect(
    site: CrawlerSite,
    maxImages?: number
  ): Promise<{
    success: boolean
    message: string
    collected: number
    failed: number
    results: any[]
  }> {
    if (!site) {
      throw new Error('site 不能为空')
    }

    const finalMaxImages = maxImages ?? this.configs[site].maxImages
    console.log(`🎯 [CrawlerCollector] 手动触发采集: ${site}, maxImages=${finalMaxImages}`)
    return await this.collectImages(site, { maxImages: finalMaxImages })
  }

  /**
   * 核心方法：爬取图片并上传到素材库
   */
  private async collectImages(
    site: CrawlerSite,
    override?: Partial<CrawlerCollectionConfig>
  ): Promise<{
    success: boolean
    message: string
    collected: number
    failed: number
    results: any[]
  }> {
    const config = { ...this.configs[site], ...override, site }
    const startTime = Date.now()
    const results: any[] = []
    let collected = 0
    let failed = 0

    this.resetProgress(site)
    this.progress[site].running = true
    this.progress[site].stage = 'crawling'
    this.progress[site].startedAt = new Date().toISOString()
    this.pushLog(site, {
      stage: 'crawling',
      success: true,
      message: `开始调用爬虫接口，站点=${site}`,
    })

    try {
      // 1. 调用爬虫接口
      console.log(`📡 [CrawlerCollector] 调用爬虫接口: ${config.site}`)
      const crawlerResponse = await axios.post(
        `${this.CRAWLER_API_BASE}/api/crawler/run`,
        {
          site: config.site,
          params: {
            maxImages: config.maxImages,
          },
        },
        { timeout: 120000 } // 2分钟超时
      )

      if (!crawlerResponse.data?.success || !crawlerResponse.data?.data?.images) {
        this.pushLog(site, {
          stage: 'crawling',
          success: false,
          message: '爬虫接口返回数据异常',
        })
        throw new Error('爬虫接口返回数据异常')
      }

      const images: CrawlerImage[] = crawlerResponse.data.data.images
      this.progress[site].total = images.length
      this.pushLog(site, {
        stage: 'crawling',
        success: true,
        message: `爬虫数据返回成功，共 ${images.length} 张`,
        total: images.length,
      })
      console.log(`📸 [CrawlerCollector] 爬取到 ${images.length} 张图片`)

      // 2. 处理每张图片
      for (let i = 0; i < images.length; i++) {
        const image = images[i]
        this.progress[site].current = i + 1

        try {
          console.log(`🔄 [CrawlerCollector] 处理图片 ${i + 1}/${images.length}: ${image.url.substring(0, 80)}...`)

          // 2.1 下载图片
          this.progress[site].stage = 'downloading'
          this.pushLog(site, {
            stage: 'downloading',
            success: true,
            message: '开始下载图片到本地临时目录',
            image: image.url,
            index: i + 1,
            total: images.length,
          })
          const imageBuffer = await this.downloadImage(image.url)
          this.pushLog(site, {
            stage: 'downloading',
            success: true,
            message: '资源图片下载到本地成功',
            image: image.url,
            index: i + 1,
            total: images.length,
          })

          // 2.2 提取文件扩展名
          const ext = this.extractExtension(image.url)
          const filename = `${config.site}_${Date.now()}_${i}${ext}`

          // 2.3 上传到 COS
          this.progress[site].stage = 'uploading'
          this.pushLog(site, {
            stage: 'uploading',
            success: true,
            message: `开始上传图片到云端: ${filename}`,
            image: image.url,
            index: i + 1,
            total: images.length,
          })
          console.log(`☁️  [CrawlerCollector] 上传到 COS: ${filename}`)
          
          // 保存临时文件
          const tempDir = path.join(app.getPath('temp'), 'yishe-crawler')
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true })
          }
          const tempFilePath = path.join(tempDir, filename)
          fs.writeFileSync(tempFilePath, imageBuffer)

          // 上传到 COS
          const cosKey = await generateCosKey({
            category: config.category || 'crawler',
            filename,
          })
          const cosResult = await uploadFileToCos(tempFilePath, cosKey)

          // 删除临时文件
          fs.unlinkSync(tempFilePath)

          if (!cosResult.ok) {
            this.pushLog(site, {
              stage: 'uploading',
              success: false,
              message: '上传图片到云端失败',
              image: image.url,
              index: i + 1,
              total: images.length,
            })
            throw new Error('msg' in cosResult ? cosResult.msg : '上传到 COS 失败')
          }

          this.pushLog(site, {
            stage: 'uploading',
            success: true,
            message: '上传图片到云端成功',
            image: image.url,
            index: i + 1,
            total: images.length,
          })

          // 2.4 保存到素材库
          this.progress[site].stage = 'saving'
          this.pushLog(site, {
            stage: 'saving',
            success: true,
            message: '开始保存素材记录',
            image: image.url,
            index: i + 1,
            total: images.length,
          })
          console.log(`💾 [CrawlerCollector] 保存到素材库`)
          const materialResult = await this.saveMaterial({
            url: cosResult.url,
            name: image.alt || image.title || `${config.site} 图片`,
            description: image.description || image.alt || '',
            keywords: `${config.site},爬虫采集,${image.title || ''}`,
            suffix: ext.replace('.', ''),
            source: config.site,
            originUrl: image.url,
            meta: {
              source: config.site,
              originalUrl: image.url,
              crawledAt: new Date().toISOString(),
              index: image.index,
            },
          })

          collected++
          this.progress[site].successCount = collected
          results.push({
            success: true,
            image: image.url,
            materialId: materialResult?.id,
            cosUrl: cosResult.url,
          })

          this.pushLog(site, {
            stage: 'saving',
            success: true,
            message: '素材保存成功',
            image: image.url,
            index: i + 1,
            total: images.length,
          })

          console.log(`✅ [CrawlerCollector] 图片处理成功 ${i + 1}/${images.length}`)
        } catch (error: any) {
          failed++
          this.progress[site].failCount = failed
          this.progress[site].lastError = error.message
          console.error(`❌ [CrawlerCollector] 图片处理失败 ${i + 1}/${images.length}: ${error.message}`)
          this.pushLog(site, {
            stage: this.progress[site].stage,
            success: false,
            message: error.message,
            image: image.url,
            index: i + 1,
            total: images.length,
          })
          results.push({
            success: false,
            image: image.url,
            error: error.message,
          })
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      const message = `采集完成: 成功 ${collected} 张, 失败 ${failed} 张, 耗时 ${duration}s`
      console.log(`🎉 [CrawlerCollector] ${message}`)

      this.progress[site].running = false
      this.progress[site].stage = 'completed'
      this.progress[site].finishedAt = new Date().toISOString()
      this.pushLog(site, {
        stage: 'completed',
        success: true,
        message,
      })

      return {
        success: true,
        message,
        collected,
        failed,
        results,
      }
    } catch (error: any) {
      console.error(`❌ [CrawlerCollector] 采集失败: ${error.message}`)
      this.progress[site].running = false
      this.progress[site].stage = 'failed'
      this.progress[site].finishedAt = new Date().toISOString()
      this.progress[site].lastError = error.message
      this.pushLog(site, {
        stage: 'failed',
        success: false,
        message: `采集失败: ${error.message}`,
      })
      throw new Error(`采集失败: ${error.message}`)
    }
  }

  private resetProgress(site: CrawlerSite) {
    this.progress[site] = {
      site,
      running: false,
      stage: 'idle',
      startedAt: null,
      finishedAt: null,
      total: 0,
      current: 0,
      successCount: 0,
      failCount: 0,
      lastError: undefined,
      logs: [],
    }
  }

  private pushLog(site: CrawlerSite, log: Omit<CrawlerProgressLog, 'time'>) {
    const item: CrawlerProgressLog = {
      ...log,
      time: new Date().toISOString(),
    }
    this.progress[site].logs.push(item)
    if (this.progress[site].logs.length > 300) {
      this.progress[site].logs = this.progress[site].logs.slice(-300)
    }
  }

  /**
   * 下载图片到内存
   */
  private async downloadImage(url: string): Promise<Buffer> {
    const maxRetries = 3
    const httpsAgent = new https.Agent({
      keepAlive: true,
      rejectUnauthorized: false,
    })

    let lastErrorMessage = '未知错误'

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 45000,
          maxRedirects: 5,
          proxy: false,
          httpsAgent,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://www.pinterest.com/',
          },
          validateStatus: (status) => status >= 200 && status < 400,
        })

        return Buffer.from(response.data)
      } catch (error: any) {
        const code = error?.code ? `[${error.code}]` : ''
        const status = error?.response?.status ? `[HTTP ${error.response.status}]` : ''
        const host = (() => {
          try {
            return new URL(url).host
          } catch {
            return 'unknown-host'
          }
        })()

        lastErrorMessage = `${code}${status} ${error?.message || '下载失败'} (host=${host}, attempt=${attempt}/${maxRetries})`
        console.warn(`⚠️ [CrawlerCollector] 图片下载重试: ${lastErrorMessage}`)

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, attempt * 1200))
        }
      }
    }

    throw new Error(`图片下载失败: ${lastErrorMessage}`)
  }

  /**
   * 提取文件扩展名
   */
  private extractExtension(url: string): string {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      let ext = path.extname(pathname).toLowerCase()
      if (!ext || !['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        ext = '.jpg' // 默认扩展名
      }
      return ext
    } catch {
      return '.jpg'
    }
  }

  /**
   * 保存素材到后端
   */
  private async saveMaterial(data: {
    url: string
    name: string
    description?: string
    keywords?: string
    suffix: string
    source?: string
    originUrl?: string
    meta?: any
  }): Promise<any> {
    try {
      const response = await axios.post(
        `${this.BACKEND_API_BASE}/api/crawlermaterial`,
        data,
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )

      if (response.data?.code === 200 || response.data?.status) {
        return response.data.data
      } else {
        throw new Error(response.data?.message || '保存失败')
      }
    } catch (error: any) {
      console.error(`保存素材失败: ${error.message}`)
      throw error
    }
  }
}

// 导出单例
export const crawlerCollectorService = new CrawlerCollectorService()

/**
 * 媒体采集路由（客户端执行）
 * 所有重活（搜索/下载/上传）都在客户端完成，服务端不参与
 */
import type { Request, Response } from 'express'
import { listSources, searchMedia, importMedia } from './mediaCollector'
import type { MediaSource } from './mediaCollector'

type TokenGetter = () => string | null

export function registerMediaCollectRoutes(app: any, getToken: TokenGetter) {

  /**
   * GET /api/media-collect/providers
   * 返回支持的采集源列表
   */
  app.get('/api/media-collect/providers', (_req: Request, res: Response) => {
    try {
      const sources = listSources()
      res.json({ success: true, data: sources })
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || '获取采集源失败' })
    }
  })

  /**
   * GET /api/media-collect/search
   * 搜索媒体资源（客户端直接调外部 API）
   */
  app.get('/api/media-collect/search', async (req: Request, res: Response) => {
    try {
      const { source, query, mediaType, page, pageSize } = req.query

      if (!source || !query) {
        res.status(400).json({ success: false, message: '缺少 source 或 query 参数' })
        return
      }

      const result = await searchMedia({
        source: source as MediaSource,
        query: String(query),
        mediaType: mediaType as any,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      })

      res.json({ success: true, data: result })
    } catch (error: any) {
      console.error('[MediaCollect] 搜索失败:', error)
      res.status(500).json({ success: false, message: error?.message || '搜索失败' })
    }
  })

  /**
   * POST /api/media-collect/import
   * 导入媒体资源（客户端下载 → COS → 写 file-resource）
   */
  app.post('/api/media-collect/import', async (req: Request, res: Response) => {
    try {
      const { items } = req.body || {}

      if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, message: '缺少 items 参数' })
        return
      }

      // 执行导入（下载 → COS → 写记录）
      const result = await importMedia(items)

      res.json({ success: true, data: result })
    } catch (error: any) {
      console.error('[MediaCollect] 导入失败:', error)
      res.status(500).json({ success: false, message: error?.message || '导入失败' })
    }
  })
}

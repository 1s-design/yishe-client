/**
 * 媒体采集路由（客户端执行）
 * 所有重活（搜索/下载/上传）都在客户端完成，服务端不参与。
 * 实现已收敛到「服务端源定义 + 采集引擎」——本路由仅做桥接转发。
 */
import type { Request, Response } from 'express'
import { sourceBridgeCall } from './capabilities/source-bridge'
import { getCurrentAccessToken, getBackendApiBase } from './cos'

type TokenGetter = () => string | null

export function registerMediaCollectRoutes(app: any, getToken: TokenGetter) {

  /**
   * GET /api/media-collect/providers
   * 返回支持的采集源列表（来自服务端源清单）
   */
  app.get('/api/media-collect/providers', async (_req: Request, res: Response) => {
    try {
      const base = (await getBackendApiBase()).replace(/\/+$/, '')
      const prefix = /\/api$/i.test(base) ? base : `${base}/api`
      const token = await getCurrentAccessToken()
      const resp = await fetch(`${prefix}/collect/sources?module=media-collect`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const body = await resp.json()
      const list = (body && (body as any).data) || body
      const sources = (Array.isArray(list) ? list : []).map((m: any) => ({
        key: m.id,
        name: m.name,
        supportedTypes: ['image', 'video', 'audio'],
      }))
      res.json({ success: true, data: sources })
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || '获取采集源失败' })
    }
  })

  /**
   * GET /api/media-collect/search
   * 搜索媒体资源（采集引擎执行，source=源 id）
   */
  app.get('/api/media-collect/search', async (req: Request, res: Response) => {
    try {
      const { source, query, mediaType, page, pageSize } = req.query

      if (!source || !query) {
        res.status(400).json({ success: false, message: '缺少 source 或 query 参数' })
        return
      }

      const bridged = await sourceBridgeCall('media-collect', 'search', {
        source: String(source),
        query: String(query),
        mediaType: mediaType ? String(mediaType) : undefined,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      })
      if (!bridged.handled || !bridged.result?.success) {
        res.status(500).json({
          success: false,
          message: bridged.result?.error || '搜索失败（采集源暂不可用）',
        })
        return
      }
      res.json({ success: true, data: bridged.result.data })
    } catch (error: any) {
      console.error('[MediaCollect] 搜索失败:', error)
      res.status(500).json({ success: false, message: error?.message || '搜索失败' })
    }
  })

  /**
   * POST /api/media-collect/import
   * 导入媒体资源（采集引擎 download：下载 → COS → 素材库）
   */
  app.post('/api/media-collect/import', async (req: Request, res: Response) => {
    try {
      const { items } = req.body || {}

      if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, message: '缺少 items 参数' })
        return
      }

      // 逐条走引擎 download（source 取条目上的 source 字段，缺省 media-collect 聚合按 item.source 路由）
      const results: any[] = []
      for (const item of items) {
        const source = String(item?.source || 'pexels')
        const bridged = await sourceBridgeCall(source.replace(/-/g, '_'), 'download', { item })
        results.push(
          bridged.handled && bridged.result?.success
            ? { success: true, data: bridged.result.data }
            : { success: false, error: bridged.result?.error || '导入失败' },
        )
      }
      res.json({
        success: true,
        data: {
          total: items.length,
          successCount: results.filter((r) => r.success).length,
          results,
        },
      })
    } catch (error: any) {
      console.error('[MediaCollect] 导入失败:', error)
      res.status(500).json({ success: false, message: error?.message || '导入失败' })
    }
  })
}

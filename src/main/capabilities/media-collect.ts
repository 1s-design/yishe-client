/**
 * 客户端通用能力 — 媒体采集（media-collect）
 * 注册到 Capability Registry 后，admin 端 ClientSelector 可发现此客户端，
 * 并通过 service-command 调用 search / import / refreshRuntime。
 */

import { z } from 'zod'
import { CapabilityRegistry } from './registry'
import type { CapabilityDefinition } from './types'
import { searchMedia, importMedia, listSources } from '../mediaCollector'

// ─── media-collect:search ───────────────────────────────
const searchDef: CapabilityDefinition = {
  name: 'search',
  namespace: 'media-collect',
  description: '搜索开放媒体资源（Wikimedia Commons / Internet Archive）',
  riskLevel: 'read',
  argsSchema: z.object({
    source: z.string().describe('采集源: wikimedia / internet-archive'),
    query: z.string().describe('搜索关键词'),
    mediaType: z.enum(['image', 'video', 'audio']).optional().describe('媒体类型'),
    page: z.number().optional().default(1).describe('页码'),
    pageSize: z.number().optional().default(20).describe('每页数量'),
  }),
  handler: async ({ source, query, mediaType, page, pageSize }) => {
    const result = await searchMedia({ source: source as any, query, mediaType: mediaType as any, page, pageSize })
    return { success: true, data: result }
  },
}

// ─── media-collect:import ───────────────────────────────
const importDef: CapabilityDefinition = {
  name: 'import',
  namespace: 'media-collect',
  description: '导入媒体资源（下载 → COS → 后端记录）',
  riskLevel: 'write',
  argsSchema: z.object({
    items: z.array(z.any()).describe('要导入的媒体资源列表'),
  }),
  handler: async ({ items }) => {
    const result = await importMedia(items)
    return { success: true, data: result }
  },
}

// ─── media-collect:refreshRuntime ───────────────────────
const refreshDef: CapabilityDefinition = {
  name: 'refreshRuntime',
  namespace: 'media-collect',
  description: '刷新媒体采集服务状态',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const sources = listSources()
    return {
      success: true,
      data: {
        ok: true,
        available: true,
        sources,
        message: '媒体采集服务可用',
      },
    }
  },
}

export function registerMediaCollectCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, importDef, refreshDef])
}

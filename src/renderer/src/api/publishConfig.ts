/**
 * 发布配置 API 服务
 */

import request from './request'

export interface PublishConfig {
  id: string
  name: string
  platform: string
  configData: any
  isActive: boolean
  titlePromptTitle?: string
  taskType?: string
  description?: string
  createTime?: string
  updateTime?: string
}

export interface BatchByPublishConfigRequest {
  stickerIds?: string[]
  imageGroupIds?: string[]
  publishConfigIds: string[]
}

export interface BatchByPublishConfigResponse {
  total: number
  list: Array<{
    id: string
    name: string
    status: string
    psdTemplateId: string
    stickerId: string
  }>
}

export const publishConfigApi = {
  /**
   * 根据ID查询发布配置
   */
  async findOne(id: string): Promise<{ data: PublishConfig; code: number; status: boolean }> {
    return request.get<{ data: PublishConfig; code: number; status: boolean }>({
      url: `/publish-config/${id}`
    })
  },

  /**
   * 获取所有发布配置
   */
  async findAll(): Promise<{ data: PublishConfig[]; code: number; status: boolean }> {
    return request.get<{ data: PublishConfig[]; code: number; status: boolean }>({
      url: '/publish-config'
    })
  },

  /**
   * 根据发布配置批量创建套图任务
   */
  async batchByPublishConfig(
    data: BatchByPublishConfigRequest,
  ): Promise<{ data: BatchByPublishConfigResponse; code: number; status: boolean }> {
    return request.post({
      url: '/sticker-psd-set/batch-by-publish-config',
      data,
    })
  },
}

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
}

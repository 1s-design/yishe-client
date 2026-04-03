/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-01-XX XX:XX:XX
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-01-XX XX:XX:XX
 * @FilePath: /yishe-electron/src/renderer/src/api/material.ts
 * @Description: 素材管理相关 API
 */

import request from './request'

/**
 * 上传素材到服务端
 */
export interface UploadMaterialParams {
  url: string // COS URL
  name?: string
  nameEn?: string
  description?: string
  descriptionEn?: string
  keywords?: string
  keywordsEn?: string
  suffix: string // 文件后缀，如 jpg, png
  source?: string
  width?: number
  height?: number
  aspectRatio?: number
}

export interface UploadMaterialResponse {
  code: number
  status: boolean
  message: string
  data?: any
}

/**
 * 保存素材到服务端
 */
export async function uploadMaterialToServer(params: UploadMaterialParams): Promise<UploadMaterialResponse> {
  return request.post<UploadMaterialResponse>({
    url: '/crawler/material/add',
    data: params
  })
}

/**
 * 爬图素材相关接口
 */
export interface CrawlerMaterialQueryParams {
  currentPage: number
  pageSize: number
  imageName?: string
  id?: string
  startTime?: string
  endTime?: string
  sortingFields?: string
  suffix?: string
  resourceType?: string // 'own' | 'external'
}

export interface CrawlerMaterial {
  id: string
  name: string
  description?: string
  keywords?: string
  suffix?: string
  url: string
  originUrl?: string
  source?: string
  phash?: string
  isOwnResource?: boolean
  createTime?: string
  updateTime?: string
  size?: number
  imageDimensions?: {
    width: number
    height: number
  }
}

export interface CrawlerMaterialPageResponse {
  list: CrawlerMaterial[]
  total: number
}

/**
 * 分页获取爬图素材
 */
export async function getCrawlerMaterialPage(params: CrawlerMaterialQueryParams): Promise<CrawlerMaterialPageResponse> {
  return request.post<CrawlerMaterialPageResponse>({
    url: '/crawler/material/page',
    data: params
  })
}

/**
 * 更新爬图素材
 */
export interface UpdateCrawlerMaterialParams {
  id: string
  name?: string
  description?: string
  keywords?: string
  source?: string
  originUrl?: string
}

export async function updateCrawlerMaterial(params: UpdateCrawlerMaterialParams): Promise<any> {
  return request.post({
    url: '/crawler/material/update',
    data: params
  })
}

/**
 * 删除爬图素材
 */
export async function deleteCrawlerMaterial(ids: string[]): Promise<any> {
  return request.post({
    url: '/crawler/material/delete',
    data: { ids }
  })
}


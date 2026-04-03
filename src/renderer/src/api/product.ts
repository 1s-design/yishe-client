/*
 * 商品 API 服务
 */

import request from './request'

export interface Product {
  id: string
  code?: string
  name: string
  enName?: string
  description?: string
  enDescription?: string
  keywords?: string
  enKeywords?: string
  type?: string
  images?: string[]
  videos?: string[]
  price?: number
  salePrice?: number
  stock?: number
  specifications?: string
  tags?: string
  searchKeywords?: string
  enSearchKeywords?: string
  isActive?: boolean
  isPublish: boolean;
  isLimitedEdition?: number;
  createTime?: string
  updateTime?: string
  customModelId?: string
  stickerId?: string
  productImage2DId?: string
  psdSetId?: string
}

export interface PageProductDto {
  currentPage?: number
  pageSize?: number
  id?: string
  code?: string
  searchText?: string
  isPublish?: boolean;
  random?: boolean;
  includeRelations?: boolean
}

export interface PageProductResponse {
  list: Product[]
  total: number
  currentPage: number
  pageSize: number
}

export const productApi = {
  /**
   * 分页查询商品列表
   */
  async getPage(params: PageProductDto): Promise<PageProductResponse> {
    const res = await request.post<{ data: PageProductResponse }>({
      url: '/product/page',
      data: params
    })
    return res.data
  },

  /**
   * 根据ID查询商品完整信息
   */
  async findOne(id: string, includeRelations: boolean = true): Promise<{ data: Product; code: number; status: boolean }> {
    return request.get<{ data: Product; code: number; status: boolean }>({
      url: `/product/${id}?includeRelations=${includeRelations}`
    })
  },

  /**
   * 获取所有商品
   */
  async findAll(includeRelations: boolean = true): Promise<Product[]> {
    const res = await request.get<{ data: Product[] }>({
      url: `/product?includeRelations=${includeRelations}`
    })
    return res.data
  },

  /**
   * 获取商品社交媒体发布数据结构
   */
  async getSocialMediaExport(id: string): Promise<any> {
    const res = await request.get<{ data: any }>({
      url: `/product/social-media-export/${id}`
    })
    return res.data
  },

  /**
   * 更新商品信息
   */
  async update(id: string, data: Partial<Product>): Promise<any> {
    return request.post({
      url: '/product/update',
      data: { ...data, id }
    })
  }
}


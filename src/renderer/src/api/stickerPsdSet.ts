/*
 * 套图（PSD Set）API 服务
 */

import request from "./request";

function unwrapApiData<T>(response: any, fallback: T): T {
  if (
    response &&
    typeof response === "object" &&
    "data" in response &&
    ("code" in response || "status" in response || "message" in response)
  ) {
    return (response.data ?? fallback) as T;
  }

  return (response ?? fallback) as T;
}

export interface StickerPsdSet {
  id: string;
  name: string;
  description?: string;
  keywords?: string;
  status: "pending" | "processing" | "completed" | "failed";
  statusMessage?: string;
  meta?: any;
  images?: string[] | null;
  /** 配置信息，用于制作套图时的配置参数 */
  stickerPsdSetConfig?: any;
  /** 制作耗时(秒) */
  processingTime?: number;
  userId?: string | null;
  createTime?: string;
  updateTime?: string;
  /** 单素材模式：单个贴纸及其ID */
  sticker?: {
    id: string;
    url: string;
    name: string;
    [key: string]: any;
  };
  /** 多素材模式：多个贴纸数组（无贴纸时为 null） */
  stickers?: Array<{
    id: string;
    url: string;
    name?: string;
    [key: string]: any;
  }> | null;
  psdTemplate?: {
    id: string;
    url: string;
    name: string;
    windowsLocalPath?: string;
    meta?: any;
    psdTemplateConfig?: any;
    [key: string]: any;
  };
  stickerId?: string;
  /** 多素材模式：多个贴纸ID */
  stickerIds?: string[];
  psdTemplateId?: string;
}

export interface UpdateStickerPsdSetDto {
  name?: string;
  description?: string;
  keywords?: string;
  status?: "pending" | "processing" | "completed" | "failed";
  statusMessage?: string;
  meta?: any;
  images?: string[];
  stickerPsdSetConfig?: any;
  processingTime?: number;
  dispatchToken?: string;
}

export interface PsdSetProductionStatusReport {
  status: "pending" | "processing" | "completed" | "failed";
  statusMessage?: string;
  message?: string;
  progress?: number;
  total?: number;
  images?: string[];
  dispatchToken?: string;
  profileId?: string;
  clientId?: string;
  machineCode?: string;
  assignedClientId?: string;
  assignedMachineCode?: string;
}

export interface PageStickerPsdSetDto {
  currentPage?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  stickerId?: string;
  psdTemplateId?: string;
  userId?: string;
  includeDetails?: boolean;
}

export interface PageStickerPsdSetResponse {
  list: StickerPsdSet[];
  total: number;
  currentPage: number;
  pageSize: number;
}

export interface ClaimNextPsdSetResponse {
  success: boolean;
  claimed: boolean;
  reason?: string;
  message?: string;
  data?: {
    psdSetId: string;
    dispatchToken: string;
    profileId: string | null;
  };
}

export const stickerPsdSetApi = {
  /**
   * 分页查询套图列表
   */
  async getPage(
    params: PageStickerPsdSetDto,
  ): Promise<PageStickerPsdSetResponse> {
    const res = await request.post<{ data: PageStickerPsdSetResponse }>({
      url: "/sticker-psd-set/page",
      data: params,
    });
    return res.data;
  },

  /**
   * 根据ID查询套图完整信息
   */
  async findOne(
    id: string,
  ): Promise<{ data: StickerPsdSet; code: number; status: boolean }> {
    return request.get<{ data: StickerPsdSet; code: number; status: boolean }>({
      url: `/sticker-psd-set/${id}`,
    });
  },

  /**
   * 更新套图信息
   */
  async update(id: string, dto: UpdateStickerPsdSetDto): Promise<any> {
    return request.patch({
      url: `/sticker-psd-set/${id}`,
      data: dto,
    });
  },

  /**
   * 更新套图状态
   */
  async updateStatus(
    id: string,
    data: { status: string; statusMessage?: string; dispatchToken?: string },
  ): Promise<any> {
    return request.post({
      url: `/sticker-psd-set/${id}/status`,
      data,
    });
  },

  /**
   * 通过服务端状态机上报套图制作状态。
   */
  async reportProductionStatus(
    id: string,
    data: PsdSetProductionStatusReport,
  ): Promise<any> {
    return request.post({
      url: `/sticker-psd-set/${id}/production-status`,
      data,
    });
  },

  /**
   * 客户端主动领取下一个待制作套图任务。
   */
  async claimNext(data: {
    clientId: string;
    machineCode?: string;
    profileId?: string;
  }): Promise<ClaimNextPsdSetResponse> {
    const response = await request.post({
      url: "/sticker-psd-set/claim-next",
      data,
    });
    return unwrapApiData<ClaimNextPsdSetResponse>(response, {
      success: false,
      claimed: false,
      reason: "empty-response",
      message: "领取任务响应为空",
    });
  },
};

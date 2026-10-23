/**
 * 图片处理记录 API（服务端交接）
 *
 * 客户端本地完成 AI 超分后：
 *   1. 把结果图上传到 COS，拿到可公开访问的 URL
 *   2. POST /image-processing-record/create 登记记录（服务端要求 http/https 图片地址）
 *   3. PATCH /image-processing-record/:id/status 回写完成状态与结果文件
 *
 * 与 MCP 工具走同一套记录体系。
 */
import request from './request';

export interface ImageProcessingResultFile {
  key: string;
  url: string;
  name: string;
}

export interface CreateImageProcessingRecordPayload {
  title?: string;
  /** process=链式处理，variations=裂变预设 */
  taskType?: 'process' | 'variations';
  /** 图片地址，必须是 http/https */
  imageUrl: string;
  /** 图像引擎 ID，例如 ai-upscale */
  processorId?: string;
  /** 链式处理操作 JSON（taskType=process 时使用） */
  operationsJson?: string;
  sourceModule?: string;
  sourceName?: string;
}

export interface ImageProcessingRecord {
  id?: string | number;
  recordId?: string | number;
  [key: string]: any;
}

/** 创建图片处理记录 */
export async function createImageProcessingRecord(
  payload: CreateImageProcessingRecordPayload,
): Promise<ImageProcessingRecord> {
  return request.post<ImageProcessingRecord>({
    url: '/image-processing-record/create',
    data: payload,
  });
}

/** 回写记录状态（processing / completed / failed） */
export async function updateImageProcessingRecordStatus(
  recordId: string | number,
  payload: {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    message?: string;
    errorMessage?: string | null;
    processorId?: string | null;
    processorLabel?: string | null;
    resultFiles?: ImageProcessingResultFile[] | null;
    responseData?: Record<string, any> | null;
  },
): Promise<any> {
  return request.patch({
    url: `/image-processing-record/${encodeURIComponent(String(recordId))}/status`,
    data: payload,
  });
}

/** 从创建接口的返回里尽量稳妥地取出记录 id */
export function pickRecordId(record: ImageProcessingRecord | null | undefined): string {
  if (!record) return '';
  const candidate =
    record.id ?? record.recordId ?? (record as any).data?.id ?? (record as any).data?.recordId;
  return candidate === undefined || candidate === null ? '' : String(candidate);
}

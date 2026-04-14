import request from './request'
import axios from 'axios'
import { getTokenFromClient } from './user'
import { getRemoteApiBase } from '../config/api'

export interface QueueMessage {
  id: string
  queue: string
  type: string
  data: any
  description?: string
  priority?: number
  delay?: number
  maxAttempts?: number
  attempts?: number
  status: 'pending' | 'waiting' | 'processing' | 'completed' | 'failed'
  createdAt: string
  updatedAt?: string
  processedAt?: string
  error?: string
  metadata?: Record<string, any>
}

export interface QueueStats {
  queue: string
  pending: number
  waiting?: number
  processing: number
  delayed: number
  completed: number
  failed: number
  total: number
}

export interface CreateTaskDto {
  queue?: string  // 队列名称（可选，如果未提供则使用 type 作为 queue）
  type: string    // 任务类型（必需，如果未提供 queue 则同时作为队列名称）
  data: any
  description?: string
  priority?: number
  delay?: number
  maxAttempts?: number
  metadata?: Record<string, any>
}

// 创建任务
export const createTask = (data: CreateTaskDto) => {
  return request.post({ url: '/queue/produce', data })
}

// 获取任务列表（根据状态分页查询）
export const getTaskList = (params: {
  queue?: string  // 队列名称（可选，不传则查询所有队列）
  status?: 'pending' | 'waiting' | 'processing' | 'completed' | 'failed'
  type?: string    // 任务类型（可选，不传则查询所有类型）
  id?: string      // 任务ID（可选，不传则查询所有ID）
  limit?: number
  offset?: number
}) => {
  // 如果 queue 为空字符串，不传该参数
  const queryParams: any = { ...params }
  if (!queryParams.queue || !queryParams.queue.trim()) {
    delete queryParams.queue
  }
  // 如果 type 为空字符串，不传该参数
  if (!queryParams.type || !queryParams.type.trim()) {
    delete queryParams.type
  }
  // 如果 id 为空字符串，不传该参数
  if (!queryParams.id || !queryParams.id.trim()) {
    delete queryParams.id
  }
  return request.get({ url: `/queue/messages`, params: queryParams })
}

// 获取任务详情
export const getTaskDetail = (queue: string, messageId: string) => {
  return request.get({ url: '/queue/message', params: { queue, messageId } })
}

// 删除任务
export const deleteTask = async (queue: string, messageId: string) => {
  const token = await getTokenFromClient()
  const response = await axios.delete(`${getRemoteApiBase()}/queue/message`, {
    params: { queue, messageId },
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  return response.data
}

// 获取队列统计信息
export const getQueueStats = (queue?: string) => {
  // 如果 queue 为空字符串，不传该参数（查询所有队列的统计）
  const params: any = {}
  if (queue && queue.trim()) {
    params.queue = queue.trim()
  }
  return request.get({ url: `/queue/stats`, params })
}

// 更新任务数据
export const updateTaskData = (
  queue: string,
  messageId: string,
  data: any,
  dispatchToken?: string,
) => {
  return request.post({
    url: `/queue/message/data`,
    data: { queue, messageId, data, dispatchToken },
  })
}

// 更新任务状态（使用 type 字段而不是 queue）
export const updateTaskStatus = (
  type: string,
  messageId: string,
  status: 'pending' | 'waiting' | 'processing' | 'completed' | 'failed',
  error?: string,
  dispatchToken?: string,
) => {
  return request.post({
    url: '/queue/message/status',
    data: { type, messageId, status, error, dispatchToken },
  })
}

// 清空队列
export const clearQueue = async (queue: string) => {
  const token = await getTokenFromClient()
  const response = await axios.delete(`${getRemoteApiBase()}/queue/clear`, {
    params: { queue },
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  return response.data
}

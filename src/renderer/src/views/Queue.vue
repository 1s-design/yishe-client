<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getTaskList,
  deleteTask,
  getQueueStats,
  updateTaskStatus,
  type QueueMessage,
  type QueueStats,
} from '../api/queue'
import { TASK_TYPE_OPTIONS } from '../config/task-types'
import { isExecutableTaskType, getTaskExecutor, getExecutableTaskDisplayList } from '../config/executable-tasks'
import { AUTO_PROCESS_TIMING } from '../config/autoProcessTiming'
import { useCountdownSleep } from '../composables/useCountdownSleep'
import { buildProcessedPublishPreview, type ProcessedAssetPreview } from '../config/platform-executors'

// 查询条件
const queryParams = reactive({
  currentPage: 1,
  pageSize: 20,
  status: undefined as 'pending' | 'waiting' | 'processing' | 'completed' | 'failed' | undefined,
  type: '', // 任务类型，默认为空（留空则查询所有类型）
  id: '', // 任务ID，默认为空（留空则查询所有ID）
})

const loading = ref(false)
const dataSource = ref<QueueMessage[]>([])
const total = ref(0)

const stats = ref<QueueStats>({
  queue: '',
  pending: 0,
  waiting: 0,
  processing: 0,
  delayed: 0,
  completed: 0,
  failed: 0,
  total: 0,
})

// 状态编辑对话框
const statusDialogVisible = ref(false)
const statusFormRef = ref()
const statusFormData = reactive({
  id: '',
  type: '',
  status: '' as QueueMessage['status'],
  newStatus: '' as QueueMessage['status'],
  error: '',
})

const statusFormRules = {
  newStatus: [{ required: true, message: '请选择新状态', trigger: 'change' }],
  error: [{ required: true, message: '请输入错误信息', trigger: 'blur' }]
}

// 查看数据对话框
const dataDialogVisible = ref(false)
const currentTaskData = ref<any>({})
const currentTaskRuntime = computed(() => extractTaskRuntime(currentTaskData.value))
const currentTaskLogs = computed(() => {
  const logs = currentTaskRuntime.value?.logs
  return Array.isArray(logs) ? logs : []
})
const runtimeLogDialogVisible = ref(false)

// 预览发布数据对话框
const publishPreviewVisible = ref(false)
const previewPublishData = ref<any>({})
const publishPreviewLoading = ref(false)
const previewProcessedAssets = ref<{
  images: ProcessedAssetPreview[]
  thumbnail?: ProcessedAssetPreview | null
  videoSource?: { originalPath: string; localPath: string } | null
}>({
  images: [],
  thumbnail: null,
  videoSource: null,
})

// 执行任务中（按任务 ID 记录，用于按钮 loading）
const executingRowId = ref<string | null>(null)

// 自动刷新定时器
let autoRefreshTimer: NodeJS.Timeout | null = null

// 自动处理相关
const autoProcessing = ref(false)
const autoProcessingRunning = ref(false)
const autoProcessingStopRequested = ref(false)
const autoStopping = ref(false)
const autoActive = computed(() => autoProcessingRunning.value || autoProcessing.value)
const noPendingNotified = ref(false)

const { countdownSeconds, countdownTotal, sleepWithCountdown } = useCountdownSleep()
const countdownProgressPercent = computed(() =>
  countdownTotal.value != null && countdownSeconds.value != null
    ? Math.round((countdownSeconds.value / countdownTotal.value) * 100)
    : 0
)

/** 客户端支持的任务类型（来自 executable-tasks，与 task-types 解耦，便于扩展非发布类任务） */
const executableTaskDisplayList = getExecutableTaskDisplayList()

// 获取状态类型
function getStatusType(status: QueueMessage['status']) {
  const map = {
    pending: 'info',
    waiting: 'warning',
    processing: 'warning',
    completed: 'success',
    failed: 'danger',
  }
  return map[status] || 'info'
}

// 获取状态文本
function getStatusText(status: QueueMessage['status']) {
  const map = {
    pending: '待处理',
    waiting: '等待中',
    processing: '处理中',
    completed: '已完成',
    failed: '失败',
  }
  return map[status] || status
}

function extractTaskRuntime(data: any) {
  if (!data || typeof data !== 'object') {
    return null
  }

  if (data.taskLogs && typeof data.taskLogs === 'object') {
    return data.taskLogs
  }

  if (data.taskRuntime && typeof data.taskRuntime === 'object') {
    return data.taskRuntime
  }

  const legacyRuntime = data.executionRuntime
  if (!legacyRuntime || typeof legacyRuntime !== 'object') {
    return null
  }

  if (Array.isArray(legacyRuntime.logs)) {
    return legacyRuntime
  }

  const firstPlatformKey = Object.keys(legacyRuntime)[0]
  if (!firstPlatformKey) {
    return null
  }

  const firstPlatformRuntime = legacyRuntime[firstPlatformKey]
  if (!firstPlatformRuntime || typeof firstPlatformRuntime !== 'object') {
    return null
  }

  return {
    platform: firstPlatformRuntime.platform || firstPlatformKey,
    logs: Array.isArray(firstPlatformRuntime.logs) ? firstPlatformRuntime.logs : [],
  }
}

function getLogLevelTagType(level?: string) {
  const normalizedLevel = String(level || 'info').toLowerCase()
  if (normalizedLevel === 'error') return 'danger'
  if (normalizedLevel === 'warn' || normalizedLevel === 'warning') return 'warning'
  return 'info'
}

function formatLogTimestamp(value: any) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }
  return date.toLocaleString()
}

function hasLogData(log: any) {
  return log?.data !== undefined && log?.data !== null && !(Array.isArray(log.data) && log.data.length === 0)
}

function formatLogData(value: any) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// 获取列表
async function getList() {
  loading.value = true
  try {
    const res = await getTaskList({
      status: queryParams.status,
      type: queryParams.type?.trim() || undefined,
      id: queryParams.id?.trim() || undefined,
      limit: queryParams.pageSize,
      offset: (queryParams.currentPage - 1) * queryParams.pageSize,
    })
    
    let responseData = res
    if (res && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
      if (res.data.success !== undefined || res.data.list !== undefined) {
        responseData = res.data
      }
    }
    
    if (responseData) {
      const isSuccess = responseData.success !== false && responseData.success !== undefined ? responseData.success : true
      if (isSuccess) {
        const messages = responseData.list || responseData.messages || []
        const totalCount = responseData.total !== undefined
          ? Number(responseData.total) || 0
          : (Array.isArray(messages) ? messages.length : 0)
        
        dataSource.value = Array.isArray(messages) ? messages : []
        total.value = totalCount
        
        // 调试：打印第一条任务的详细信息
        if (dataSource.value.length > 0) {
          console.log('📋 第一条任务数据:', {
            id: dataSource.value[0].id,
            type: dataSource.value[0].type,
            status: dataSource.value[0].status,
            statusType: typeof dataSource.value[0].status,
            fullData: dataSource.value[0]
          })
        }
      } else {
        dataSource.value = []
        total.value = 0
      }
    } else {
      dataSource.value = []
      total.value = 0
    }
  } catch (error: any) {
    console.error('获取列表失败:', error)
    ElMessage.error(error?.message || '获取列表失败')
    dataSource.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// 刷新统计信息
async function refreshStats() {
  try {
    const queueName = queryParams.type?.trim() || ''
    const res = await getQueueStats(queueName)
    
    let statsData = res
    if (res && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
      if (res.data.queue !== undefined || res.data.pending !== undefined) {
        statsData = res.data
      } else if (res.data.data && typeof res.data.data === 'object') {
        statsData = res.data.data
      }
    }
    
    if (statsData && typeof statsData === 'object' && !Array.isArray(statsData)) {
      stats.value = {
        queue: statsData.queue || queryParams.type?.trim() || '*',
        pending: Number(statsData.pending) || 0,
        waiting: Number(statsData.waiting) || 0,
        processing: Number(statsData.processing) || 0,
        delayed: Number(statsData.delayed) || 0,
        completed: Number(statsData.completed) || 0,
        failed: Number(statsData.failed) || 0,
        total: Number(statsData.total) || 0,
      }
    }
  } catch (error: any) {
    console.error('获取统计信息失败:', error)
  }
}

// 是否可执行（当前客户端支持执行的任务类型）
function isExecutable(row: QueueMessage) {
  return isExecutableTaskType(row.type) && ['pending', 'completed', 'failed'].includes(row.status)
}

function shouldShowExecuteButton(row: QueueMessage) {
  return isExecutableTaskType(row.type)
}

function isExecuteButtonDisabled(row: QueueMessage) {
  if (!shouldShowExecuteButton(row)) return true
  if (row.status === 'processing' || row.status === 'waiting') return true
  if (executingRowId.value && executingRowId.value !== row.id) return true
  return false
}

// 执行任务
async function handleExecute(row: QueueMessage) {
  if (!isExecutableTaskType(row.type)) {
    ElMessage.warning('当前任务类型不支持在客户端执行')
    return
  }

  if (row.status === 'processing') {
    ElMessage.warning('任务正在执行中，请勿重复触发')
    return
  }

  if (row.status === 'waiting') {
    ElMessage.warning('任务当前处于等待状态，请稍后再试')
    return
  }

  if (!['pending', 'completed', 'failed'].includes(row.status)) {
    ElMessage.warning('任务当前不可执行')
    return
  }

  if (row?.data?.meta?.titleStatus === 'pending') {
    ElMessage.warning('标题仍在生成中，请稍后重试')
    return
  }

  const executor = getTaskExecutor(row.type)
  if (!executor) return
  executingRowId.value = row.id
  try {
    // 发起执行（异步）
    const executePromise = executor(row)
    
    // 延迟 1 秒后刷新列表，以便看到 "processing" 状态
    setTimeout(() => {
      getList()
      refreshStats()
    }, 1000)

    await executePromise
    ElMessage.success('任务执行成功')
  } catch (e: any) {
    console.error(`任务执行失败 [${row.id}]:`, e)
    ElMessage.error(e?.message || '执行失败')
    throw e // 向上抛出错误，以便自动处理逻辑感知
  } finally {
    executingRowId.value = null
    // 最终再刷新一次，确保看到 "completed" 或 "failed"
    getList()
    refreshStats()
  }
}

// 自动处理循环逻辑
async function runAutoTaskLoop() {
  autoProcessingRunning.value = true
  
  while (!autoProcessingStopRequested.value) {
    try {
      // 如果当前已有手动任务在执行，等待
      if (executingRowId.value) {
        await sleepWithCountdown(AUTO_PROCESS_TIMING.WAIT_WHEN_BUSY_MS, () => autoProcessingStopRequested.value)
        continue
      }

      // 获取第一页的待处理任务（不传 status，获取所有状态的任务）
      const res = await getTaskList({
        limit: 10,
        offset: 0
      })

      let responseData = res
      if (res && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
        if (res.data.success !== undefined || res.data.list !== undefined) {
          responseData = res.data
        }
      }

      const rawList = (responseData?.list || responseData?.messages || []) as QueueMessage[]
      // 只处理客户端支持的任务，且状态为 pending 或 completed（可执行状态）
      const executableList = rawList.filter(item => 
        isExecutableTaskType(item.type) && 
        (item.status === 'pending' || item.status === 'completed')
      )

      if (!executableList.length) {
        if (!noPendingNotified.value && rawList.length > 0) {
           ElMessage.info('发现待处理任务，但当前客户端不支持处理，已跳过')
           noPendingNotified.value = true
        } else if (rawList.length === 0) {
           noPendingNotified.value = false
        }
        // 无可处理任务时休眠后继续
        await sleepWithCountdown(AUTO_PROCESS_TIMING.IDLE_POLL_INTERVAL_MS, () => autoProcessingStopRequested.value)
        continue
      }

      noPendingNotified.value = false
      
      // 顺序执行可处理任务
      for (const task of executableList) {
        if (autoProcessingStopRequested.value) break
        
        try {
          await handleExecute(task)
        } catch (err) {
          // 单个任务失败不停止循环
          console.error('自动处理单个任务失败:', err)
        }
        
        // 任务间隔
        await sleepWithCountdown(AUTO_PROCESS_TIMING.TASK_INTERVAL_MS, () => autoProcessingStopRequested.value)
      }

    } catch (error) {
      console.error('自动处理循环异常:', error)
      await sleepWithCountdown(AUTO_PROCESS_TIMING.ERROR_RETRY_MS, () => autoProcessingStopRequested.value)
    }
  }

  // 若非用户主动停止，防止循环意外退出，自动重启
  if (!autoProcessingStopRequested.value) {
    console.warn('自动处理循环意外退出，准备重启')
    await sleepWithCountdown(AUTO_PROCESS_TIMING.ERROR_RETRY_MS, () => autoProcessingStopRequested.value)
    if (!autoProcessingStopRequested.value) {
      runAutoTaskLoop()
      return
    }
  }

  autoProcessing.value = false
  autoProcessingRunning.value = false
  autoProcessingStopRequested.value = false
  autoStopping.value = false
}

// 开启自动处理
function startAutoProcessing() {
  if (autoProcessingRunning.value) return
  autoProcessing.value = true
  autoProcessingStopRequested.value = false
  autoStopping.value = false
  ElMessage.success('已开启自动处理任务')
  runAutoTaskLoop()
}

// 停止自动处理
function stopAutoProcessing() {
  autoStopping.value = true
  autoProcessingStopRequested.value = true
  ElMessage.warning('正在停止自动处理...')
}

// 切换自动处理
function toggleAutoProcessing() {
  if (autoActive.value) {
    stopAutoProcessing()
  } else {
    startAutoProcessing()
  }
}

// 编辑（更新状态）
function handleEdit(row: QueueMessage) {
  statusFormData.id = row.id
  statusFormData.type = row.type
  statusFormData.status = row.status
  statusFormData.newStatus = row.status
  statusFormData.error = row.error || ''
  statusDialogVisible.value = true
}

// 查看数据
function handleViewData(row: QueueMessage) {
  currentTaskData.value = row.data
  dataDialogVisible.value = true
}

function handleViewRuntimeLogs(row: QueueMessage) {
  currentTaskData.value = row.data
  runtimeLogDialogVisible.value = true
}

// 预览发布数据
async function handlePreviewPublish(row: QueueMessage) {
  publishPreviewLoading.value = true
  publishPreviewVisible.value = true
  previewPublishData.value = {}
  previewProcessedAssets.value = {
    images: [],
    thumbnail: null,
    videoSource: null,
  }

  try {
    const result = await buildProcessedPublishPreview(row)
    previewPublishData.value = result.requestBody
    previewProcessedAssets.value = result.processedAssets
  } catch (error: any) {
    ElMessage.error(error?.message || '生成发布预览失败')
  } finally {
    publishPreviewLoading.value = false
  }
}

// 删除任务
function handleDelete(row: QueueMessage) {
  ElMessageBox.confirm('确认删除该任务吗？', '删除提示', {
    confirmButtonText: '确认',
    cancelButtonText: '取消',
    type: 'error',
  })
    .then(async () => {
      try {
        await deleteTask(row.queue, row.id)
        ElMessage.success('删除成功')
        getList()
        refreshStats()
      } catch (error) {
        ElMessage.error('删除失败')
      }
    })
    .catch(() => {})
}

// 提交状态修改
async function handleStatusSubmit() {
  try {
    await statusFormRef.value.validate()
    
    if (statusFormData.newStatus === statusFormData.status) {
      ElMessage.info('状态未发生变化')
      statusDialogVisible.value = false
      return
    }
    
    await updateTaskStatus(
      statusFormData.type, 
      statusFormData.id, 
      statusFormData.newStatus,
      statusFormData.newStatus === 'failed' ? statusFormData.error : undefined
    )
    
    ElMessage.success('状态修改成功')
    statusDialogVisible.value = false
    getList()
    refreshStats()
  } catch (error: any) {
    ElMessage.error(error?.message || '操作失败')
  }
}

// 格式化时间
function formatTime(time?: string) {
  if (!time) return '-'
  return new Date(time).toLocaleString('zh-CN')
}

// 处理操作命令
function handleOperationCommand(command: string, row: QueueMessage) {
  switch (command) {
    case 'view-data':
      handleViewData(row)
      break
    case 'view-runtime-logs':
      handleViewRuntimeLogs(row)
      break
    case 'preview-publish':
      handlePreviewPublish(row)
      break
    case 'edit-status':
      handleEdit(row)
      break
    case 'delete':
      handleDelete(row)
      break
    default:
      console.warn('未知的操作命令:', command)
  }
}

// 监听任务类型变化
watch(() => queryParams.type, (newType) => {
  if (newType && newType.trim()) {
    localStorage.setItem('queue_last_type', newType.trim())
  } else {
    localStorage.removeItem('queue_last_type')
  }
})

// 初始化
onMounted(() => {
  getList()
  refreshStats()
  
  // 开启自动刷新，每 10 秒刷新一次，保障状态最新
  autoRefreshTimer = setInterval(() => {
    // 如果当前正在执行某个任务，可以稍微延后刷新或正常刷新
    getList()
    refreshStats()
  }, 10000)
})

onUnmounted(() => {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }
})
</script>

<template>
  <div class="queue-page">
    <el-card class="queue-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <div class="card-header-left">
            <i class="mdi mdi-format-list-bulleted card-header-icon" />
            <span class="card-title">任务队列管理</span>
          </div>
        </div>
      </template>

      <div class="card-content">
        <!-- 搜索栏 -->
        <div class="search-bar">
          <el-input
            v-model="queryParams.id"
            placeholder="任务ID（留空则查询所有ID）"
            clearable
            style="width: 250px"
            @keyup.enter="getList"
          >
            <template #prefix>
              <i class="mdi mdi-identifier" />
            </template>
          </el-input>
          <el-select
            v-model="queryParams.type"
            placeholder="任务类型"
            clearable
            style="width: 220px"
            @change="getList"
          >
            <el-option label="全部类型" value="" />
            <el-option
              v-for="opt in TASK_TYPE_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-select
            v-model="queryParams.status"
            placeholder="任务状态"
            clearable
            style="width: 160px"
            @change="getList"
          >
            <el-option label="全部" value="" />
            <el-option label="待处理" value="pending" />
            <el-option label="等待中" value="waiting" />
            <el-option label="处理中" value="processing" />
            <el-option label="已完成" value="completed" />
            <el-option label="失败" value="failed" />
          </el-select>
          <el-button type="primary" @click="getList">
            <i class="mdi mdi-magnify" style="margin-right: 4px" />
            查询
          </el-button>
          
          <el-button
            :type="autoActive ? 'danger' : 'success'"
            :disabled="autoStopping"
            @click="toggleAutoProcessing"
          >
            <i
              class="mdi"
              :class="autoActive ? 'mdi-stop-circle-outline' : 'mdi-play-circle-outline'"
              style="margin-right: 4px"
            />
            <template v-if="autoActive">
              {{ autoStopping ? '停止中...' : '停止自动处理' }}
            </template>
            <template v-else>
              自动处理待处理
            </template>
          </el-button>
          <div v-if="autoActive && countdownSeconds !== null" class="auto-status-wrap">
            <div class="auto-status-progress">
              <div class="auto-status-progress-bar" :style="{ width: countdownProgressPercent + '%' }" />
            </div>
            <span class="auto-status-text">还剩 {{ countdownSeconds }} 秒重新查询</span>
          </div>
        </div>

        <!-- 客户端支持的任务类型说明（点击查看） -->
        <div class="executable-types-hint">
          <span class="executable-types-label">
            <i class="mdi mdi-information-outline" />
            本客户端可执行的任务类型
          </span>
          <el-popover placement="bottom-start" :width="320" trigger="click">
            <template #reference>
              <el-button type="primary" link size="small" class="executable-types-trigger">
                点击查看
              </el-button>
            </template>
            <div class="executable-types-popover">
              <div class="executable-types-popover-title">可执行的任务类型（共 {{ executableTaskDisplayList.length }} 种）</div>
              <div class="executable-types-tags">
                <el-tag
                  v-for="item in executableTaskDisplayList"
                  :key="item.value"
                  size="small"
                  type="success"
                  effect="plain"
                  class="executable-tag"
                >
                  {{ item.label }}
                </el-tag>
              </div>
              <div class="executable-types-popover-note">其他类型的待处理任务将被自动跳过</div>
            </div>
          </el-popover>
          <span class="executable-types-note">，其他类型将自动跳过</span>
        </div>

        <!-- 表格展示 -->
        <div class="table-container">
        <el-table
          :data="dataSource"
          v-loading="loading"
          stripe
          size="small"
          style="width: 100%"
        >
          <el-table-column prop="id" label="任务ID" min-width="200" show-overflow-tooltip />
          <el-table-column prop="type" label="任务类型" width="240" />
          <el-table-column prop="description" label="任务描述" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.description || '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.status)" size="small">
                {{ getStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="可执行状态" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.status === 'waiting'" type="warning" size="small">
                等待中
              </el-tag>
              <el-tag v-else-if="row.status === 'pending' || row.status === 'completed' || row.status === 'failed'" type="success" size="small">
                可执行
              </el-tag>
              <el-tag v-else :type="getStatusType(row.status)" size="small">
                {{ getStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="priority" label="优先级" width="80" />
          <el-table-column prop="attempts" label="重试次数" width="100">
            <template #default="{ row }">
              {{ row.attempts || 0 }} / {{ row.maxAttempts || 3 }}
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="创建时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.createdAt) }}
            </template>
          </el-table-column>
          <el-table-column prop="updatedAt" label="更新时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.updatedAt) }}
            </template>
          </el-table-column>
          <el-table-column prop="error" label="错误信息" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.error || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right" align="center" class-name="queue-operation-column">
            <template #default="{ row }">
              <div class="queue-operation-cell">
                <template v-if="shouldShowExecuteButton(row)">
                  <el-button
                    type="primary"
                    size="small"
                    :loading="executingRowId === row.id"
                    :disabled="isExecuteButtonDisabled(row)"
                    @click="handleExecute(row)"
                  >
                    执行
                  </el-button>
                  <span class="queue-operation-gap" />
                </template>
                <el-dropdown trigger="click" @command="(command) => handleOperationCommand(command, row)">
                  <el-button type="primary" link size="small">
                    操作
                    <i class="mdi mdi-chevron-down" style="margin-left: 4px" />
                  </el-button>
                  <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="view-data">
                      <i class="mdi mdi-eye-outline" style="margin-right: 4px" />
                      <span>查看数据</span>
                    </el-dropdown-item>
                    <el-dropdown-item command="view-runtime-logs">
                      <i class="mdi mdi-text-box-search-outline" style="margin-right: 4px" />
                      <span>运行日志</span>
                    </el-dropdown-item>
                    <el-dropdown-item command="preview-publish">
                      <i class="mdi mdi-play-network-outline" style="margin-right: 4px" />
                      <span>发布预览</span>
                    </el-dropdown-item>
                    <el-dropdown-item command="edit-status">
                      <i class="mdi mdi-tag-outline" style="margin-right: 4px" />
                      <span>标记状态</span>
                    </el-dropdown-item>
                    <el-dropdown-item divided command="delete">
                      <i class="mdi mdi-delete-outline" style="margin-right: 4px" />
                      <span>删除</span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

        <!-- 分页 -->
        <div class="pagination-wrapper mt-4">
          <el-pagination
            v-model:current-page="queryParams.currentPage"
            v-model:page-size="queryParams.pageSize"
            :total="total"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next, jumper"
            size="small"
            @current-change="getList"
            @size-change="getList"
          />
        </div>
      </div>
    </el-card>

    <!-- 编辑状态对话框 -->
    <el-dialog 
      v-model="statusDialogVisible" 
      title="修改任务状态" 
      width="500px"
    >
      <el-form 
        ref="statusFormRef" 
        :model="statusFormData" 
        :rules="statusFormRules" 
        label-width="100px"
      >
        <el-form-item label="任务ID">
          <el-input v-model="statusFormData.id" disabled />
        </el-form-item>
        <el-form-item label="当前状态">
          <el-tag :type="getStatusType(statusFormData.status)">
            {{ getStatusText(statusFormData.status) }}
          </el-tag>
        </el-form-item>
        <el-form-item label="新状态" prop="newStatus">
          <el-select v-model="statusFormData.newStatus" placeholder="请选择新状态" style="width: 100%">
            <el-option label="待处理" value="pending" />
            <el-option label="等待中" value="waiting" />
            <el-option label="处理中" value="processing" />
            <el-option label="已完成" value="completed" />
            <el-option label="失败" value="failed" />
          </el-select>
        </el-form-item>
        <el-form-item label="错误信息" prop="error" v-if="statusFormData.newStatus === 'failed'">
          <el-input
            v-model="statusFormData.error"
            type="textarea"
            :rows="3"
            placeholder="请输入错误信息"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="statusDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleStatusSubmit">确定</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 查看数据对话框 -->
    <el-dialog 
      v-model="dataDialogVisible" 
      title="任务数据" 
      width="600px"
    >
      <pre class="data-preview">{{ JSON.stringify(currentTaskData, null, 2) }}</pre>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dataDialogVisible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog 
      v-model="runtimeLogDialogVisible" 
      title="运行日志" 
      width="900px"
      class="runtime-log-dialog"
    >
      <div class="runtime-log-shell">
        <div class="runtime-log-toolbar">
          <div class="runtime-log-toolbar__meta">
            <span>平台：{{ currentTaskRuntime?.platform || '-' }}</span>
            <span>日志数：{{ currentTaskLogs.length }}</span>
          </div>
        </div>
        <div v-if="currentTaskLogs.length" class="runtime-log-console">
          <div v-for="(log, index) in currentTaskLogs" :key="log.id || `${log.timestamp}-${index}`" class="runtime-log-console__line">
            <span class="runtime-log-console__time">{{ formatLogTimestamp(log.time || log.timestamp) }}</span>
            <span class="runtime-log-console__level" :data-level="String(log.level || 'info').toLowerCase()">
              {{ String(log.level || 'info').toUpperCase() }}
            </span>
            <span class="runtime-log-console__message">{{ log.message || '-' }}</span>
            <pre v-if="hasLogData(log)" class="runtime-log-console__data">{{ formatLogData(log.data) }}</pre>
          </div>
        </div>
        <el-empty v-else description="暂无运行日志" :image-size="72" />
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="runtimeLogDialogVisible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 预览发布数据对话框 -->
    <el-dialog 
      v-model="publishPreviewVisible" 
      title="预览客户端向下游发出的参数" 
      width="960px"
    >
      <div v-loading="publishPreviewLoading">
        <div style="margin-bottom: 15px; font-size: 12px; color: #E6A23C; background: #fdf6ec; padding: 10px; border-radius: 4px;">
          <i class="mdi mdi-information" style="margin-right: 4px;"></i>这里展示的是客户端真正会发给发布端的请求体，图片已按本地化与压缩规则处理，并优先复用工作目录缓存。
        </div>

        <el-row :gutter="16">
          <el-col :span="14">
            <div class="preview-section-title">请求体</div>
            <pre class="data-preview">{{ JSON.stringify(previewPublishData, null, 2) }}</pre>
          </el-col>
          <el-col :span="10">
            <div class="preview-section-title">处理后的文件</div>
            <div class="processed-assets-panel">
              <template v-if="previewProcessedAssets.images.length">
                <div
                  v-for="(image, index) in previewProcessedAssets.images"
                  :key="`${image.processedPath}-${index}`"
                  class="processed-asset-card"
                >
                  <img
                    v-if="image.previewDataUrl"
                    :src="image.previewDataUrl"
                    class="processed-asset-image"
                    alt="processed preview"
                  />
                  <div class="processed-asset-meta">
                    <div>图片 {{ index + 1 }}{{ image.cached ? ' · 缓存' : '' }}</div>
                    <div>{{ image.width || '-' }} x {{ image.height || '-' }}</div>
                    <div>{{ image.fileSize || 0 }} bytes</div>
                    <div class="processed-asset-path">{{ image.processedPath }}</div>
                  </div>
                </div>
              </template>
              <el-empty v-else description="没有图片资源" :image-size="72" />

              <div v-if="previewProcessedAssets.thumbnail" class="processed-asset-extra">
                <div class="preview-subtitle">缩略图</div>
                <div class="processed-asset-path">{{ previewProcessedAssets.thumbnail.processedPath }}</div>
              </div>

              <div v-if="previewProcessedAssets.videoSource" class="processed-asset-extra">
                <div class="preview-subtitle">视频文件</div>
                <div class="processed-asset-path">{{ previewProcessedAssets.videoSource.localPath }}</div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="publishPreviewVisible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>

  </div>
</template>

<style scoped>
.queue-page {
  width: 100%;
}

.queue-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.card-header-icon {
  font-size: 20px;
  color: #6366f1;
}

.card-title {
  font-size: 18px;
  font-weight: 600;
  color: #111827;
  letter-spacing: 0.01em;
}

.card-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 200px);
  min-height: 600px;
}

.auto-status-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 12px;
}
.auto-status-progress {
  width: 80px;
  height: 6px;
  background: var(--el-fill-color-light);
  border-radius: 3px;
  overflow: hidden;
}
.auto-status-progress-bar {
  height: 100%;
  background: var(--el-color-primary);
  border-radius: 3px;
  transition: width 1s linear;
}
.auto-status-text {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.executable-types-hint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
  font-size: 13px;
}
.executable-types-label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--el-text-color-regular);
}
.executable-types-label .mdi {
  color: var(--el-color-info);
  font-size: 16px;
}
.executable-types-trigger {
  padding: 0 4px;
  font-size: 13px;
}
.executable-types-note {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.executable-types-popover {
  padding: 4px 0;
}
.executable-types-popover-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}
.executable-types-popover .executable-types-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.executable-types-popover .executable-tag {
  margin: 0;
}
.executable-types-popover-note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.search-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px;
  background: #f9fafb;
  border-radius: 8px;
  flex-shrink: 0;
}

.table-container {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-container :deep(.el-table) {
  height: 100%;
}

.table-container :deep(.el-table__body-wrapper) {
  max-height: calc(100vh - 400px);
  overflow-y: auto;
}

.queue-operation-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.queue-operation-gap {
  margin-left: 8px;
}

:deep(.queue-operation-column.el-table__cell) {
  vertical-align: middle;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
  padding: 12px 0 0;
  flex-shrink: 0;
  border-top: 1px solid #e5e7eb;
  padding-top: 12px;
}

.data-preview {
  padding: 16px;
  border-radius: 8px;
  max-height: 500px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.8;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  color: #1f2937;
}

.runtime-log-dialog :deep(.el-dialog) {
  background: #0b1220;
}

.runtime-log-dialog :deep(.el-dialog__header),
.runtime-log-dialog :deep(.el-dialog__body),
.runtime-log-dialog :deep(.el-dialog__footer) {
  background: #0b1220;
  color: #dbe4f0;
}

.runtime-log-dialog :deep(.el-dialog__body) {
  padding-top: 10px;
}

.runtime-log-dialog :deep(.el-dialog__footer) {
  border-top: 1px solid rgba(51, 65, 85, 0.9);
}

.runtime-log-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.runtime-log-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.runtime-log-toolbar__meta {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: #94a3b8;
}

.runtime-log-console {
  max-height: 68vh;
  overflow: auto;
  padding: 12px 14px;
  border-radius: 10px;
  background: #020617;
  border: 1px solid #1e293b;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.7;
}

.runtime-log-console__line + .runtime-log-console__line {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(51, 65, 85, 0.75);
}

.runtime-log-console__time {
  color: #64748b;
  margin-right: 10px;
}

.runtime-log-console__level {
  display: inline-block;
  min-width: 56px;
  margin-right: 10px;
  font-weight: 700;
}

.runtime-log-console__level[data-level='info'] {
  color: #38bdf8;
}

.runtime-log-console__level[data-level='warn'],
.runtime-log-console__level[data-level='warning'] {
  color: #fbbf24;
}

.runtime-log-console__level[data-level='error'] {
  color: #f87171;
}

.runtime-log-console__message {
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}

.runtime-log-console__data {
  margin: 8px 0 0 66px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #0f172a;
  color: #cbd5e1;
  overflow: auto;
  line-height: 1.6;
}

.data-preview::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.data-preview::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 4px;
}

.data-preview::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}

.data-preview::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.preview-section-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
}

.processed-assets-panel {
  min-height: 420px;
  max-height: 520px;
  overflow: auto;
  padding-right: 4px;
}

.processed-asset-card {
  display: flex;
  gap: 12px;
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
}

.processed-asset-image {
  width: 96px;
  height: 96px;
  border-radius: 10px;
  object-fit: cover;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
}

.processed-asset-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #4b5563;
}

.processed-asset-path {
  word-break: break-all;
  color: #111827;
}

.processed-asset-extra {
  margin-top: 12px;
  padding: 12px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
}

.preview-subtitle {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #111827;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .search-bar {
    flex-direction: column;
    align-items: stretch;
  }
  
  .search-bar > * {
    width: 100% !important;
  }
}
</style>

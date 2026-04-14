<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { stickerPsdSetApi, type StickerPsdSet } from '../api/stickerPsdSet'
import { getUserInfo } from '../api/auth'
import { ElMessage } from 'element-plus'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()

const loading = ref(false)
const dataSource = ref<StickerPsdSet[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const statusFilter = ref<string>('')
const currentUserId = ref<string | null>(null)

// 待制作检测相关
const pendingCheckInterval = ref<NodeJS.Timeout | null>(null)
const lastPendingCount = ref(0) // 上次提醒时的待制作数量

const statusOptions = [
  { label: '全部', value: '' },
  { label: '待处理', value: 'pending' },
  { label: '处理中', value: 'processing' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' }
]

const statusMap: Record<string, { label: string; type: string }> = {
  pending: { label: '待处理', type: 'info' },
  processing: { label: '处理中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  failed: { label: '失败', type: 'danger' }
}

const getList = async () => {
  loading.value = true
  try {
    // 确保已获取用户ID
    if (!currentUserId.value) {
      await loadCurrentUser()
    }

    const res = await stickerPsdSetApi.getPage({
      currentPage: currentPage.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      status: statusFilter.value || undefined,
      userId: currentUserId.value || undefined,
      includeDetails: false
    })
    
    dataSource.value = res.list || []
    total.value = res.total || 0
  } catch (error: any) {
    console.error('获取套图列表失败:', error)
    ElMessage.error(error?.message || '获取套图列表失败')
    dataSource.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

const loadCurrentUser = async () => {
  try {
    const userInfo = await getUserInfo()
    currentUserId.value = userInfo.id
  } catch (error: any) {
    console.error('获取当前用户信息失败:', error)
    // 如果获取用户信息失败，仍然可以查询，但不按用户过滤
    currentUserId.value = null
  }
}

const handleSearch = () => {
  currentPage.value = 1
  getList()
}

const handlePageChange = (page: number) => {
  currentPage.value = page
  getList()
}

const handleSizeChange = (size: number) => {
  pageSize.value = size
  currentPage.value = 1
  getList()
}

const formatTime = (time?: string) => {
  if (!time) return '-'
  return new Date(time).toLocaleString('zh-CN')
}

const formatProcessingTime = (seconds?: any) => {
  const s = Number(seconds)
  if (isNaN(s) || s <= 0) return '-'
  if (s < 60) return `${s.toFixed(2)}秒`
  if (s < 3600) {
    const minutes = Math.floor(s / 60)
    const secs = s % 60
    return `${minutes}分${secs.toFixed(2)}秒`
  }
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const secs = s % 60
  return `${hours}小时${minutes}分${secs.toFixed(2)}秒`
}

// 检查待制作的套图数量
const checkPendingCount = async () => {
  try {
    // 确保已获取用户ID
    if (!currentUserId.value) {
      await loadCurrentUser()
    }

    // 查询待制作的套图数量
    const res = await stickerPsdSetApi.getPage({
      currentPage: 1,
      pageSize: 1, // 只需要总数，不需要列表数据
      status: 'pending',
      userId: currentUserId.value || undefined,
      includeDetails: false
    })

    const pendingCount = res.total || 0

    // 如果待制作数量大于0，且数量有变化，则提醒用户
    if (pendingCount > 0 && pendingCount !== lastPendingCount.value) {
      lastPendingCount.value = pendingCount
      showToast({
        color: 'warning',
        icon: 'mdi-alert-outline',
        message: `您有 ${pendingCount} 个套图待制作`,
        duration: 5000
      })
    } else if (pendingCount === 0) {
      // 如果数量变为0，重置记录
      lastPendingCount.value = 0
    }
  } catch (error: any) {
    // 静默处理错误，不影响主流程
    console.error('检查待制作套图数量失败:', error)
  }
}

// 启动定期检测
const startPendingCheck = () => {
  // 立即检查一次
  checkPendingCount()
  
  // 每30秒检查一次
  pendingCheckInterval.value = setInterval(() => {
    checkPendingCount()
  }, 30000)
}

// 停止定期检测
const stopPendingCheck = () => {
  if (pendingCheckInterval.value) {
    clearInterval(pendingCheckInterval.value)
    pendingCheckInterval.value = null
  }
}

// 修改状态
const handleUpdateStatus = async (row: StickerPsdSet, status: string) => {
  try {
    await stickerPsdSetApi.updateStatus(row.id, { status })
    ElMessage.success('状态已更新')
    getList()
  } catch (error: any) {
    ElMessage.error(error?.message || '状态更新失败')
  }
}

// 处理操作命令
const handleOperationCommand = (command: string, row: StickerPsdSet) => {
  switch (command) {
    case 'mark-pending':
      handleUpdateStatus(row, 'pending')
      break
    case 'mark-processing':
      handleUpdateStatus(row, 'processing')
      break
    case 'mark-completed':
      handleUpdateStatus(row, 'completed')
      break
    case 'mark-failed':
      handleUpdateStatus(row, 'failed')
      break
    default:
      console.warn('未知的操作命令:', command)
  }
}

onMounted(async () => {
  await loadCurrentUser()
  await getList()
  // 启动待制作检测
  startPendingCheck()
})

onUnmounted(() => {
  // 清理定时器
  stopPendingCheck()
})
</script>

<template>
  <div class="psd-set-page">
    <el-card class="psd-set-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <div class="card-header-left">
            <i class="mdi mdi-image-multiple-outline card-header-icon" />
            <span class="card-title">套图管理</span>
          </div>
        </div>
      </template>

      <div class="card-content">
        <!-- 搜索栏 -->
        <div class="search-bar">
          <el-input
            v-model="keyword"
            placeholder="搜索套图名称、描述或关键词"
            clearable
            style="width: 300px"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <i class="mdi mdi-magnify" />
            </template>
          </el-input>
          <el-select
            v-model="statusFilter"
            placeholder="状态筛选"
            clearable
            style="width: 150px"
            @change="handleSearch"
          >
            <el-option
              v-for="option in statusOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <el-button type="primary" @click="handleSearch">
            <i class="mdi mdi-magnify" style="margin-right: 4px" />
            搜索
          </el-button>
        </div>

        <!-- 表格容器 -->
        <div class="table-container">
          <el-table
            :data="dataSource"
            v-loading="loading"
            stripe
            size="small"
            style="width: 100%"
            :default-sort="{ prop: 'createTime', order: 'descending' }"
          >
          <el-table-column prop="id" label="ID" width="120" />
          <el-table-column prop="name" label="套图名称" min-width="200" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusMap[row.status]?.type || 'info'" size="small">
                {{ statusMap[row.status]?.label || row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="processingTime" label="制作耗时" width="140">
            <template #default="{ row }">
              {{ formatProcessingTime(row.processingTime) }}
            </template>
          </el-table-column>
          <el-table-column prop="createTime" label="创建时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.createTime) }}
            </template>
          </el-table-column>
          <el-table-column prop="updateTime" label="更新时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.updateTime) }}
            </template>
          </el-table-column>
          <el-table-column prop="statusMessage" label="错误信息" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.statusMessage || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-dropdown trigger="click" @command="(command) => handleOperationCommand(command, row)">
                <el-button type="primary" link size="small">
                  操作
                  <i class="mdi mdi-chevron-down" style="margin-left: 4px" />
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="mark-pending">
                      <span>标记为待处理</span>
                    </el-dropdown-item>
                    <el-dropdown-item command="mark-processing">
                      <span>标记为处理中</span>
                    </el-dropdown-item>
                    <el-dropdown-item command="mark-completed">
                      <span>标记为已完成</span>
                    </el-dropdown-item>
                    <el-dropdown-item command="mark-failed">
                      <span>标记为失败</span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </el-table-column>
          </el-table>
        </div>

        <!-- 分页 -->
        <div class="pagination-wrapper">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :total="total"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next, jumper"
            size="small"
            @current-change="handlePageChange"
            @size-change="handleSizeChange"
          />
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.psd-set-page {
  width: 100%;
}

.psd-set-card {
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

.search-bar {
  display: flex;
  align-items: center;
  gap: 12px;
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

.sticker-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sticker-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #e5e7eb;
}

.sticker-name {
  font-size: 13px;
  color: #374151;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.template-name {
  font-size: 13px;
  color: #374151;
}

.template-path {
  margin-top: 4px;
}

.generated-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.image-item {
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  min-height: 60px;
  display: flex;
  align-items: center;
}

.image-item:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.generated-image-thumb {
  width: 60px !important;
  height: 60px !important;
  min-width: 60px;
  min-height: 60px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #e5e7eb;
  display: block;
  cursor: pointer;
  background: #f3f4f6;
}

.text-gray {
  color: #9ca3af;
  font-size: 13px;
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
</style>

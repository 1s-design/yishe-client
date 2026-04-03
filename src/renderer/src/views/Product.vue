<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { productApi, type Product } from '../api/product'
import { ElMessage } from 'element-plus'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()

const loading = ref(false)
const dataSource = ref<Product[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const searchText = ref('')
const mediaPublishStatusFilter = ref<string>('')

// 待发布检测相关
const pendingCheckInterval = ref<NodeJS.Timeout | null>(null)
const lastPendingCount = ref(0)

const mediaPublishStatusOptions = [
  { label: '全部', value: '' },
  { label: '待发布', value: 'pending' },
  { label: '发布中', value: 'publishing' },
  { label: '成功', value: 'success' },
  { label: '失败', value: 'failed' }
]

const mediaPublishStatusMap: Record<string, { label: string; type: string }> = {
  pending: { label: '待发布', type: 'info' },
  publishing: { label: '发布中', type: 'warning' },
  success: { label: '成功', type: 'success' },
  failed: { label: '失败', type: 'danger' }
}

const getList = async () => {
  loading.value = true
  try {
    const res = await productApi.getPage({
      currentPage: currentPage.value,
      pageSize: pageSize.value,
      searchText: searchText.value || undefined,
      mediaPublishStatus: mediaPublishStatusFilter.value || undefined,
      includeRelations: false
    })
    
    dataSource.value = res.list || []
    total.value = res.total || 0
  } catch (error: any) {
    console.error('获取商品列表失败:', error)
    ElMessage.error(error?.message || '获取商品列表失败')
    dataSource.value = []
    total.value = 0
  } finally {
    loading.value = false
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

// 获取图片数组，处理可能的 JSON 字符串格式
const getImages = (row: Product): string[] => {
  if (!row.images) return []
  if (Array.isArray(row.images)) {
    return row.images.filter((url: any) => url && typeof url === 'string' && url.trim())
  }
  if (typeof row.images === 'string') {
    try {
      const parsed = JSON.parse(row.images)
      if (Array.isArray(parsed)) {
        return parsed.filter((url: any) => url && typeof url === 'string' && url.trim())
      }
    } catch (e) {
      // 如果不是 JSON，可能是逗号分隔的字符串
      const imageStr = row.images as string
      return imageStr.split(',').map((url: string) => url.trim()).filter((url: string) => url)
    }
  }
  return []
}

// 获取视频数组，处理可能的 JSON 字符串格式
const getVideos = (row: Product): string[] => {
  if (!row.videos) return []
  if (Array.isArray(row.videos)) {
    return row.videos.filter((url: any) => url && typeof url === 'string' && url.trim())
  }
  if (typeof row.videos === 'string') {
    try {
      const parsed = JSON.parse(row.videos)
      if (Array.isArray(parsed)) {
        return parsed.filter((url: any) => url && typeof url === 'string' && url.trim())
      }
    } catch (e) {
      // 如果不是 JSON，可能是逗号分隔的字符串
      const videoStr = row.videos as string
      return videoStr.split(',').map((url: string) => url.trim()).filter((url: string) => url)
    }
  }
  return []
}

const openImage = (url: string) => {
  window.open(url, '_blank')
}

const openVideo = (url: string) => {
  window.open(url, '_blank')
}

// 处理图片加载错误
const handleImageError = (event: Event, url: string) => {
  const img = event.target as HTMLImageElement
  console.error('图片加载失败:', {
    url,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    complete: img.complete
  })
  // 隐藏失败的图片
  img.style.display = 'none'
  // 可选：显示占位图
  // img.src = 'data:image/svg+xml;base64,...'
}

// 社交媒体导出相关
const socialExportVisible = ref(false)
const socialExportText = ref('')
const localExportVisible = ref(false)
const localExportText = ref('')
const convertingLocal = ref(false)

// 查看社交媒体数据结构
const handleViewSocialMediaExport = async (row: Product) => {
  if (!row?.id) return
  try {
    const res = await productApi.getSocialMediaExport(row.id)
    socialExportText.value = JSON.stringify(res, null, 2)
    socialExportVisible.value = true
  } catch (error: any) {
    console.error('获取社交媒体数据失败:', error)
    ElMessage.error(error?.message || '获取社交媒体数据失败')
  }
}

// 复制社交媒体数据
const copySocialExport = async () => {
  if (!socialExportText.value) return
  try {
    await navigator.clipboard.writeText(socialExportText.value)
    ElMessage.success('已复制到剪贴板')
  } catch (error) {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = socialExportText.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    ElMessage.success('已复制到剪贴板')
  }
}

// 检查并下载文件，返回本地路径
const ensureLocalFile = async (url: string): Promise<string> => {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    // 如果不是有效的HTTP URL，直接返回原值
    return url
  }

  try {
    // 先检查文件是否已下载
    const checkResult = await (window.api as any).checkFileDownloaded(url)
    if (checkResult.found && checkResult.filePath) {
      console.log(`文件已存在，跳过下载: ${checkResult.filePath}`)
      return checkResult.filePath
    }

    // 文件不存在，进行下载
    const downloadResult = await (window.api as any).downloadFile(url)
    if (downloadResult.success && downloadResult.filePath) {
      console.log(`文件下载完成: ${downloadResult.filePath}`)
      return downloadResult.filePath
    } else {
      console.warn(`文件下载失败: ${downloadResult.message || '未知错误'}`)
      // 下载失败时返回原URL
      return url
    }
  } catch (error: any) {
    console.error(`处理文件失败 (${url}):`, error)
    // 出错时返回原URL
    return url
  }
}

// 递归转换对象中的URL为本地路径
const convertUrlsToLocal = async (obj: any, processedUrls = new Map<string, string>()): Promise<any> => {
  if (obj === null || obj === undefined) {
    return obj
  }

  // 如果是字符串且是HTTP URL
  if (typeof obj === 'string' && obj.startsWith('http')) {
    // 检查是否已处理过相同的URL
    if (processedUrls.has(obj)) {
      return processedUrls.get(obj)!
    }
    // 下载并缓存结果
    const localPath = await ensureLocalFile(obj)
    processedUrls.set(obj, localPath)
    return localPath
  }

  // 如果是数组
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => convertUrlsToLocal(item, processedUrls)))
  }

  // 如果是对象
  if (typeof obj === 'object') {
    const result: any = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = await convertUrlsToLocal(obj[key], processedUrls)
      }
    }
    return result
  }

  // 其他类型直接返回
  return obj
}

// 获取本地发布数据
const handleGetLocalExport = async (row: Product) => {
  if (!row?.id) return
  
  convertingLocal.value = true
  try {
    // 1. 获取发布数据
    const res = await productApi.getSocialMediaExport(row.id)
    
    // 2. 转换URL为本地路径
    const localData = await convertUrlsToLocal(res)
    
    // 3. 显示结果
    localExportText.value = JSON.stringify(localData, null, 2)
    localExportVisible.value = true
    ElMessage.success('本地发布数据已生成')
  } catch (error: any) {
    console.error('获取本地发布数据失败:', error)
    ElMessage.error(error?.message || '获取本地发布数据失败')
  } finally {
    convertingLocal.value = false
  }
}

// 复制本地发布数据
const copyLocalExport = async () => {
  if (!localExportText.value) return
  try {
    await navigator.clipboard.writeText(localExportText.value)
    ElMessage.success('已复制到剪贴板')
  } catch (error) {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = localExportText.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    ElMessage.success('已复制到剪贴板')
  }
}

// 处理操作命令
const handleOperationCommand = (command: string, row: Product) => {
  switch (command) {
    case 'view-social-media':
      handleViewSocialMediaExport(row)
      break
    case 'get-local-data':
      handleGetLocalExport(row)
      break
    default:
      console.warn('未知的操作命令:', command)
  }
}

// 检查待发布的商品数量并刷新列表
const checkPendingCount = async () => {
  try {
    // 刷新主列表以同步状态
    getList()
    
    const res = await productApi.getPage({
      currentPage: 1,
      pageSize: 1,
      mediaPublishStatus: 'pending',
      includeRelations: false
    })

    const pendingCount = res.total || 0

    if (pendingCount > 0 && pendingCount !== lastPendingCount.value) {
      lastPendingCount.value = pendingCount
      showToast({
        color: 'warning',
        icon: 'mdi-alert-outline',
        message: `您有 ${pendingCount} 个商品待发布到社交媒体`,
        duration: 5000
      })
    } else if (pendingCount === 0) {
      lastPendingCount.value = 0
    }
  } catch (error: any) {
    console.error('检查待发布商品数量失败:', error)
  }
}

// 启动定期检测
const startPendingCheck = () => {
  checkPendingCount()
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

// 修改社交媒体发布状态
const handleUpdateMediaPublishStatus = async (row: Product, status: string) => {
  try {
    await productApi.update(row.id, { mediaPublishStatus: status as any })
    ElMessage.success('社交媒体发布状态已更新')
    getList()
  } catch (error: any) {
    ElMessage.error(error?.message || '状态更新失败')
  }
}

onMounted(() => {
  getList()
  startPendingCheck()
})

onUnmounted(() => {
  stopPendingCheck()
})
</script>

<template>
  <div class="product-page">
    <el-card class="product-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <div class="card-header-left">
            <i class="mdi mdi-package-variant card-header-icon" />
            <span class="card-title">商品管理</span>
          </div>
        </div>
      </template>

      <div class="card-content">
        <!-- 搜索栏 -->
        <div class="search-bar">
          <el-input
            v-model="searchText"
            placeholder="搜索商品名称、描述或关键词"
            clearable
            style="width: 300px"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <i class="mdi mdi-magnify" />
            </template>
          </el-input>
          <el-select
            v-model="mediaPublishStatusFilter"
            placeholder="社交媒体发布状态"
            clearable
            style="width: 180px"
            @change="handleSearch"
          >
            <el-option
              v-for="option in mediaPublishStatusOptions"
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
          <el-table-column prop="name" label="标题" min-width="200" show-overflow-tooltip />
          <el-table-column prop="description" label="描述" min-width="250" show-overflow-tooltip />
          <el-table-column prop="keywords" label="关键字" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.keywords">{{ row.keywords }}</span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column prop="mediaPublishStatus" label="社交媒体发布状态" width="150">
            <template #default="{ row }">
              <el-tag 
                :type="mediaPublishStatusMap[row.mediaPublishStatus || 'pending']?.type || 'info'" 
                size="small"
              >
                {{ mediaPublishStatusMap[row.mediaPublishStatus || 'pending']?.label || '待发布' }}
              </el-tag>
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
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-dropdown trigger="click" @command="(command) => handleOperationCommand(command, row)">
                <el-button type="primary" link size="small">
                  操作
                  <i class="mdi mdi-chevron-down" style="margin-left: 4px" />
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="view-social-media">
                      <span>查看发布数据</span>
                    </el-dropdown-item>
                    <el-dropdown-item 
                      command="get-local-data"
                      :disabled="convertingLocal"
                    >
                      <span>{{ convertingLocal ? '转换中...' : '获取本地数据' }}</span>
                    </el-dropdown-item>
                    <el-dropdown-item divided @click="handleUpdateMediaPublishStatus(row, 'pending')">标记为待发布</el-dropdown-item>
                    <el-dropdown-item @click="handleUpdateMediaPublishStatus(row, 'publishing')">标记为发布中</el-dropdown-item>
                    <el-dropdown-item @click="handleUpdateMediaPublishStatus(row, 'success')">标记为成功</el-dropdown-item>
                    <el-dropdown-item @click="handleUpdateMediaPublishStatus(row, 'failed')">标记为失败</el-dropdown-item>
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

    <!-- 社交媒体发布数据弹窗 -->
    <el-dialog
      v-model="socialExportVisible"
      title="社交媒体发布数据"
      width="60%"
      :close-on-click-modal="true"
      align-center
    >
      <div class="p-4 max-w-5xl mx-auto">
        <el-input v-model="socialExportText" type="textarea" :rows="18" readonly />
      </div>
      <template #footer>
        <el-button @click="socialExportVisible = false">关闭</el-button>
        <el-button type="primary" @click="copySocialExport" :disabled="!socialExportText">复制JSON</el-button>
      </template>
    </el-dialog>

    <!-- 本地发布数据弹窗 -->
    <el-dialog
      v-model="localExportVisible"
      title="本地发布数据（已转换为本地路径）"
      width="60%"
      :close-on-click-modal="true"
      align-center
    >
      <div class="p-4 max-w-5xl mx-auto">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="mb-3"
        >
          <template #title>
            <span>所有在线文件已下载到本地，URL已替换为本地文件路径。相同链接的文件不会重复下载。</span>
          </template>
        </el-alert>
        <el-input v-model="localExportText" type="textarea" :rows="18" readonly />
      </div>
      <template #footer>
        <el-button @click="localExportVisible = false">关闭</el-button>
        <el-button type="primary" @click="copyLocalExport" :disabled="!localExportText">复制JSON</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.product-page {
  width: 100%;
}

.product-card {
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

.search-bar {
  display: flex;
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

.product-images {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.image-item {
  cursor: pointer;
  transition: transform 0.2s;
}

.image-item:hover {
  transform: scale(1.05);
}

.product-image-thumb {
  width: 60px !important;
  height: 60px !important;
  min-width: 60px;
  min-height: 60px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #e5e7eb;
  display: block;
  background: #f3f4f6;
  cursor: pointer;
}

.image-more {
  font-size: 12px;
  color: #6b7280;
  padding: 4px 8px;
  background: #f3f4f6;
  border-radius: 4px;
}

.product-videos {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.video-item {
  cursor: pointer;
  transition: transform 0.2s;
}

.video-item:hover {
  transform: scale(1.05);
}

.video-thumb-wrapper {
  position: relative;
  width: 60px;
  height: 60px;
  min-width: 60px;
  min-height: 60px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.product-video-thumb {
  width: 60px !important;
  height: 60px !important;
  object-fit: cover;
  display: block;
  cursor: pointer;
}

.video-play-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #ffffff;
  font-size: 24px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  z-index: 1;
}

.video-more {
  font-size: 12px;
  color: #6b7280;
  padding: 4px 8px;
  background: #f3f4f6;
  border-radius: 4px;
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

.text-gray {
  color: #9ca3af;
  font-size: 13px;
}
</style>


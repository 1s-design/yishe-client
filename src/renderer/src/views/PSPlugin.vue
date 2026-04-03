<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useToast } from '../composables/useToast'
import photoshopApi, { type PhotoshopStatusResponse } from '../api/photoshop'

const { showToast } = useToast()

type ServiceStatus = 'running' | 'stopped' | 'error'

const loading = ref(false)
const serviceStatus = ref<ServiceStatus>('stopped')
const serviceInfo = ref<{
  status: string
  version: string
  timestamp: string
} | null>(null)

// Photoshop 状态相关
const checkingPsStatus = ref(false)
const psStatus = ref<PhotoshopStatusResponse | null>(null)
const testConnection = ref(false)
const startingPs = ref(false)
const stoppingPs = ref(false)
const restartingPs = ref(false)

const statusMap: Record<
  ServiceStatus,
  { label: string; type: 'success' | 'warning' | 'danger' | 'info'; color: string }
> = {
  running: { label: '运行中', type: 'success', color: '#22c55e' },
  error: { label: '异常', type: 'danger', color: '#ef4444' },
  stopped: { label: '未运行', type: 'info', color: '#94a3b8' }
}

// 通过 HTTP 接口检测服务状态
async function fetchServiceStatus(silent = false) {
  if (!silent) {
    loading.value = true
  }
  try {
    const health = await photoshopApi.checkHealth()
    serviceInfo.value = health
    serviceStatus.value = 'running'
  } catch (error: any) {
    serviceStatus.value = 'error'
    serviceInfo.value = null
    if (!silent) {
      // 如果是网络错误（服务未运行），设置为 stopped 状态
      if (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error')) {
        serviceStatus.value = 'stopped'
      } else {
        showToast({
          color: 'error',
          icon: 'mdi-alert-circle-outline',
          message: error?.message || '检测服务状态失败'
        })
      }
    }
  } finally {
    if (!silent) {
      loading.value = false
    }
  }
}


// Photoshop 状态检测
async function checkPhotoshopStatus() {
  checkingPsStatus.value = true
  try {
    const status = await photoshopApi.checkPhotoshopStatus(testConnection.value)
    psStatus.value = status
    if (status.is_available) {
      showToast({
        color: 'success',
        icon: 'mdi-check-circle',
        message: 'Photoshop 连接正常'
      })
    } else {
      showToast({
        color: 'warning',
        icon: 'mdi-alert-outline',
        message: 'Photoshop 不可用，请检查是否已启动'
      })
    }
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: error?.message || '检测 Photoshop 状态失败'
    })
    psStatus.value = null
  } finally {
    checkingPsStatus.value = false
  }
}

// 启动 Photoshop
async function startPhotoshop() {
  startingPs.value = true
  try {
    const result = await photoshopApi.startPhotoshop(30)
    showToast({
      color: 'success',
      icon: 'mdi-check-circle',
      message: result.message || 'Photoshop 启动成功'
    })
    setTimeout(() => {
      checkPhotoshopStatus()
    }, 2000)
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: error?.message || '启动 Photoshop 失败'
    })
  } finally {
    startingPs.value = false
  }
}

// 关闭 Photoshop
async function stopPhotoshop() {
  try {
    await ElMessageBox.confirm('确认关闭 Photoshop 吗？', '确认操作', {
      confirmButtonText: '关闭',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  stoppingPs.value = true
  try {
    const result = await photoshopApi.stopPhotoshop(false)
    showToast({
      color: 'success',
      icon: 'mdi-check-circle',
      message: result.message || 'Photoshop 已关闭'
    })
    setTimeout(() => {
      checkPhotoshopStatus()
    }, 1000)
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: error?.message || '关闭 Photoshop 失败'
    })
  } finally {
    stoppingPs.value = false
  }
}

// 重启 Photoshop
async function restartPhotoshop() {
  try {
    await ElMessageBox.confirm('确认重启 Photoshop 吗？重启将关闭当前 Photoshop 并重新启动。', '确认操作', {
      confirmButtonText: '重启',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  restartingPs.value = true
  try {
    const result = await photoshopApi.restartPhotoshop(30)
    showToast({
      color: 'success',
      icon: 'mdi-check-circle',
      message: result.message || 'Photoshop 重启成功'
    })
    setTimeout(() => {
      checkPhotoshopStatus()
    }, 3000)
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: error?.message || '重启 Photoshop 失败'
    })
  } finally {
    restartingPs.value = false
  }
}

function openPsControlTool() {
  window.open('http://localhost:1595', '_blank')
}

onMounted(() => {
  fetchServiceStatus()
  const interval = setInterval(fetchServiceStatus, 3000)
  onUnmounted(() => {
    clearInterval(interval)
  })
})
</script>

<template>
  <div class="psplugin-page">
    <div class="page-hero">
      <div class="hero-copy">
        <div class="eyebrow">Photoshop 工具</div>
        <h2 class="hero-title">Photoshop 工具管理</h2>
        <p class="hero-desc">
          PS 工具服务由外部独立管理，客户端仅检测服务状态。推荐操作流程：① 确认 <strong>PS 工具服务</strong> 运行中 → ② 检测 / 启动 <strong>Photoshop</strong> →
          ③ 打开 <strong>控制页面</strong> 做进一步调试。
        </p>
      </div>
      <div class="hero-badge">
        <i class="mdi mdi-puzzle-outline"></i>
        <div class="badge-meta">
          <span class="badge-label">服务状态</span>
          <span class="badge-value" :style="{ color: statusMap[serviceStatus]?.color }">
            {{ statusMap[serviceStatus]?.label || serviceStatus }}
          </span>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="grid-row grid-cards">
        <!-- 1. PS 工具服务状态 -->
        <el-card class="panel" shadow="never" v-loading="loading">
          <div class="panel-head">
            <div class="panel-title">
              <i class="mdi mdi-cog-outline"></i>
              服务状态
            </div>
          </div>

          <div class="process-info">
            <div class="field-row">
              <div class="field">
                <div class="field-label">运行状态</div>
                <div class="field-value">
                  <el-tag
                    :type="statusMap[serviceStatus]?.type || 'info'"
                    effect="plain"
                  >
                    <i :class="['mdi', serviceStatus === 'running' ? 'mdi-check-circle' : 'mdi-circle-outline', 'mr-1']"></i>
                    {{ statusMap[serviceStatus]?.label || serviceStatus }}
                  </el-tag>
                </div>
              </div>
              <div class="field" v-if="serviceInfo">
                <div class="field-label">版本</div>
                <div class="field-value">
                  <el-tag type="info">
                    {{ serviceInfo.version }}
                  </el-tag>
                </div>
              </div>
            </div>

            <div class="actions">
              <el-button
                :loading="loading"
                @click="fetchServiceStatus"
              >
                <i class="mdi mdi-refresh mr-1"></i>
                刷新状态
              </el-button>
            </div>

            <ul class="tips">
              <li>PS 工具服务由外部独立管理，客户端仅检测服务状态。</li>
              <li>如果状态为 "未运行"，请确保已在外部启动 ps.exe 服务（默认端口：1595）。</li>
              <li>服务启动后，再进行下方 Photoshop 检测与操作。</li>
            </ul>
          </div>
        </el-card>

        <!-- 2. Photoshop 连接与控制 -->
        <el-card class="panel" shadow="never">
          <div class="panel-head">
            <div class="panel-title">
              <i class="mdi mdi-adobe"></i>
              Photoshop 状态
            </div>
          </div>

          <div class="actions">
            <el-button
              type="primary"
              :loading="checkingPsStatus"
              @click="checkPhotoshopStatus"
            >
              <i class="mdi mdi-check-circle mr-1"></i>
              ① 检测连接
            </el-button>
            <el-button
              type="success"
              :loading="startingPs"
              @click="startPhotoshop"
            >
              <i class="mdi mdi-play mr-1"></i>
              ② 启动 Photoshop
            </el-button>
            <el-button
              type="warning"
              :loading="stoppingPs"
              @click="stopPhotoshop"
            >
              <i class="mdi mdi-stop mr-1"></i>
              关闭 Photoshop
            </el-button>
            <el-button
              type="info"
              :loading="restartingPs"
              @click="restartPhotoshop"
            >
              <i class="mdi mdi-restart mr-1"></i>
              重启 Photoshop
            </el-button>
          </div>

          <el-checkbox v-model="testConnection" class="checkbox-field">
            深度检测
          </el-checkbox>

          <div v-if="psStatus" class="status-info">
            <div class="field-row">
              <div class="field">
                <div class="field-label">运行</div>
                <div class="field-value">
                  <el-tag :type="psStatus.is_running ? 'success' : 'danger'" effect="plain">
                    {{ psStatus.is_running ? '运行中' : '未运行' }}
                  </el-tag>
                </div>
              </div>
              <div class="field">
                <div class="field-label">可用</div>
                <div class="field-value">
                  <el-tag :type="psStatus.is_available ? 'success' : 'warning'" effect="plain">
                    {{ psStatus.is_available ? '可用' : '不可用' }}
                  </el-tag>
                </div>
              </div>
              <div class="field">
                <div class="field-label">COM</div>
                <div class="field-value">
                  <el-tag :type="psStatus.com_registered ? 'success' : 'danger'">
                    {{ psStatus.com_registered ? '已注册' : '未注册' }}
                  </el-tag>
                </div>
              </div>
            </div>
            <div v-if="psStatus.connection_test" class="field">
              <div class="field-label">连接测试</div>
              <div class="field-value">
                <el-tag :type="psStatus.connection_test.success ? 'success' : 'danger'">
                  {{ psStatus.connection_test.success ? '成功' : '失败' }}
                </el-tag>
                <span v-if="psStatus.connection_test.version" class="muted ml-2">
                  v{{ psStatus.connection_test.version }}
                </span>
              </div>
            </div>
          </div>
        </el-card>
        <!-- 3. 控制台入口 -->
        <el-card class="panel" shadow="never">
          <div class="panel-head">
            <div class="panel-title">
              <i class="mdi mdi-open-in-new"></i>
              PS 控制工具
            </div>
          </div>

          <p class="muted" style="margin: 0 0 8px 0;">
            打开本地 Photoshop 控制工具页面（http://localhost:1595）。
          </p>

          <div class="actions">
            <el-button type="primary" @click="openPsControlTool">
              <i class="mdi mdi-open-in-new mr-1"></i>
              打开控制页面
            </el-button>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.psplugin-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.page-hero {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 12px;
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 70%;
}

.eyebrow {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6366f1;
  font-weight: 700;
}

.hero-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.hero-desc {
  margin: 0;
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
}

.hero-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(79, 70, 229, 0.08));
  color: #1f2937;
  min-width: 180px;
  justify-content: flex-start;
}

.hero-badge i {
  font-size: 20px;
  color: #4f46e5;
}

.badge-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.badge-label {
  font-size: 12px;
  color: #6366f1;
  font-weight: 600;
}

.badge-value {
  font-size: 13px;
  color: #0f172a;
  font-weight: 600;
}

.grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}

.grid-row {
  display: grid;
  grid-template-columns: 1fr; /* 每个模块单独占一行 */
  gap: 12px;
}

.grid-cards {
  align-items: stretch;
}

.panel {
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: #ffffff;
}

.panel :deep(.el-card__body) {
  padding: 12px;
}

.subtle {
  background: #ffffff;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #111827;
  font-size: 15px;
}

.panel-title i {
  color: #4f46e5;
  font-size: 18px;
}

.process-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.field-label {
  font-size: 13px;
  color: #64748b;
  letter-spacing: 0.01em;
  font-weight: 500;
}

.field-value {
  font-size: 14px;
  color: #111827;
  font-weight: 500;
}

.field-value.code {
  font-family: 'Courier New', monospace;
  background: #f1f5f9;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  font-size: 13px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.mr-1 {
  margin-right: 4px;
}

.muted {
  color: #94a3b8;
}

.empty-state {
  padding: 24px 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.empty-state i {
  font-size: 36px;
  color: #cbd5e1;
}

.tips {
  margin: 0;
  padding-left: 18px;
  color: #475569;
  line-height: 1.6;
  font-size: 14px;
}

.tips li {
  margin-bottom: 8px;
}

.checkbox-field {
  margin-top: 6px;
  margin-bottom: 6px;
}

.status-info {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
}

.ml-2 {
  margin-left: 8px;
}

.analysis-result {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
}

.smart-objects-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.smart-object-item {
  padding: 8px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 6px;
}

.so-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-weight: 600;
}

.so-details {
  font-size: 13px;
  color: #64748b;
  line-height: 1.6;
}

.process-result {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
}

.flat-alert {
  border-radius: 6px;
}

.nested-card {
  margin-top: 6px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.nested-card :deep(.el-card__body) {
  padding: 10px;
}

.smart-object-config-item {
  margin-bottom: 8px;
}

.so-config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 14px;
  color: #111827;
  font-weight: 600;
}

.field-hint {
  font-size: 12px;
  color: #64748b;
  font-weight: normal;
  margin-left: 4px;
}

@media (max-width: 1100px) {
  .hero-copy {
    max-width: 100%;
  }
  
  .page-hero {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  
  .hero-badge {
    width: 100%;
  }
}
</style>


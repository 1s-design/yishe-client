<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()

type ServiceStatus = 'running' | 'stopped' | 'checking'

const loading = ref(false)
const acting = ref(false)
const serviceStatus = ref<ServiceStatus>('stopped')
const serviceAvailable = ref(false)
const servicePort = ref(1519)

const statusMap: Record<
  'running' | 'stopped',
  { label: string; type: 'success' | 'danger' | 'warning'; color: string; icon: string }
> = {
  running: { label: '运行中', type: 'success', color: '#22c55e', icon: 'mdi-check-circle' },
  stopped: { label: '未运行', type: 'danger', color: '#ef4444', icon: 'mdi-circle-outline' }
}

async function checkServiceStatus(silent = false) {
  if (!silent) {
    loading.value = true
  }
  try {
    const status = await window.api.checkLocalServiceStatus()
    serviceStatus.value = status.running ? 'running' : 'stopped'
    serviceAvailable.value = status.available
    servicePort.value = status.port
  } catch (error: any) {
    if (!silent) {
      showToast({
        color: 'error',
        icon: 'mdi-alert-circle-outline',
        message: error?.message || '检查服务状态失败'
      })
    }
    serviceStatus.value = 'stopped'
    serviceAvailable.value = false
  } finally {
    if (!silent) {
      loading.value = false
    }
  }
}

async function startService() {
  acting.value = true
  try {
    const result = await window.api.startLocalService()
    if (result.success) {
      showToast({
        color: 'success',
        icon: 'mdi-check-circle',
        message: result.message || '本地服务启动成功'
      })
      // 等待服务启动后检查状态
      setTimeout(() => {
        checkServiceStatus()
      }, 1000)
    } else {
      showToast({
        color: 'error',
        icon: 'mdi-alert-circle-outline',
        message: result.message || '启动服务失败'
      })
    }
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: error?.message || '启动服务失败'
    })
  } finally {
    acting.value = false
  }
}

async function stopService() {
  try {
    await ElMessageBox.confirm('确认停止本地服务吗？停止后端口 1519 将无法访问。', '确认操作', {
      confirmButtonText: '停止',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  acting.value = true
  try {
    const result = await window.api.stopLocalService()
    if (result.success) {
      showToast({
        color: 'success',
        icon: 'mdi-check-circle',
        message: result.message || '本地服务已停止'
      })
    } else {
      showToast({
        color: 'error',
        icon: 'mdi-alert-circle-outline',
        message: result.message || '停止服务失败'
      })
    }
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: error?.message || '停止服务失败'
    })
  } finally {
    acting.value = false
    setTimeout(() => {
      checkServiceStatus()
    }, 500)
  }
}

function openServiceUrl() {
  window.open(`http://localhost:${servicePort.value}`, '_blank')
}

function openApiDocs() {
  window.open(`http://localhost:${servicePort.value}/api-docs`, '_blank')
}

onMounted(() => {
  checkServiceStatus()
  const interval = setInterval(() => checkServiceStatus(true), 3000)
  onUnmounted(() => {
    clearInterval(interval)
  })
})
</script>

<template>
  <div class="local-service-page">
    <div class="page-hero">
      <div class="hero-copy">
        <div class="eyebrow">本地服务</div>
        <h2 class="hero-title">本地服务管理</h2>
        <p class="hero-desc">
          管理运行在 <strong>1519 端口</strong> 的本地服务，提供 API 接口和 WebSocket 连接功能。
        </p>
      </div>
      <div class="hero-badge" v-if="serviceStatus !== 'checking'">
        <i class="mdi mdi-server-network"></i>
        <div class="badge-meta">
          <span class="badge-label">服务状态</span>
          <span class="badge-value" :style="{ color: statusMap[serviceStatus]?.color }">
            {{ statusMap[serviceStatus]?.label }}
          </span>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="grid-row grid-cards">
        <!-- 服务控制卡片 -->
        <el-card class="panel" shadow="never" v-loading="loading">
          <div class="panel-head">
            <div class="panel-title">
              <i class="mdi mdi-cog-outline"></i>
              服务控制
            </div>
          </div>

          <div class="service-info">
            <div class="field-row">
              <div class="field">
                <div class="field-label">运行状态</div>
                <div class="field-value">
                  <el-tag
                    :type="statusMap[serviceStatus]?.type || 'info'"
                    effect="plain"
                  >
                    <i :class="['mdi', statusMap[serviceStatus]?.icon, 'mr-1']"></i>
                    {{ statusMap[serviceStatus]?.label }}
                  </el-tag>
                  <el-tag
                    v-if="serviceStatus === 'running' && serviceAvailable"
                    type="success"
                    effect="plain"
                    class="ml-2"
                  >
                    <i class="mdi mdi-check-circle mr-1"></i>
                    可用
                  </el-tag>
                  <el-tag
                    v-else-if="serviceStatus === 'running' && !serviceAvailable"
                    type="warning"
                    effect="plain"
                    class="ml-2"
                  >
                    <i class="mdi mdi-alert-outline mr-1"></i>
                    不可用
                  </el-tag>
                </div>
              </div>
              <div class="field">
                <div class="field-label">服务端口</div>
                <div class="field-value">
                  <code>{{ servicePort }}</code>
                </div>
              </div>
            </div>

            <div class="actions">
              <el-button
                v-if="serviceStatus !== 'running'"
                type="primary"
                :loading="acting"
                @click="startService"
                size="default"
              >
                <i class="mdi mdi-play mr-1"></i>
                启动服务
              </el-button>
              <el-button
                v-else
                type="danger"
                :loading="acting"
                @click="stopService"
                size="default"
              >
                <i class="mdi mdi-stop mr-1"></i>
                停止服务
              </el-button>
              <el-button
                :loading="loading"
                @click="checkServiceStatus"
                size="default"
              >
                <i class="mdi mdi-refresh mr-1"></i>
                刷新状态
              </el-button>
            </div>

            <div class="tips">
              <div class="tip-item">
                <i class="mdi mdi-information-outline tip-icon"></i>
                <span>服务启动后，可以通过 <code>http://localhost:{{ servicePort }}</code> 访问服务。</span>
              </div>
              <div class="tip-item">
                <i class="mdi mdi-refresh tip-icon"></i>
                <span>服务状态每 3 秒自动刷新一次，也可以手动点击刷新按钮。</span>
              </div>
              <div class="tip-item">
                <i class="mdi mdi-alert-circle-outline tip-icon"></i>
                <span>如果服务显示"运行中"但"不可用"，请检查端口是否被占用或服务是否正常响应。</span>
              </div>
            </div>
          </div>
        </el-card>

        <!-- 快捷操作卡片 -->
        <el-card class="panel" shadow="never">
          <div class="panel-head">
            <div class="panel-title">
              <i class="mdi mdi-link-variant"></i>
              快捷操作
            </div>
          </div>

          <div class="actions">
            <el-button
              type="primary"
              :disabled="serviceStatus !== 'running'"
              @click="openServiceUrl"
              size="default"
            >
              <i class="mdi mdi-open-in-new mr-1"></i>
              打开服务首页
            </el-button>
            <el-button
              type="success"
              :disabled="serviceStatus !== 'running'"
              @click="openApiDocs"
              size="default"
            >
              <i class="mdi mdi-book-open-variant mr-1"></i>
              打开 API 文档
            </el-button>
          </div>

          <div class="service-urls">
            <div class="url-item" @click="openServiceUrl" :class="{ disabled: serviceStatus !== 'running' }">
              <div class="url-icon">
                <i class="mdi mdi-web"></i>
              </div>
              <div class="url-content">
                <div class="url-label">服务地址</div>
                <div class="url-value">http://localhost:{{ servicePort }}</div>
              </div>
              <div class="url-action">
                <i class="mdi mdi-open-in-new"></i>
              </div>
            </div>
            <div class="url-item" @click="openApiDocs" :class="{ disabled: serviceStatus !== 'running' }">
              <div class="url-icon">
                <i class="mdi mdi-book-open-page-variant"></i>
              </div>
              <div class="url-content">
                <div class="url-label">API 文档</div>
                <div class="url-value">http://localhost:{{ servicePort }}/api-docs</div>
              </div>
              <div class="url-action">
                <i class="mdi mdi-open-in-new"></i>
              </div>
            </div>
            <div class="url-item">
              <div class="url-icon">
                <i class="mdi mdi-heart-pulse"></i>
              </div>
              <div class="url-content">
                <div class="url-label">健康检查</div>
                <div class="url-value">http://localhost:{{ servicePort }}/api/health</div>
              </div>
            </div>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.local-service-page {
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
  grid-template-columns: 1fr;
  gap: 12px;
}

.grid-cards {
  align-items: stretch;
}

.panel {
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: #ffffff;
  transition: all 0.2s ease;
}

.panel:hover {
  border-color: rgba(15, 23, 42, 0.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}

.panel :deep(.el-card__body) {
  padding: 12px;
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

.service-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.field-value {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.field-value code {
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0;
}

.tips {
  margin-top: 12px;
  padding: 12px;
  background: rgba(99, 102, 241, 0.04);
  border-left: 3px solid #6366f1;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tip-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: #475569;
  line-height: 1.6;
}

.tip-icon {
  color: #6366f1;
  font-size: 16px;
  margin-top: 2px;
  flex-shrink: 0;
}

.tips code {
  background: rgba(99, 102, 241, 0.15);
  color: #4f46e5;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.service-urls {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.url-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: rgba(15, 23, 42, 0.02);
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.url-item:hover:not(.disabled) {
  background: rgba(99, 102, 241, 0.05);
  border-color: rgba(99, 102, 241, 0.2);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.1);
}

.url-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.url-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(79, 70, 229, 0.05));
  border-radius: 8px;
  flex-shrink: 0;
}

.url-icon i {
  font-size: 20px;
  color: #6366f1;
}

.url-content {
  flex: 1;
  min-width: 0;
}

.url-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.url-value {
  font-size: 13px;
  font-weight: 500;
  color: #0f172a;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  word-break: break-all;
}

.url-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #94a3b8;
  flex-shrink: 0;
  transition: color 0.2s ease;
}

.url-item:hover:not(.disabled) .url-action {
  color: #6366f1;
}

.mr-1 {
  margin-right: 4px;
}

.ml-2 {
  margin-left: 8px;
}

:deep(.el-button) {
  text-transform: none;
  font-weight: 500;
}

:deep(.el-button i) {
  font-size: 16px;
}

:deep(.el-tag) {
  border-radius: 6px;
  font-weight: 500;
  font-size: 12px;
}
</style>


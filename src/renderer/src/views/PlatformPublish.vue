<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { checkUploaderStatus, getUploaderBrowserStatus, connectUploaderBrowser, closeUploaderBrowser, isUploaderBrowserReady } from '../api/uploader'
import type { UploaderStatus, UploaderBrowserStatus } from '../api/uploader'
import {
  getCrawlerStatus,
  getCrawlerProgress,
  startCrawlerSchedule,
  stopCrawlerSchedule,
  updateCrawlerConfig,
  manualCollect,
  type CrawlerStatusMap,
  type CrawlerProgressMap,
  type CrawlerConfig,
  type CollectResult
} from '../api/crawler'
import { UPLOADER_API_BASE } from '../config/api'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()

const loading = ref(false)
const connectingBrowser = ref(false)
const closingBrowser = ref(false)
const uploaderStatus = ref<UploaderStatus>({ connected: false })
const browserStatus = ref<UploaderBrowserStatus | null>(null)
const pollInterval = ref<ReturnType<typeof setInterval> | null>(null)
const POLL_INTERVAL_MS = 3000
const headlessMode = ref(false) // 无头模式开关
const activeTab = ref('connection') // 当前标签页
const lastServiceConnected = ref(false)
const lastBrowserReady = ref(false)

const crawlerSites = [
  { key: 'sora', label: 'OpenAI Sora' },
  { key: 'pinterest', label: 'Pinterest' },
] as const

type SiteKey = (typeof crawlerSites)[number]['key']

const CRAWLER_CONFIG_STORAGE_KEY = 'crawler.configs.v1'

function buildDefaultConfig(site: SiteKey): CrawlerConfig {
  return {
    site,
    maxImages: 20,
    interval: 3600000,
    category: 'crawler',
    isPublic: false,
  }
}

function loadLocalConfigs(): Record<SiteKey, CrawlerConfig> {
  const defaults: Record<SiteKey, CrawlerConfig> = {
    sora: buildDefaultConfig('sora'),
    pinterest: buildDefaultConfig('pinterest'),
  }

  try {
    const raw = localStorage.getItem(CRAWLER_CONFIG_STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<Record<SiteKey, CrawlerConfig>>
    return {
      sora: { ...defaults.sora, ...parsed.sora, site: 'sora' },
      pinterest: { ...defaults.pinterest, ...parsed.pinterest, site: 'pinterest' },
    }
  } catch {
    return defaults
  }
}

function saveLocalConfigs(configs: Record<SiteKey, CrawlerConfig>) {
  localStorage.setItem(CRAWLER_CONFIG_STORAGE_KEY, JSON.stringify(configs))
}

const crawlerConfigs = ref<Record<SiteKey, CrawlerConfig>>(loadLocalConfigs())

watch(
  crawlerConfigs,
  (value) => {
    saveLocalConfigs(value)
  },
  { deep: true }
)

const crawlerStatusMap = ref<CrawlerStatusMap>({
  sora: { enabled: false, isRunning: false, config: crawlerConfigs.value.sora },
  pinterest: { enabled: false, isRunning: false, config: crawlerConfigs.value.pinterest },
})

const crawlerProgressMap = ref<CrawlerProgressMap>({
  sora: {
    site: 'sora',
    running: false,
    stage: 'idle',
    startedAt: null,
    finishedAt: null,
    total: 0,
    current: 0,
    successCount: 0,
    failCount: 0,
    logs: [],
  },
  pinterest: {
    site: 'pinterest',
    running: false,
    stage: 'idle',
    startedAt: null,
    finishedAt: null,
    total: 0,
    current: 0,
    successCount: 0,
    failCount: 0,
    logs: [],
  },
})

const crawlerListRows = computed(() => {
  return crawlerSites.map(site => ({
    key: site.key,
    label: site.label,
    isRunning: crawlerStatusMap.value[site.key]?.isRunning ?? false,
    maxImages: crawlerConfigs.value[site.key].maxImages,
    interval: crawlerConfigs.value[site.key].interval,
    category: crawlerConfigs.value[site.key].category || 'crawler',
    isPublic: crawlerConfigs.value[site.key].isPublic,
    stage: crawlerProgressMap.value[site.key]?.stage || 'idle',
    current: crawlerProgressMap.value[site.key]?.current || 0,
    total: crawlerProgressMap.value[site.key]?.total || 0,
    successCount: crawlerProgressMap.value[site.key]?.successCount || 0,
    failCount: crawlerProgressMap.value[site.key]?.failCount || 0,
    lastError: crawlerProgressMap.value[site.key]?.lastError,
    latestMessage: crawlerProgressMap.value[site.key]?.logs?.length
      ? crawlerProgressMap.value[site.key].logs[crawlerProgressMap.value[site.key].logs.length - 1].message
      : '暂无进度消息',
  }))
})

const configDialogVisible = ref(false)
const editingSite = ref<SiteKey | null>(null)
const editingConfig = ref<CrawlerConfig>(buildDefaultConfig('sora'))

const crawlerLoading = ref<Record<SiteKey, { starting: boolean; stopping: boolean; collecting: boolean; updating: boolean; refreshing: boolean }>>({
  sora: { starting: false, stopping: false, collecting: false, updating: false, refreshing: false },
  pinterest: { starting: false, stopping: false, collecting: false, updating: false, refreshing: false },
})

const lastCrawlerResultMap = ref<Record<SiteKey, CollectResult | null>>({
  sora: null,
  pinterest: null,
})

const crawlerRefreshing = computed(() =>
  crawlerSites.some(site => crawlerLoading.value[site.key].refreshing)
)

let crawlerRefreshTimer: ReturnType<typeof setInterval> | null = null

const browserReady = computed(() => {
  const br = browserStatus.value
  return isUploaderBrowserReady(br)
})

const fullyReady = computed(() => uploaderStatus.value.connected && browserReady.value)

// 格式化时间间隔
function formatInterval(ms: number): string {
  const seconds = ms / 1000
  const minutes = seconds / 60
  const hours = minutes / 60
  const days = hours / 24

  if (days >= 1) {
    return `${days.toFixed(1)} 天`
  } else if (hours >= 1) {
    return `${hours.toFixed(1)} 小时`
  } else if (minutes >= 1) {
    return `${minutes.toFixed(0)} 分钟`
  } else {
    return `${seconds.toFixed(0)} 秒`
  }
}

async function refreshStatus(silent = false) {
  if (!silent) loading.value = true
  try {
    const status = await checkUploaderStatus()
    uploaderStatus.value = status
    if (status.connected) {
      const br = await getUploaderBrowserStatus()
      browserStatus.value = br.success && br.data ? br.data : null
    } else {
      browserStatus.value = null
    }
  } catch (e: unknown) {
    const err = e as Error
    if (!silent) {
      showToast({
        color: 'error',
        icon: 'mdi-alert-circle-outline',
        message: err?.message ?? '检测失败'
      })
    }
    uploaderStatus.value = { connected: false, message: err?.message ?? '检测失败' }
    browserStatus.value = null
  } finally {
    if (!silent) loading.value = false
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    refreshStatus(true)
  }
}

async function connectBrowser() {
  if (!uploaderStatus.value.connected || connectingBrowser.value) return
  connectingBrowser.value = true
  try {
    const res = await connectUploaderBrowser({ headless: headlessMode.value })
    if (res.success) {
      showToast({
        color: 'success',
        icon: 'mdi-check-circle',
        message: `浏览器实例已连接${headlessMode.value ? '（无头模式）' : ''}`
      })
      await refreshStatus(true)
    } else {
      showToast({
        color: 'error',
        icon: 'mdi-alert-circle-outline',
        message: res.message ?? '连接浏览器失败'
      })
    }
  } finally {
    connectingBrowser.value = false
  }
}

async function closeBrowser() {
  if (!uploaderStatus.value.connected || closingBrowser.value) return
  closingBrowser.value = true
  try {
    const res = await closeUploaderBrowser()
    if (res.success) {
      showToast({
        color: 'success',
        icon: 'mdi-check-circle',
        message: '浏览器连接已关闭'
      })
      await refreshStatus(true)
    } else {
      showToast({
        color: 'error',
        icon: 'mdi-alert-circle-outline',
        message: res.message ?? '关闭浏览器失败'
      })
    }
  } finally {
    closingBrowser.value = false
  }
}

function openUploaderWeb() {
  window.open(`${UPLOADER_API_BASE}`, '_blank')
}

// 爬虫相关方法
async function refreshCrawlerStatus() {
  crawlerSites.forEach(site => {
    crawlerLoading.value[site.key].refreshing = true
  })
  try {
    const newStatus = await getCrawlerStatus()
    crawlerStatusMap.value = newStatus
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: `刷新爬虫状态失败: ${error.message}`
    })
  }

  try {
    const progress = await getCrawlerProgress()
    crawlerProgressMap.value = progress
  } catch {
    // 进度接口不存在或暂不可用时静默降级，不阻断主状态刷新
  } finally {
    crawlerSites.forEach(site => {
      crawlerLoading.value[site.key].refreshing = false
    })
  }
}

function stageText(stage: string): string {
  const map: Record<string, string> = {
    idle: '空闲',
    crawling: '爬图中',
    downloading: '下载中',
    uploading: '上传中',
    saving: '入库中',
    completed: '已完成',
    failed: '失败',
  }
  return map[stage] || stage
}

async function updateCrawlerConfigh(site: SiteKey) {
  crawlerLoading.value[site].updating = true
  try {
    const config = crawlerConfigs.value[site]
    await updateCrawlerConfig(site, config)
    saveLocalConfigs(crawlerConfigs.value)
    showToast({
      color: 'success',
      icon: 'mdi-check-circle',
      message: '配置已更新'
    })
    await refreshCrawlerStatus()
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: `更新配置失败: ${error.message}`
    })
  } finally {
    crawlerLoading.value[site].updating = false
  }
}

async function startCrawler(site: SiteKey) {
  crawlerLoading.value[site].starting = true
  try {
    await startCrawlerSchedule(site, crawlerConfigs.value[site])
    showToast({
      color: 'success',
      icon: 'mdi-check-circle',
      message: '定时采集已启动'
    })
    await refreshCrawlerStatus()
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: `启动失败: ${error.message}`
    })
  } finally {
    crawlerLoading.value[site].starting = false
  }
}

async function stopCrawler(site: SiteKey) {
  crawlerLoading.value[site].stopping = true
  try {
    await stopCrawlerSchedule(site)
    showToast({
      color: 'success',
      icon: 'mdi-check-circle',
      message: '定时采集已停止'
    })
    await refreshCrawlerStatus()
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: `停止失败: ${error.message}`
    })
  } finally {
    crawlerLoading.value[site].stopping = false
  }
}

async function manualCrawlerCollect(site: SiteKey) {
  crawlerLoading.value[site].collecting = true
  try {
    showToast({
      color: 'info',
      icon: 'mdi-information-outline',
      message: '开始采集，请稍候...'
    })
    const result = await manualCollect(site, crawlerConfigs.value[site].maxImages)
    lastCrawlerResultMap.value[site] = result

    if (result.success) {
      showToast({
        color: 'success',
        icon: 'mdi-check-circle',
        message: `采集完成！成功 ${result.collected} 张，失败 ${result.failed} 张`
      })
    } else {
      showToast({
        color: 'error',
        icon: 'mdi-alert-circle-outline',
        message: `采集失败: ${result.message}`
      })
    }
  } catch (error: any) {
    showToast({
      color: 'error',
      icon: 'mdi-alert-circle-outline',
      message: `采集失败: ${error.message}`
    })
  } finally {
    crawlerLoading.value[site].collecting = false
  }
}

function openConfigDialog(site: SiteKey) {
  editingSite.value = site
  editingConfig.value = { ...crawlerConfigs.value[site], site }
  configDialogVisible.value = true
}

async function saveSiteConfig() {
  if (!editingSite.value) return
  const site = editingSite.value
  crawlerConfigs.value[site] = { ...editingConfig.value, site }
  await updateCrawlerConfigh(site)
  configDialogVisible.value = false
}

function startCrawlerAutoRefresh() {
  crawlerRefreshTimer = setInterval(() => {
    refreshCrawlerStatus()
  }, 10000) // 每10秒刷新一次
}

function stopCrawlerAutoRefresh() {
  if (crawlerRefreshTimer) {
    clearInterval(crawlerRefreshTimer)
    crawlerRefreshTimer = null
  }
}

onMounted(() => {
  refreshStatus()
  pollInterval.value = setInterval(() => refreshStatus(true), POLL_INTERVAL_MS)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // 初始化爬虫状态
  refreshCrawlerStatus()
  startCrawlerAutoRefresh()
})

onUnmounted(() => {
  if (pollInterval.value) {
    clearInterval(pollInterval.value)
    pollInterval.value = null
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  stopCrawlerAutoRefresh()
})

watch(
  () => uploaderStatus.value.connected,
  (connected) => {
    if (connected === lastServiceConnected.value) {
      return
    }

    if (!connected && lastServiceConnected.value) {
      showToast({
        color: 'warning',
        icon: 'mdi-lan-disconnect',
        message: '自动操作服务已断开，浏览器状态已同步重置'
      })
    }

    if (connected && !lastServiceConnected.value) {
      showToast({
        color: 'success',
        icon: 'mdi-lan-connect',
        message: '自动操作服务已恢复连接'
      })
    }

    lastServiceConnected.value = connected
  },
  { immediate: true }
)

watch(
  browserReady,
  (ready) => {
    if (ready === lastBrowserReady.value) {
      return
    }

    if (!ready && lastBrowserReady.value && uploaderStatus.value.connected) {
      showToast({
        color: 'warning',
        icon: 'mdi-google-chrome',
        message: '浏览器实例已断开或已被关闭'
      })
    }

    if (ready && !lastBrowserReady.value) {
      showToast({
        color: 'success',
        icon: 'mdi-google-chrome',
        message: '浏览器实例已就绪'
      })
    }

    lastBrowserReady.value = ready
  },
  { immediate: true }
)
</script>

<template>
  <div class="platform-publish-page">
    <div class="page-hero">
      <div class="hero-copy">
        <div class="eyebrow">浏览器自动化服务</div>
        <h2 class="hero-title">浏览器自动化操作</h2>
        <p class="hero-desc">
          检测浏览器自动化服务是否已启动。连接成功后，可在本客户端内操控浏览器，完成抖音、小红书、微博、快手、咸鱼、速卖通、亚马逊、希音等多平台发布、信息填充、表单操作等多类型自动化任务。同时支持自动爬取 Sora/Pinterest 图片并上传到素材库。
        </p>
      </div>
      <div class="hero-badge" v-if="!loading && !crawlerRefreshing">
        <i
          class="mdi"
          :class="fullyReady ? 'mdi-lan-connect' : uploaderStatus.connected ? 'mdi-lan-pending' : 'mdi-lan-disconnect'"
        ></i>
        <div class="badge-meta">
          <span class="badge-label">整体状态</span>
          <span
            class="badge-value"
            :style="{
              color: fullyReady ? '#22c55e' : uploaderStatus.connected ? '#f59e0b' : '#ef4444'
            }"
          >
            {{
              fullyReady
                ? '就绪'
                : uploaderStatus.connected
                  ? '浏览器未连接'
                  : '服务未连接'
            }}
          </span>
        </div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="service-tabs">
      <!-- 连接管理标签页 -->
      <el-tab-pane label="连接管理" name="connection">
        <div class="grid">
          <div class="grid-row grid-cards">
            <el-card class="panel" shadow="never" v-loading="loading">
              <div class="panel-head">
                <div class="panel-title">
                  <i class="mdi mdi-connection"></i>
                  连接状态
                </div>
                <div class="actions">
                  <el-button :loading="loading" @click="refreshStatus()" size="small" plain>
                    <i class="mdi mdi-refresh mr-1"></i>
                    刷新
                  </el-button>
                </div>
              </div>

              <div class="service-info">
                <div class="field-row">
                  <div class="field">
                    <div class="field-label">自动操作服务 (7010)</div>
                    <div class="field-value">
                      <el-tag :type="uploaderStatus.connected ? 'success' : 'danger'" effect="light" class="status-tag">
                        <i
                          :class="[
                            'mdi',
                            uploaderStatus.connected ? 'mdi-check-circle' : 'mdi-close-circle',
                            'mr-1'
                          ]"
                        ></i>
                        {{ uploaderStatus.connected ? '已连接' : '未连接' }}
                      </el-tag>
                      <span v-if="uploaderStatus.apiInfo?.name" class="ml-2 text-muted">
                        {{ uploaderStatus.apiInfo.name }}
                        <template v-if="uploaderStatus.apiInfo.version">
                          v{{ uploaderStatus.apiInfo.version }}
                        </template>
                      </span>
                    </div>
                  </div>
                  <div class="field" v-if="uploaderStatus.connected">
                    <div class="field-label">浏览器实例</div>
                    <div class="field-value">
                      <el-tag
                        :type="browserReady ? 'success' : 'warning'"
                        effect="light"
                        class="status-tag"
                      >
                        <i :class="['mdi', browserReady ? 'mdi-google-chrome' : 'mdi-alert', 'mr-1']"></i>
                        {{ browserReady ? '已连接' : '未连接' }}
                      </el-tag>

                      <template v-if="browserStatus?.hasInstance">
                        <span class="ml-3 text-muted">
                          <i class="mdi mdi-tab mr-1"></i>
                          页面: {{ browserStatus.pageCount }}
                        </span>
                      </template>
                    </div>
                  </div>
                </div>

                <!-- 浏览器页面列表 -->
                <div v-if="browserReady && browserStatus?.pages && browserStatus.pages.length > 0" class="pages-list-container">
                  <div class="field-label mb-2">活跃页面 ({{ browserStatus.pages.length }})</div>
                  <div class="pages-list">
                    <div v-for="(page, idx) in browserStatus.pages" :key="idx" class="page-item" :title="page.url">
                       <i class="mdi mdi-file-document-outline page-icon"></i>
                       <span class="page-title">{{ page.title || '无标题页面' }}</span>
                       <span class="page-url">{{ page.url }}</span>
                    </div>
                  </div>
                </div>

                <el-alert
                   v-if="uploaderStatus.connected && !browserReady"
                   title="自动操作服务已连接，但浏览器未就绪"
                   type="warning"
                   description='需要连接浏览器才能进行自动化操作。点击"连接浏览器"以启动。'
                   show-icon
                   :closable="false"
                   class="mt-2"
                />

                <el-alert
                   v-if="!uploaderStatus.connected && uploaderStatus.message"
                   title="服务无法连接"
                   type="error"
                   :description="uploaderStatus.message"
                   show-icon
                   :closable="false"
                   class="mt-2"
                />

                <!-- 快捷操作区 -->
                 <div class="control-section mt-4" v-if="uploaderStatus.connected">
                    <div class="section-title">快捷控制</div>

                    <!-- 无头模式开关 -->
                    <div class="headless-mode-control" v-if="!browserReady">
                      <div class="field">
                        <div class="field-label">
                          <i class="mdi mdi-monitor-off mr-1"></i>
                          无头模式
                        </div>
                        <div class="field-value">
                          <el-switch
                            v-model="headlessMode"
                            active-text="启用"
                            inactive-text="禁用"
                            :disabled="connectingBrowser || closingBrowser"
                          />
                          <span class="ml-2 text-muted" style="font-size: 12px;">
                            <i class="mdi mdi-information-outline"></i>
                            {{ headlessMode ? '后台运行，不显示浏览器窗口' : '显示浏览器窗口' }}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div class="control-buttons">
                       <el-button
                        v-if="!browserReady"
                        type="primary"
                        :loading="connectingBrowser"
                        :disabled="closingBrowser"
                        @click="connectBrowser"
                        size="default"
                      >
                        <i class="mdi mdi-connection mr-1"></i>
                        连接浏览器{{ headlessMode ? '（无头）' : '' }}
                      </el-button>

                      <el-button
                        v-if="browserReady"
                        type="danger"
                        plain
                        :loading="closingBrowser"
                        :disabled="connectingBrowser"
                        @click="closeBrowser"
                        size="default"
                      >
                        <i class="mdi mdi-close-circle-outline mr-1"></i>
                        关闭浏览器连接
                      </el-button>

                      <el-button
                        @click="openUploaderWeb"
                        size="default"
                        plain
                      >
                        <i class="mdi mdi-open-in-new mr-1"></i>
                        管理后台
                      </el-button>
                    </div>
                 </div>

                <div class="tips">
                  <div class="tip-item">
                    <i class="mdi mdi-information-outline tip-icon"></i>
                    <span>说明：需自动操作服务启动且浏览器连接才能工作。可在管理后台配置和执行各类自动化任务。</span>
                  </div>
                </div>
              </div>
            </el-card>
          </div>
        </div>
      </el-tab-pane>

      <!-- 爬虫采集标签页 -->
      <el-tab-pane label="爬虫采集" name="crawler">
        <div class="crawler-container">
          <el-card class="crawler-list-card" shadow="never">
            <template #header>
              <div class="card-header">
                <span>网站爬取列表</span>
                <el-button size="small" @click="refreshCrawlerStatus" :loading="crawlerRefreshing">刷新状态</el-button>
              </div>
            </template>

            <el-table :data="crawlerListRows" border stripe>
              <el-table-column prop="label" label="站点" min-width="160" />
              <el-table-column label="状态" width="120">
                <template #default="scope">
                  <el-tag :type="scope.row.isRunning ? 'success' : 'info'">
                    {{ scope.row.isRunning ? '运行中' : '已停止' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="处理进度" min-width="180">
                <template #default="scope">
                  <div class="table-progress-wrap">
                    <el-tag
                      size="small"
                      :type="scope.row.stage === 'failed' ? 'danger' : scope.row.stage === 'completed' ? 'success' : scope.row.stage === 'idle' ? 'info' : 'warning'"
                    >
                      {{ stageText(scope.row.stage) }}
                    </el-tag>
                    <span class="table-progress-text">{{ scope.row.current }}/{{ scope.row.total }}</span>
                    <span class="table-progress-stats">成功 {{ scope.row.successCount }} / 失败 {{ scope.row.failCount }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="实时消息" min-width="300">
                <template #default="scope">
                  <div class="table-message-wrap">
                    <span class="table-message-main">{{ scope.row.latestMessage }}</span>
                    <span v-if="scope.row.lastError" class="table-message-error">错误: {{ scope.row.lastError }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="每次图片数" width="120">
                <template #default="scope">{{ scope.row.maxImages }}</template>
              </el-table-column>
              <el-table-column label="定时间隔" min-width="140">
                <template #default="scope">{{ formatInterval(scope.row.interval) }}</template>
              </el-table-column>
              <el-table-column label="素材分类" min-width="140">
                <template #default="scope">{{ scope.row.category }}</template>
              </el-table-column>
              <el-table-column label="是否公开" width="100">
                <template #default="scope">{{ scope.row.isPublic ? '是' : '否' }}</template>
              </el-table-column>
              <el-table-column label="操作" min-width="420" fixed="right">
                <template #default="scope">
                  <div class="crawler-action-group">
                    <el-button size="small" @click="openConfigDialog(scope.row.key)">设置</el-button>
                    <el-button
                      size="small"
                      type="success"
                      @click="startCrawler(scope.row.key)"
                      :loading="crawlerLoading[scope.row.key].starting"
                      :disabled="scope.row.isRunning"
                    >
                      开启
                    </el-button>
                    <el-button
                      size="small"
                      type="danger"
                      @click="stopCrawler(scope.row.key)"
                      :loading="crawlerLoading[scope.row.key].stopping"
                      :disabled="!scope.row.isRunning"
                    >
                      关闭
                    </el-button>
                    <el-button
                      size="small"
                      type="primary"
                      @click="manualCrawlerCollect(scope.row.key)"
                      :loading="crawlerLoading[scope.row.key].collecting"
                    >
                      手动执行
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </div>

        <el-dialog
          v-model="configDialogVisible"
          title="爬虫配置"
          width="520px"
          destroy-on-close
        >
          <el-form :model="editingConfig" label-width="100px" size="default" class="site-form">
            <el-form-item label="每次图片数">
              <el-input-number v-model="editingConfig.maxImages" :min="1" :max="100" :step="5" />
            </el-form-item>

            <el-form-item label="定时间隔">
              <el-select v-model="editingConfig.interval" style="width: 220px;">
                <el-option label="10 分钟" :value="600000" />
                <el-option label="30 分钟" :value="1800000" />
                <el-option label="1 小时" :value="3600000" />
                <el-option label="2 小时" :value="7200000" />
                <el-option label="6 小时" :value="21600000" />
                <el-option label="12 小时" :value="43200000" />
                <el-option label="24 小时" :value="86400000" />
              </el-select>
            </el-form-item>

            <el-form-item label="素材分类">
              <el-input v-model="editingConfig.category" placeholder="例如: crawler, sora, ai" style="width: 220px;" />
            </el-form-item>

            <el-form-item label="是否公开">
              <el-switch v-model="editingConfig.isPublic" />
            </el-form-item>
          </el-form>

          <template #footer>
            <el-button @click="configDialogVisible = false">取消</el-button>
            <el-button
              type="primary"
              @click="saveSiteConfig"
              :loading="editingSite ? crawlerLoading[editingSite].updating : false"
            >
              保存
            </el-button>
          </template>
        </el-dialog>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.platform-publish-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 24px;
}

.page-hero {
  background: #ffffff;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 65%;
}

.eyebrow {
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #6366f1;
  font-weight: 700;
}

.hero-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.01em;
}

.hero-desc {
  margin: 4px 0 0 0;
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
}

.hero-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  min-width: 180px;
}

.hero-badge i {
  font-size: 24px;
  color: #64748b;
}

.badge-meta {
  display: flex;
  flex-direction: column;
}

.badge-label {
  font-size: 11px;
  color: #64748b;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.badge-value {
  font-size: 14px;
  font-weight: 700;
}

.service-tabs {
  margin-bottom: 16px;
}

.service-tabs :deep(.el-tabs__header) {
  border-bottom: 2px solid #e2e8f0;
}

.service-tabs :deep(.el-tabs__nav-wrap::after) {
  background: none;
}

.service-tabs :deep(.el-tabs__item) {
  font-weight: 500;
  color: #64748b;
  transition: all 0.3s;
}

.service-tabs :deep(.el-tabs__item.is-active) {
  color: #6366f1;
  font-weight: 600;
}

.grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel {
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.panel :deep(.el-card__body) {
  padding: 20px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f1f5f9;
}

.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #0f172a;
  font-size: 16px;
}

.panel-title i {
  color: #6366f1;
  font-size: 20px;
}

.service-info {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field-row {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  padding-bottom: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: #64748b;
  font-weight: 600;
  text-transform: uppercase;
}

.field-value {
  display: flex;
  align-items: center;
}

.status-tag {
  font-weight: 500;
  border: none;
  padding: 4px 10px;
  height: 28px;
}

.pages-list-container {
    background: #f8fafc;
    border-radius: 8px;
    padding: 12px;
    border: 1px solid #e2e8f0;
}

.pages-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
}

.page-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    padding: 6px 8px;
    background: #fff;
    border-radius: 4px;
    border: 1px solid #edf2f7;
}

.page-icon {
    color: #94a3b8;
}

.page-title {
    font-weight: 500;
    color: #334155;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
}

.page-url {
    color: #94a3b8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    font-family: monospace;
}

.control-section {
    border-top: 1px solid #f1f5f9;
    padding-top: 16px;
}

.section-title {
    font-size: 13px;
    font-weight: 600;
    color: #0f172a;
    margin-bottom: 12px;
}

.headless-mode-control {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 16px;
}

.headless-mode-control .field {
    margin: 0;
}

.headless-mode-control .field-label {
    display: flex;
    align-items: center;
    font-size: 13px;
    margin-bottom: 8px;
}

.headless-mode-control .field-value {
    display: flex;
    align-items: center;
    gap: 8px;
}

.control-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

/* 爬虫采集相关样式 */
.crawler-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.crawler-list-card {
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.crawler-list-card :deep(.el-card__body) {
  padding: 20px;
}

.table-progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.table-progress-text {
  color: #334155;
  font-size: 12px;
}

.table-progress-stats {
  color: #64748b;
  font-size: 12px;
}

.table-message-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.table-message-main {
  color: #0f172a;
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
}

.table-message-error {
  color: #dc2626;
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 14px;
}

.site-form :deep(.el-form-item) {
  margin-bottom: 16px;
}

.crawler-action-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mr-1 {
  margin-right: 4px;
}

.ml-2 {
  margin-left: 8px;
}

.ml-3 {
    margin-left: 12px;
}

.mt-2 {
    margin-top: 8px;
}

.mt-4 {
    margin-top: 16px;
}

.mb-2 {
    margin-bottom: 8px;
}

.text-muted {
  color: #64748b;
  font-size: 13px;
}

.tips {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 12px;
  background: #fff;
  border-radius: 8px;
  border: 1px dashed #cbd5e1;
}

.tip-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
}

.tip-icon {
  color: #6366f1;
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}
</style>


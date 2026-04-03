<script setup lang="ts">
// 系统设置页面
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import {
  getServiceMode,
  setServiceMode,
  getRemoteApiBase,
  getWsEndpoint,
  type ServiceMode,
} from "../config/api";
import { updateApiBaseUrl } from "../api/request";
import { websocketClient } from "../services/websocketClient";
import { useToast } from "../composables/useToast";
import {
  useThemeMode,
  type ThemePreference,
} from "../composables/useThemeMode";
import { ElMessageBox } from "element-plus";

const { showToast } = useToast();
const { themePreference, resolvedThemeLabel, setThemePreference } =
  useThemeMode();

const isDevelopment = process.env.NODE_ENV === "development";
const serviceMode = ref<ServiceMode>(getServiceMode());
const workspaceDirectory = ref("");
const workspaceLoading = ref(false);
const selectingWorkspace = ref(false);

const currentApiBase = computed(() => getRemoteApiBase());
const currentWsEndpoint = computed(() => getWsEndpoint());
const themeDescription = computed(() =>
  themePreference.value === "auto"
    ? `当前为${resolvedThemeLabel.value}，系统会在 07:00-19:00 使用浅色，其余时间自动切换深色。`
    : `当前已固定为${resolvedThemeLabel.value}。`,
);
const themeOptions: Array<{ label: string; value: ThemePreference }> = [
  { label: "跟随时间", value: "auto" },
  { label: "浅色模式", value: "light" },
  { label: "深色模式", value: "dark" },
];
const workspaceDescription = computed(() =>
  workspaceDirectory.value
    ? "当前工作目录会被用于文件缓存、本地下载、图片处理中间产物以及部分自动化执行的导出目录。"
    : "工作目录未设置时，依赖本地缓存和文件落地的功能会受到影响。",
);

// 根据服务模式获取状态配置
const serviceStatusConfig = computed(() => {
  const mode = serviceMode.value;
  if (mode === "local") {
    return {
      tone: "warning",
      text: "本地服务",
    };
  } else {
    return {
      tone: "success",
      text: "生产服务",
    };
  }
});

const handleServiceModeChange = async (mode: ServiceMode) => {
  if (!isDevelopment) {
    showToast({
      color: "warning",
      icon: "mdi-alert",
      message: "生产环境不允许切换服务模式",
    });
    serviceMode.value = getServiceMode(); // 恢复原值
    return;
  }

  try {
    // 提示用户可能需要重新登录
    await ElMessageBox.confirm(
      "切换服务后，如果不同服务的账号不同，您可能需要重新登录。是否继续？",
      "切换服务提示",
      {
        confirmButtonText: "继续",
        cancelButtonText: "取消",
        type: "warning",
      },
    );

    // 更新配置
    setServiceMode(mode);
    serviceMode.value = mode;

    // 更新API baseURL
    updateApiBaseUrl(getRemoteApiBase());

    // 切换WebSocket连接（会先断开旧连接，再连接新地址）
    websocketClient.switchService(mode);

    showToast({
      color: "success",
      icon: "mdi-check-circle",
      message: `已切换到${mode === "local" ? "本地" : "远程"}服务`,
    });
  } catch (error) {
    // 用户取消，恢复原值
    serviceMode.value = getServiceMode();
  }
};

const loadWorkspaceDirectory = async () => {
  try {
    workspaceLoading.value = true;
    const path = await window.api.getWorkspaceDirectory();
    workspaceDirectory.value = path || "";
  } catch (error) {
    console.error("加载工作目录失败:", error);
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "加载工作目录失败",
    });
  } finally {
    workspaceLoading.value = false;
  }
};

const selectWorkspaceDirectory = async () => {
  try {
    selectingWorkspace.value = true;
    const selectedPath = await window.api.selectWorkspaceDirectory();
    if (!selectedPath) {
      return;
    }

    workspaceDirectory.value = selectedPath;
    showToast({
      color: "success",
      icon: "mdi-folder-check-outline",
      message: "工作目录已更新",
    });
  } catch (error) {
    console.error("选择工作目录失败:", error);
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "选择工作目录失败",
    });
  } finally {
    selectingWorkspace.value = false;
  }
};

const openWorkspaceDirectory = async () => {
  if (!workspaceDirectory.value) {
    showToast({
      color: "warning",
      icon: "mdi-alert-outline",
      message: "请先设置工作目录",
    });
    return;
  }

  try {
    await window.api.openPath(workspaceDirectory.value);
  } catch (error: any) {
    console.error("打开工作目录失败:", error);
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: error?.message || "打开工作目录失败",
    });
  }
};

const clearWorkspaceDirectory = async () => {
  try {
    workspaceLoading.value = true;
    await window.api.setWorkspaceDirectory("");
    workspaceDirectory.value = "";
    showToast({
      color: "success",
      icon: "mdi-delete-circle-outline",
      message: "工作目录已清除",
    });
  } catch (error) {
    console.error("清除工作目录失败:", error);
    showToast({
      color: "error",
      icon: "mdi-alert-circle-outline",
      message: "清除工作目录失败",
    });
  } finally {
    workspaceLoading.value = false;
  }
};

const handleServiceModeChanged = ((
  event: CustomEvent<{ mode: ServiceMode }>,
) => {
  serviceMode.value = event.detail.mode;
}) as EventListener;

// 监听服务模式变化（从其他地方切换时同步）
onMounted(() => {
  window.addEventListener("service-mode-changed", handleServiceModeChanged);
  void loadWorkspaceDirectory();
});

onBeforeUnmount(() => {
  window.removeEventListener("service-mode-changed", handleServiceModeChanged);
});
</script>

<template>
  <div class="settings-page">
    <section class="settings-stage">
      <div class="settings-stage__eyebrow">System Preferences</div>
      <h2 class="settings-stage__title">客户端设置</h2>
      <p class="settings-stage__desc">
        统一管理主题模式、工作目录和服务连接策略。这里保留的是客户端真正需要长期维护的少量配置。
      </p>
    </section>

    <section class="settings-grid">
      <article class="settings-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">
              <i class="mdi mdi-theme-light-dark"></i>
              界面主题
            </div>
            <div class="panel-desc">{{ themeDescription }}</div>
          </div>
        </div>
        <div class="info-content">
          <el-radio-group
            v-model="themePreference"
            class="theme-radio-group"
            @change="(value) => setThemePreference(value as ThemePreference)"
          >
            <el-radio-button
              v-for="item in themeOptions"
              :key="item.value"
              :label="item.value"
            >
              {{ item.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
      </article>

      <article class="settings-panel settings-panel--wide">
        <div class="panel-head">
          <div>
            <div class="panel-title">
              <i class="mdi mdi-folder-cog-outline"></i>
              工作目录
            </div>
            <div class="panel-desc">{{ workspaceDescription }}</div>
          </div>
        </div>
        <div class="info-content">
          <div class="workspace-field">
            <div class="address-label">当前目录</div>
            <el-input
              :model-value="workspaceDirectory || '未设置工作目录'"
              readonly
              class="workspace-path-input"
            />
          </div>

          <div class="workspace-actions">
            <el-button
              type="primary"
              :loading="selectingWorkspace"
              @click="selectWorkspaceDirectory"
            >
              选择目录
            </el-button>
            <el-button
              :disabled="!workspaceDirectory"
              @click="openWorkspaceDirectory"
            >
              打开目录
            </el-button>
            <el-button
              :disabled="!workspaceDirectory || workspaceLoading"
              @click="clearWorkspaceDirectory"
            >
              清除目录
            </el-button>
            <el-button
              text
              :loading="workspaceLoading"
              @click="loadWorkspaceDirectory"
            >
              刷新
            </el-button>
          </div>

          <el-alert
            v-if="!workspaceDirectory"
            type="warning"
            :closable="false"
            show-icon
          >
            工作目录未设置，下载缓存、文件落地和部分自动化导出能力会受影响。
          </el-alert>
        </div>
      </article>

      <article class="settings-panel settings-panel--wide">
        <div class="panel-head">
          <div>
            <div class="panel-title">
              <i class="mdi mdi-server-network"></i>
              服务配置
            </div>
            <div class="panel-desc">
              当前客户端所使用的 API 与 WebSocket 连接信息。
            </div>
          </div>
        </div>
        <div class="info-content">
          <el-alert
            v-if="!isDevelopment"
            type="info"
            :closable="false"
            show-icon
          >
            生产环境固定使用远程服务
          </el-alert>

          <el-form-item label="服务模式" v-if="isDevelopment">
            <el-radio-group
              v-model="serviceMode"
              @change="handleServiceModeChange"
            >
              <el-radio label="local">本地服务</el-radio>
              <el-radio label="remote">远程服务</el-radio>
            </el-radio-group>
          </el-form-item>

          <div class="address-info">
            <div class="address-item">
              <div class="address-label">当前 API 地址</div>
              <div class="address-value-with-status">
                <span
                  class="status-dot"
                  :class="`is-${serviceStatusConfig.tone}`"
                ></span>
                <span class="address-text">{{ currentApiBase }}</span>
                <span
                  class="status-text"
                  :class="`is-${serviceStatusConfig.tone}`"
                >
                  {{ serviceStatusConfig.text }}
                </span>
              </div>
            </div>
            <div class="address-item">
              <div class="address-label">当前 WebSocket 地址</div>
              <div class="address-value-with-status">
                <span
                  class="status-dot"
                  :class="`is-${serviceStatusConfig.tone}`"
                ></span>
                <span class="address-text">{{ currentWsEndpoint }}</span>
                <span
                  class="status-text"
                  :class="`is-${serviceStatusConfig.tone}`"
                >
                  {{ serviceStatusConfig.text }}
                </span>
              </div>
            </div>
          </div>

          <el-alert
            v-if="isDevelopment"
            type="warning"
            :closable="false"
            show-icon
          >
            切换服务可能需要重新登录
          </el-alert>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.settings-stage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 780px;
}

.settings-stage__eyebrow {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--theme-text-soft);
  font-weight: 700;
}

.settings-stage__title {
  margin: 0;
  font-size: 34px;
  font-weight: 700;
  color: var(--theme-text);
  line-height: 1.08;
}

.settings-stage__desc {
  margin: 0;
  font-size: 14px;
  color: var(--theme-text-muted);
  line-height: 1.8;
}

.settings-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.82fr) minmax(420px, 1.18fr);
  gap: 16px;
}

.settings-panel {
  border-radius: 24px;
  border: 1px solid var(--theme-border);
  background: var(--theme-surface);
  box-shadow: var(--theme-shadow-xs);
}

.settings-panel--wide {
  grid-column: 2;
}

.panel-head {
  margin-bottom: 18px;
}

.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: var(--theme-text);
  font-size: 18px;
}

.panel-title i {
  color: var(--theme-primary);
  font-size: 18px;
}

.panel-desc {
  margin-top: 8px;
  color: var(--theme-text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.info-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-panel {
  padding: 22px;
}

.theme-radio-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
}

.theme-radio-group :deep(.el-radio-button__inner) {
  min-width: 112px;
  border-radius: 12px !important;
  border: 1px solid var(--theme-border) !important;
  box-shadow: none !important;
  background: var(--theme-surface-strong);
}

.theme-radio-group :deep(.el-radio-button:first-child .el-radio-button__inner),
.theme-radio-group :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 12px !important;
}

.address-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.address-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.address-label {
  color: var(--theme-text-muted);
  font-size: 13px;
  font-weight: 500;
}

.address-value {
  color: var(--theme-text);
  font-size: 14px;
  word-break: break-all;
}

.address-value-with-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.status-dot.is-success {
  background-color: var(--theme-success);
}

.status-dot.is-warning {
  background-color: var(--theme-warning);
}

.status-text.is-success {
  color: var(--theme-success);
}

.status-text.is-warning {
  color: var(--theme-warning);
}

.address-text {
  color: var(--theme-text);
  font-size: 14px;
  word-break: break-all;
  flex: 1;
  min-width: 0;
}

.status-text {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  background: transparent;
}

.workspace-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.workspace-path-input :deep(.el-input__wrapper) {
  min-height: 44px;
  border-radius: 12px;
  background: var(--theme-surface-strong);
  box-shadow: none;
}

.workspace-path-input :deep(.el-input__inner) {
  color: var(--theme-text);
}

.workspace-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 1080px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }

  .settings-panel--wide {
    grid-column: auto;
  }
}

@media (max-width: 767px) {
  .settings-stage__title {
    font-size: 28px;
  }

  .settings-panel {
    padding: 18px;
    border-radius: 20px;
  }
}
</style>

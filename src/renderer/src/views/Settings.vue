<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { updateApiBaseUrl } from "../api/request";
import {
  getApiBaseByMode,
  getServiceMode,
  getWsEndpointByMode,
  type ServiceMode,
} from "../config/api";
import { useToast } from "../composables/useToast";
import {
  useThemeMode,
  type ThemePreference,
} from "../composables/useThemeMode";
import { websocketClient } from "../services/websocketClient";

const { showToast } = useToast();
const { themePreference, resolvedThemeLabel, setThemePreference } =
  useThemeMode();

function getNativeApi() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as typeof window & { api?: typeof window.api }).api;
}

const isDevelopment = process.env.NODE_ENV === "development";
const serviceMode = ref<ServiceMode>(getServiceMode());
const workspaceDirectory = ref("");
const workspaceLoading = ref(false);
const selectingWorkspace = ref(false);
const supportsNativeApi = computed(() => !!getNativeApi());

const currentApiBase = computed(() => getApiBaseByMode(serviceMode.value));
const currentWsEndpoint = computed(() => getWsEndpointByMode(serviceMode.value));
const themeDescription = computed(() =>
  themePreference.value === "auto"
    ? `当前显示：${resolvedThemeLabel.value}`
    : `当前固定为${resolvedThemeLabel.value}`,
);
const themeOptions: Array<{ label: string; value: ThemePreference }> = [
  { label: "跟随时间", value: "auto" },
  { label: "浅色模式", value: "light" },
  { label: "深色模式", value: "dark" },
];
const workspaceDescription = computed(() =>
  workspaceDirectory.value ? "已设置工作目录" : "未设置工作目录",
);

const serviceStatusConfig = computed(() => {
  const mode = serviceMode.value;
  if (mode === "local") {
    return {
      tone: "warning",
      text: "本地",
    };
  }

  return {
    tone: "success",
    text: "远程",
  };
});

const handleServiceModeChange = async (mode: ServiceMode) => {
  if (!isDevelopment) {
    showToast({
      color: "warning",
      icon: "mdi-alert",
      message: "生产环境不允许切换服务模式",
    });
    serviceMode.value = getServiceMode();
    return;
  }

  try {
    await ElMessageBox.confirm(
      "切换服务后可能需要重新登录，是否继续？",
      "切换服务",
      {
        confirmButtonText: "继续",
        cancelButtonText: "取消",
        type: "warning",
      },
    );

    websocketClient.switchService(mode);
    serviceMode.value = mode;
    updateApiBaseUrl(getApiBaseByMode(mode));

    showToast({
      color: "success",
      icon: "mdi-check-circle",
      message: `已切换到${mode === "local" ? "本地" : "远程"}服务`,
    });
  } catch {
    serviceMode.value = getServiceMode();
  }
};

const loadWorkspaceDirectory = async () => {
  try {
    workspaceLoading.value = true;
    const nativeApi = getNativeApi();
    if (!nativeApi?.getWorkspaceDirectory) {
      workspaceDirectory.value = "";
      return;
    }

    const path = await nativeApi.getWorkspaceDirectory();
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
    const nativeApi = getNativeApi();
    if (!nativeApi?.selectWorkspaceDirectory) {
      showToast({
        color: "warning",
        icon: "mdi-monitor-off",
        message: "当前为浏览器环境，未注入桌面端工作目录能力",
      });
      return;
    }

    const selectedPath = await nativeApi.selectWorkspaceDirectory();
    if (!selectedPath) {
      return;
    }

    workspaceDirectory.value = selectedPath;
    websocketClient.updateClientInfo({
      workspaceDirectory: String(selectedPath || "").trim(),
    });
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
    const nativeApi = getNativeApi();
    if (!nativeApi?.openPath) {
      showToast({
        color: "warning",
        icon: "mdi-monitor-off",
        message: "当前为浏览器环境，未注入桌面端工作目录能力",
      });
      return;
    }

    await nativeApi.openPath(workspaceDirectory.value);
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
    const nativeApi = getNativeApi();
    if (!nativeApi?.setWorkspaceDirectory) {
      showToast({
        color: "warning",
        icon: "mdi-monitor-off",
        message: "当前为浏览器环境，未注入桌面端工作目录能力",
      });
      return;
    }

    await nativeApi.setWorkspaceDirectory("");
    workspaceDirectory.value = "";
    websocketClient.updateClientInfo({
      workspaceDirectory: "",
    });
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
    <section class="settings-grid">
      <article class="settings-panel">
        <div class="settings-panel__head">
          <div class="settings-panel__title">显示</div>
          <div class="settings-panel__hint">{{ themeDescription }}</div>
        </div>
        <el-radio-group
          v-model="themePreference"
          class="segmented-group"
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
      </article>

      <article class="settings-panel settings-panel--wide">
        <div class="settings-panel__head">
          <div class="settings-panel__title">工作目录</div>
          <div class="settings-panel__hint">{{ workspaceDescription }}</div>
        </div>

        <div class="workspace-block">
          <div class="field-label">当前目录</div>
          <el-input
            :model-value="workspaceDirectory || '未设置工作目录'"
            readonly
            class="workspace-path-input"
          />
        </div>

        <div class="workspace-actions">
          <el-button
            type="primary"
            :disabled="!supportsNativeApi"
            :loading="selectingWorkspace"
            @click="selectWorkspaceDirectory"
          >
            选择目录
          </el-button>
          <el-button
            :disabled="!workspaceDirectory || !supportsNativeApi"
            @click="openWorkspaceDirectory"
          >
            打开目录
          </el-button>
          <el-button
            :disabled="
              !workspaceDirectory || workspaceLoading || !supportsNativeApi
            "
            @click="clearWorkspaceDirectory"
          >
            清除目录
          </el-button>
          <el-button
            text
            :disabled="!supportsNativeApi"
            :loading="workspaceLoading"
            @click="loadWorkspaceDirectory"
          >
            刷新
          </el-button>
        </div>

        <div v-if="!workspaceDirectory" class="settings-note is-warning">
          工作目录未设置
        </div>
        <div v-if="!supportsNativeApi" class="settings-note is-warning">
          当前为浏览器调试环境，工作目录配置仅在桌面客户端内可用
        </div>
      </article>

      <article class="settings-panel settings-panel--wide">
        <div class="settings-panel__head">
          <div class="settings-panel__title">服务配置</div>
          <div class="settings-panel__hint">当前 API 与 WebSocket 连接信息</div>
        </div>

        <div v-if="isDevelopment" class="service-mode">
          <div class="field-label">服务模式</div>
          <el-radio-group
            v-model="serviceMode"
            class="segmented-group"
            @change="handleServiceModeChange"
          >
            <el-radio-button label="local">本地服务</el-radio-button>
            <el-radio-button label="remote">远程服务</el-radio-button>
          </el-radio-group>
        </div>

        <div class="address-list">
          <div class="address-item">
            <div class="field-label">API</div>
            <div class="address-item__value">
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
            <div class="field-label">WebSocket</div>
            <div class="address-item__value">
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

        <div class="settings-note">
          {{
            isDevelopment
              ? "切换服务后可能需要重新登录"
              : "生产环境固定使用远程服务"
          }}
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--theme-border);
  border-radius: 12px;
  background: var(--theme-surface);
}

.settings-panel__head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.settings-panel__title {
  color: var(--theme-text);
  font-size: 12px;
  font-weight: 700;
}

.settings-panel__hint {
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.field-label {
  color: var(--theme-text-soft);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.segmented-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 5px;
}

.segmented-group :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 82px;
  min-height: 28px;
  border-radius: 9px !important;
  padding: 0 10px;
  font-size: 10px;
  line-height: 1;
}

.segmented-group :deep(.el-radio-button:first-child .el-radio-button__inner),
.segmented-group :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 9px !important;
}

.segmented-group
  :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: var(--theme-text) !important;
  border-color: var(--theme-text) !important;
  color: var(--theme-contrast) !important;
}

.workspace-block,
.service-mode,
.address-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--theme-border);
  border-radius: 10px;
  background: var(--theme-surface-strong);
}

.workspace-path-input :deep(.el-input__wrapper) {
  min-height: 32px;
  border-radius: 10px;
  background: var(--theme-surface-strong);
  border: 1px solid var(--theme-border);
  box-shadow: none;
}

.workspace-path-input :deep(.el-input__inner) {
  color: var(--theme-text);
  font-size: 11px;
}

.workspace-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.workspace-actions :deep(.el-button) {
  min-height: 30px;
  margin: 0;
  border-radius: 9px;
  font-size: 10px;
}

.workspace-actions :deep(.el-button--primary) {
  border-color: var(--theme-text);
  background: var(--theme-text);
  color: var(--theme-contrast);
}

.address-list {
  gap: 6px;
}

.address-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--theme-border-strong);
  border-radius: 10px;
  background: var(--theme-surface);
}

.address-item__value {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: start;
  gap: 6px;
}

.address-text {
  min-width: 0;
  flex: 1;
  color: var(--theme-text);
  font-size: 10px;
  line-height: 1.4;
  word-break: break-all;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--theme-border-strong);
}

.status-dot.is-success {
  background: var(--theme-success);
}

.status-dot.is-warning {
  background: var(--theme-warning);
}

.status-text {
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.status-text.is-success {
  color: var(--theme-success);
}

.status-text.is-warning {
  color: var(--theme-warning);
}

.settings-note {
  padding: 8px;
  border: 1px solid var(--theme-border);
  border-radius: 10px;
  background: var(--theme-surface);
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.45;
}

.settings-note.is-warning {
  border-color: color-mix(
    in srgb,
    var(--theme-warning) 32%,
    var(--theme-border)
  );
  color: var(--theme-warning);
}

@media (max-width: 767px) {
  .settings-panel {
    padding: 10px;
  }

  .segmented-group,
  .workspace-actions {
    width: 100%;
  }

  .workspace-actions {
    grid-template-columns: 1fr;
  }

  .address-item__value {
    grid-template-columns: 8px minmax(0, 1fr);
  }

  .status-text {
    grid-column: 2;
  }
}
</style>

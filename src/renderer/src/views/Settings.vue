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
const logDirectory = ref("");
const logFileCount = ref(0);
const logTotalSize = ref(0);
const logLoading = ref(false);
const supportsNativeApi = computed(() => !!getNativeApi());

const currentApiBase = computed(() => getApiBaseByMode(serviceMode.value));
const currentWsEndpoint = computed(() => getWsEndpointByMode(serviceMode.value));
const themeDescription = computed(() =>
  themePreference.value === "auto"
    ? `当前：${resolvedThemeLabel.value}`
    : `固定${resolvedThemeLabel.value}`,
);
const themeOptions: Array<{ label: string; value: ThemePreference }> = [
  { label: "跟随时间", value: "auto" },
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" },
];
const logSizeText = computed(() => {
  const size = logTotalSize.value;
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${size} B`;
});

const serviceStatusConfig = computed(() => {
  const mode = serviceMode.value;
  return {
    tone: mode === "local" ? "warning" : "success",
    text: mode === "local" ? "本地" : "远程",
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
  } finally {
    workspaceLoading.value = false;
  }
};

const selectWorkspaceDirectory = async () => {
  try {
    selectingWorkspace.value = true;
    const nativeApi = getNativeApi();
    if (!nativeApi?.selectWorkspaceDirectory) {
      showToast({ color: "warning", icon: "mdi-monitor-off", message: "浏览器环境不支持" });
      return;
    }
    const selectedPath = await nativeApi.selectWorkspaceDirectory();
    if (!selectedPath) return;
    workspaceDirectory.value = selectedPath;
    websocketClient.updateClientInfo({
      workspaceDirectory: String(selectedPath || "").trim(),
    });
    showToast({ color: "success", icon: "mdi-folder-check-outline", message: "工作目录已更新" });
  } catch (error) {
    console.error("选择工作目录失败:", error);
  } finally {
    selectingWorkspace.value = false;
  }
};

const openWorkspaceDirectory = async () => {
  if (!workspaceDirectory.value) return;
  try {
    const nativeApi = getNativeApi();
    if (!nativeApi?.openPath) return;
    await nativeApi.openPath(workspaceDirectory.value);
  } catch (error: any) {
    console.error("打开工作目录失败:", error);
  }
};

const clearWorkspaceDirectory = async () => {
  try {
    workspaceLoading.value = true;
    const nativeApi = getNativeApi();
    if (!nativeApi?.setWorkspaceDirectory) return;
    await nativeApi.setWorkspaceDirectory("");
    workspaceDirectory.value = "";
    websocketClient.updateClientInfo({ workspaceDirectory: "" });
    showToast({ color: "success", icon: "mdi-delete-circle-outline", message: "工作目录已清除" });
  } catch (error) {
    console.error("清除工作目录失败:", error);
  } finally {
    workspaceLoading.value = false;
  }
};

const loadLogInfo = async () => {
  try {
    logLoading.value = true;
    const nativeApi = getNativeApi();
    if (!nativeApi?.queryClientLog) {
      logDirectory.value = "";
      logFileCount.value = 0;
      logTotalSize.value = 0;
      return;
    }
    const result = await nativeApi.queryClientLog("list", {});
    const files = Array.isArray(result?.files) ? result.files : [];
    logDirectory.value = String(result?.root || "");
    logFileCount.value = files.length;
    logTotalSize.value = files.reduce(
      (sum: number, file: any) => sum + (Number(file?.size) || 0),
      0,
    );
  } catch (error) {
    console.error("加载日志目录失败:", error);
  } finally {
    logLoading.value = false;
  }
};

const openLogDirectory = async () => {
  try {
    const nativeApi = getNativeApi();
    if (!nativeApi?.queryClientLog || !nativeApi?.openPath) return;
    if (!logDirectory.value) await loadLogInfo();
    if (!logDirectory.value) return;
    await nativeApi.openPath(logDirectory.value);
  } catch (error: any) {
    console.error("打开日志目录失败:", error);
  }
};

const handleServiceModeChanged = ((event: CustomEvent<{ mode: ServiceMode }>) => {
  serviceMode.value = event.detail.mode;
}) as EventListener;

onMounted(() => {
  window.addEventListener("service-mode-changed", handleServiceModeChanged);
  void loadWorkspaceDirectory();
  void loadLogInfo();
});

onBeforeUnmount(() => {
  window.removeEventListener("service-mode-changed", handleServiceModeChanged);
});
</script>

<template>
  <div class="settings-compact">
    <div class="settings-row">
      <div class="settings-row__label">显示</div>
      <el-radio-group
        v-model="themePreference"
        class="seg"
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
      <span class="settings-row__hint">{{ themeDescription }}</span>
    </div>

    <div class="settings-row">
      <div class="settings-row__label">工作目录</div>
      <div class="settings-row__content">
        <el-input
          :model-value="workspaceDirectory || '未设置'"
          readonly
          size="small"
          class="settings-input"
        />
        <div class="settings-row__btns">
          <el-button size="small" type="primary" :disabled="!supportsNativeApi" :loading="selectingWorkspace" @click="selectWorkspaceDirectory">选择</el-button>
          <el-button size="small" :disabled="!workspaceDirectory || !supportsNativeApi" @click="openWorkspaceDirectory">打开</el-button>
          <el-button size="small" :disabled="!workspaceDirectory || workspaceLoading || !supportsNativeApi" @click="clearWorkspaceDirectory">清除</el-button>
        </div>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row__label">服务配置</div>
      <div class="settings-row__content">
        <div class="settings-addr-row">
          <span class="settings-addr-row__dot" :class="`is-${serviceStatusConfig.tone}`"></span>
          <span class="settings-addr-row__label">API</span>
          <span class="settings-addr-row__value">{{ currentApiBase }}</span>
          <span class="settings-addr-row__tag" :class="`is-${serviceStatusConfig.tone}`">{{ serviceStatusConfig.text }}</span>
        </div>
        <div class="settings-addr-row">
          <span class="settings-addr-row__dot" :class="`is-${serviceStatusConfig.tone}`"></span>
          <span class="settings-addr-row__label">WS</span>
          <span class="settings-addr-row__value">{{ currentWsEndpoint }}</span>
          <span class="settings-addr-row__tag" :class="`is-${serviceStatusConfig.tone}`">{{ serviceStatusConfig.text }}</span>
        </div>
        <div v-if="isDevelopment" class="settings-row__btns" style="margin-top:4px">
          <el-radio-group v-model="serviceMode" class="seg" @change="handleServiceModeChange">
            <el-radio-button label="local">本地</el-radio-button>
            <el-radio-button label="remote">远程</el-radio-button>
          </el-radio-group>
        </div>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row__label">日志</div>
      <div class="settings-row__content">
        <el-input
          :model-value="logDirectory || '未加载'"
          readonly
          size="small"
          class="settings-input"
        />
        <div class="settings-row__meta">
          <span>{{ logFileCount }} 个文件 · {{ logSizeText }}</span>
          <span>保留最近 7 天，超过 100 MB 自动清理</span>
        </div>
        <div class="settings-row__btns">
          <el-button size="small" type="primary" :disabled="!supportsNativeApi" @click="openLogDirectory">打开日志</el-button>
          <el-button size="small" text :disabled="!supportsNativeApi" :loading="logLoading" @click="loadLogInfo">刷新</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-compact {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 8px 10px;
  border: 1px solid var(--theme-border);
  border-radius: 10px;
  background: var(--theme-surface);
}

.settings-row__label {
  color: var(--theme-text);
  font-size: 11px;
  font-weight: 700;
  padding-top: 4px;
}

.settings-row__content {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.settings-row__hint {
  color: var(--theme-text-muted);
  font-size: 10px;
  grid-column: 2;
  margin-top: -2px;
}

.settings-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--theme-text-muted);
  font-size: 10px;
}

.settings-row__btns {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.settings-row__btns :deep(.el-button) {
  margin: 0;
  border-radius: 8px;
  font-size: 10px;
  min-height: 26px;
}

.settings-input :deep(.el-input__wrapper) {
  border-radius: 8px;
  background: var(--theme-surface-muted);
  border: 1px solid var(--theme-border);
  box-shadow: none;
}

.settings-input :deep(.el-input__inner) {
  color: var(--theme-text);
  font-size: 10px;
}

.seg {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.seg :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  min-height: 24px;
  border-radius: 7px !important;
  padding: 0 8px;
  font-size: 10px;
  line-height: 1;
}

.seg :deep(.el-radio-button:first-child .el-radio-button__inner),
.seg :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 7px !important;
}

.seg :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: var(--theme-text) !important;
  border-color: var(--theme-text) !important;
  color: var(--theme-contrast) !important;
}

.settings-addr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  background: var(--theme-surface-strong);
}

.settings-addr-row__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--theme-border-strong);
}

.settings-addr-row__dot.is-success { background: var(--theme-success); }
.settings-addr-row__dot.is-warning { background: var(--theme-warning); }

.settings-addr-row__label {
  color: var(--theme-text-soft);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  width: 22px;
  flex-shrink: 0;
}

.settings-addr-row__value {
  flex: 1;
  min-width: 0;
  color: var(--theme-text);
  font-size: 10px;
  word-break: break-all;
  line-height: 1.3;
}

.settings-addr-row__tag {
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}

.settings-addr-row__tag.is-success { color: var(--theme-success); }
.settings-addr-row__tag.is-warning { color: var(--theme-warning); }

@media (max-width: 520px) {
  .settings-row {
    grid-template-columns: 1fr;
  }
  .settings-row__label {
    padding-top: 0;
  }
}
</style>

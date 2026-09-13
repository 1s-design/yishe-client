<template>
  <Teleport to="body">
    <Transition name="update-fade">
      <div v-if="visible" class="update-notification" @click="handleClick">
        <div class="update-notification__content">
          <span class="update-notification__text">{{ titleText }}</span>
          <span v-if="downloading" class="update-notification__progress">
            <span class="update-notification__progress-bar" :style="{ width: `${progress}%` }" />
          </span>
          <span v-else class="update-notification__action">{{ actionText }}</span>
        </div>
        <button class="update-notification__close" title="稍后提醒" @click.stop="handleDismiss">×</button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

interface UpdateInfo {
  state: string;
  version?: string;
  currentVersion?: string;
  progress?: number;
  error?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  isDev?: boolean;
  isManualDownload?: boolean;
}

const visible = ref(false);
const updateInfo = ref<UpdateInfo>({ state: "idle" });
const downloading = ref(false);
const dismissed = ref(false);

const progress = computed(() => updateInfo.value.progress || 0);
const isDownloaded = computed(() => updateInfo.value.state === "downloaded");
const isManual = computed(
  () => Boolean(updateInfo.value.isManualDownload)
);

const titleText = computed(() => {
  if (isDownloaded.value) {
    return `新版本 ${updateInfo.value.version || ""} 已就绪`;
  }
  if (updateInfo.value.state === "error") {
    return "版本更新提示";
  }
  if (downloading.value) {
    return `正在下载新版本 ${updateInfo.value.version || ""}`;
  }
  return `发现新版本 ${updateInfo.value.version || ""}`;
});

const hintText = computed(() => {
  if (isDownloaded.value) {
    return "点击立即重启客户端完成安装";
  }
  if (downloading.value) {
    return `下载进度 ${progress.value}%`;
  }
  if (updateInfo.value.state === "error") {
    return updateInfo.value.error || "自动更新异常，点击重试或前往手动下载";
  }
  if (isManual.value) {
    return "点击前往下载最新版本";
  }
  return "点击开始自动下载更新";
});

const actionText = computed(() => {
  if (isDownloaded.value) return "点击重启安装";
  if (downloading.value) return `${progress.value}%`;
  if (updateInfo.value.state === "error") return "点击重试";
  return "点击更新";
});

let unsubscribe: (() => void) | null = null;

onMounted(() => {
  // 监听更新状态推送
  unsubscribe = window.api.onUpdateStatus((status: UpdateInfo) => {
    updateInfo.value = status;

    if (status.state === "available" && !dismissed.value) {
      visible.value = true;
    } else if (status.state === "downloading") {
      visible.value = true;
      downloading.value = true;
    } else if (status.state === "downloaded") {
      visible.value = true;
      downloading.value = false;
    } else if (status.state === "not-available") {
      visible.value = false;
    } else if (status.state === "error" && !dismissed.value) {
      downloading.value = false;
      // 若处于下载中断，依然展示卡片供用户手动前往下载
      if (updateInfo.value.version) {
        visible.value = true;
      } else {
        visible.value = false;
      }
    }
  });
});

onUnmounted(() => {
  unsubscribe?.();
});

async function handleClick() {
  const targetUrl =
    updateInfo.value.releaseUrl || "https://github.com/1s-design/yishe-client/releases/latest";

  // 1. 已下载完成：立即重启安装
  if (isDownloaded.value) {
    await window.api.updateInstall();
    return;
  }

  // 2. 若发生错误或要求手动模式，才打开外部浏览器
  if (isManual.value || (updateInfo.value.state === "error" && !updateInfo.value.downloadUrl)) {
    window.api?.openExternal?.(targetUrl) || window.open(targetUrl, "_blank");
    return;
  }

  // 3. 应用内自动下载
  if (downloading.value) return;
  downloading.value = true;
  await window.api.updateDownload();
}

function handleDismiss() {
  visible.value = false;
  dismissed.value = true;
}
</script>

<style scoped>
.update-notification {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  transition: opacity 0.2s ease, box-shadow 0.2s ease;
  max-width: 420px;
  user-select: none;
}

.update-notification:hover {
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
}

.update-notification__content {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.update-notification__text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.92);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.update-notification__action {
  flex-shrink: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  padding-left: 12px;
  border-left: 1px solid rgba(255, 255, 255, 0.12);
}

.update-notification__progress {
  flex-shrink: 0;
  width: 48px;
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  overflow: hidden;
}

.update-notification__progress-bar {
  display: block;
  height: 100%;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.update-notification__close {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.4);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s ease;
}

.update-notification__close:hover {
  color: rgba(255, 255, 255, 0.8);
}

.update-fade-enter-active,
.update-fade-leave-active {
  transition: opacity 0.25s ease;
}

.update-fade-enter-from,
.update-fade-leave-to {
  opacity: 0;
}
</style>

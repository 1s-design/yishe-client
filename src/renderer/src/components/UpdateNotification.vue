<template>
  <Teleport to="body">
    <Transition name="update-fade">
      <div v-if="visible" class="update-notification" @click="handleClick">
        <div class="update-notification__icon">
          <span class="update-notification__emoji">{{ emojiIcon }}</span>
        </div>
        <div class="update-notification__content">
          <div class="update-notification__title">
            {{ titleText }}
          </div>
          <div class="update-notification__hint">
            {{ hintText }}
          </div>
          <div v-if="downloading" class="update-notification__progress">
            <div class="update-notification__progress-bar" :style="{ width: `${progress}%` }" />
          </div>
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
  isDev?: boolean;
  isManualDownload?: boolean;
}

const visible = ref(false);
const updateInfo = ref<UpdateInfo>({ state: "idle" });
const downloading = ref(false);
const dismissed = ref(false);

const isMac = typeof navigator !== "undefined" && /macintosh|mac os x/i.test(navigator.userAgent);
const progress = computed(() => updateInfo.value.progress || 0);
const isDownloaded = computed(() => updateInfo.value.state === "downloaded");
const isManual = computed(
  () => Boolean(updateInfo.value.isDev || updateInfo.value.isManualDownload || isMac)
);

const emojiIcon = computed(() => {
  if (isDownloaded.value) return "🎉";
  if (updateInfo.value.state === "error") return "⚠️";
  return "🚀";
});

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
    return updateInfo.value.error || "自动更新异常，点击前往手动下载";
  }
  if (isManual.value) {
    return isMac ? "点击在浏览器下载最新 Mac 安装包 (dmg)" : "点击前往浏览器下载最新版本";
  }
  return "点击开始自动下载更新";
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

  // 2. 手动/外部下载引导（Mac 平台或开发模式或兜底模式）
  if (isManual.value || updateInfo.value.state === "error") {
    window.api?.openExternal?.(targetUrl) || window.open(targetUrl, "_blank");
    return;
  }

  // 3. Windows 自动下载
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
  top: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(135deg, #6900ff 0%, #8b5cf6 100%);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(105, 0, 255, 0.35);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  max-width: 340px;
  user-select: none;
}

.update-notification:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(105, 0, 255, 0.45);
}

.update-notification__icon {
  flex-shrink: 0;
}

.update-notification__emoji {
  font-size: 24px;
}

.update-notification__content {
  flex: 1;
  min-width: 0;
}

.update-notification__title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  line-height: 1.3;
}

.update-notification__hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 3px;
  line-height: 1.3;
}

.update-notification__progress {
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  margin-top: 6px;
  overflow: hidden;
}

.update-notification__progress-bar {
  height: 100%;
  background: #fff;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.update-notification__close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.18);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.update-notification__close:hover {
  background: rgba(255, 255, 255, 0.35);
  color: #fff;
}

.update-fade-enter-active,
.update-fade-leave-active {
  transition: all 0.3s ease;
}

.update-fade-enter-from,
.update-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>

<template>
  <Teleport to="body">
    <Transition name="update-fade">
      <div v-if="visible" class="update-notification" @click="handleDownload">
        <div class="update-notification__icon">
          <span class="update-notification__emoji">🚀</span>
        </div>
        <div class="update-notification__content">
          <div class="update-notification__title">
            发现新版本 {{ updateInfo.version }}
          </div>
          <div class="update-notification__hint">
            {{ downloading ? `下载中 ${progress}%` : "点击下载更新" }}
          </div>
          <div v-if="downloading" class="update-notification__progress">
            <div class="update-notification__progress-bar" :style="{ width: `${progress}%` }" />
          </div>
        </div>
        <button class="update-notification__close" @click.stop="handleDismiss">×</button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

interface UpdateInfo {
  state: string;
  version?: string;
  progress?: number;
  error?: string;
}

const visible = ref(false);
const updateInfo = ref<UpdateInfo>({ state: "idle" });
const downloading = ref(false);
const dismissed = ref(false);

const progress = computed(() => updateInfo.value.progress || 0);

let unsubscribe: (() => void) | null = null;

onMounted(() => {
  // 监听更新状态
  unsubscribe = window.api.onUpdateStatus((status: UpdateInfo) => {
    updateInfo.value = status;

    if (status.state === "available" && !dismissed.value) {
      visible.value = true;
    } else if (status.state === "downloading") {
      downloading.value = true;
    } else if (status.state === "downloaded") {
      downloading.value = false;
      showInstallNotification();
    } else if (status.state === "not-available" || status.state === "error") {
      visible.value = false;
    }
  });
});

onUnmounted(() => {
  unsubscribe?.();
});

async function handleDownload() {
  if (downloading.value) return;
  downloading.value = true;
  await window.api.updateDownload();
}

function handleDismiss() {
  visible.value = false;
  dismissed.value = true;
}

function showInstallNotification() {
  const confirmed = confirm(`新版本 ${updateInfo.value.version} 已下载完成，是否立即重启应用安装？`);
  if (confirmed) {
    window.api.updateInstall();
  }
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
  max-width: 320px;
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
}

.update-notification__hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 2px;
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
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.15);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s ease;
}

.update-notification__close:hover {
  background: rgba(255, 255, 255, 0.3);
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

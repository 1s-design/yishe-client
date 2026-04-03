<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        class="loading-overlay"
        :class="{ 'minimal-mode': minimal }"
        @click.self="handleClick"
      >
        <div
          v-if="!minimal"
          class="loading-container"
          :class="{ 'with-progress': showProgress }"
        >
          <!-- 图标区域 -->
          <div class="loading-icon-wrapper">
            <div v-if="icon" class="loading-icon">
              <i :class="['mdi', icon]"></i>
            </div>
            <div v-else class="loading-spinner">
              <div class="spinner-ring"></div>
              <div class="spinner-ring"></div>
              <div class="spinner-ring"></div>
            </div>
          </div>

          <!-- 标题 -->
          <div v-if="title" class="loading-title">{{ title }}</div>

          <!-- 消息 -->
          <div v-if="message" class="loading-message">{{ message }}</div>

          <!-- 进度条 -->
          <div v-if="showProgress" class="loading-progress">
            <div class="progress-bar-wrapper">
              <div
                class="progress-bar"
                :style="{ width: `${progressPercentage}%` }"
              ></div>
            </div>
            <div v-if="showProgressText" class="progress-text">
              <span class="progress-current">{{ progress }}</span>
              <span class="progress-separator">/</span>
              <span class="progress-total">{{ total }}</span>
            </div>
          </div>

          <!-- 百分比显示（可选） -->
          <div v-if="showProgress && showPercentage" class="loading-percentage">
            {{ progressPercentage }}%
          </div>
        </div>
        <!-- 简洁模式：直接显示在蒙层上，无卡片 -->
        <div v-else class="loading-minimal">
          <div v-if="icon" class="minimal-icon">
            <i :class="['mdi', icon]"></i>
          </div>
          <div v-else class="minimal-spinner">
            <div class="spinner-ring"></div>
            <div class="spinner-ring"></div>
            <div class="spinner-ring"></div>
          </div>
          <div v-if="title" class="minimal-title">{{ title }}</div>
          <div v-if="message" class="minimal-message">{{ message }}</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
  visible: boolean;
  title?: string;
  message?: string;
  icon?: string;
  progress?: number;
  total?: number;
  showProgress?: boolean;
  showProgressText?: boolean;
  showPercentage?: boolean;
  closable?: boolean;
  minimal?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  showProgress: false,
  showProgressText: true,
  showPercentage: false,
  closable: false,
  minimal: false,
});

const emit = defineEmits<{
  close: [];
}>();

const progressPercentage = computed(() => {
  if (!props.showProgress || !props.total || props.total === 0) {
    return 0;
  }
  return Math.round(((props.progress || 0) / props.total) * 100);
});

const handleClick = () => {
  if (props.closable) {
    emit("close");
  }
};
</script>

<style scoped>
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  background: color-mix(in srgb, var(--theme-bg) 72%, rgba(0, 0, 0, 0.2));
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  animation: fadeIn 0.2s ease-out;
}

.loading-container {
  width: min(360px, calc(100vw - 40px));
  padding: 22px 22px 20px;
  border-radius: 24px;
  background: color-mix(
    in srgb,
    var(--theme-surface-elevated) 92%,
    transparent
  );
  text-align: center;
  animation: slideUp 0.24s ease-out;
}

.loading-container.with-progress {
  padding-bottom: 24px;
}

.loading-icon-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 14px;
}

.loading-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--theme-text) 4%, transparent);
  color: var(--theme-text);
  font-size: 18px;
}

.loading-icon i {
  display: block;
}

.loading-spinner {
  position: relative;
  width: 38px;
  height: 38px;
  margin: 0 auto;
}

.spinner-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border: 3px solid transparent;
  border-top-color: var(--theme-text);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

.spinner-ring:nth-child(1) {
  opacity: 1;
}

.spinner-ring:nth-child(2) {
  opacity: 0.55;
}

.spinner-ring:nth-child(3) {
  opacity: 0.25;
}

.loading-title {
  margin: 0;
  color: var(--theme-text);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}

.loading-message {
  margin-top: 6px;
  color: var(--theme-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.loading-progress {
  margin-top: 14px;
}

.progress-bar-wrapper {
  width: 100%;
  height: 6px;
  background: color-mix(in srgb, var(--theme-text) 8%, transparent);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 10px;
}

.progress-bar {
  height: 100%;
  background: var(--theme-text);
  border-radius: 999px;
  transition: width 0.24s ease;
}

.progress-text {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: var(--theme-text-soft);
  font-weight: 600;
}

.progress-current {
  color: var(--theme-text);
  font-weight: 600;
}

.progress-separator {
  color: var(--theme-text-soft);
}

.progress-total {
  color: var(--theme-text-muted);
}

.loading-percentage {
  margin-top: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease-out;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.loading-overlay.minimal-mode {
  background: color-mix(in srgb, var(--theme-bg) 78%, rgba(0, 0, 0, 0.16));
}

.loading-minimal {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: min(280px, calc(100vw - 40px));
  padding: 16px 18px;
  border-radius: 20px;
  background: color-mix(
    in srgb,
    var(--theme-surface-elevated) 88%,
    transparent
  );
  text-align: center;
}

.minimal-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--theme-text) 4%, transparent);
  color: var(--theme-text);
  font-size: 16px;
}

.minimal-icon i {
  display: block;
}

.minimal-spinner {
  position: relative;
  width: 28px;
  height: 28px;
  margin: 0 auto;
}

.minimal-spinner .spinner-ring {
  border-width: 3px;
  border-top-color: var(--theme-text);
}

.minimal-spinner .spinner-ring:nth-child(2) {
  opacity: 0.55;
}

.minimal-spinner .spinner-ring:nth-child(3) {
  opacity: 0.25;
}

.minimal-title {
  color: var(--theme-text);
  font-size: 13px;
  font-weight: 600;
}

.minimal-message {
  color: var(--theme-text-muted);
  font-size: 11px;
  line-height: 1.5;
}
</style>

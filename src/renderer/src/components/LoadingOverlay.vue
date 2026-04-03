<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="loading-overlay" :class="{ 'minimal-mode': minimal }" @click.self="handleClick">
        <div v-if="!minimal" class="loading-container" :class="{ 'with-progress': showProgress }">
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
import { computed } from 'vue'

interface Props {
  visible: boolean
  title?: string
  message?: string
  icon?: string
  progress?: number
  total?: number
  showProgress?: boolean
  showProgressText?: boolean
  showPercentage?: boolean
  closable?: boolean
  minimal?: boolean // 简洁模式：无白色卡片，文字更小
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  showProgress: false,
  showProgressText: true,
  showPercentage: false,
  closable: false,
  minimal: false
})

const emit = defineEmits<{
  close: []
}>()

const progressPercentage = computed(() => {
  if (!props.showProgress || !props.total || props.total === 0) {
    return 0
  }
  return Math.round((props.progress || 0) / props.total * 100)
})

const handleClick = () => {
  if (props.closable) {
    emit('close')
  }
}
</script>

<style scoped>
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.3s ease-out;
}

.loading-container {
  background: linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%);
  border-radius: 20px;
  box-shadow: 
    0 25px 70px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;
  padding: 40px 56px;
  min-width: 360px;
  max-width: 500px;
  width: 90%;
  animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  text-align: center;
}

.loading-container.with-progress {
  padding: 48px 56px;
}

/* 图标区域 */
.loading-icon-wrapper {
  margin-bottom: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.loading-icon {
  font-size: 48px;
  color: #6366f1;
  animation: pulse 2s ease-in-out infinite;
}

.loading-icon i {
  display: block;
}

/* 旋转加载动画 */
.loading-spinner {
  position: relative;
  width: 64px;
  height: 64px;
  margin: 0 auto;
}

.spinner-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border: 4px solid transparent;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
}

.spinner-ring:nth-child(1) {
  animation-delay: -0.45s;
}

.spinner-ring:nth-child(2) {
  animation-delay: -0.3s;
  border-top-color: #8b5cf6;
}

.spinner-ring:nth-child(3) {
  animation-delay: -0.15s;
  border-top-color: #a78bfa;
}

/* 标题 */
.loading-title {
  font-size: 22px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 12px;
  letter-spacing: 0.3px;
}

/* 消息 */
.loading-message {
  font-size: 16px;
  color: #6b7280;
  margin-bottom: 24px;
  min-height: 24px;
  line-height: 1.5;
}

/* 进度条区域 */
.loading-progress {
  margin-top: 8px;
}

.progress-bar-wrapper {
  width: 100%;
  height: 10px;
  background: #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 12px;
  position: relative;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.06);
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%);
  border-radius: 10px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
}

.progress-bar::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.3),
    transparent
  );
  animation: shimmer 2s infinite;
}

.progress-text {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 14px;
  color: #9ca3af;
  font-weight: 500;
}

.progress-current {
  color: #6366f1;
  font-weight: 600;
}

.progress-separator {
  color: #d1d5db;
}

.progress-total {
  color: #6b7280;
}

/* 百分比显示 */
.loading-percentage {
  margin-top: 8px;
  font-size: 18px;
  font-weight: 600;
  color: #6366f1;
}

/* 动画 */
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
    transform: translateY(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
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

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.05);
  }
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease-out;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 简洁模式样式 */
.loading-overlay.minimal-mode {
  background: rgba(0, 0, 0, 0.6);
}

.loading-minimal {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.minimal-icon {
  font-size: 32px;
  color: rgba(255, 255, 255, 0.9);
  animation: pulse 2s ease-in-out infinite;
}

.minimal-icon i {
  display: block;
}

.minimal-spinner {
  position: relative;
  width: 40px;
  height: 40px;
  margin: 0 auto;
}

.minimal-spinner .spinner-ring {
  border-width: 3px;
  border-top-color: rgba(255, 255, 255, 0.9);
}

.minimal-spinner .spinner-ring:nth-child(2) {
  border-top-color: rgba(255, 255, 255, 0.7);
}

.minimal-spinner .spinner-ring:nth-child(3) {
  border-top-color: rgba(255, 255, 255, 0.5);
}

.minimal-title {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.95);
  margin-top: 4px;
}

.minimal-message {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  margin-top: -4px;
}
</style>


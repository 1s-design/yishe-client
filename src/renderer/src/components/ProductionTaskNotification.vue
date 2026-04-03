<template>
  <Teleport to="body">
    <Transition name="slide-up">
      <div v-if="visible" class="production-task-notification">
        <div class="notification-card">
          <!-- 头部 -->
          <div class="notification-header">
            <div class="header-left">
              <div class="header-icon">
                <i class="mdi mdi-image-edit-outline"></i>
              </div>
              <div class="header-text">
                <div class="header-title">{{ title }}</div>
                <div v-if="message" class="header-message">{{ message }}</div>
              </div>
            </div>
            <button class="close-btn" @click="handleClose" v-if="closable">
              <i class="mdi mdi-close"></i>
            </button>
          </div>

          <!-- 进度条 -->
          <div v-if="showProgress" class="notification-progress">
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
              <span class="progress-percentage">({{ progressPercentage }}%)</span>
            </div>
          </div>

          <!-- 步骤信息 -->
          <div v-if="step" class="notification-step">
            <i class="mdi mdi-check-circle step-icon"></i>
            <span class="step-text">{{ step }}</span>
          </div>
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
  step?: string
  progress?: number
  total?: number
  showProgress?: boolean
  showProgressText?: boolean
  closable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  title: '套图制作中',
  showProgress: false,
  showProgressText: true,
  closable: false
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

const handleClose = () => {
  emit('close')
}
</script>

<style scoped>
.production-task-notification {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2000;
  max-width: 520px;
  min-width: 400px;
  width: auto;
  animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.notification-card {
  background: linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%);
  border-radius: 16px;
  box-shadow: 
    0 12px 48px rgba(0, 0, 0, 0.18),
    0 0 0 1px rgba(0, 0, 0, 0.06) inset,
    0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 20px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.8);
}

/* 头部 */
.notification-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.header-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
}

.header-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 20px;
  flex-shrink: 0;
  animation: pulse 2s ease-in-out infinite;
}

.header-text {
  flex: 1;
  min-width: 0;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 6px;
  line-height: 1.4;
}

.header-message {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}

.close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
  flex-shrink: 0;
  padding: 0;
}

.close-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

.close-btn i {
  font-size: 18px;
}

/* 进度条 */
.notification-progress {
  margin-top: 12px;
}

.progress-bar-wrapper {
  width: 100%;
  height: 6px;
  background: #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
  position: relative;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%);
  border-radius: 6px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
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
  gap: 4px;
  font-size: 12px;
  color: #6b7280;
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
  color: #9ca3af;
}

.progress-percentage {
  color: #6366f1;
  font-weight: 600;
  margin-left: 4px;
}

/* 步骤信息 */
.notification-step {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #e5e7eb;
  font-size: 13px;
  color: #4b5563;
  line-height: 1.5;
}

.step-icon {
  color: #10b981;
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

.step-text {
  flex: 1;
  word-break: break-word;
  white-space: pre-wrap;
  font-weight: 500;
}

/* 动画 */
@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.9;
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
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-up-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.slide-up-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>


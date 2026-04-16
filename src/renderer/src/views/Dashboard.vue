<script setup lang="ts">
export interface DashboardStatusCard {
  key: string;
  title: string;
  value: string;
  description: string;
  icon: string;
  tone: "success" | "warning" | "danger" | "muted";
}

export interface DashboardQuickAction {
  key: string;
  title: string;
  description: string;
  icon: string;
}

export interface DashboardMetaItem {
  key: string;
  label: string;
  value: string;
}

const props = defineProps<{
  statusCards: DashboardStatusCard[];
  quickActions: DashboardQuickAction[];
  metaItems: DashboardMetaItem[];
}>();

const emit = defineEmits<{
  navigate: [key: string];
}>();

function toneClass(tone: DashboardStatusCard["tone"]) {
  return `is-${tone}`;
}
</script>

<template>
  <div class="dashboard-page">
    <section class="dashboard-group">
      <div class="dashboard-group__head">
        <div class="dashboard-group__title">运行状态</div>
        <div class="dashboard-group__hint">当前客户端与桥接服务状态</div>
      </div>
      <div class="dashboard-status-grid">
        <article
          v-for="item in props.statusCards"
          :key="item.key"
          class="dashboard-card"
          :class="toneClass(item.tone)"
        >
          <div class="dashboard-card__top">
            <span class="dashboard-card__signal" :class="toneClass(item.tone)">
              <span class="dashboard-card__signal-dot"></span>
            </span>
            <span class="dashboard-card__title">{{ item.title }}</span>
          </div>
          <div class="dashboard-card__value">{{ item.value }}</div>
          <div v-if="item.description" class="dashboard-card__desc">
            {{ item.description }}
          </div>
        </article>
      </div>
    </section>

    <section class="dashboard-group">
      <div class="dashboard-group__head">
        <div class="dashboard-group__title">快捷操作</div>
      </div>
      <div class="dashboard-actions">
        <button
          v-for="item in props.quickActions"
          :key="item.key"
          type="button"
          class="dashboard-action"
          @click="emit('navigate', item.key)"
        >
          <span class="dashboard-action__icon">
            <i :class="['mdi', item.icon]"></i>
          </span>
          <span class="dashboard-action__body">
            <span class="dashboard-action__title">{{ item.title }}</span>
            <span class="dashboard-action__desc">{{ item.description }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="dashboard-group">
      <div class="dashboard-group__head">
        <div class="dashboard-group__title">设备信息</div>
      </div>
      <div class="dashboard-meta">
        <div
          v-for="item in props.metaItems"
          :key="item.key"
          class="dashboard-meta__item"
        >
          <span class="dashboard-meta__label">{{ item.label }}</span>
          <span class="dashboard-meta__value">{{ item.value }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dashboard-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dashboard-group__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dashboard-group__title {
  color: var(--theme-text);
  font-size: 12px;
  font-weight: 700;
}

.dashboard-group__hint {
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.dashboard-status-grid,
.dashboard-actions {
  display: grid;
  gap: 8px;
}

.dashboard-status-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.dashboard-actions {
  grid-template-columns: 1fr;
}

.dashboard-card,
.dashboard-action,
.dashboard-meta__item {
  border: 1px solid var(--theme-border);
  border-radius: 12px;
  background: var(--theme-surface);
}

.dashboard-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 92px;
  padding: 12px 13px;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background-color 0.18s ease;
}

.dashboard-card__top {
  display: flex;
  align-items: center;
  gap: 9px;
}

.dashboard-card__signal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.dashboard-card__signal-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--theme-text-soft);
  box-shadow: 0 0 0 0 rgba(138, 138, 138, 0.35);
  animation: dashboardPulseMuted 2s ease-in-out infinite;
}

.dashboard-card__title {
  color: var(--theme-text);
  font-size: 11px;
  font-weight: 600;
}

.dashboard-card__value {
  color: var(--theme-text);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.15;
  word-break: break-word;
  letter-spacing: -0.02em;
}

.dashboard-card__desc {
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.35;
}

.dashboard-card.is-success .dashboard-card__signal-dot {
  background: var(--theme-success);
  box-shadow: 0 0 0 0 rgba(23, 163, 74, 0.35);
  animation-name: dashboardPulseSuccess;
}

.dashboard-card.is-warning .dashboard-card__signal-dot {
  background: var(--theme-warning);
  box-shadow: 0 0 0 0 rgba(197, 139, 17, 0.34);
  animation-name: dashboardPulseWarning;
}

.dashboard-card.is-danger .dashboard-card__signal-dot {
  background: var(--theme-danger);
  box-shadow: 0 0 0 0 rgba(213, 67, 67, 0.34);
  animation-name: dashboardPulseDanger;
}

.dashboard-card.is-muted .dashboard-card__signal-dot {
  background: var(--theme-text-soft);
}

@keyframes dashboardPulseSuccess {
  0% {
    box-shadow: 0 0 0 0 rgba(23, 163, 74, 0.34);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(23, 163, 74, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(23, 163, 74, 0);
  }
}

@keyframes dashboardPulseWarning {
  0% {
    box-shadow: 0 0 0 0 rgba(197, 139, 17, 0.34);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(197, 139, 17, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(197, 139, 17, 0);
  }
}

@keyframes dashboardPulseDanger {
  0% {
    box-shadow: 0 0 0 0 rgba(213, 67, 67, 0.34);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(213, 67, 67, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(213, 67, 67, 0);
  }
}

@keyframes dashboardPulseMuted {
  0% {
    box-shadow: 0 0 0 0 rgba(138, 138, 138, 0.28);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(138, 138, 138, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(138, 138, 138, 0);
  }
}

.dashboard-action {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 10px 12px;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease;
}

.dashboard-action:hover {
  border-color: var(--theme-border-strong);
  background: var(--theme-surface-strong);
}

.dashboard-action__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: var(--theme-surface-strong);
  color: var(--theme-text);
  font-size: 12px;
}

.dashboard-action__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dashboard-action__title {
  color: var(--theme-text);
  font-size: 11px;
  font-weight: 600;
}

.dashboard-action__desc {
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.35;
}

.dashboard-meta {
  display: grid;
  gap: 8px;
}

.dashboard-meta__item {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 10px;
  min-height: 40px;
  padding: 8px 10px;
}

.dashboard-meta__label {
  color: var(--theme-text-muted);
  font-size: 10px;
}

.dashboard-meta__value {
  color: var(--theme-text);
  font-size: 11px;
  font-weight: 600;
  text-align: right;
  word-break: break-word;
}

@media (max-width: 520px) {
  .dashboard-status-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-meta__item {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .dashboard-meta__value {
    text-align: left;
  }
}
</style>

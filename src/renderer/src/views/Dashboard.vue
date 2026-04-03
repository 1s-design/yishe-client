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
            <span class="dashboard-card__badge" :class="toneClass(item.tone)">
              <i :class="['mdi', item.icon]"></i>
            </span>
            <span class="dashboard-card__title">{{ item.title }}</span>
          </div>
          <div class="dashboard-card__value">{{ item.value }}</div>
          <div class="dashboard-card__desc">{{ item.description }}</div>
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
  gap: 8px;
  min-height: 102px;
  padding: 12px;
}

.dashboard-card__top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dashboard-card__badge {
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

.dashboard-card__title {
  color: var(--theme-text);
  font-size: 11px;
  font-weight: 600;
}

.dashboard-card__value {
  color: var(--theme-text);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
  word-break: break-word;
}

.dashboard-card__desc {
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.45;
}

.dashboard-card__badge.is-success {
  color: var(--theme-success);
}

.dashboard-card__badge.is-warning {
  color: var(--theme-warning);
}

.dashboard-card__badge.is-danger {
  color: var(--theme-danger);
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

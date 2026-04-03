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
    <section class="dashboard-stage">
      <div class="dashboard-stage__eyebrow">Yishe Client Workspace</div>
      <h2 class="dashboard-stage__title">今天先处理什么？</h2>
      <p class="dashboard-stage__desc">
        客户端现在更像执行工作台，负责保持在线、桥接桌面能力并承接任务执行。你可以从下面的常用动作开始，也可以继续在左侧切换页面。
      </p>

      <div class="dashboard-composer">
        <div class="dashboard-composer__prompt">
          选择一个常用动作，快速进入当前最常见的执行流程。
        </div>
        <div class="dashboard-composer__actions">
          <button
            v-for="item in props.quickActions"
            :key="item.key"
            type="button"
            class="dashboard-chip"
            @click="emit('navigate', item.key)"
          >
            <span class="dashboard-chip__icon">
              <i :class="['mdi', item.icon]"></i>
            </span>
            <span>{{ item.title }}</span>
          </button>
        </div>
      </div>
    </section>

    <section class="dashboard-grid dashboard-grid--status">
      <article
        v-for="item in props.statusCards"
        :key="item.key"
        class="dashboard-card"
        :class="toneClass(item.tone)"
      >
        <div class="dashboard-card__head">
          <span class="dashboard-card__icon">
            <i :class="['mdi', item.icon]"></i>
          </span>
          <span class="dashboard-card__title">{{ item.title }}</span>
        </div>
        <div class="dashboard-card__value">{{ item.value }}</div>
        <div class="dashboard-card__desc">{{ item.description }}</div>
      </article>
    </section>

    <section class="dashboard-grid dashboard-grid--content">
      <article class="dashboard-panel">
        <div class="dashboard-panel__head">
          <div>
            <div class="dashboard-panel__title">设备上下文</div>
            <div class="dashboard-panel__desc">
              当前客户端的关键上下文、连接环境与工作信息。
            </div>
          </div>
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
      </article>

      <article class="dashboard-panel">
        <div class="dashboard-panel__head">
          <div>
            <div class="dashboard-panel__title">推荐动作</div>
            <div class="dashboard-panel__desc">
              这些入口覆盖了当前客户端最常用的几个动作。
            </div>
          </div>
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
            <span class="dashboard-action__title">{{ item.title }}</span>
            <span class="dashboard-action__desc">{{ item.description }}</span>
          </button>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.dashboard-stage,
.dashboard-card,
.dashboard-panel {
  border: 1px solid var(--theme-border);
  border-radius: 28px;
  background: var(--theme-surface);
  box-shadow: var(--theme-shadow-xs);
}

.dashboard-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56px 24px 34px;
  text-align: center;
  background:
    radial-gradient(
      circle at top center,
      color-mix(in srgb, var(--theme-primary) 10%, transparent),
      transparent 30%
    ),
    var(--theme-surface);
}

.dashboard-stage__eyebrow {
  color: var(--theme-text-soft);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.dashboard-stage__title {
  margin: 20px 0 0;
  max-width: 720px;
  color: var(--theme-text);
  font-size: 44px;
  font-weight: 700;
  line-height: 1.06;
}

.dashboard-stage__desc {
  margin: 16px 0 0;
  max-width: 760px;
  color: var(--theme-text-muted);
  font-size: 15px;
  line-height: 1.8;
}

.dashboard-composer {
  width: 100%;
  max-width: 920px;
  margin-top: 30px;
  padding: 18px;
  border-radius: 24px;
  border: 1px solid var(--theme-border);
  background: var(--theme-surface-strong);
}

.dashboard-composer__prompt {
  color: var(--theme-text);
  font-size: 14px;
  font-weight: 600;
}

.dashboard-composer__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 14px;
}

.dashboard-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--theme-border);
  border-radius: 999px;
  background: var(--theme-surface);
  color: var(--theme-text);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    background-color 0.18s ease;
}

.dashboard-chip:hover {
  transform: translateY(-1px);
  border-color: color-mix(
    in srgb,
    var(--theme-primary) 20%,
    var(--theme-border)
  );
  background: color-mix(in srgb, var(--theme-primary) 6%, var(--theme-surface));
}

.dashboard-chip__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--theme-primary);
}

.dashboard-grid {
  display: grid;
  gap: 16px;
}

.dashboard-grid--status {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.dashboard-grid--content {
  grid-template-columns: minmax(340px, 0.92fr) minmax(420px, 1.08fr);
}

.dashboard-card {
  padding: 22px;
}

.dashboard-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dashboard-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: var(--theme-surface-muted);
  color: var(--theme-text-muted);
  font-size: 18px;
}

.dashboard-card__title {
  color: var(--theme-text);
  font-size: 13px;
  font-weight: 700;
}

.dashboard-card__value {
  margin-top: 22px;
  color: var(--theme-text);
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
}

.dashboard-card__desc {
  margin-top: 10px;
  color: var(--theme-text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.dashboard-card.is-success {
  border-color: color-mix(
    in srgb,
    var(--theme-success) 24%,
    var(--theme-border)
  );
}

.dashboard-card.is-success .dashboard-card__icon {
  background: var(--theme-success-light);
  color: var(--theme-success);
}

.dashboard-card.is-warning {
  border-color: color-mix(
    in srgb,
    var(--theme-warning) 24%,
    var(--theme-border)
  );
}

.dashboard-card.is-warning .dashboard-card__icon {
  background: var(--theme-warning-light);
  color: var(--theme-warning);
}

.dashboard-card.is-danger {
  border-color: color-mix(
    in srgb,
    var(--theme-danger) 24%,
    var(--theme-border)
  );
}

.dashboard-card.is-danger .dashboard-card__icon {
  background: var(--theme-danger-light);
  color: var(--theme-danger);
}

.dashboard-panel {
  padding: 24px;
}

.dashboard-panel__head {
  margin-bottom: 18px;
}

.dashboard-panel__title {
  color: var(--theme-text);
  font-size: 18px;
  font-weight: 700;
}

.dashboard-panel__desc {
  margin-top: 6px;
  color: var(--theme-text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.dashboard-meta {
  display: grid;
  gap: 12px;
}

.dashboard-meta__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 52px;
  padding: 0 16px;
  border-radius: 16px;
  background: var(--theme-surface-muted);
}

.dashboard-meta__label {
  color: var(--theme-text-muted);
  font-size: 12px;
}

.dashboard-meta__value {
  color: var(--theme-text);
  font-size: 13px;
  font-weight: 600;
  text-align: right;
  word-break: break-word;
}

.dashboard-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.dashboard-action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 16px;
  border: 1px solid var(--theme-border);
  border-radius: 20px;
  background: var(--theme-surface);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    background-color 0.18s ease,
    box-shadow 0.18s ease;
}

.dashboard-action:hover {
  transform: translateY(-1px);
  border-color: color-mix(
    in srgb,
    var(--theme-primary) 24%,
    var(--theme-border)
  );
  background: color-mix(in srgb, var(--theme-primary) 5%, var(--theme-surface));
  box-shadow: var(--theme-shadow-xs);
}

.dashboard-action:focus-visible {
  outline: none;
  box-shadow: var(--theme-shadow-focus);
}

.dashboard-action__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: var(--theme-primary-light);
  color: var(--theme-primary);
  font-size: 17px;
}

.dashboard-action__title {
  color: var(--theme-text);
  font-size: 14px;
  font-weight: 700;
}

.dashboard-action__desc {
  color: var(--theme-text-muted);
  font-size: 12px;
  line-height: 1.7;
}

@media (max-width: 1180px) {
  .dashboard-grid--status {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-grid--content {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 767px) {
  .dashboard-grid--status,
  .dashboard-actions {
    grid-template-columns: 1fr;
  }

  .dashboard-stage {
    padding: 34px 18px 22px;
    border-radius: 22px;
  }

  .dashboard-stage__title {
    font-size: 30px;
  }

  .dashboard-card,
  .dashboard-panel {
    border-radius: 18px;
  }
}
</style>

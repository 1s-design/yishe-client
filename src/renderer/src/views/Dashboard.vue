<script setup lang="ts">
export interface DashboardStatusCard {
  key: string;
  title: string;
  value: string;
  description: string;
  details?: DashboardStatusCardDetail[];
  hoverTitle?: string;
  hoverLines?: string[];
  icon: string;
  tone: "success" | "warning" | "danger" | "muted";
  actions?: DashboardStatusCardAction[];
  highlight?: boolean;
  busy?: boolean;
}

export interface DashboardStatusCardDetail {
  text: string;
  tone?: DashboardStatusCard["tone"];
}

export interface DashboardStatusCardAction {
  key: string;
  label: string;
  icon: string;
  loading?: boolean;
  disabled?: boolean;
}

const props = defineProps<{ statusCards: DashboardStatusCard[] }>();
const emit = defineEmits<{ cardAction: [key: string] }>();
</script>

<template>
  <div class="dash-cards">
    <article
      v-for="item in props.statusCards"
      :key="item.key"
      class="dash-card"
      :class="{ 'is-running': item.tone === 'success' }"
    >
      <div class="dash-card__head">
        <span class="dash-card__status" aria-hidden="true" />
        <span class="dash-card__title">{{ item.title }}</span>
        <span class="dash-card__value">{{ item.value }}</span>
      </div>
      <p v-if="item.description" class="dash-card__description">
        {{ item.description }}
      </p>
      <div v-if="item.actions?.length" class="dash-card__actions">
        <button
          v-for="action in item.actions"
          :key="action.key"
          type="button"
          :disabled="action.disabled || action.loading"
          @click="emit('cardAction', action.key)"
        >
          {{ action.loading ? "处理中" : action.label }}
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.dash-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.dash-card {
  min-width: 0;
  min-height: 68px;
  padding: 8px 9px;
  border: 1px solid var(--theme-border);
  border-radius: 7px;
  background: var(--theme-surface);
}

.dash-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dash-card__status {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: #d76565;
}

.dash-card.is-running .dash-card__status {
  background: #54d98c;
}

.dash-card__title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--theme-text-muted);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dash-card__value {
  flex: 0 0 auto;
  color: var(--theme-text);
  font-size: 12px;
  font-weight: 600;
}

.dash-card__description {
  margin: 5px 0 0;
  overflow: hidden;
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dash-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.dash-card__actions button {
  min-height: 22px;
  border: 1px solid var(--theme-border);
  border-radius: 5px;
  background: transparent;
  color: var(--theme-text-muted);
  cursor: pointer;
  padding: 0 7px;
  font: inherit;
  font-size: 11px;
}

.dash-card__actions button:hover:not(:disabled) {
  border-color: var(--theme-border-strong);
  color: var(--theme-text);
}

.dash-card__actions button:disabled {
  cursor: default;
  opacity: 0.45;
}

@media (max-width: 1080px) {
  .dash-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .dash-cards {
    grid-template-columns: 1fr;
  }
}
</style>

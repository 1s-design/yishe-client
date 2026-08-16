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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.dash-card {
  min-width: 0;
  min-height: 76px;
  padding: 10px 11px;
  border: 1px solid #292929;
  border-radius: 9px;
  background: #111;
}

.dash-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
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
  color: #aaa;
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dash-card__value {
  flex: 0 0 auto;
  color: #f2f2f2;
  font-size: 13px;
  font-weight: 600;
}

.dash-card__description {
  margin: 7px 0 0;
  overflow: hidden;
  color: #858585;
  font-size: 10px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dash-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.dash-card__actions button {
  min-height: 24px;
  border: 1px solid #343434;
  border-radius: 7px;
  background: transparent;
  color: #d7d7d7;
  cursor: pointer;
  padding: 0 8px;
  font: inherit;
  font-size: 11px;
}

.dash-card__actions button:hover:not(:disabled) {
  border-color: #5a5a5a;
  color: #fff;
}

.dash-card__actions button:disabled {
  cursor: default;
  opacity: 0.45;
}

@media (max-width: 640px) {
  .dash-cards {
    grid-template-columns: 1fr;
  }
}
</style>

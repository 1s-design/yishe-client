<script setup lang="ts">
export interface DashboardStatusCard {
  key: string;
  title: string;
  value: string;
  description: string;
  details?: string[];
  icon: string;
  tone: "success" | "warning" | "danger" | "muted";
  actions?: DashboardStatusCardAction[];
}

export interface DashboardStatusCardAction {
  key: string;
  label: string;
  icon: string;
  loading?: boolean;
  disabled?: boolean;
}

const props = defineProps<{
  statusCards: DashboardStatusCard[];
}>();

const emit = defineEmits<{
  cardAction: [key: string];
}>();

function toneClass(tone: DashboardStatusCard["tone"]) {
  return `is-${tone}`;
}
</script>

<template>
  <div class="dash-cards">
    <article
      v-for="item in props.statusCards"
      :key="item.key"
      class="dash-card"
      :class="toneClass(item.tone)"
      :title="item.description"
    >
      <div class="dash-card__head">
        <span class="dash-card__dot" :class="toneClass(item.tone)"></span>
        <span class="dash-card__title">{{ item.title }}</span>
      </div>
      <div class="dash-card__row">
        <span class="dash-card__value">{{ item.value }}</span>
        <span v-if="item.actions?.length" class="dash-card__actions">
          <button
            v-for="action in item.actions"
            :key="action.key"
            type="button"
            class="dash-card__btn"
            :disabled="action.disabled || action.loading"
            :title="action.label"
            @click.stop="emit('cardAction', action.key)"
          >
            <i
              :class="[
                'mdi',
                action.loading ? 'mdi-loading mdi-spin' : action.icon,
              ]"
            ></i>
          </button>
        </span>
      </div>
      <div v-if="item.description" class="dash-card__description">
        {{ item.description }}
      </div>
      <div v-if="item.details?.length" class="dash-card__details">
        <span
          v-for="detail in item.details"
          :key="detail"
          class="dash-card__detail"
        >
          {{ detail }}
        </span>
      </div>
    </article>
  </div>
</template>

<style scoped>
.dash-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.dash-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 11px;
  border: 1px solid var(--theme-border);
  border-radius: 10px;
  background: var(--theme-surface);
  min-height: 76px;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.dash-card__head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.dash-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--theme-text-soft);
}

.dash-card__dot.is-success {
  background: var(--theme-success);
  animation: dashPulse 2s ease-in-out infinite;
}

.dash-card__dot.is-warning {
  background: var(--theme-warning);
  animation: dashPulse 2s ease-in-out infinite;
}

.dash-card__dot.is-danger {
  background: var(--theme-danger);
  animation: dashPulse 2s ease-in-out infinite;
}

.dash-card__dot.is-muted {
  background: var(--theme-text-soft);
}

.dash-card__title {
  color: var(--theme-text-muted);
  font-size: 10px;
  font-weight: 600;
}

.dash-card__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dash-card__value {
  color: var(--theme-text);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.01em;
}

.dash-card__description {
  min-height: 16px;
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dash-card__details {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 18px;
}

.dash-card__detail {
  max-width: 100%;
  padding: 2px 5px;
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  background: var(--theme-surface-muted);
  color: var(--theme-text-muted);
  font-size: 9px;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dash-card__actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.dash-card__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--theme-border);
  border-radius: 7px;
  background: var(--theme-surface-muted);
  color: var(--theme-text);
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    opacity 0.18s ease;
}

.dash-card__btn:hover:not(:disabled) {
  border-color: var(--theme-border-strong);
  background: var(--theme-surface-strong);
}

.dash-card__btn:disabled {
  cursor: default;
  opacity: 0.55;
}

.dash-card__btn .mdi-spin {
  animation: dashSpin 0.9s linear infinite;
}

@keyframes dashPulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 32%, transparent);
  }
  70% {
    box-shadow: 0 0 0 6px color-mix(in srgb, currentColor 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 0%, transparent);
  }
}

@keyframes dashSpin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 680px) {
  .dash-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 420px) {
  .dash-cards {
    grid-template-columns: 1fr;
  }
}
</style>

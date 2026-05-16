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
      :class="[
        toneClass(item.tone),
        { 'is-highlight': item.highlight, 'is-busy': item.busy },
      ]"
      :title="item.hoverLines?.length ? undefined : item.description"
    >
      <div
        v-if="item.hoverLines?.length"
        class="dash-card__hover"
        role="tooltip"
      >
        <strong v-if="item.hoverTitle">{{ item.hoverTitle }}</strong>
        <span v-for="line in item.hoverLines" :key="line">{{ line }}</span>
      </div>
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
          :key="detail.text"
          class="dash-card__detail"
          :class="detail.tone ? toneClass(detail.tone) : undefined"
        >
          {{ detail.text }}
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
  position: relative;
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

.dash-card.is-highlight {
  border-color: var(--theme-success);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--theme-success) 6%, transparent),
    transparent 60%
  );
  box-shadow: 0 0 12px color-mix(in srgb, var(--theme-success) 15%, transparent);
}

.dash-card.is-highlight .dash-card__value {
  color: var(--theme-success);
}

.dash-card.is-highlight .dash-card__description {
  color: var(--theme-success);
  font-weight: 600;
}

.dash-card.is-busy {
  border-color: var(--theme-warning);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--theme-warning) 6%, transparent),
    transparent 60%
  );
  box-shadow: 0 0 12px color-mix(in srgb, var(--theme-warning) 15%, transparent);
}

.dash-card.is-busy .dash-card__value {
  color: var(--theme-warning);
}

.dash-card.is-busy .dash-card__description {
  color: var(--theme-warning);
  font-weight: 500;
}

.dash-card__hover {
  position: absolute;
  z-index: 20;
  left: 10px;
  right: 10px;
  top: calc(100% + 2px);
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: min(360px, calc(100vw - 24px));
  padding: 8px 9px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  background: var(--theme-surface);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
  color: var(--theme-text-muted);
  font-size: 10px;
  line-height: 1.45;
  opacity: 0;
  pointer-events: auto;
  user-select: text;
  cursor: text;
  visibility: hidden;
  transform: translateY(-3px);
  transition:
    opacity 0.14s ease,
    transform 0.14s ease,
    visibility 0.14s ease;
}

.dash-card__hover::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -8px;
  height: 8px;
}

.dash-card__hover strong {
  color: var(--theme-text);
  font-size: 10px;
  line-height: 1.35;
}

.dash-card__hover span {
  overflow-wrap: anywhere;
  user-select: text;
}

.dash-card:hover {
  z-index: 30;
}

.dash-card:hover .dash-card__hover {
  opacity: 1;
  transform: translateY(0);
  visibility: visible;
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

.dash-card__detail.is-success {
  border-color: color-mix(in srgb, var(--theme-success) 42%, var(--theme-border));
  background: color-mix(in srgb, var(--theme-success) 10%, var(--theme-surface-muted));
  color: var(--theme-success);
}

.dash-card__detail.is-warning {
  border-color: color-mix(in srgb, var(--theme-warning) 42%, var(--theme-border));
  background: color-mix(in srgb, var(--theme-warning) 10%, var(--theme-surface-muted));
  color: var(--theme-warning);
}

.dash-card__detail.is-danger {
  border-color: color-mix(in srgb, var(--theme-danger) 42%, var(--theme-border));
  background: color-mix(in srgb, var(--theme-danger) 10%, var(--theme-surface-muted));
  color: var(--theme-danger);
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

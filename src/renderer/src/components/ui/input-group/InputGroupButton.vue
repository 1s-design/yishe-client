<script setup lang="ts">
import { type HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

interface Props {
  class?: HTMLAttributes['class'];
  disabled?: boolean;
}

const props = defineProps<Props>();
</script>

<template>
  <button
    type="button"
    :disabled="props.disabled"
    :class="cn('inline-flex items-center justify-center rounded-full transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-50', props.class)"
  >
    <slot />
  </button>
</template>

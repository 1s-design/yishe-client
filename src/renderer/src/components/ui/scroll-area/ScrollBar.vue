<script setup lang="ts">
import { type HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

interface Props {
  class?: HTMLAttributes['class'];
  orientation?: 'vertical' | 'horizontal';
}

const props = withDefaults(defineProps<Props>(), {
  orientation: 'vertical',
});
</script>

<template>
  <div :class="cn('flex touch-none select-none transition-colors', props.class)" />
</template>

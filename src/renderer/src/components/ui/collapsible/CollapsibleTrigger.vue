<script setup lang="ts">
import { inject, type HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

interface Props {
  class?: HTMLAttributes['class'];
  asChild?: boolean;
}

const props = defineProps<Props>();

const ctx = inject<{ isOpen: any; toggle: () => void } | null>('collapsible', null);

function handleClick() {
  ctx?.toggle();
}
</script>

<template>
  <button
    type="button"
    @click="handleClick"
    :class="cn('cursor-pointer', props.class)"
  >
    <slot />
  </button>
</template>

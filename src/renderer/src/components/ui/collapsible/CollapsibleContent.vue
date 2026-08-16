<script setup lang="ts">
import { inject, type HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

interface Props {
  class?: HTMLAttributes['class'];
}

const props = defineProps<Props>();

const ctx = inject<{ isOpen: any } | null>('collapsible', null);
</script>

<template>
  <div v-show="ctx?.isOpen?.value ?? true" :class="cn('overflow-hidden transition-all', props.class)">
    <slot />
  </div>
</template>

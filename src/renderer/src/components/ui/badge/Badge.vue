<script setup lang="ts">
import { type HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

interface Props {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
});
</script>

<template>
  <div
    :class="
      cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-hidden',
        props.variant === 'default' && 'border-transparent bg-primary text-primary-foreground shadow-xs hover:bg-primary/80',
        props.variant === 'secondary' && 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        props.variant === 'destructive' && 'border-transparent bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/80',
        props.variant === 'outline' && 'text-foreground',
        props.class
      )
    "
  >
    <slot />
  </div>
</template>

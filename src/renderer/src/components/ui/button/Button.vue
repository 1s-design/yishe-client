<script setup lang="ts">
import { type HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

interface Props {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  class?: HTMLAttributes['class'];
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'default',
});
</script>

<template>
  <button
    :disabled="props.disabled"
    :class="
      cn(
        'inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
        props.variant === 'default' && 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        props.variant === 'destructive' && 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        props.variant === 'outline' && 'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        props.variant === 'secondary' && 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        props.variant === 'ghost' && 'hover:bg-accent hover:text-accent-foreground',
        props.variant === 'link' && 'text-primary underline-offset-4 hover:underline',
        props.size === 'default' && 'h-9 px-4 py-2',
        props.size === 'sm' && 'h-8 rounded-md px-3 text-xs',
        props.size === 'lg' && 'h-10 rounded-md px-8',
        props.size === 'icon' && 'h-9 w-9',
        props.class
      )
    "
  >
    <slot />
  </button>
</template>

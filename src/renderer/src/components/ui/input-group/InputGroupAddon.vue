<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

type Align = 'inline-start' | 'inline-end' | 'block-start' | 'block-end'
const props = withDefaults(defineProps<{ align?: Align; class?: HTMLAttributes['class'] }>(), { align: 'inline-start' })
</script>

<template>
  <div
    role="group"
    data-slot="input-group-addon"
    :data-align="props.align"
    :class="cn(
      'text-muted-foreground flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium select-none',
      props.align === 'inline-start' && 'order-first pl-3 has-[>button]:ml-[-0.45rem]',
      props.align === 'inline-end' && 'order-last pr-3 has-[>button]:mr-[-0.45rem]',
      props.align === 'block-start' && 'order-first w-full justify-start px-3 pt-3',
      props.align === 'block-end' && 'order-last w-full justify-start px-3 pb-3',
      props.class,
    )"
  >
    <slot />
  </div>
</template>

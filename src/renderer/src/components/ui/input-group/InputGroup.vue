<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <div
    data-slot="input-group"
    role="group"
    :class="cn(
      'group/input-group relative flex w-full min-w-0 items-center rounded-3xl border border-input bg-card shadow-xs outline-none transition-[color,box-shadow]',
      'has-[>textarea]:h-auto has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50',
      'has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col',
      'has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col',
      props.class,
    )"
  >
    <slot />
  </div>
</template>

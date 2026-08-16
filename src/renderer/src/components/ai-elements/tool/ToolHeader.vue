<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CollapsibleTrigger } from '@/components/ui/collapsible/index'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
  name?: string
}

const props = defineProps<Props>()
</script>

<template>
  <CollapsibleTrigger
    :class="
      cn(
        'flex w-full items-center justify-between font-mono text-xs cursor-pointer select-none',
        props.class,
      )
    "
  >
    <slot>
      <div class="flex items-center gap-2">
        <span class="mdi mdi-wrench text-xs text-muted-foreground"></span>
        <span class="font-medium">{{ props.name }}</span>
      </div>
      <span class="mdi mdi-chevron-down text-xs text-muted-foreground transition-transform"></span>
    </slot>
  </CollapsibleTrigger>
</template>

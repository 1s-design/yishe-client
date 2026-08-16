<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CollapsibleTrigger } from '@/components/ui/collapsible/index'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <CollapsibleTrigger
    :class="
      cn(
        'flex items-center gap-2 text-muted-foreground hover:text-foreground text-xs select-none cursor-pointer',
        props.class,
      )
    "
  >
    <slot>
      <span class="mdi mdi-brain text-sm"></span>
      <span>思考过程</span>
      <span class="mdi mdi-chevron-down text-xs"></span>
    </slot>
  </CollapsibleTrigger>
</template>

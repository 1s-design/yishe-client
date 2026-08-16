<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CollapsibleContent } from '@/components/ui/collapsible/index'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <CollapsibleContent
    :class="
      cn(
        'mt-2 border-l-2 border-border/80 pl-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap',
        props.class,
      )
    "
  >
    <slot />
  </CollapsibleContent>
</template>

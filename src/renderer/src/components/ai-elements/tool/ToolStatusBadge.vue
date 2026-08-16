<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Badge } from '@/components/ui/badge/index'
import { cn } from '@/lib/utils'

interface Props {
  status: 'running' | 'success' | 'error' | string
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <Badge
    :variant="props.status === 'error' ? 'destructive' : 'secondary'"
    :class="
      cn(
        'gap-1 text-[10px] font-mono capitalize',
        props.status === 'running' && 'animate-pulse text-amber-600',
        props.status === 'success' && 'text-emerald-600',
        props.class,
      )
    "
  >
    <span
      v-if="props.status === 'running'"
      class="inline-block size-1.5 rounded-full bg-amber-500"
    />
    <span
      v-else-if="props.status === 'success'"
      class="inline-block size-1.5 rounded-full bg-emerald-500"
    />
    <span
      v-else-if="props.status === 'error'"
      class="inline-block size-1.5 rounded-full bg-destructive"
    />
    <slot>{{ props.status }}</slot>
  </Badge>
</template>

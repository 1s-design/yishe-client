<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  ariaLabel?: string
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  ariaLabel: 'Conversation',
})
</script>

<template>
  <div
    :aria-label="props.ariaLabel"
    :class="cn('relative flex-1 overflow-y-auto', props.class)"
    role="log"
  >
    <slot />
  </div>
</template>

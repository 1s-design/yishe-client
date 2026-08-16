<script setup lang="ts">
import { type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  from: 'user' | 'assistant' | 'system'
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div
    :class="
      cn(
        'group flex w-full flex-col gap-2',
        props.from === 'user' ? 'is-user items-end' : props.from === 'assistant' ? 'is-assistant items-start' : 'items-start',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { type HTMLAttributes } from 'vue'
import { InputGroup } from '@/components/ui/input-group/index'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <InputGroup
    :class="
      cn(
        'relative flex w-full flex-col rounded-3xl border border-border bg-card p-2 shadow-xs transition-colors',
        props.class,
      )
    "
  >
    <slot />
  </InputGroup>
</template>

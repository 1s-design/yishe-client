<script setup lang="ts">
import { type HTMLAttributes } from 'vue'
import { Button } from '@/components/ui/button/index'
import { cn } from '@/lib/utils'

interface Props {
  title?: string
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    :title="props.title"
    :class="cn('size-7 rounded-md p-0 text-muted-foreground hover:text-foreground cursor-pointer', props.class)"
    v-bind="$attrs"
  >
    <slot />
  </Button>
</template>

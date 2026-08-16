<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Button } from '@/components/ui/button/index'
import { cn } from '@/lib/utils'
import { useAttachmentContext } from './context'

interface Props {
  label?: string
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  label: 'Remove',
})

const { remove, variant } = useAttachmentContext()

function handleClick(e: Event) {
  e.stopPropagation()
  remove?.()
}
</script>

<template>
  <Button
    v-if="remove"
    :aria-label="props.label"
    :class="
      cn(
        variant === 'grid'
          && [
            'absolute top-1.5 right-1.5 size-5 rounded-full p-0 flex items-center justify-center',
            'bg-background/80 backdrop-blur-xs',
            'opacity-0 transition-opacity group-hover:opacity-100',
            'hover:bg-background cursor-pointer',
          ],
        variant === 'inline'
          && [
            'size-4 rounded p-0 flex items-center justify-center',
            'opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer',
          ],
        variant === 'list' && ['size-6 shrink-0 rounded p-0 flex items-center justify-center cursor-pointer'],
        props.class,
      )
    "
    type="button"
    variant="ghost"
    @click="handleClick"
  >
    <slot>
      <span class="mdi mdi-close text-xs"></span>
    </slot>
    <span class="sr-only">{{ props.label }}</span>
  </Button>
</template>

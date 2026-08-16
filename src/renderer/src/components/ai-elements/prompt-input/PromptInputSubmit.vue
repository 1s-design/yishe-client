<script setup lang="ts">
import { type HTMLAttributes } from 'vue'
import { InputGroupButton } from '@/components/ui/input-group/index'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
  disabled?: boolean
  status?: string
}

const props = defineProps<Props>()
</script>

<template>
  <InputGroupButton
    type="button"
    :disabled="props.disabled"
    :class="cn('size-7 rounded-full cursor-pointer', props.class)"
    v-bind="$attrs"
  >
    <slot>
      <span class="mdi mdi-arrow-up text-lg"></span>
    </slot>
  </InputGroupButton>
</template>

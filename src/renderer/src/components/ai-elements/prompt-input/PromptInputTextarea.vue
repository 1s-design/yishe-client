<script setup lang="ts">
import { type HTMLAttributes, ref } from 'vue'
import { InputGroupTextarea } from '@/components/ui/input-group/index'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
  placeholder?: string
  modelValue?: string
  rows?: number | string
  disabled?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void
  (e: 'submit'): void
}>()

const isComposing = ref(false)

function handleInput(val: string) {
  emit('update:modelValue', val)
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    if (isComposing.value || e.isComposing || e.shiftKey) return
    e.preventDefault()
    emit('submit')
  }
}
</script>

<template>
  <InputGroupTextarea
    :model-value="props.modelValue"
    :placeholder="props.placeholder || '发送消息...'"
    :rows="props.rows || 1"
    :disabled="props.disabled"
    :class="cn('max-h-48 min-h-14 resize-none bg-transparent', props.class)"
    @update:model-value="handleInput"
    @keydown="handleKeyDown"
    @compositionstart="isComposing = true"
    @compositionend="isComposing = false"
  />
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props { class?: HTMLAttributes['class']; modelValue?: string; placeholder?: string; rows?: number | string; disabled?: boolean }
const props = defineProps<Props>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()
</script>

<template>
  <textarea
    data-slot="input-group-control"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :rows="props.rows"
    :disabled="props.disabled"
    :class="cn('field-sizing-content flex min-h-14 w-full min-w-0 flex-1 self-stretch resize-none rounded-none border-0 bg-transparent px-3 py-2.5 text-[13px] leading-5 shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50', props.class)"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>

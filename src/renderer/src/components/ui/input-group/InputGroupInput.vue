<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props { class?: HTMLAttributes['class']; modelValue?: string; placeholder?: string; type?: string; disabled?: boolean }
const props = withDefaults(defineProps<Props>(), { type: 'text' })
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()
</script>

<template>
  <input
    data-slot="input-group-control"
    :type="props.type"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :class="cn('flex h-9 min-w-0 flex-1 rounded-md border-0 bg-transparent px-3 py-1 text-sm shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50', props.class)"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

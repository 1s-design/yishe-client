<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import MarkdownRenderer from '../../agent/MarkdownRenderer.vue'

interface Props {
  content: string
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div :class="cn('max-w-none text-[13px] leading-6', props.class)">
    <MarkdownRenderer :content="props.content" />
  </div>
</template>

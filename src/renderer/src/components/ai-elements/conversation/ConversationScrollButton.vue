<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { HTMLAttributes } from 'vue'
import { Button } from '@/components/ui/button/index'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const isVisible = ref(false)
let conversation: HTMLElement | null = null

function updateVisibility() {
  if (!conversation) return
  isVisible.value = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight > 24
}

function scrollToBottom() {
  conversation?.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' })
}

onMounted(() => {
  conversation = document.querySelector('[role="log"]')
  conversation?.addEventListener('scroll', updateVisibility, { passive: true })
  requestAnimationFrame(updateVisibility)
})

onBeforeUnmount(() => {
  conversation?.removeEventListener('scroll', updateVisibility)
})
</script>

<template>
  <Button
    v-if="isVisible"
    type="button"
    variant="outline"
    size="icon"
    aria-label="滚动到底部"
    :class="cn('absolute bottom-4 right-4 z-10 size-8 rounded-full border border-border bg-background shadow-md transition-all hover:bg-accent', props.class)"
    @click="scrollToBottom"
  >
    <slot>
      <span class="mdi mdi-arrow-down text-sm" />
    </slot>
  </Button>
</template>

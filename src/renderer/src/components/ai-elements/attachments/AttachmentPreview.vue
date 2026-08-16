<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { computed } from 'vue'
import { useAttachmentContext } from './context'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { data, mediaCategory, variant } = useAttachmentContext()

const isGrid = computed(() => variant.value === 'grid')
const fileUrl = computed(() => data.value.url)
const showImage = computed(() => mediaCategory.value === 'image' && !!fileUrl.value)
const showVideo = computed(() => mediaCategory.value === 'video' && !!fileUrl.value)
</script>

<template>
  <div
    :class="
      cn(
        'flex shrink-0 items-center justify-center overflow-hidden',
        variant === 'grid' && 'size-full bg-muted',
        variant === 'inline' && 'size-5 rounded bg-background',
        variant === 'list' && 'size-10 rounded-lg bg-muted',
        props.class,
      )
    "
  >
    <img
      v-if="showImage"
      :alt="data.filename || data.name || 'Image'"
      :class="isGrid ? 'size-full object-cover' : 'size-full rounded-lg object-cover'"
      :src="fileUrl"
    >
    <video
      v-else-if="showVideo"
      class="size-full object-cover"
      muted
      :src="fileUrl"
    />
    <!-- Document SVG -->
    <svg
      v-else-if="mediaCategory === 'document'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="text-muted-foreground"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
    <!-- Default Paperclip SVG -->
    <svg
      v-else
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="text-muted-foreground"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  </div>
</template>

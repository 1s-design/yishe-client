<script setup lang="ts">
import { ref, provide, watch, type HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

interface Props {
  open?: boolean;
  defaultOpen?: boolean;
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<Props>(), {
  defaultOpen: false,
});

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
}>();

const isOpen = ref(props.open !== undefined ? props.open : props.defaultOpen);

watch(
  () => props.open,
  (val) => {
    if (val !== undefined) isOpen.value = val;
  }
);

function toggle() {
  isOpen.value = !isOpen.value;
  emit('update:open', isOpen.value);
}

provide('collapsible', {
  isOpen,
  toggle,
});
</script>

<template>
  <div :class="cn('', props.class)">
    <slot :is-open="isOpen" />
  </div>
</template>

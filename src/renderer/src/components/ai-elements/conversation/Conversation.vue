<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { cn } from "@/lib/utils";

interface Props {
  ariaLabel?: string;
  class?: HTMLAttributes["class"];
}

const props = withDefaults(defineProps<Props>(), {
  ariaLabel: "Conversation",
});

const container = ref<HTMLElement | null>(null);
const BOTTOM_THRESHOLD_PX = 72;
let stickToBottom = true;
let mutationObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let scheduled = false;

function isNearBottom() {
  const element = container.value;
  if (!element) return true;
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    BOTTOM_THRESHOLD_PX
  );
}

function scrollToBottom(behavior: ScrollBehavior = "auto") {
  const element = container.value;
  if (!element) return;
  element.scrollTo({ top: element.scrollHeight, behavior });
}

function scheduleFollow() {
  if (scheduled || !stickToBottom) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (stickToBottom) scrollToBottom();
  });
}

function handleScroll() {
  // 用户主动上滚时不打断阅读；回到底部后下一次流式输出会继续跟随。
  stickToBottom = isNearBottom();
}

onMounted(() => {
  const element = container.value;
  if (!element) return;

  void nextTick(() => {
    stickToBottom = true;
    scrollToBottom();
  });

  element.addEventListener("scroll", handleScroll, { passive: true });
  mutationObserver = new MutationObserver(scheduleFollow);
  mutationObserver.observe(element, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  resizeObserver = new ResizeObserver(scheduleFollow);
  resizeObserver.observe(element);
});

onBeforeUnmount(() => {
  container.value?.removeEventListener("scroll", handleScroll);
  mutationObserver?.disconnect();
  resizeObserver?.disconnect();
});

defineExpose({
  scrollToBottom: () => {
    stickToBottom = true;
    scrollToBottom("smooth");
  },
  isNearBottom,
});
</script>

<template>
  <div
    ref="container"
    :aria-label="props.ariaLabel"
    :class="cn('relative flex-1 overflow-y-auto', props.class)"
    role="log"
  >
    <slot />
  </div>
</template>

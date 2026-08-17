<template>
  <div
    class="agent-shell flex h-screen w-screen overflow-hidden bg-background text-[13px] text-foreground"
  >
    <Starfield />
    <ChatSidebar
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :user-info="userInfo"
      @new-chat="handleNewChat"
      @select="handleSelectSession"
      @delete="handleDeleteSession"
      @login="emit('open-login')"
      @open-dashboard="emit('open-dashboard')"
      @logout="emit('logout')"
    />

    <ChatView
      :messages="activeMessages"
      :is-streaming="isStreaming"
      :is-configured="agentConfig.enabled"
      :is-config-loaded="agentConfig.loaded"
      @send="handleSend"
      @stop="handleStop"
      @resolve-tool-approval="handleResolveToolApproval"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { getRemoteApiBase } from "../config/api";
import { useAgent } from "../composables/useAgent";
import ChatSidebar from "../components/agent/ChatSidebar.vue";
import ChatView from "../components/agent/ChatView.vue";
import Starfield from "../components/agent/Starfield.vue";

const emit = defineEmits<{
  (e: "open-dashboard"): void;
  (e: "open-login"): void;
  (e: "logout"): void;
}>();

const props = defineProps<{
  userInfo?: {
    account?: string;
    username?: string;
    avatar?: string;
    avatarUrl?: string;
    [key: string]: unknown;
  } | null;
}>();

const {
  sessions,
  activeSessionId,
  isStreaming,
  createSession,
  setActiveSession,
  deleteSession,
  sendMessage,
  stopGeneration,
  resolveToolApproval,
  syncCloudConfig,
} = useAgent();

const userInfo = computed(() => props.userInfo);
const agentConfig = ref({ loaded: false, enabled: false });

const activeMessages = computed(() => {
  const session = sessions.value.find((s) => s.id === activeSessionId.value);
  return session?.messages || [];
});

async function syncServerBoundAgent() {
  agentConfig.value = { loaded: false, enabled: false };
  const token = await window.api?.getToken?.();
  if (!token) {
    agentConfig.value = { loaded: true, enabled: false };
    return;
  }

  try {
    const config = await syncCloudConfig({
      serverBase: getRemoteApiBase(),
      token,
    });
    agentConfig.value = { loaded: true, enabled: Boolean(config?.enabled) };
  } catch {
    agentConfig.value = { loaded: true, enabled: false };
  }
}

watch(
  () => props.userInfo,
  (user) => {
    if (user) {
      void syncServerBoundAgent();
    } else {
      agentConfig.value = { loaded: true, enabled: false };
    }
  },
  { immediate: true },
);

function handleNewChat() {
  createSession();
}

function handleSelectSession(id: string) {
  setActiveSession(id);
}

function handleDeleteSession(id: string) {
  deleteSession(id);
}

async function handleSend(text: string, attachments?: any[]) {
  await sendMessage(text, attachments);
}

async function handleStop() {
  await stopGeneration();
}

async function handleResolveToolApproval(payload: {
  callId: string;
  approved: boolean;
}) {
  await resolveToolApproval(payload.callId, payload.approved);
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    handleNewChat();
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

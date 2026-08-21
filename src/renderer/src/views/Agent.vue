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
      @refresh="handleRefresh"
      @open-capability-browser="handleOpenCapabilityBrowser"
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

    <CapabilityBrowser
      :is-open="showCapabilityBrowser"
      @close="showCapabilityBrowser = false"
      @add-tools="handleAddTools"
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
import CapabilityBrowser from "../components/agent/CapabilityBrowser.vue";
import type { CapabilityTool } from "../components/agent/CapabilityBrowser.vue";

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
  refreshSessions,
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

async function handleRefresh() {
  await refreshSessions();
}

const showCapabilityBrowser = ref(false);

function handleOpenCapabilityBrowser() {
  showCapabilityBrowser.value = true;
}

async function handleAddTools(tools: CapabilityTool[]) {
  if (tools.length === 0) return;
  const toolNames = tools.map((t) => t.name).join("、");
  const message = `已选择工具：${toolNames}。请告诉我需要执行的具体任务或参数。`;
  await sendMessage(message, [], {
    selectedTools: tools.map((tool) => ({
      name: tool.name,
      source: tool.source,
      label: tool.displayName,
    })),
    toolSelectionOnly: true,
  });
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

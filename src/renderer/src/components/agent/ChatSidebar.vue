<template>
  <aside
    class="chat-sidebar"
    :class="{ 'is-collapsed': isCollapsed }"
    aria-label="衣设 Agent 导航"
  >
    <header class="sidebar-header">
      <div class="sidebar-brand" aria-label="1s design">
        <img :src="brandLogo" alt="1s design" class="sidebar-brand__logo" />
      </div>
      <button
        type="button"
        class="sidebar-icon-button sidebar-collapse-button"
        :aria-label="isCollapsed ? '展开侧边栏' : '收起侧边栏'"
        :title="isCollapsed ? '展开侧边栏' : '收起侧边栏'"
        :aria-expanded="!isCollapsed"
        @click="isCollapsed = !isCollapsed"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path v-if="!isCollapsed" d="m14 7-5 5 5 5M20 7l-5 5 5 5" />
          <path v-else d="m10 7 5 5-5 5M4 7l5 5-5 5" />
        </svg>
      </button>
    </header>

    <div class="sidebar-content">
      <nav class="sidebar-primary" aria-label="主要操作">
        <button
          type="button"
          class="sidebar-item sidebar-item--new"
          title="新建对话"
          @click="$emit('newChat')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
          </svg>
          <span class="sidebar-item__label">新建</span>
          <kbd v-if="!isCollapsed">⌘ K</kbd>
        </button>
      </nav>

      <section
        class="sidebar-section sidebar-history"
        aria-labelledby="history-title"
      >
        <div class="sidebar-section__heading">
          <span id="history-title">历史</span>
        </div>

        <div class="sidebar-sessions">
          <div
            v-for="session in sessions"
            :key="session.id"
            class="sidebar-session"
            :class="{ 'is-active': session.id === activeSessionId }"
            role="button"
            tabindex="0"
            :title="session.title || '新对话'"
            @click="$emit('select', session.id)"
            @keydown.enter="$emit('select', session.id)"
            @mouseenter="hoveredId = session.id"
            @mouseleave="hoveredId = null"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"
              />
            </svg>
            <span class="sidebar-session__title">{{
              session.title || "新对话"
            }}</span>
            <button
              v-if="hoveredId === session.id && !isCollapsed"
              type="button"
              class="sidebar-session__delete"
              title="删除此会话"
              aria-label="删除此会话"
              @click.stop="$emit('delete', session.id)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </section>
    </div>

    <footer class="sidebar-footer">
      <div class="sidebar-footer__actions">
        <button
          type="button"
          class="sidebar-item sidebar-item--secondary"
          title="服务控制台"
          @click="$emit('openDashboard')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span class="sidebar-item__label">控制台</span>
          <i class="sidebar-status-dot" aria-label="服务状态"></i>
        </button>
      </div>

      <div class="sidebar-account" :class="{ 'is-guest': !isAuthenticated }">
        <div class="sidebar-account__avatar" :title="accountName">
          <img v-if="accountAvatar" :src="accountAvatar" alt="" />
          <span v-else>{{ accountInitial }}</span>
        </div>
        <div v-if="!isCollapsed" class="sidebar-account__copy">
          <strong>{{ accountName }}</strong>
          <span>{{ accountMeta }}</span>
        </div>
        <button
          v-if="isAuthenticated"
          type="button"
          class="sidebar-account__action sidebar-account__logout"
          title="退出登录"
          aria-label="退出登录"
          @click="$emit('logout')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="m16 17 5-5-5-5M21 12H9" />
          </svg>
        </button>
        <button
          v-else
          type="button"
          class="sidebar-account__action sidebar-account__login"
          title="登录"
          aria-label="登录"
          @click="$emit('login')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 17l5-5-5-5" />
            <path d="M4 12h11" />
          </svg>
        </button>
      </div>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import brandLogo from "../../assets/icon.png";
import type { ChatSession } from "../../types/agent";

type SidebarUser = {
  account?: string;
  username?: string;
  avatar?: string;
  avatarUrl?: string;
  headimgurl?: string;
  [key: string]: unknown;
};

const props = defineProps<{
  sessions: ChatSession[];
  activeSessionId: string | null;
  userInfo?: SidebarUser | null;
}>();

defineEmits<{
  newChat: [];
  select: [id: string];
  delete: [id: string];
  login: [];
  openDashboard: [];
  logout: [];
}>();

const hoveredId = ref<string | null>(null);
const isCollapsed = ref(false);

const isAuthenticated = computed(() =>
  Boolean(props.userInfo?.username || props.userInfo?.account),
);
const accountName = computed(
  () => props.userInfo?.username || props.userInfo?.account || "未登录",
);
const accountMeta = computed(() => {
  if (!isAuthenticated.value) return "登录后开始使用";
  const account = String(props.userInfo?.account || "").trim();
  return account && account !== accountName.value ? account : "已登录";
});
const accountAvatar = computed(() => {
  const user = props.userInfo;
  const value = user?.avatarUrl || user?.avatar || user?.headimgurl;
  return typeof value === "string" && value.trim() ? value.trim() : "";
});
const accountInitial = computed(() =>
  accountName.value.trim().slice(0, 1).toUpperCase(),
);
</script>

<style scoped>
.chat-sidebar {
  --menu-bg: #090909;
  --menu-border: rgba(255, 255, 255, 0.1);
  --menu-text: #f4f4f4;
  --menu-muted: #999999;
  --menu-soft: rgba(255, 255, 255, 0.045);
  --menu-hover: rgba(255, 255, 255, 0.075);
  --menu-active: #1d1d1d;
  --menu-avatar: #292929;
  position: relative;
  display: flex;
  width: 288px;
  min-width: 288px;
  height: 100%;
  flex-shrink: 0;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--menu-border);
  background: var(--menu-bg);
  color: var(--menu-text);
  transition:
    width 180ms ease,
    min-width 180ms ease,
    background-color 180ms ease,
    border-color 180ms ease;
  user-select: none;
}

.chat-sidebar.is-collapsed {
  width: 72px;
  min-width: 72px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 76px;
  padding: 44px 14px 10px;
  -webkit-app-region: drag;
}

.sidebar-brand {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
}

.sidebar-brand__logo {
  display: block;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  object-fit: cover;
}

.sidebar-icon-button,
.sidebar-item,
.sidebar-session,
.sidebar-session__delete,
.sidebar-account__logout {
  border: 0;
  font: inherit;
  -webkit-app-region: no-drag;
}

.sidebar-icon-button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: transparent;
  color: var(--menu-muted);
  cursor: pointer;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.sidebar-icon-button:hover,
.sidebar-icon-button:focus-visible {
  background: var(--menu-hover);
  color: var(--menu-text);
  outline: none;
}

.sidebar-icon-button svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.sidebar-content {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 7px 10px 14px;
}

.sidebar-primary {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-item {
  display: flex;
  width: 100%;
  min-height: 38px;
  align-items: center;
  gap: 11px;
  border-radius: 9px;
  background: transparent;
  color: var(--menu-text);
  cursor: pointer;
  padding: 0 11px;
  text-align: left;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.sidebar-item:hover,
.sidebar-item:focus-visible {
  background: var(--menu-hover);
  outline: none;
}

.sidebar-item--new {
  background: var(--menu-active);
  font-weight: 650;
}

.sidebar-item--new:hover,
.sidebar-item--new:focus-visible {
  background: color-mix(in srgb, var(--menu-active) 82%, var(--menu-text));
}

.sidebar-item svg {
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.sidebar-item__label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-item kbd {
  border: 1px solid var(--menu-border);
  border-radius: 5px;
  color: var(--menu-muted);
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  line-height: 19px;
  padding: 0 5px;
}

.sidebar-section {
  margin-top: 26px;
}

.sidebar-section__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 25px;
  padding: 0 11px;
  color: var(--menu-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.sidebar-section__count {
  font-size: 10px;
  font-weight: 500;
  opacity: 0.65;
}

.sidebar-sessions {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 3px;
}

.sidebar-session {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 35px;
  align-items: center;
  gap: 10px;
  border-radius: 8px;
  background: transparent;
  color: var(--menu-muted);
  cursor: pointer;
  padding: 0 10px;
  text-align: left;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.sidebar-session:hover,
.sidebar-session:focus-visible {
  background: var(--menu-hover);
  color: var(--menu-text);
  outline: none;
}

.sidebar-session.is-active {
  background: var(--menu-soft);
  color: var(--menu-text);
}

.sidebar-session > svg {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  opacity: 0.65;
}

.sidebar-session__title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 550;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-session__delete {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: transparent;
  color: var(--menu-muted);
  cursor: pointer;
}

.sidebar-session__delete:hover,
.sidebar-session__delete:focus-visible {
  background: rgba(239, 68, 68, 0.12);
  color: #ef7777;
  outline: none;
}

.sidebar-session__delete svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.8;
}

.sidebar-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--menu-border);
  padding: 11px 10px 13px;
}

.sidebar-footer__actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-item--secondary {
  min-height: 34px;
  color: var(--menu-muted);
}

.sidebar-item--secondary:hover,
.sidebar-item--secondary:focus-visible {
  color: var(--menu-text);
}

.sidebar-status-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  margin-left: auto;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent);
}

.sidebar-account {
  display: flex;
  min-height: 56px;
  align-items: center;
  gap: 10px;
  margin-top: 9px;
  border-top: 1px solid var(--menu-border);
  padding: 12px 7px 0;
}

.sidebar-account__avatar {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--menu-border);
  border-radius: 10px;
  background: var(--menu-avatar);
  color: var(--menu-text);
  font-size: 11px;
  font-weight: 700;
}

.sidebar-account__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sidebar-account__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.sidebar-account__copy strong,
.sidebar-account__copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-account__copy strong {
  color: var(--menu-text);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
}

.sidebar-account__copy span {
  color: var(--menu-muted);
  font-size: 10px;
  line-height: 1.3;
}

.sidebar-account__action {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--menu-muted);
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.sidebar-account__action:hover,
.sidebar-account__action:focus-visible {
  background: var(--menu-hover);
  color: var(--menu-text);
  outline: none;
}

.sidebar-account__logout:hover,
.sidebar-account__logout:focus-visible {
  background: rgba(239, 68, 68, 0.1);
  color: #ef7777;
}

.sidebar-account__action svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.chat-sidebar.is-collapsed .sidebar-header {
  min-height: 128px;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 40px 10px 10px;
}

.chat-sidebar.is-collapsed .sidebar-collapse-button {
  order: -1;
  width: 22px;
  height: 22px;
}

.chat-sidebar.is-collapsed .sidebar-section__heading,
.chat-sidebar.is-collapsed .sidebar-item__label,
.chat-sidebar.is-collapsed .sidebar-session__title,
.chat-sidebar.is-collapsed .sidebar-account__copy {
  display: none;
}

.chat-sidebar.is-collapsed .sidebar-content {
  padding-right: 10px;
  padding-left: 10px;
}

.chat-sidebar.is-collapsed .sidebar-history {
  display: none;
}

.chat-sidebar.is-collapsed .sidebar-item,
.chat-sidebar.is-collapsed .sidebar-session {
  justify-content: center;
  padding-right: 0;
  padding-left: 0;
}

.chat-sidebar.is-collapsed .sidebar-item svg,
.chat-sidebar.is-collapsed .sidebar-session > svg {
  margin: 0;
}

.chat-sidebar.is-collapsed .sidebar-status-dot {
  display: none;
}

.chat-sidebar.is-collapsed .sidebar-footer {
  padding-right: 10px;
  padding-left: 10px;
}

.chat-sidebar.is-collapsed .sidebar-account {
  min-height: 84px;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
  padding-right: 0;
  padding-left: 0;
}

@media (max-width: 760px) {
  .chat-sidebar {
    width: 244px;
    min-width: 244px;
  }
}
</style>

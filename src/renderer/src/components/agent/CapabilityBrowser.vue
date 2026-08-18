<template>
  <Teleport to="body">
    <div v-if="isOpen" class="capability-overlay" @click.self="close">
      <div class="capability-modal">
        <!-- Header -->
        <div class="cap-header">
          <div class="cap-header-left">
            <h2>能力库</h2>
            <span class="cap-count">{{ allTools.length }} 个工具</span>
          </div>
          <div class="cap-header-right">
            <button class="cap-close" @click="close">✕</button>
          </div>
        </div>

        <!-- Search & Filter -->
        <div class="cap-controls">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索工具名称或描述..."
            class="cap-search"
          />
          <div class="cap-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.value"
              :class="['cap-tab', { active: activeTab === tab.value }]"
              @click="activeTab = tab.value"
            >
              {{ tab.label }}
              <span class="cap-tab-num">{{ getTabCount(tab.value) }}</span>
            </button>
          </div>
        </div>

        <!-- Content - Card Grid -->
        <div class="cap-content">
          <div v-if="loading" class="cap-loading">加载中...</div>
          <div v-else-if="filteredTools.length === 0" class="cap-empty">
            {{ allTools.length === 0 ? '暂无可用工具' : '没有匹配的工具' }}
          </div>
          <div v-else class="cap-grid">
            <div
              v-for="tool in filteredTools"
              :key="tool.id"
              :class="['cap-card', { selected: selectedIds.has(tool.id) }]"
              @click="toggleSelect(tool)"
            >
              <div class="cap-card-header">
                <input
                  type="checkbox"
                  :checked="selectedIds.has(tool.id)"
                  @click.stop
                  @change="toggleSelect(tool)"
                />
                <span :class="['cap-card-badge', tool.source]">{{ tool.source === 'client' ? '本地' : '云端' }}</span>
              </div>
              <div class="cap-card-name">{{ tool.displayName }}</div>
              <div class="cap-card-desc">{{ tool.description || '暂无描述' }}</div>
              <div class="cap-card-category">{{ tool.category }}</div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="cap-footer">
          <span v-if="selectedIds.size > 0" class="cap-selected-count">
            已选 <strong>{{ selectedIds.size }}</strong> 个
          </span>
          <span v-else class="cap-hint">点击卡片选择工具</span>
          <div class="cap-actions">
            <button class="cap-btn" @click="clearSelection">清空</button>
            <button
              class="cap-btn cap-btn-primary"
              :disabled="selectedIds.size === 0"
              @click="addToConversation"
            >
              添加到对话
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { LOCAL_API_BASE } from '../../config/api';

export interface CapabilityTool {
  id: string;
  name: string;
  displayName: string;
  description: string;
  source: 'client' | 'server';
  category: string;
  riskLevel: string;
}

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ close: []; addTools: [tools: CapabilityTool[]] }>();

const loading = ref(false);
const searchQuery = ref('');
const activeTab = ref('all');
const allTools = ref<CapabilityTool[]>([]);
const selectedIds = ref<Set<string>>(new Set());

const tabs = [
  { value: 'all', label: '全部' },
  { value: 'client', label: '本地' },
  { value: 'server', label: '云端' },
];

async function fetchTools() {
  loading.value = true;
  const tools: CapabilityTool[] = [];

  try {
    const res = await fetch(`${LOCAL_API_BASE}/capabilities`);
    const data = await res.json();
    if (data.success && data.capabilities) {
      for (const cap of data.capabilities) {
        tools.push({
          id: `c:${cap.namespace}:${cap.name}`,
          name: `${cap.namespace}.${cap.name}`,
          displayName: cap.name,
          description: cap.description || '',
          source: 'client',
          category: cap.namespace,
          riskLevel: cap.riskLevel || 'low',
        });
      }
    }
  } catch (e) {
    console.error('Failed to fetch client capabilities:', e);
  }

  try {
    const res = await fetch(`${LOCAL_API_BASE}/agent/server-capabilities`);
    const data = await res.json();
    if (data.data?.tools) {
      for (const tool of data.data.tools) {
        if (!tool.name) continue;
        tools.push({
          id: `s:${tool.name}`,
          name: tool.name,
          displayName: tool.name,
          description: tool.description || '',
          source: 'server',
          category: tool.category || '',
          riskLevel: tool.riskLevel || 'low',
        });
      }
    }
  } catch (e) {
    console.error('Failed to fetch server capabilities:', e);
  }

  allTools.value = tools;
  loading.value = false;
}

watch(
  () => props.isOpen,
  async (val) => {
    if (val) {
      selectedIds.value.clear();
      searchQuery.value = '';
      activeTab.value = 'all';
      await nextTick();
      fetchTools();
    }
  },
);

const filteredTools = computed(() => {
  let tools = allTools.value;
  if (activeTab.value === 'client') tools = tools.filter((t) => t.source === 'client');
  if (activeTab.value === 'server') tools = tools.filter((t) => t.source === 'server');
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase();
    tools = tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }
  return tools;
});

function getTabCount(tab: string) {
  if (tab === 'client') return allTools.value.filter((t) => t.source === 'client').length;
  if (tab === 'server') return allTools.value.filter((t) => t.source === 'server').length;
  return allTools.value.length;
}

function toggleSelect(tool: CapabilityTool) {
  const next = new Set(selectedIds.value);
  if (next.has(tool.id)) next.delete(tool.id);
  else next.add(tool.id);
  selectedIds.value = next;
}

function clearSelection() {
  selectedIds.value.clear();
}

function addToConversation() {
  const selected = allTools.value.filter((t) => selectedIds.value.has(t.id));
  emit('addTools', selected);
  close();
}

function close() {
  emit('close');
}
</script>

<style scoped>
.capability-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.capability-modal {
  width: 100%;
  height: 100%;
  max-width: 1400px;
  max-height: 100%;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.cap-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cap-header h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--card-foreground);
}

.cap-count {
  font-size: 12px;
  color: var(--muted-foreground);
  background: var(--muted);
  padding: 4px 10px;
  border-radius: 12px;
}

.cap-close {
  background: none;
  border: none;
  color: var(--muted-foreground);
  cursor: pointer;
  font-size: 20px;
  padding: 6px 10px;
  border-radius: 6px;
}

.cap-close:hover {
  background: var(--muted);
}

.cap-controls {
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 12px;
  align-items: center;
  flex-shrink: 0;
}

.cap-search {
  flex: 1;
  padding: 10px 14px;
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--card-foreground);
  font-size: 14px;
  outline: none;
}

.cap-search:focus {
  border-color: var(--ring);
}

.cap-tabs {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.cap-tab {
  background: var(--muted);
  border: none;
  color: var(--muted-foreground);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}

.cap-tab:hover {
  background: var(--accent);
}

.cap-tab.active {
  background: var(--primary);
  color: var(--primary-foreground);
}

.cap-tab-num {
  font-size: 11px;
  opacity: 0.7;
}

.cap-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}

.cap-loading,
.cap-empty {
  text-align: center;
  padding: 60px;
  color: var(--muted-foreground);
}

.cap-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.cap-card {
  background: var(--muted);
  border: 2px solid transparent;
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cap-card:hover {
  border-color: var(--border);
  background: var(--accent);
}

.cap-card.selected {
  border-color: var(--primary);
  background: var(--accent);
}

.cap-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cap-card-header input {
  cursor: pointer;
}

.cap-card-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
}

.cap-card-badge.client {
  background: rgba(74, 158, 255, 0.2);
  color: #4a9eff;
}

.cap-card-badge.server {
  background: rgba(74, 255, 158, 0.2);
  color: #4ae09e;
}

.cap-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--card-foreground);
}

.cap-card-desc {
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cap-card-category {
  font-size: 10px;
  color: var(--muted-foreground);
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.cap-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.cap-selected-count {
  font-size: 13px;
  color: var(--muted-foreground);
}

.cap-selected-count strong {
  color: var(--primary);
}

.cap-hint {
  font-size: 13px;
  color: var(--muted-foreground);
  opacity: 0.7;
}

.cap-actions {
  display: flex;
  gap: 8px;
}

.cap-btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  background: var(--muted);
  color: var(--card-foreground);
  transition: all 0.15s;
}

.cap-btn:hover {
  background: var(--accent);
}

.cap-btn-primary {
  background: var(--primary);
  color: var(--primary-foreground);
}

.cap-btn-primary:hover:not(:disabled) {
  opacity: 0.85;
}

.cap-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>

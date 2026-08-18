<template>
  <Teleport to="body">
    <div v-if="isOpen" class="capability-overlay" @click.self="close">
      <div class="capability-modal">
        <!-- Header -->
        <div class="cap-header">
          <h2>能力库</h2>
          <span class="cap-count">{{ allTools.length }} 个工具</span>
          <button class="cap-close" @click="close">✕</button>
        </div>

        <!-- Search -->
        <div class="cap-search-row">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索工具..."
            class="cap-search-input"
          />
          <div class="cap-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.value"
              :class="['cap-tab', { active: activeTab === tab.value }]"
              @click="activeTab = tab.value"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>

        <!-- Tool List -->
        <div class="cap-content">
          <div v-if="loading" class="cap-loading">加载中...</div>
          <div v-else-if="filteredTools.length === 0" class="cap-empty">暂无匹配的工具</div>
          <div v-else class="cap-list">
            <div
              v-for="tool in filteredTools"
              :key="tool.id"
              :class="['cap-item', { selected: isSelected(tool.id) }]"
              @click="toggleSelect(tool)"
            >
              <input
                type="checkbox"
                :checked="isSelected(tool.id)"
                @click.stop
                @change="toggleSelect(tool)"
              />
              <div class="cap-item-info">
                <span class="cap-item-name">{{ tool.displayName }}</span>
                <span class="cap-item-desc">{{ tool.description }}</span>
              </div>
              <span :class="['cap-badge', tool.source]">{{ tool.source === 'client' ? '本地' : '云端' }}</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="cap-footer">
          <span v-if="selectedCount > 0" class="cap-selected">已选 {{ selectedCount }} 个</span>
          <span v-else class="cap-hint">点击选择工具</span>
          <div class="cap-actions">
            <button class="cap-btn" @click="clearSelection">清空</button>
            <button
              class="cap-btn cap-btn-primary"
              :disabled="selectedCount === 0"
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
import { ref, computed, watch } from 'vue';

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

  // Client capabilities
  try {
    const res = await fetch('/api/capabilities');
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
    console.warn('Failed to fetch client capabilities:', e);
  }

  // Server capabilities
  try {
    const res = await fetch('/api/agent/server-capabilities');
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
    console.warn('Failed to fetch server capabilities:', e);
  }

  allTools.value = tools;
  loading.value = false;
}

watch(() => props.isOpen, (val) => {
  if (val) {
    selectedIds.value.clear();
    fetchTools();
  }
});

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
        t.category.toLowerCase().includes(q)
    );
  }
  return tools;
});

const selectedCount = computed(() => selectedIds.value.size);

function isSelected(id: string) {
  return selectedIds.value.has(id);
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
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.capability-modal {
  width: 100%;
  max-width: 700px;
  max-height: 85vh;
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cap-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.cap-header h2 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.cap-count {
  font-size: 12px;
  color: var(--text-muted);
  background: var(--surface);
  padding: 2px 8px;
  border-radius: 10px;
}

.cap-close {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 18px;
  padding: 4px 8px;
  border-radius: 4px;
}

.cap-close:hover {
  background: var(--surface);
}

.cap-search-row {
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cap-search-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--foreground);
  font-size: 13px;
  outline: none;
}

.cap-search-input:focus {
  border-color: var(--primary, #4a9eff);
}

.cap-tabs {
  display: flex;
  gap: 6px;
}

.cap-tab {
  background: var(--surface);
  border: none;
  color: var(--text-muted);
  padding: 6px 12px;
  border-radius: 14px;
  font-size: 12px;
  cursor: pointer;
}

.cap-tab.active {
  background: var(--primary, #4a9eff);
  color: #fff;
}

.cap-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px;
}

.cap-loading,
.cap-empty {
  text-align: center;
  padding: 40px;
  color: var(--text-muted);
}

.cap-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cap-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.cap-item:hover {
  background: var(--surface);
}

.cap-item.selected {
  background: rgba(74, 158, 255, 0.1);
}

.cap-item input {
  cursor: pointer;
  flex-shrink: 0;
}

.cap-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cap-item-name {
  font-size: 13px;
  font-weight: 500;
}

.cap-item-desc {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cap-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  flex-shrink: 0;
}

.cap-badge.client {
  background: rgba(74, 158, 255, 0.15);
  color: #4a9eff;
}

.cap-badge.server {
  background: rgba(74, 255, 158, 0.15);
  color: #4ae09e;
}

.cap-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
}

.cap-selected {
  font-size: 12px;
  color: var(--text-muted);
}

.cap-hint {
  font-size: 12px;
  color: var(--text-muted);
  opacity: 0.6;
}

.cap-actions {
  display: flex;
  gap: 8px;
}

.cap-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  background: var(--surface);
  color: var(--foreground);
}

.cap-btn:hover {
  background: var(--surface-hover, #3a3a5a);
}

.cap-btn-primary {
  background: var(--primary, #4a9eff);
  color: #fff;
}

.cap-btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.cap-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>

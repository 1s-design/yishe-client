<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
      <section class="flex max-h-[min(680px,calc(100vh-2rem))] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="agent-config-title">
        <header class="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="agent-config-title" class="font-semibold">AI 使用设置</h2>
            <p class="mt-1 text-xs text-muted-foreground">配置衣设 Agent 使用的模型端点。</p>
          </div>
          <Button variant="ghost" size="icon" title="关闭" @click="emit('close')">
            <span class="mdi mdi-close text-lg" />
          </Button>
        </header>

        <div class="flex-1 space-y-5 overflow-y-auto p-5">
          <div class="grid grid-cols-2 rounded-lg border border-border p-1">
            <Button :variant="!isCustom ? 'secondary' : 'ghost'" size="sm" @click="isCustom = false">云端同步</Button>
            <Button :variant="isCustom ? 'secondary' : 'ghost'" size="sm" @click="isCustom = true">自定义端点</Button>
          </div>

          <div v-if="!isCustom" class="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
            <p class="text-sm leading-6 text-muted-foreground">从衣设云端同步 `ai.client-agent.execute` 绑定的模型配置。自定义端点适合 DeepSeek、OpenAI-compatible 或本地 Ollama。</p>
            <Button variant="outline" :disabled="syncing" @click="handleSyncCloud">
              <span v-if="syncing" class="mdi mdi-loading animate-spin" />
              <span>{{ syncing ? '同步中…' : '从云端同步配置' }}</span>
            </Button>
            <p v-if="syncResult" :class="syncResult.ok ? 'text-emerald-600' : 'text-destructive'" class="text-xs">{{ syncResult.message }}</p>
          </div>

          <div class="space-y-4">
            <label class="block space-y-1.5 text-sm">
              <span class="font-medium">模型</span>
              <InputGroup><InputGroupInput v-model="config.model" placeholder="deepseek-chat" /></InputGroup>
            </label>
            <label class="block space-y-1.5 text-sm">
              <span class="font-medium">Base URL</span>
              <InputGroup><InputGroupInput v-model="config.baseUrl" placeholder="https://api.deepseek.com/v1" /></InputGroup>
            </label>
            <label class="block space-y-1.5 text-sm">
              <span class="font-medium">API Key</span>
              <InputGroup><InputGroupInput v-model="config.apiKey" type="password" placeholder="sk-…" /></InputGroup>
            </label>
            <label class="block space-y-1.5 text-sm">
              <span class="flex justify-between"><span class="font-medium">Temperature</span><span class="text-muted-foreground">{{ config.temperature }}</span></span>
              <input v-model.number="config.temperature" type="range" min="0" max="2" step="0.1" class="w-full accent-primary" />
            </label>
          </div>
          <p v-if="saveStatus" :class="saveStatus.type === 'success' ? 'text-emerald-600' : 'text-destructive'" class="text-xs">{{ saveStatus.message }}</p>
        </div>

        <footer class="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" @click="emit('close')">取消</Button>
          <Button :disabled="saving" @click="handleSave">{{ saving ? '保存中…' : '保存配置' }}</Button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { AgentConfig } from '../../types/agent'
import { getRemoteApiBase } from '../../config/api'
import { Button } from '../ui/button'
import { InputGroup, InputGroupInput } from '../ui/input-group'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: []; save: [config: Partial<AgentConfig>] }>()
const isCustom = ref(false)
const saving = ref(false)
const syncing = ref(false)
const syncResult = ref<{ ok: boolean; message: string } | null>(null)
const saveStatus = ref<{ type: 'success' | 'error'; message: string } | null>(null)
const config = reactive<AgentConfig>({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', temperature: 0.7 })

// Loading happens when the modal is opened; this keeps the settings fresh after a cloud sync.
watch(() => props.visible, async visible => {
  if (!visible) return
  const saved = await (window as any).api?.agent?.getConfig?.()
  if (!saved) return
  Object.assign(config, { model: saved.model || config.model, baseUrl: saved.baseUrl || config.baseUrl, apiKey: saved.apiKey || '', temperature: saved.temperature ?? 0.7 })
  isCustom.value = !!saved.isCustom
  saveStatus.value = null
}, { immediate: true })


async function handleSave() {
  saving.value = true
  try {
    emit('save', { ...config, isCustom: isCustom.value, enabled: true })
    saveStatus.value = { type: 'success', message: '配置已保存' }
  } catch (error: any) {
    saveStatus.value = { type: 'error', message: error?.message || '保存失败' }
  } finally { saving.value = false }
}

async function handleSyncCloud() {
  syncing.value = true
  syncResult.value = null
  try {
    const token = await (window as any).api?.getToken?.()
    if (!token) throw new Error('未登录，无法同步云端配置')
    const result = await (window as any).api?.agent?.syncCloudConfig?.({ serverBase: getRemoteApiBase(), token })
    if (!result?.model) throw new Error('云端未配置 Agent Key')
    Object.assign(config, { model: result.model, baseUrl: result.baseUrl || config.baseUrl, apiKey: result.apiKey || '' })
    isCustom.value = false
    syncResult.value = { ok: true, message: `已同步 ${result.model}` }
  } catch (error: any) {
    syncResult.value = { ok: false, message: error?.message || '同步失败' }
  } finally { syncing.value = false }
}
</script>

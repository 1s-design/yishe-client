<template>
  <main class="agent-main">
    <div class="agent-layout">
      <Conversation aria-label="衣设 Agent 对话" class="agent-conversation">
        <ConversationContent class="agent-conversation__content">
          <div v-if="messages.length === 0" class="agent-empty-state">
            <div class="agent-empty-state__inner">
              <template v-if="isConfigLoaded && !isConfigured">
                <h1>客户端 Agent 尚未配置</h1>
                <p class="agent-config-notice">
                  请前往管理端绑定「客户端 Agent」模型后再使用。
                </p>
              </template>
              <template v-else>
                <h1>有什么可以帮你？</h1>
                <div class="agent-suggestions">
                  <button
                    v-for="item in suggestions"
                    :key="item.prompt"
                    type="button"
                    class="agent-suggestion"
                    @click="emit('send', item.prompt)"
                  >
                    <span
                      :class="['mdi', item.icon, 'agent-suggestion__icon']"
                      aria-hidden="true"
                    />
                    <span>{{ item.title }}</span>
                  </button>
                </div>
              </template>
            </div>
          </div>

          <template v-else>
            <Message
              v-for="message in messages"
              :key="message.id"
              :from="message.role === 'user' ? 'user' : 'assistant'"
              :class="[
                'agent-message',
                message.role === 'user' ? 'is-user' : 'is-assistant',
              ]"
            >
              <Attachments
                v-if="message.attachments?.length"
                variant="inline"
                class="agent-attachments"
              >
                <Attachment
                  v-for="attachment in message.attachments"
                  :key="attachment.id"
                  :data="attachment"
                >
                  <AttachmentPreview />
                  <AttachmentInfo />
                </Attachment>
              </Attachments>

              <MessageContent
                v-if="message.role === 'user'"
                class="agent-user-content"
              >
                <p class="whitespace-pre-wrap break-words">
                  {{ message.content }}
                </p>
              </MessageContent>

              <div v-else class="agent-assistant-content">
                <Reasoning
                  v-if="message.reasoning"
                  :is-streaming="message.isStreaming"
                  :default-open="message.isStreaming"
                  class="agent-reasoning"
                >
                  <ReasoningTrigger>
                    <span
                      v-if="message.isStreaming"
                      class="agent-thinking-spinner"
                      aria-hidden="true"
                    />
                    <span>{{
                      message.isStreaming ? "正在思考" : "思考过程"
                    }}</span>
                  </ReasoningTrigger>
                  <ReasoningContent>{{ message.reasoning }}</ReasoningContent>
                </Reasoning>

                <section
                  v-if="message.interaction"
                  class="agent-approval"
                  :class="`is-${message.interaction.status}`"
                >
                  <div class="agent-approval__header">
                    <span class="agent-approval__dot" aria-hidden="true" />
                    <span>{{
                      message.interaction.riskLevel === "system"
                        ? "需要系统权限"
                        : "需要你的确认"
                    }}</span>
                  </div>
                  <p>
                    {{
                      message.interaction.description ||
                      `准备执行 ${message.interaction.toolName}`
                    }}
                  </p>
                  <div class="agent-approval__tool">
                    <span class="mdi mdi-wrench" aria-hidden="true" />
                    <span>{{ message.interaction.toolName }}</span>
                  </div>
                  <pre
                    v-if="Object.keys(message.interaction.args || {}).length"
                    >{{ formatJson(message.interaction.args) }}</pre
                  >
                  <div
                    v-if="message.interaction.status === 'pending'"
                    class="agent-approval__actions"
                  >
                    <button
                      type="button"
                      class="agent-approval__cancel"
                      @click="
                        emit('resolveToolApproval', {
                          callId: message.interaction.id,
                          approved: false,
                        })
                      "
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      class="agent-approval__confirm"
                      @click="
                        emit('resolveToolApproval', {
                          callId: message.interaction.id,
                          approved: true,
                        })
                      "
                    >
                      执行
                    </button>
                  </div>
                  <span v-else class="agent-approval__state">{{
                    message.interaction.status === "approved"
                      ? "已确认，正在执行"
                      : "已取消"
                  }}</span>
                </section>

                <div v-if="message.toolCalls?.length" class="agent-tools">
                  <Tool
                    v-for="tool in message.toolCalls"
                    :key="tool.id"
                    :default-open="tool.status === 'running'"
                    class="agent-tool"
                  >
                    <ToolHeader :name="tool.name">
                      <span class="agent-tool__name">
                        <span class="mdi mdi-wrench" />
                        <span>{{ tool.name }}</span>
                      </span>
                      <ToolStatusBadge :status="tool.status">
                        {{
                          tool.status === "running"
                            ? "执行中"
                            : tool.status === "error"
                              ? "失败"
                              : "完成"
                        }}
                      </ToolStatusBadge>
                    </ToolHeader>
                    <ToolInput
                      v-if="Object.keys(tool.args || {}).length"
                      class="agent-tool__section"
                    >
                      <pre>{{ formatJson(tool.args) }}</pre>
                    </ToolInput>
                    <ToolOutput
                      v-if="tool.result !== undefined || tool.error"
                      class="agent-tool__section"
                    >
                      <pre>{{ tool.error || formatJson(tool.result) }}</pre>
                    </ToolOutput>
                  </Tool>
                </div>

                <MessageContent class="agent-assistant-message">
                  <MessageResponse
                    v-if="message.content"
                    :content="message.content"
                  />
                  <span
                    v-if="message.isStreaming && !message.content"
                    class="agent-streaming-loader"
                  >
                    <span class="agent-thinking-spinner" aria-hidden="true" />
                    <span>正在思考</span>
                  </span>
                  <p v-if="message.error" class="agent-message-error">
                    {{ message.error }}
                  </p>
                </MessageContent>

                <MessageActions
                  v-if="message.content && !message.isStreaming"
                  class="agent-message-actions"
                >
                  <MessageAction
                    title="复制"
                    @click="copyText(message.content)"
                  >
                    <span class="mdi mdi-content-copy" />
                  </MessageAction>
                </MessageActions>
              </div>
            </Message>
          </template>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div
        class="agent-composer-wrap"
        @dragover.prevent
        @drop.prevent="handleDrop"
      >
        <PromptInput class="agent-composer">
          <PromptInputHeader
            v-if="attachedFiles.length"
            class="agent-composer__attachments"
          >
            <Attachments variant="inline">
              <Attachment
                v-for="attachment in attachedFiles"
                :key="attachment.id"
                :data="attachment"
                @remove="removeAttachment(attachment.id)"
              >
                <AttachmentPreview />
                <AttachmentInfo />
                <AttachmentRemove />
              </Attachment>
            </Attachments>
          </PromptInputHeader>

          <PromptInputBody>
            <div class="agent-composer__row">
              <input
                ref="fileInputRef"
                class="hidden"
                type="file"
                multiple
                @change="handleFileInputChange"
              />
              <button
                type="button"
                class="agent-composer__button"
                :disabled="!isConfigured"
                title="添加附件"
                @click="fileInputRef?.click()"
              >
                <span class="mdi mdi-paperclip" />
                <span class="sr-only">添加附件</span>
              </button>
              <PromptInputTextarea
                v-model="inputText"
                :disabled="isStreaming || !isConfigured"
                :placeholder="
                  isConfigured ? '发送消息…' : '请先在管理端配置客户端 Agent'
                "
                @paste="handlePaste"
                @submit="handleSubmit"
              />
              <button
                v-if="isStreaming"
                type="button"
                class="agent-composer__button agent-composer__button--stop"
                title="停止生成"
                @click="emit('stop')"
              >
                <span class="mdi mdi-stop" />
              </button>
              <PromptInputSubmit
                v-else
                :disabled="
                  !isConfigured || (!inputText.trim() && !attachedFiles.length)
                "
                class="agent-composer__submit"
                title="发送"
                @click="handleSubmit"
              >
                <span class="mdi mdi-arrow-up" />
              </PromptInputSubmit>
            </div>
          </PromptInputBody>
        </PromptInput>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { AttachmentData, ChatMessage } from "../../types/agent";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "../ai-elements/attachments";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "../ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
} from "../ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../ai-elements/reasoning";
import {
  Tool,
  ToolHeader,
  ToolInput,
  ToolOutput,
  ToolStatusBadge,
} from "../ai-elements/tool";

withDefaults(
  defineProps<{
    messages: ChatMessage[];
    isStreaming?: boolean;
    isConfigured?: boolean;
    isConfigLoaded?: boolean;
  }>(),
  { isConfigured: false, isConfigLoaded: false },
);
const emit = defineEmits<{
  send: [text: string, attachments?: AttachmentData[]];
  stop: [];
  resolveToolApproval: [payload: { callId: string; approved: boolean }];
}>();
const inputText = ref("");
const attachedFiles = ref<AttachmentData[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);

const suggestions = [
  {
    icon: "mdi-image-multiple-outline",
    title: "搜集素材",
    prompt: "帮我搜集适合电商主图的 5 个 SVG 素材",
  },
  {
    icon: "mdi-image-search-outline",
    title: "分析图片",
    prompt: "分析我上传的图片，并给出一份设计优化建议",
  },
  {
    icon: "mdi-lightbulb-outline",
    title: "寻找灵感",
    prompt: "帮我整理今天值得关注的设计灵感和行业资讯",
  },
  {
    icon: "mdi-lightning-bolt-outline",
    title: "执行自动化",
    prompt: "我想把一组图片批量处理成统一尺寸，应该怎么做？",
  },
];

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text);
}

function handleSubmit() {
  const text = inputText.value.trim();
  if (!text && attachedFiles.value.length === 0) return;
  emit(
    "send",
    text,
    attachedFiles.value.length ? [...attachedFiles.value] : undefined,
  );
  inputText.value = "";
  attachedFiles.value = [];
}

function removeAttachment(id: string) {
  attachedFiles.value = attachedFiles.value.filter((item) => item.id !== id);
}

function readFile(file: File): Promise<AttachmentData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: `attachment_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: file.name || "粘贴图片",
        filename: file.name || "粘贴图片",
        mediaType: file.type || "application/octet-stream",
        size: file.size,
        url: String(reader.result),
        dataUrl: String(reader.result),
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addFiles(files: FileList | File[]) {
  const next = await Promise.all(Array.from(files).map(readFile));
  attachedFiles.value.push(...next);
}

function handleFileInputChange(event: Event) {
  const files = (event.target as HTMLInputElement).files;
  if (files) void addFiles(files);
  if (event.target instanceof HTMLInputElement) event.target.value = "";
}

function handleDrop(event: DragEvent) {
  if (event.dataTransfer?.files.length) void addFiles(event.dataTransfer.files);
}

function handlePaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files || []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (files.length) {
    event.preventDefault();
    void addFiles(files);
  }
}
</script>

<style scoped>
.agent-main {
  --agent-main-bg: var(--theme-bg);
  --agent-surface: var(--theme-surface);
  --agent-surface-soft: var(--theme-surface-muted);
  --agent-border: var(--theme-border-strong);
  --agent-border-soft: var(--theme-border);
  --agent-text: var(--theme-text);
  --agent-muted: var(--theme-text-muted);
  --agent-user-bubble: color-mix(
    in srgb,
    var(--theme-surface-muted) 88%,
    var(--theme-bg)
  );
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background: color-mix(in srgb, var(--agent-main-bg) 86%, transparent);
  color: var(--agent-text);
}

.agent-layout {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  /* hiddenInset 标题栏会覆盖 Renderer 顶部，给首条流式消息保留安全区。 */
  padding: 38px 20px 0;
}

.agent-conversation {
  width: 100%;
  min-height: 0;
  flex: 1;
}

.agent-conversation__content {
  width: min(100%, 760px);
  min-height: 100%;
  gap: 0;
  margin: 0 auto;
  padding: 18px 0 30px;
}

.agent-empty-state {
  display: flex;
  width: 100%;
  min-height: calc(100vh - 228px);
  align-items: center;
  justify-content: center;
  padding: 24px 0 32px;
}

.agent-empty-state__inner {
  display: flex;
  width: min(100%, 620px);
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.agent-empty-state__inner h1 {
  margin: 0;
  color: var(--agent-text);
  font-size: clamp(22px, 2.1vw, 28px);
  font-weight: 600;
  letter-spacing: -0.035em;
}

.agent-config-notice {
  margin: 11px 0 0;
  color: var(--agent-muted);
  font-size: 12px;
  line-height: 1.6;
}

.agent-suggestions {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 26px;
}

.agent-suggestion {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--agent-border-soft);
  border-radius: 10px;
  background: transparent;
  color: var(--agent-text);
  cursor: pointer;
  padding: 0 12px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  transition:
    border-color 150ms ease,
    background-color 150ms ease;
}

.agent-suggestion:hover,
.agent-suggestion:focus-visible {
  border-color: var(--agent-border);
  background: var(--agent-surface);
  outline: none;
}

.agent-suggestion__icon {
  color: var(--agent-muted);
  font-size: 15px;
}

.agent-message {
  width: 100%;
}

.agent-message + .agent-message {
  margin-top: 34px;
}

.agent-user-content {
  max-width: min(82%, 620px) !important;
  border-radius: 22px !important;
  background: var(--agent-user-bubble) !important;
  padding: 11px 16px !important;
  color: var(--agent-text) !important;
  font-size: 14px !important;
  line-height: 1.55 !important;
}

.agent-assistant-content {
  width: 100%;
}

.agent-assistant-message {
  width: 100% !important;
  color: var(--agent-text) !important;
  font-size: 14px !important;
  line-height: 1.65 !important;
}

.agent-assistant-message :deep(.markdown-body) {
  font-size: 14px;
  line-height: 1.7;
}

.agent-assistant-message :deep(.markdown-body p:last-child) {
  margin-bottom: 0;
}

.agent-message-actions {
  margin-top: 7px;
  opacity: 0;
  transition: opacity 150ms ease;
}

.agent-message:hover .agent-message-actions,
.agent-message:focus-within .agent-message-actions {
  opacity: 1;
}

.agent-message-actions :deep(button) {
  width: 27px;
  height: 27px;
  color: var(--agent-muted);
}

.agent-message-error {
  margin: 9px 0 0;
  color: #d35d5d;
  font-size: 12px;
}

.agent-reasoning {
  margin-bottom: 15px !important;
}

.agent-reasoning :deep(button) {
  color: var(--agent-muted);
  font-size: 12px;
}

.agent-reasoning :deep(button:hover) {
  color: var(--agent-text);
}

.agent-thinking-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  border: 1.5px solid color-mix(in srgb, currentColor 22%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: agent-spin 700ms linear infinite;
}

.agent-approval {
  width: min(100%, 520px);
  margin: 0 0 15px;
  padding: 11px 12px;
  border: 1px solid var(--agent-border-soft);
  border-radius: 10px;
  background: var(--agent-surface);
}

.agent-approval__header,
.agent-approval__tool {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--agent-text);
  font-size: 11px;
  font-weight: 600;
}

.agent-approval__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #dba94a;
}

.agent-approval p {
  margin: 8px 0;
  color: var(--agent-muted);
  font-size: 11px;
  line-height: 1.5;
}

.agent-approval__tool .mdi {
  color: var(--agent-muted);
  font-size: 13px;
}

.agent-approval pre {
  max-height: 100px;
  margin: 9px 0 0;
  padding: 7px 8px;
  overflow: auto;
  border-radius: 6px;
  background: var(--agent-main-bg);
  color: var(--agent-muted);
  font-family: "SF Mono", "Fira Code", Consolas, monospace;
  font-size: 10px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agent-approval__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 10px;
}

.agent-approval__actions button {
  min-height: 26px;
  border-radius: 6px;
  cursor: pointer;
  padding: 0 10px;
  font: inherit;
  font-size: 11px;
}

.agent-approval__cancel {
  border: 1px solid var(--agent-border);
  background: transparent;
  color: var(--agent-muted);
}

.agent-approval__confirm {
  border: 1px solid var(--agent-text);
  background: var(--agent-text);
  color: var(--agent-main-bg);
}

.agent-approval__state {
  display: block;
  margin-top: 9px;
  color: var(--agent-muted);
  font-size: 10px;
}

.agent-approval.is-rejected .agent-approval__dot {
  background: #d35d5d;
}

.agent-approval.is-approved .agent-approval__dot {
  background: #54b978;
}

.agent-tools {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0 0 18px;
}

.agent-tool {
  width: calc(100% - 16px);
  margin: 0 8px !important;
  padding: 7px 8px 8px;
  overflow: hidden;
  border: 1px solid var(--agent-border-soft) !important;
  border-radius: 11px !important;
  background: var(--agent-surface) !important;
}

.agent-tool :deep([data-slot="collapsible-trigger"]) {
  min-height: 45px;
  box-sizing: border-box;
  padding: 0 20px !important;
}

.agent-tool__name {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--agent-text);
  font-family: inherit;
  font-size: 12px;
}

.agent-tool__name .mdi {
  color: var(--agent-muted);
}

.agent-tool__section {
  margin-top: 8px !important;
  border-top: 1px solid var(--agent-border-soft);
  padding: 16px 20px !important;
}

.agent-tool__section pre {
  max-height: 220px;
  margin: 0;
  overflow: auto;
  color: var(--agent-muted);
  font-family: "SF Mono", "Fira Code", Consolas, monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agent-streaming-loader {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--agent-muted);
  font-size: 12px;
  line-height: 1.5;
}

.agent-composer-wrap {
  width: min(100%, 760px);
  flex: 0 0 auto;
  margin: 0 auto;
  padding: 0 0 13px;
}

.agent-composer {
  margin: 0 !important;
  padding: 0 !important;
  border: 1px solid var(--agent-border-soft) !important;
  border-radius: 16px !important;
  background: var(--agent-surface) !important;
  box-shadow: none !important;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.agent-composer:focus-within {
  border-color: color-mix(
    in srgb,
    var(--agent-text) 35%,
    var(--agent-border)
  ) !important;
  box-shadow: none !important;
}

.agent-composer__row {
  display: flex;
  width: 100%;
  min-height: 52px;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
}

.agent-composer__row > .agent-composer__button,
.agent-composer__row > .agent-composer__submit {
  flex: 0 0 28px;
  align-self: center;
  margin: 0;
  line-height: 1;
}

.agent-composer :deep(textarea) {
  width: auto !important;
  min-height: 38px !important;
  flex: 1 1 0 !important;
  align-self: center !important;
  margin: 0 !important;
  padding: 8px 3px !important;
  color: var(--agent-text) !important;
  font-size: 14px !important;
  line-height: 1.5 !important;
}

.agent-composer :deep(textarea::placeholder) {
  color: var(--agent-muted) !important;
  opacity: 1;
}

.agent-composer__attachments {
  border-bottom: 1px solid var(--agent-border-soft);
  padding: 10px 12px 8px !important;
}

.agent-composer__button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-self: center;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--agent-muted);
  cursor: pointer;
  font-size: 17px;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.agent-composer__button:hover {
  background: var(--agent-surface-soft);
  color: var(--agent-text);
}

.agent-composer__button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.agent-composer__button--stop {
  background: var(--agent-text);
  color: var(--agent-main-bg);
  font-size: 13px;
}

.agent-composer__button--stop:hover {
  background: var(--agent-text);
  color: var(--agent-main-bg);
}

.agent-composer__submit {
  display: inline-flex !important;
  width: 28px !important;
  height: 28px !important;
  flex: 0 0 28px !important;
  align-self: center !important;
  align-items: center !important;
  justify-content: center !important;
  margin: 0 !important;
  line-height: 1 !important;
  border-radius: 7px !important;
  background: var(--agent-text) !important;
  color: var(--agent-main-bg) !important;
  font-size: 16px !important;
}

.agent-composer__submit:disabled {
  background: var(--agent-surface-soft) !important;
  color: var(--agent-muted) !important;
  opacity: 1 !important;
}

@keyframes agent-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .agent-layout {
    padding: 28px 12px 0;
  }

  .agent-suggestions {
    grid-template-columns: 1fr;
  }

  .agent-user-content {
    max-width: 90% !important;
  }
}
</style>

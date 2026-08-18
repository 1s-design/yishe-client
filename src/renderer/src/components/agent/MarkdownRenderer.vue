<template>
  <div class="markdown-body" v-html="rendered"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  content: string;
}>();

/**
 * 轻量级 Markdown → HTML 渲染器
 * 支持：代码块、行内代码、标题、粗体、斜体、链接、列表、引用
 */
const rendered = computed(() => {
  if (!props.content) return '';
  return renderMarkdown(props.content);
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(md: string): string {
  if (!md) return '';

  // 保护代码块（fenced code blocks）
  const codeBlocks: string[] = [];
  let result = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length;
    const langLabel = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : '';
    codeBlocks.push(
      `<pre class="code-block">${langLabel}<code class="language-${escapeHtml(lang)}">${escapeHtml(code.trim())}</code></pre>`
    );
    return `__CODE_BLOCK_${idx}__`;
  });

  // 行内代码
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    return `<code class="inline-code">${escapeHtml(code)}</code>`;
  });

  // 标题
  result = result.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  result = result.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  result = result.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 粗体 + 斜体
  result = result.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 图片 [![alt](url)](optional-link) —— 必须在链接处理之前，否则 ![ 会被链接正则吞掉
  result = result.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, alt, src) => {
      return `<img class="markdown-img" src="${escapeHtml(src)}" alt="${escapeHtml(alt || '')}" loading="lazy" />`;
    }
  );

  // 链接
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 列表必须在换行转 <br> 之前成组处理，否则每个 li 之间会被
  // 插入一个额外的 br，视觉上会出现远大于 ChatGPT 的行间距。
  result = result.replace(/(?:^- .+(?:\r?\n|$))+/gm, (match) => {
    const items = match.trim().split(/\r?\n/).map(item => `<li>${item.slice(2)}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  result = result.replace(/(?:^\d+\. .+(?:\r?\n|$))+/gm, (match) => {
    const items = match.trim().split(/\r?\n/).map(item => `<li>${item.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // 引用
  result = result.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // 水平线
  result = result.replace(/^---$/gm, '<hr/>');

  // 段落（将双换行转为段落）
  result = result.replace(/\n\n/g, '</p><p>');

  // 单换行为 <br>
  result = result.replace(/\n/g, '<br/>');

  // 包裹段落
  result = `<p>${result}</p>`;

  // 修复：移除空段落
  result = result.replace(/<p>\s*<\/p>/g, '');

  // 还原代码块
  result = result.replace(/__CODE_BLOCK_(\d+)__/g, (_match, idx) => {
    return codeBlocks[parseInt(idx)];
  });

  return result;
}
</script>

<style scoped>
.markdown-body {
  line-height: 1.7;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.markdown-body :deep(p) {
  margin: 0 0 0.75em 0;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  font-weight: 600;
  margin: 1em 0 0.5em;
  line-height: 1.3;
}

.markdown-body :deep(h1) { font-size: 1.4em; }
.markdown-body :deep(h2) { font-size: 1.25em; }
.markdown-body :deep(h3) { font-size: 1.1em; }

.markdown-body :deep(strong) {
  font-weight: 600;
}

.markdown-body :deep(em) {
  font-style: italic;
}

.markdown-body :deep(a) {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-body :deep(img.markdown-img) {
  display: block;
  max-width: 100%;
  max-height: 320px;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  margin: 0.75em 0;
  border: 1px solid rgba(128, 128, 128, 0.18);
  background: #fafafa;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.markdown-body :deep(ul) {
  list-style: disc;
}

.markdown-body :deep(ol) {
  list-style: decimal;
}

.markdown-body :deep(li) {
  margin: 0.25em 0;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid currentColor;
  opacity: 0.8;
  padding-left: 1em;
  margin: 0.75em 0;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid rgba(128, 128, 128, 0.3);
  margin: 1.5em 0;
}

.markdown-body :deep(.inline-code) {
  background: rgba(128, 128, 128, 0.15);
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-size: 0.875em;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
}

.markdown-body :deep(.code-block) {
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 8px;
  padding: 1em;
  margin: 0.75em 0;
  overflow-x: auto;
  position: relative;
  font-size: 0.85em;
  line-height: 1.6;
}

.markdown-body :deep(.code-block code) {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  white-space: pre;
}

.markdown-body :deep(.code-lang) {
  position: absolute;
  top: 0.5em;
  right: 0.75em;
  font-size: 0.75em;
  opacity: 0.6;
  text-transform: uppercase;
}
</style>

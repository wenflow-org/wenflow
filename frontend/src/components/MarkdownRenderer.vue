<template>
  <div class="markdown-renderer" ref="rendererRef" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from 'vue';
import MarkdownIt from 'markdown-it';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';
import markdownItKatex from 'markdown-it-katex';
import hljs from 'highlight.js';
import mermaid from 'mermaid';

const props = defineProps<{
  content: string;
}>();

const rendererRef = ref<HTMLElement | null>(null);

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

const md = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true,
  highlight: (str: string, lang: string) => {
    if (lang === 'mermaid') {
      return `<pre class="mermaid-code">${md.utils.escapeHtml(str)}</pre>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
    }
    return `<pre><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

md.use(markdownItKatex);

function postProcessMermaid(html: string): string {
  return html
    .replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, '<div class="mermaid">$1</div>')
    .replace(/<pre class="mermaid-code">([\s\S]*?)<\/pre>/g, '<div class="mermaid">$1</div>');
}

async function renderMermaidDiagrams() {
  if (!rendererRef.value) return;
  const mermaidElements = rendererRef.value.querySelectorAll('.mermaid');
  if (mermaidElements.length === 0) return;

  try {
    await mermaid.run({ nodes: Array.from(mermaidElements) as HTMLElement[] });
  } catch (e) {
    console.warn('Mermaid render failed:', e);
  }
}

const renderedHtml = computed(() => {
  const raw = md.render(props.content);
  return postProcessMermaid(raw);
});

watch(renderedHtml, async () => {
  await nextTick();
  await renderMermaidDiagrams();
});

onMounted(async () => {
  await nextTick();
  await renderMermaidDiagrams();
});
</script>

<style scoped>
.markdown-renderer {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 16px;
  line-height: 1.8;
  color: #1f2328;
  word-wrap: break-word;
}

.markdown-renderer :deep(h1),
.markdown-renderer :deep(h2),
.markdown-renderer :deep(h3),
.markdown-renderer :deep(h4),
.markdown-renderer :deep(h5),
.markdown-renderer :deep(h6) {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
  color: #1f2328;
}

.markdown-renderer :deep(h1) {
  font-size: 2em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #d0d7de;
}

.markdown-renderer :deep(h2) {
  font-size: 1.5em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #d0d7de;
}

.markdown-renderer :deep(h3) {
  font-size: 1.25em;
}

.markdown-renderer :deep(p) {
  margin-top: 0;
  margin-bottom: 16px;
}

.markdown-renderer :deep(strong) {
  font-weight: 600;
  color: #24292f;
}

.markdown-renderer :deep(a) {
  color: #0969da;
  text-decoration: none;
}

.markdown-renderer :deep(a:hover) {
  text-decoration: underline;
}

.markdown-renderer :deep(img) {
  max-width: 100%;
  height: auto;
  box-sizing: border-box;
}

.markdown-renderer :deep(pre) {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: #161b22;
  border-radius: 6px;
  margin-bottom: 16px;
}

.markdown-renderer :deep(pre code) {
  padding: 0;
  margin: 0;
  font-size: 100%;
  background-color: transparent;
  color: #e6edf3;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

.markdown-renderer :deep(code) {
  padding: 0.2em 0.4em;
  margin: 0;
  font-size: 85%;
  background-color: rgba(175, 184, 193, 0.2);
  border-radius: 6px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

.markdown-renderer :deep(blockquote) {
  margin: 0 0 16px 0;
  padding: 0 1em;
  color: #656d76;
  border-left: 0.25em solid #d0d7de;
}

.markdown-renderer :deep(blockquote > :first-child) {
  margin-top: 0;
}

.markdown-renderer :deep(blockquote > :last-child) {
  margin-bottom: 0;
}

.markdown-renderer :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow: auto;
  margin-bottom: 16px;
  border-spacing: 0;
  border-collapse: collapse;
}

.markdown-renderer :deep(table th),
.markdown-renderer :deep(table td) {
  padding: 6px 13px;
  border: 1px solid #d0d7de;
}

.markdown-renderer :deep(table tr) {
  background-color: #ffffff;
  border-top: 1px solid #d0d7de;
}

.markdown-renderer :deep(table tr:nth-child(2n)) {
  background-color: #f6f8fa;
}

.markdown-renderer :deep(ul),
.markdown-renderer :deep(ol) {
  margin-top: 0;
  margin-bottom: 16px;
  padding-left: 2em;
}

.markdown-renderer :deep(li) {
  margin-top: 0.25em;
}

.markdown-renderer :deep(hr) {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: #d0d7de;
  border: 0;
}

.markdown-renderer :deep(.katex-display) {
  margin: 1em 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.markdown-renderer :deep(.mermaid) {
  text-align: center;
  margin: 16px 0;
}

.markdown-renderer :deep(.mermaid svg) {
  max-width: 100%;
  height: auto;
}
</style>

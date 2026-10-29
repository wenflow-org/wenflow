// AI 内容安全渲染工具：统一 markdown + 消毒配置（XSS 收敛）
// 消毒配置单一来源见 ./sanitize-config（与 components/MarkdownRenderer.vue 共享）
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { buildAiContentSanitizeConfig } from './sanitize-config';
import { normalizePipeTables } from './markdownTables';
import { normalizeMermaidLabels } from './mermaidCode';

// 原始 HTML 一律丢弃（html:false），仅渲染 markdown 生成的标签
const md: MarkdownIt = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
});

const SANITIZE_CONFIG = buildAiContentSanitizeConfig();

/**
 * 将不可信的 AI 文本渲染为安全的 HTML 字符串（配合 v-html 使用）。
 * 输入为纯文本/markdown；输出已通过 DOMPurify 严格清洗。
 */
export function renderAiMessageHtml(text: string | null | undefined): string {
  const rendered = md.render(normalizePipeTables(text || ''));
  return DOMPurify.sanitize(rendered, SANITIZE_CONFIG) as unknown as string;
}

/**
 * 课堂气泡专用：把 ```mermaid 转成 .mermaid 占位，交给宿主异步 run。
 * 其他消息面（通用聊天、目标对话、后台会话舱）没有 Mermaid 运行器，继续走普通
 * renderAiMessageHtml，保持可读的代码块而不是无样式裸文本。
 */
export function renderAiMessageHtmlWithMermaid(text: string | null | undefined): string {
  const rendered = md.render(normalizePipeTables(text || ''));
  const withMermaid = rendered
    .replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_m, code: string) => `<div class="mermaid">${normalizeMermaidLabels(code)}</div>`)
    .replace(/<pre><code class="hljs language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_m, code: string) => `<div class="mermaid">${normalizeMermaidLabels(code)}</div>`);
  return DOMPurify.sanitize(withMermaid, SANITIZE_CONFIG) as unknown as string;
}

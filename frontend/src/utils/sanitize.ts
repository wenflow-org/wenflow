// AI 内容安全渲染工具：统一 markdown + 消毒配置（XSS 收敛）
// 与 components/MarkdownRenderer.vue 的严格配置保持一致；v2 页面此前各自弱配置（html:true + 不完整 FORBID_TAGS）
import MarkdownIt from 'markdown-it';
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';

// 原始 HTML 一律丢弃（html:false），仅渲染 markdown 生成的标签
const md: MarkdownIt = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
});

const SANITIZE_CONFIG: DOMPurifyConfig = {
  USE_PROFILES: { html: true, mathMl: true },
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base', 'svg', 'foreignObject', 'math', 'mstyle', 'mtext', 'annotation'],
  FORBID_ATTR: ['style', 'srcset', 'onerror', 'onload', 'onclick'],
  ALLOW_DATA_ATTR: false,
};

/**
 * 将不可信的 AI 文本渲染为安全的 HTML 字符串（配合 v-html 使用）。
 * 输入为纯文本/markdown；输出已通过 DOMPurify 严格清洗。
 */
export function renderAiMessageHtml(text: string | null | undefined): string {
  const rendered = md.render(text || '');
  return DOMPurify.sanitize(rendered, SANITIZE_CONFIG) as unknown as string;
}

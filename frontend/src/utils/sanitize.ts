// AI 内容安全渲染工具：统一 markdown + 消毒配置（XSS 收敛）
// 消毒配置单一来源见 ./sanitize-config（与 components/MarkdownRenderer.vue 共享）
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { buildAiContentSanitizeConfig } from './sanitize-config';

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
  const rendered = md.render(text || '');
  return DOMPurify.sanitize(rendered, SANITIZE_CONFIG) as unknown as string;
}

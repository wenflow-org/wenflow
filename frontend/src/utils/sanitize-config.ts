// AI 内容消毒配置单一来源。
// 背景：sanitize.ts 与 components/MarkdownRenderer.vue 曾各自手工维护一份
// DOMPurify 配置并逐渐漂移（math 家族 / style / srcset 差异），注释宣称
// 「保持一致」与事实不符。本模块用参数表达唯一已知的合法差异：
// MarkdownRenderer 渲染 KaTeX 输出需要保留 style 属性，其余场景一律禁用。
import type { Config as DOMPurifyConfig } from 'dompurify';

export interface AiContentSanitizeOptions {
  /**
   * 允许 style 属性。仅 MarkdownRenderer 的 KaTeX 数学公式渲染需要
   * （katex 输出带内联样式的 span）；纯文本聊天等场景必须保持 false。
   */
  allowStyleAttr?: boolean;
}

/**
 * 构造 AI 内容的 DOMPurify 严格配置。
 * 原始 HTML 在 markdown-it 层已被 html:false 转义，此处防御的是
 * markdown 插件产物（链接/图片/KaTeX/mermaid 占位）中混入的危险面。
 */
export function buildAiContentSanitizeConfig(
  options: AiContentSanitizeOptions = {}
): DOMPurifyConfig {
  const forbidAttr = new Set(['srcset', 'onerror', 'onload', 'onclick']);
  if (options.allowStyleAttr !== true) {
    forbidAttr.add('style');
  }

  return {
    USE_PROFILES: { html: true, mathMl: true },
    // math/mstyle/mtext/annotation：html:false 下原始 MathML 本就不会成为活节点，
    // 显式禁止是纵深防御（防未来插件引入）；KaTeX/texmath 输出为 HTML span，不依赖这些标签
    FORBID_TAGS: [
      'script', 'style', 'iframe', 'object', 'embed', 'form', 'input',
      'button', 'link', 'meta', 'base', 'svg', 'foreignObject',
      'math', 'mstyle', 'mtext', 'annotation'
    ],
    FORBID_ATTR: [...forbidAttr],
    ALLOW_DATA_ATTR: false,
  };
}

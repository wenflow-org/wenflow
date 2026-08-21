/**
 * sanitize.ts 回归测试 —— 全站 AI 内容 XSS 收敛的唯一入口（V2GoalConversation/V2LearningPage 聊天气泡）。
 * 此前零覆盖：DOMPurify 配置与 markdown-it 行为的交互很微妙，一次依赖升级或配置调整
 * 就可能静默破坏防线而无任何报警。
 *
 * 断言策略：用 DOMParser 解析输出后查询「活节点/活属性」——
 * 转义后的可见文本（如 &lt;script&gt;）不算注入，字符串包含检查会误报。
 */
import { describe, expect, it } from 'vitest';
import { renderAiMessageHtml } from '../sanitize';

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** 输出中所有真实 <a> 的 href 列表 */
function liveHrefs(html: string): string[] {
  return Array.from(doc(html).querySelectorAll('a'))
    .map((a) => a.getAttribute('href') || '');
}

describe('renderAiMessageHtml 安全回归', () => {
  it('原始 <script> 不产生可执行节点，仅转义为可见文本', () => {
    const out = renderAiMessageHtml('<script>alert(1)</script>');
    expect(doc(out).querySelector('script')).toBeNull();
    expect(out).toContain('&lt;script&gt;');
  });

  it('markdown 链接的 javascript: 协议不会成为任何活链接的 href', () => {
    const out = renderAiMessageHtml('[点我](javascript:alert(1))');
    // markdown-it validateLink 拒绝后保留字面文本，不生成 <a>
    expect(liveHrefs(out).some((h) => /^javascript:/i.test(h))).toBe(false);
    expect(doc(out).querySelectorAll('a').length).toBe(0);
    expect(out).toContain('点我');
  });

  it('vbscript:/data:text/html 协议同样不生成活链接', () => {
    const out1 = renderAiMessageHtml('[a](vbscript:msgbox(1))');
    const out2 = renderAiMessageHtml('[b](DATA:text/html;base64,PHNjcmlwdD4=)');
    expect(liveHrefs(out1).some((h) => /^vbscript:/i.test(h))).toBe(false);
    expect(liveHrefs(out2).some((h) => /^data:text\/html/i.test(h))).toBe(false);
  });

  it('原始 <img onerror> 整体转义，无活 img 节点', () => {
    const out = renderAiMessageHtml('<img src="x" onerror="alert(1)">');
    expect(doc(out).querySelector('img')).toBeNull();
    expect(out).toContain('&lt;img');
  });

  it('原始标签上的 onclick/style/srcset/data-* 属性不存在于任何活节点', () => {
    const out = renderAiMessageHtml('<a href="https://example.com" onclick="alert(1)" style="position:fixed" srcset="x 2x" data-payload="p">x</a>');
    const d = doc(out);
    expect(d.querySelector('[onclick]')).toBeNull();
    expect(d.querySelector('[style]')).toBeNull();
    expect(d.querySelector('[srcset]')).toBeNull();
    expect(d.querySelector('[data-payload]')).toBeNull();
  });

  it('iframe/object/embed/form/input 等危险标签无活节点', () => {
    const out = renderAiMessageHtml([
      '<iframe src="https://evil.example"></iframe>',
      '<object data="x"></object>',
      '<embed src="x">',
      '<form action="x"><input type="text"></form>'
    ].join('\n'));
    const d = doc(out);
    expect(d.querySelector('iframe, object, embed, form, input')).toBeNull();
  });

  it('svg/math/foreignObject 无活节点（mathMl profile 不放行注入）', () => {
    const out = renderAiMessageHtml('<svg><script>alert(1)</script></svg><math><mtext><foreignObject>x</foreignObject></mtext></math>');
    const d = doc(out);
    expect(d.querySelector('svg, math, mtext, foreignObject')).toBeNull();
  });
});

describe('renderAiMessageHtml 功能存活', () => {
  it('基本 markdown 正常渲染：加粗/代码/列表/安全链接', () => {
    const out = renderAiMessageHtml('**重点** 与 `code`\n\n- 条目一\n\n[文档](https://example.com/docs)');
    expect(out).toContain('<strong>重点</strong>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<li>条目一</li>');
    expect(liveHrefs(out)).toContain('https://example.com/docs');
  });

  it('普通 https 图片正常渲染', () => {
    const out = renderAiMessageHtml('![示意图](https://cdn.example.com/a.png)');
    const img = doc(out).querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/a.png');
  });

  it('空输入与 null 安全', () => {
    expect(renderAiMessageHtml('')).toBe('');
    expect(renderAiMessageHtml(null)).toBe('');
    expect(renderAiMessageHtml(undefined)).toBe('');
  });
});
